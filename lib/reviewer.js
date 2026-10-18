/**
 * The independent reviewer call.
 *
 * This module owns the one place where dsh-goal-steward talks to a model on its
 * own behalf: a single one-shot, tool-less call whose entire input is the
 * evidence pack and whose entire output is one validated verdict. It never
 * reuses the executor's conversation, and it never writes anything except the
 * audit record (owned by the caller) — that is the whole of its authority.
 *
 * @module dsh-goal-steward/reviewer
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { REVIEWER_SYSTEM_PROMPT } from './prompt.js';
import { parseVerdict } from './parse.js';
import {
  buildEvidencePack,
  clip,
  collectFinalAssistantText,
  collectHumanIntent,
  collectRecentActions,
  deriveCharter,
  snapshotEvents,
  surfaceSeqs,
} from './evidence.js';

/** Plugin identity stamped on steering messages. */
export const PLUGIN_ID = 'dsh-goal-steward';

/** Whether this agent is a child session whose turns are intermediate work. */
export function isChildSession(agent) {
  try {
    return agent?.session?.header?.parentSession !== undefined;
  } catch {
    return false;
  }
}

/**
 * Resolve the reviewer route.
 *
 * Independence note: on a single-provider host the reviewer necessarily shares
 * the executor's weights. Role isolation, information isolation, programmatic
 * isolation, and temporal isolation are what remain available — and they are
 * what this module actually implements.
 *
 * @param {import('./config.js').GoalStewardConfig} config
 * @param {{session: {requestHeader?: () => any}}} agent
 * @returns {{provider: string, model: string, source: 'config'|'session'}|null}
 */
export function resolveRoute(config, agent) {
  if (config.reviewProvider && config.reviewModel) {
    return { provider: config.reviewProvider, model: config.reviewModel, source: 'config' };
  }
  try {
    const header = agent?.session?.requestHeader?.();
    const provider = header?.config?.provider;
    const model = header?.config?.model;
    if (typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0) {
      return { provider, model, source: 'session' };
    }
  } catch {
    // A session without a frozen request header is normal on the first turn.
  }
  return null;
}

/**
 * Read the durable goal snapshot, when the host goal service is present.
 *
 * @param {{get?: (name: string) => any}} ctx cordis context.
 * @param {any} agent live agent.
 * @returns {{objective?: string, revision?: number, phase?: string}|undefined}
 */
export function goalSnapshot(ctx, agent) {
  try {
    const goals = typeof ctx?.get === 'function' ? ctx.get('goals') : undefined;
    const goal = goals?.get?.(agent);
    if (goal !== null && typeof goal === 'object') return goal;
  } catch {
    // Goal lookup is optional: most conversations never create a goal.
  }
  return undefined;
}

/**
 * Drain one reviewer stream into its final text.
 *
 * @param {{llm: {stream: (options: object) => AsyncIterable<any>}}} ctx
 * @param {object} options GenerateOptions for the reviewer call.
 * @returns {Promise<string>} assembled text.
 */
export async function streamReviewerText(ctx, options) {
  const assembler = new BlockAssembler();
  /** @type {any} */
  let finish;
  for await (const chunk of ctx.llm.stream(options)) {
    assembler.push(chunk);
    if (chunk?.type === 'finish') {
      finish = chunk.reason;
      break;
    }
  }
  if (finish === undefined) throw new Error('reviewer stream ended without a finish chunk');
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    const failure = finish.failure ?? {};
    throw new Error(`reviewer stream ${finish.kind}: ${failure.code ?? 'unknown'} ${failure.message ?? ''}`.trim());
  }
  const text = assembler
    .blocks()
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
  if (text.length === 0) throw new Error('reviewer produced no text');
  return text;
}

/**
 * Run one reviewer call for the turn that is about to close.
 *
 * Never throws: every failure is returned as a status so the caller can audit it
 * and let the turn close normally.
 *
 * @param {object} input
 * @param {any} input.ctx cordis context.
 * @param {import('./config.js').GoalStewardConfig} input.config
 * @param {any} input.agent live agent whose turn is closing.
 * @param {number} input.turn turn number.
 * @param {AbortSignal|undefined} input.signal turn signal.
 * @param {ReturnType<import('./cadence.js').createSessionState>} input.state per-session state.
 * @returns {Promise<{status: 'ok', verdict: any, route: object, elapsedMs: number, charter: object|null}
 *   | {status: 'skip'|'error', reason: string, route?: object|null, elapsedMs?: number, charter?: object|null}>}
 */
export async function reviewSession(input) {
  const { ctx, config, agent, turn, signal, state } = input;
  const session = agent?.session;
  if (!session) return { status: 'skip', reason: 'no-session' };

  const events = snapshotEvents(session);
  const surface = surfaceSeqs(session);
  const humanIntent = collectHumanIntent(events);
  if (humanIntent.length === 0) return { status: 'skip', reason: 'no-human-intent' };

  const goal = goalSnapshot(ctx, agent);
  const charter = deriveCharter({
    storedCharter: state.charter,
    goalObjective: goal?.objective,
    humanIntent,
  });

  const route = resolveRoute(config, agent);
  if (route === null) return { status: 'skip', reason: 'no-route', charter };

  const pack = buildEvidencePack({
    turn,
    reviewsSoFar: state.reviews,
    charter,
    humanIntent,
    finalMessage: collectFinalAssistantText(events, surface),
    recentActions: collectRecentActions(events),
    previousFindings: state.previousFindings,
    maxChars: config.maxInputChars,
  });

  const timeout = AbortSignal.timeout(config.timeoutMs);
  const callSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  const startedAt = Date.now();

  try {
    const text = await streamReviewerText(ctx, {
      provider: route.provider,
      model: route.model,
      system: REVIEWER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: pack }] }],
      temperature: config.temperature,
      maxTokens: config.maxReviewTokens,
      signal: callSignal,
    });
    const elapsedMs = Date.now() - startedAt;
    const verdict = parseVerdict(text);
    if (verdict === null) {
      return { status: 'error', reason: 'unparseable-verdict', raw: clip(text, 400), route, elapsedMs, charter };
    }
    return { status: 'ok', verdict, route, elapsedMs, charter };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    return { status: 'error', reason: `call-failed: ${clip(failure, 240)}`, route, elapsedMs: Date.now() - startedAt, charter };
  }
}

/**
 * Materialize one audit finding as a steering message for the executor.
 *
 * The wording deliberately refuses to smuggle method advice: the reviewer names
 * the misalignment and the correction target, never the route.
 *
 * @param {any} verdict validated verdict with severity >= 2.
 * @param {number} turn reviewed turn.
 * @returns {any} a frozen user-role message with a plugin source.
 */
export function buildSteerMessage(verdict, turn) {
  const heading = verdict.severity >= 3
    ? 'GOAL-STEWARD AUDIT — goal_conflict (severity 3)'
    : 'GOAL-STEWARD AUDIT — goal drift (severity 2)';
  const lines = [
    heading,
    '',
    `finding: ${verdict.drift_type ?? 'unspecified'}`,
    `evidence: ${verdict.evidence}`,
    '',
    verdict.steer,
    '',
    'This is an audit finding, not a new task, and it does not authorize any method change by itself. Address the finding, then continue your work.',
  ];
  if (verdict.severity >= 3) {
    lines.push('Stop this line of work and surface the conflict to the principal before continuing.');
  }
  return createUserMessage({
    content: [{ type: 'text', text: lines.join('\n') }],
    source: { kind: 'plugin', plugin: PLUGIN_ID, note: `audit-turn-${turn}` },
  });
}
