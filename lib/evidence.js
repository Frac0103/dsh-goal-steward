/**
 * Evidence-pack construction: the only information the independent reviewer is
 * allowed to see.
 *
 * The pack is deliberately narrow. It contains the stable layer, the principal's
 * own words, the executor's final visible output, a digest of recent tool calls,
 * and the reviewer's own recent findings — and nothing else. It never contains
 * the executor's reasoning or system prompt, because information isolation is
 * one of the four sources of review independence.
 *
 * Pure functions over plain event objects, so the whole module is unit-testable
 * without the host runtime.
 *
 * @module dsh-goal-steward/evidence
 */

/** Per-message and per-field character caps. */
const HUMAN_MESSAGE_MAX = 700;
const INITIAL_MESSAGE_MAX = 1_200;
const FINAL_MESSAGE_MAX = 2000;
const ACTION_MAX = 180;
const HUMAN_LIMIT = 4;
const ACTION_LIMIT = 18;
const FINDING_LIMIT = 3;

/** Concatenate the text blocks of one content array. */
export function blocksToText(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

/** Collapse whitespace and cut to `max` characters. */
export function clip(text, max) {
  if (typeof text !== 'string') return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max).trimEnd()}…`;
}

/** Read the session event log defensively. */
export function snapshotEvents(session) {
  try {
    const events = session?.snapshotEvents?.();
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

/** Read the model-visible surface sequence defensively. */
export function surfaceSeqs(session) {
  try {
    const nodes = session?.surface?.nodes;
    return Array.isArray(nodes) ? nodes : [];
  } catch {
    return [];
  }
}

/** Whether one event is a principal-authored user message. */
export function isHumanMessage(event) {
  return event?.type === 'user/message' && event?.data?.source?.kind === 'user';
}

/**
 * Collect the principal's most recent messages, oldest first.
 *
 * @param {readonly any[]} events session events.
 * @param {number} [limit] maximum messages.
 * @returns {string[]} clipped message texts.
 */
export function collectHumanIntent(events, limit = HUMAN_LIMIT) {
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const event = events[i];
    if (!isHumanMessage(event)) continue;
    const text = blocksToText(event.data?.content);
    if (text.length === 0) continue;
    out.unshift(clip(text, HUMAN_MESSAGE_MAX));
  }
  return out;
}

/** Read the text of one assistant message event. */
function assistantText(event) {
  return blocksToText(event?.data?.message?.content);
}

/**
 * Collect the executor's final visible message of the current turn.
 *
 * @param {readonly any[]} events session events.
 * @param {readonly number[]} surface model-visible sequence.
 * @returns {string} clipped assistant text, or an empty string.
 */
export function collectFinalAssistantText(events, surface) {
  for (let i = surface.length - 1; i >= 0; i -= 1) {
    const event = events[surface[i]];
    if (event?.type !== 'assistant/message') continue;
    const text = assistantText(event);
    if (text.length > 0) return clip(text, FINAL_MESSAGE_MAX);
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type !== 'assistant/message') continue;
    const text = assistantText(event);
    if (text.length > 0) return clip(text, FINAL_MESSAGE_MAX);
  }
  return '';
}

/**
 * Summarize recent tool calls as `turn/step: name args`.
 *
 * @param {readonly any[]} events session events.
 * @param {number} [limit] maximum calls.
 * @returns {string[]} digests, oldest first.
 */
export function collectRecentActions(events, limit = ACTION_LIMIT) {
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const event = events[i];
    if (event?.type !== 'tool/call') continue;
    const data = event.data ?? {};
    const name = typeof data.name === 'string' ? data.name : 'unknown';
    const raw = typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? null);
    out.unshift(`turn ${data.turn ?? '?'} step ${data.step ?? '?'}: ${name} ${clip(raw, ACTION_MAX)}`);
  }
  return out;
}

/**
 * Collect the session's opening mandate — the first principal message.
 *
 * This is the primary source of the stable layer. Using the oldest message of a
 * *recent* window is wrong by construction: once more than four principal
 * messages exist, the window no longer contains the mandate and a short reply
 * such as "go ahead" becomes a false objective. (Observed in live dogfooding.)
 *
 * @param {readonly any[]} events session events.
 * @param {number} [maxChars] character cap.
 * @returns {string} the clipped opening mandate, or an empty string.
 */
export function collectInitialIntent(events, maxChars = INITIAL_MESSAGE_MAX) {
  for (const event of events) {
    if (!isHumanMessage(event)) continue;
    const text = blocksToText(event.data?.content);
    if (text.length > 0) return clip(text, maxChars);
  }
  return '';
}

/**
 * Build the reviewer evidence pack.
 *
 * @param {object} input
 * @param {number} input.turn current turn number.
 * @param {number} [input.reviewsSoFar] reviews already spent in this session.
 * @param {object|null} [input.ledger] the two-level goal ledger view.
 * @param {string} [input.initialMessage] the opening mandate.
 * @param {readonly string[]} [input.humanIntent] recent principal messages.
 * @param {string} [input.finalMessage] executor final message.
 * @param {readonly string[]} [input.recentActions] tool-call digests.
 * @param {readonly object[]} [input.previousFindings] last reviewer findings.
 * @param {number} [input.maxChars] serialized pack budget.
 * @returns {string} the JSON evidence pack text.
 */
export function buildEvidencePack(input) {
  const pack = {
    turn: input.turn,
    reviews_so_far: input.reviewsSoFar ?? 0,
    goal_ledger: input.ledger ?? null,
    principal_initial_message: input.initialMessage ?? '',
    principal_messages: [...(input.humanIntent ?? [])],
    executor_final_message: input.finalMessage ?? '',
    recent_actions: [...(input.recentActions ?? [])],
    previous_findings: (input.previousFindings ?? []).slice(-FINDING_LIMIT),
    note: 'Evidence only. The executor reasoning is intentionally excluded.',
  };

  const maxChars = typeof input.maxChars === 'number' && input.maxChars > 0 ? input.maxChars : 12_000;
  let text = JSON.stringify(pack, null, 2);
  // Shrink the cheapest evidence first: action digests, then older principal
  // messages. The stable layer and the final message are never dropped.
  while (text.length > maxChars && pack.recent_actions.length > 0) {
    pack.recent_actions.shift();
    text = JSON.stringify(pack, null, 2);
  }
  while (text.length > maxChars && pack.principal_messages.length > 1) {
    pack.principal_messages.shift();
    text = JSON.stringify(pack, null, 2);
  }
  return text;
}
