/**
 * dsh-goal-steward — independent goal governance for DeepSeek Harness.
 *
 * Two surfaces, matching the two lines of defence in the design document:
 *
 * 1. A standing governance protocol in the system prompt (zero extra calls):
 *    the executor's own goal-charter discipline.
 * 2. A role-isolated reviewer call at turn boundaries (management by exception):
 *    it sees only an evidence pack, it has no tools, and it may only *steer* —
 *    never command — the executor.
 *
 * The plugin is deliberately fail-open: every failure inside the governance layer
 * is audited and then ignored, because a reviewer that can break a conversation
 * is worse than no reviewer.
 *
 * @module dsh-goal-steward
 */

import { resolveConfig } from './config.js';
import {
  GOVERNANCE_SECTION_NAME,
  GOVERNANCE_SECTION_ORDER,
  GOVERNANCE_TEXT,
} from './prompt.js';
import { appendAuditRecord } from './audit.js';
import { createSessionState, decideReview, decideSteer, recordReview } from './cadence.js';
import {
  buildSteerMessage,
  goalSnapshot,
  isChildSession,
  reviewSession,
} from './reviewer.js';

/** Cordis plugin identity. */
export const name = 'dsh-goal-steward';

/** Host services that must exist before the plugin is constructed. */
export const inject = ['llm', 'systemPrompt'];

/** Maximum live sessions whose state is retained. */
const MAX_TRACKED_SESSIONS = 512;

/** Best-effort structured logging across host logger shapes. */
function log(ctx, level, message) {
  try {
    const logger = ctx?.logger;
    if (typeof logger === 'function') {
      const scoped = logger('dsh-goal-steward');
      const method = scoped?.[level] ?? scoped;
      if (typeof method === 'function') method.call(scoped, message);
      return;
    }
    const method = logger?.[level];
    if (typeof method === 'function') method.call(logger, message);
  } catch {
    // Logging must never affect governance.
  }
}

/** Render an unknown error as one short line. */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Install the governance layer.
 *
 * @param {any} ctx cordis context.
 * @param {unknown} rawConfig untrusted bundle config.
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  if (!config.enabled) {
    log(ctx, 'info', 'disabled by configuration');
    return;
  }

  /** @type {Map<string, ReturnType<typeof createSessionState> & {goalRevision?: number}>} */
  const sessions = new Map();

  /** Read-or-create per-session state with a bounded LRU-ish map. */
  const stateFor = (sessionId) => {
    let state = sessions.get(sessionId);
    if (state !== undefined) return state;
    state = createSessionState();
    sessions.set(sessionId, state);
    if (sessions.size > MAX_TRACKED_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
    return state;
  };

  const writeAudit = async (record) => {
    const file = await appendAuditRecord(config, record);
    if (file === null && config.logEvents) log(ctx, 'warn', 'audit record could not be persisted');
  };

  const onTurnStopping = async (payload) => {
    const agent = payload?.agent;
    const turn = payload?.turn;
    if (!agent?.session || typeof turn !== 'number') return;
    if (!config.includeChildSessions && isChildSession(agent)) return;

    const sessionId = agent.id;
    const state = stateFor(sessionId);

    // Track the durable goal even on turns we do not review, so a principal's
    // goal change is a forced trigger rather than something the cadence may miss.
    const goal = goalSnapshot(ctx, agent);
    const revision = typeof goal?.revision === 'number' ? goal.revision : undefined;
    const goalChanged = revision !== undefined && state.goalRevision !== undefined && revision !== state.goalRevision;
    if (revision !== undefined) state.goalRevision = revision;

    const cadence = decideReview({ turn, state, goalChanged, config });
    if (!cadence.review) return;

    const result = await reviewSession({
      ctx,
      config,
      agent,
      turn,
      signal: payload?.signal,
      state,
    });

    if (result.status !== 'ok') {
      // Skips and failures still advance the cadence so a broken route cannot
      // turn every turn into an audit attempt.
      state.lastReviewTurn = turn;
      if (result.ledger !== null && result.ledger !== undefined) state.ledger = result.ledger;
      await writeAudit({
        event: 'review',
        outcome: result.status,
        reason: result.reason,
        trigger: cadence.reason,
        sessionId,
        turn,
        route: result.route ?? null,
        elapsedMs: result.elapsedMs ?? null,
        goals: state.ledger === null ? null : {
          revision: state.ledger.revision,
          lastChange: state.ledger.lastChange,
          finalGoal: state.ledger.final?.objective ?? null,
          currentGoal: state.ledger.current?.objective ?? null,
        },
      });
      if (config.logEvents) log(ctx, 'warn', `review ${result.status} (${result.reason}) session=${sessionId} turn=${turn}`);
      return;
    }

    const { verdict, route, elapsedMs, ledger, goalApplied, parseSource } = result;
    if (ledger !== null && ledger !== undefined) state.ledger = ledger;

    const steering = decideSteer({ verdict, state, turn, config });
    let steered = false;
    if (steering.steer) {
      try {
        agent.steer(buildSteerMessage(verdict, turn, state.ledger));
        steered = true;
      } catch (error) {
        if (config.logEvents) log(ctx, 'warn', `steer failed: ${errorText(error)}`);
      }
    }

    recordReview({ state, turn, verdict, steered });
    const goalUpdate = verdict.goal_update ?? { change: 'none' };
    await writeAudit({
      event: 'review',
      outcome: 'ok',
      trigger: cadence.reason,
      sessionId,
      turn,
      verdict: verdict.verdict,
      severity: verdict.severity,
      driftType: verdict.drift_type,
      evidence: verdict.evidence,
      steer: verdict.steer,
      steered,
      steerSkipped: steered ? null : steering.reason,
      route,
      elapsedMs,
      parseSource: parseSource ?? 'text',
      reviewsSoFar: state.reviews,
      steersSoFar: state.steers,
      goalChange: goalUpdate.change,
      goalApplied: goalApplied === true,
      goalRationale: goalUpdate.rationale ?? '',
      goals: state.ledger === null ? null : {
        revision: state.ledger.revision,
        lastChange: state.ledger.lastChange,
        finalGoal: state.ledger.final?.objective ?? null,
        currentGoal: state.ledger.current?.objective ?? null,
      },
    });

    if (config.logEvents) {
      const detail = steered ? 'steered' : `silent:${steering.reason}`;
      log(ctx, 'info', `review session=${sessionId} turn=${turn} verdict=${verdict.verdict} severity=${verdict.severity} goal=${goalUpdate.change} ${detail}`);
    }
  };

  ctx.effect(function* install() {
    yield ctx.systemPrompt.section({
      name: GOVERNANCE_SECTION_NAME,
      order: GOVERNANCE_SECTION_ORDER,
      text: GOVERNANCE_TEXT,
    });

    yield ctx.on('agent/turn-stopping', async (payload) => {
      try {
        await onTurnStopping(payload);
      } catch (error) {
        log(ctx, 'warn', `turn-stopping failed: ${errorText(error)}`);
      }
    });

    yield ctx.on('agent/disposed', (payload) => {
      try {
        const sessionId = payload?.agent?.id;
        if (sessionId !== undefined) sessions.delete(sessionId);
      } catch {
        // Disposal cleanup is best-effort.
      }
    });

    yield () => {
      sessions.clear();
    };
  }, 'goal-steward lifecycle');
}
