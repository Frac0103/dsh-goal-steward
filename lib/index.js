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
import { appendAuditRecord, readAuditRecords, resolveAuditFile } from './audit.js';
import { createSessionState, decideReview, decideSteer, recordReview } from './cadence.js';
import { createStewardCommand } from './commands.js';
import { restoreSessionState } from './restore.js';
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

  /**
   * Lifecycle fence.
   *
   * A plugin instance is not permanent: the host reloads it on HMR, disables it
   * from the profile, or unloads it on shutdown, and any of those can happen
   * while a reviewer call is still in flight. `disposed` is the authority
   * boundary — once the instance is retired it must not steer the executor and
   * must not keep writing findings, exactly as a dismissed reviewer does not get
   * to keep issuing audit letters.
   *
   * @type {boolean}
   */
  let disposed = false;

  /** Aborts the in-flight reviewer call when this instance is retired. */
  const lifecycle = new AbortController();

  /** @type {Map<string, ReturnType<typeof createSessionState> & {goalRevision?: number}>} */
  const sessions = new Map();

  /** In-flight audit replays, so concurrent turns do not replay twice. */
  const restorations = new Map();

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

  /**
   * Inherit the session's ledger and earlier findings from the audit trail.
   *
   * Runs once per session per instance, before the first audit decision. The
   * assignment is deliberately partial: only institutional memory is inherited
   * (ledger + findings), never the cadence counters — a reloaded reviewer opens
   * a fresh budget. Fail-open: an unreadable trail simply means "no memory".
   *
   * @param {string} sessionId session whose records to replay.
   * @param {ReturnType<typeof createSessionState>} state live session state.
   * @returns {Promise<void>}
   */
  const ensureRestored = async (sessionId, state) => {
    if (state.restored === true) return;
    const inFlight = restorations.get(sessionId);
    if (inFlight !== undefined) return inFlight;
    // Replay needs a durable trail to read; with `audit: false` the session
    // starts from the opening mandate, exactly as before.
    const task = (async () => {
      state.restored = true;
      if (!config.audit) return;
      try {
        const records = await readAuditRecords(config, sessionId);
        const inherited = restoreSessionState(records);
        if (inherited === null) return;
        if (state.ledger === null && inherited.ledger !== null) state.ledger = inherited.ledger;
        if (state.previousFindings.length === 0) state.previousFindings = inherited.previousFindings;
      } catch {
        // Replay is optional: never let it affect the turn.
      }
    })();
    restorations.set(sessionId, task);
    try {
      await task;
    } finally {
      restorations.delete(sessionId);
    }
  };

  const writeAudit = async (record) => {
    const file = await appendAuditRecord(config, record);
    if (file === null && config.logEvents) log(ctx, 'warn', 'audit record could not be persisted');
  };

  const onTurnStopping = async (payload) => {
    if (disposed) return;
    const agent = payload?.agent;
    const turn = payload?.turn;
    if (!agent?.session || typeof turn !== 'number') return;
    if (!config.includeChildSessions && isChildSession(agent)) return;

    const sessionId = agent.id;
    const state = stateFor(sessionId);

    // Inherit the session's ledger and earlier findings before the first audit
    // decision: a reloaded reviewer must judge against the charter the session
    // already agreed on, not re-derive it from the opening message.
    await ensureRestored(sessionId, state);
    if (disposed) return;

    // Track the durable goal even on turns we do not review, so a principal's
    // goal change is a forced trigger rather than something the cadence may miss.
    const goal = goalSnapshot(ctx, agent);
    const revision = typeof goal?.revision === 'number' ? goal.revision : undefined;
    const goalChanged = revision !== undefined && state.goalRevision !== undefined && revision !== state.goalRevision;
    if (revision !== undefined) state.goalRevision = revision;

    const cadence = decideReview({ turn, state, goalChanged, config });
    if (!cadence.review) return;

    // Teardown must also interrupt the reviewer call, otherwise a retired
    // instance would keep a model request open until the timeout expires.
    const signal = payload?.signal === undefined
      ? lifecycle.signal
      : AbortSignal.any([payload.signal, lifecycle.signal]);

    const result = await reviewSession({
      ctx,
      config,
      agent,
      turn,
      signal,
      state,
    });

    // The instance may have been retired while the reviewer was thinking.
    if (disposed) return;

    if (result.status !== 'ok') {
      // Skips, failures and guarded rewrites still advance the cadence so a
      // broken route cannot turn every turn into an audit attempt.
      state.lastReviewTurn = turn;
      if (result.ledger !== null && result.ledger !== undefined) state.ledger = result.ledger;
      const guardedVerdict = result.verdict ?? null;
      await writeAudit({
        event: 'review',
        outcome: result.status,
        reason: result.reason,
        trigger: cadence.reason,
        sessionId,
        turn,
        route: result.route ?? null,
        elapsedMs: result.elapsedMs ?? null,
        verdict: guardedVerdict?.verdict ?? null,
        severity: guardedVerdict?.severity ?? null,
        driftType: guardedVerdict?.drift_type ?? null,
        evidence: guardedVerdict?.evidence ?? null,
        goalChange: guardedVerdict?.goal_update?.change ?? null,
        goalApplied: false,
        goals: state.ledger === null ? null : {
          revision: state.ledger.revision,
          lastChange: state.ledger.lastChange,
          final: state.ledger.final,
          current: state.ledger.current,
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
        final: state.ledger.final,
        current: state.ledger.current,
      },
    });

    if (config.logEvents) {
      const detail = steered ? 'steered' : `silent:${steering.reason}`;
      log(ctx, 'info', `review session=${sessionId} turn=${turn} verdict=${verdict.verdict} severity=${verdict.severity} goal=${goalUpdate.change} ${detail}`);
    }
  };

  try {
    ctx.effect(function* install() {
      // The prompt section name doubles as the singleton lock: the host registry
      // refuses a duplicate section name, so a second instance of this plugin
      // cannot assemble a second governance protocol or run a second reviewer.
      yield ctx.systemPrompt.section({
        name: GOVERNANCE_SECTION_NAME,
        order: GOVERNANCE_SECTION_ORDER,
        text: GOVERNANCE_TEXT,
      });

      yield ctx.on('agent/turn-stopping', async (payload) => {
        try {
          await onTurnStopping(payload);
        } catch (error) {
          if (disposed) return;
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

      // Collected before the listeners and the section, so on unload it runs
      // first: after this point the instance is inert even while its own
      // registrations are still being removed.
      yield () => {
        disposed = true;
        lifecycle.abort();
        sessions.clear();
        restorations.clear();
      };
    }, 'goal-steward lifecycle');
  } catch (error) {
    // Fail-open at install time too: governance is an addition to a working
    // host, never a precondition for it. The realistic cause is a duplicate
    // mount, which the section-name lock above deliberately rejects; a
    // half-installed second reviewer would audit every turn twice.
    log(ctx, 'warn', `installation skipped: ${errorText(error)}`);
  }

  // Optional human command surface (`/steward`). The command registry is not a
  // hard dependency: a UI-less host never provides it, and the child fiber waits
  // for it without delaying the reviewer. A failed registration is fail-open —
  // the reviewer keeps working even when the command cannot be installed.
  try {
    if (typeof ctx.inject === 'function') {
      const auditPath = resolveAuditFile(config);
      ctx.inject(['commands'], (commandCtx) => {
        const definition = createStewardCommand({
          config,
          auditPath,
          getState: (sessionId) => stateFor(sessionId),
          inherit: async (sessionId) => {
            if (!config.audit) return null;
            try {
              return restoreSessionState(await readAuditRecords(config, sessionId));
            } catch {
              return null;
            }
          },
          writeAudit,
          isDisposed: () => disposed,
        });
        commandCtx.effect(() => commandCtx.commands.register(definition));
      });
    }
  } catch (error) {
    log(ctx, 'warn', `command surface skipped: ${errorText(error)}`);
  }
}
