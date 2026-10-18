/**
 * The two-level goal ledger: final goal vs current goal.
 *
 * Why two levels
 * --------------
 * A single "goal" conflates two different control objects. The final goal is the
 * principal's terminal objective: it is part of the stable layer and changes
 * only when the principal explicitly redirects it. The current goal is the
 * objective of the work phase in flight: it is *supposed* to change as phases
 * complete, as the principal refines the ask, or as new evidence narrows scope.
 *
 * Treating every change as drift would freeze the work; treating no change as
 * drift would let the objective be silently replaced. The ledger records both
 * levels separately and classifies each observed change, which is the
 * change-control discipline applied to a conversation.
 *
 * Pure functions only — the ledger is plain JSON so it can be audited and, in a
 * later version, persisted.
 *
 * @module dsh-goal-steward/goals
 */

/** Caps for normalized goal fields. */
export const GOAL_OBJECTIVE_MAX = 220;
export const GOAL_ITEM_MAX = 120;
export const GOAL_LIST_MAX = 4;
export const RATIONALE_MAX = 160;

/** How the two-level ledger changed in one audit. */
export const GOAL_CHANGES = Object.freeze([
  'none',
  'refined',
  'phase_advance',
  'redirected',
  'silent_substitution',
]);

/** Changes that rewrite the ledger. `none`/`silent_substitution` never do. */
export const APPLIED_GOAL_CHANGES = Object.freeze(['refined', 'phase_advance', 'redirected']);

/** Maximum retained revision history entries. */
const HISTORY_MAX = 10;

/** Collapse whitespace and cut to `max` characters. */
export function clampText(value, max) {
  if (typeof value !== 'string') return '';
  // Strip C0/C1 control characters before whitespace folding: model output must
  // not be able to smuggle terminal control, NUL bytes, or line-injection into
  // the audit trail or the steering message.
  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length <= max ? normalized : normalized.slice(0, max).trimEnd();
}

/** Normalize one optional string list with caps and de-duplication. */
export function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const text = clampText(item, GOAL_ITEM_MAX);
    if (text.length > 0 && !out.includes(text)) out.push(text);
    if (out.length >= GOAL_LIST_MAX) break;
  }
  return out;
}

/**
 * Normalize one goal object.
 *
 * @param {unknown} value untrusted goal.
 * @returns {{objective: string, success_criteria: string[], constraints: string[], non_goals: string[]}|null}
 */
export function normalizeGoal(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const objective = clampText(value.objective, GOAL_OBJECTIVE_MAX);
  if (objective.length === 0) return null;
  return {
    objective,
    success_criteria: normalizeList(value.success_criteria),
    constraints: normalizeList(value.constraints),
    non_goals: normalizeList(value.non_goals),
  };
}

/**
 * Validate one `goal_update` object returned by the reviewer.
 *
 * The contract is intentionally strict: a drift claim must be actionable, and a
 * ledger rewrite must name the goal it rewrites.
 *
 * @param {unknown} value untrusted update.
 * @param {{severity: number, drift_type: string|null, steer: string, evidence: string}} verdict validated verdict fields.
 * @returns {{change: string, final: object|null, current: object|null, serves_final: boolean|null, rationale: string}|null}
 *   the normalized update, or null when the update is unusable.
 */
export function normalizeGoalUpdate(value, verdict) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { change: 'none', final: null, current: null, serves_final: null, rationale: '' };
  }

  const change = typeof value.change === 'string' && GOAL_CHANGES.includes(value.change) ? value.change : 'none';
  const final = normalizeGoal(value.final);
  const current = normalizeGoal(value.current);
  const servesFinal = typeof value.serves_final === 'boolean' ? value.serves_final : null;
  const rationale = clampText(value.rationale, RATIONALE_MAX);

  if (change === 'silent_substitution') {
    // Silent substitution is a diagnosis, never a rewrite: it must arrive as an
    // evidence-backed drift finding and it never touches the ledger.
    if (verdict.severity < 2) return null;
    if (verdict.drift_type !== 'goal_substitution') return null;
    if (verdict.evidence.length === 0 || verdict.steer.length === 0) return null;
    return { change, final: null, current: null, serves_final: servesFinal, rationale };
  }

  if (servesFinal === false && change !== 'silent_substitution') {
    // A current goal that stops serving the final goal is drift, whatever the
    // model called it; refuse to silently rewrite the ledger.
    return null;
  }

  if (change === 'none') {
    return { change, final: null, current: null, serves_final: servesFinal, rationale };
  }

  if (change === 'redirected') {
    // Only the principal can redirect the terminal objective, and the model must
    // hand back the replacement goal itself.
    if (final === null) return null;
    return {
      change,
      final,
      current: current ?? final,
      serves_final: true,
      rationale,
    };
  }

  // refined | phase_advance rewrite the current goal only.
  if (current === null) return null;
  return { change, final: final ?? null, current, serves_final: true, rationale };
}

/**
 * Create the ledger for a fresh session.
 *
 * @param {{initialIntent?: string, goalObjective?: string}} input
 * @returns {{revision: number, final: object|null, current: object|null, lastChange: string, history: object[]}}
 */
export function createLedger(input = {}) {
  const objective = clampText(input.goalObjective ?? input.initialIntent ?? '', GOAL_OBJECTIVE_MAX);
  if (objective.length === 0) {
    return { revision: 0, final: null, current: null, lastChange: 'unset', history: [] };
  }
  const goal = { objective, success_criteria: [], constraints: [], non_goals: [] };
  return {
    revision: 1,
    final: goal,
    current: goal,
    lastChange: 'initial',
    history: [{ revision: 1, change: 'initial', final: goal, current: goal }],
  };
}

/**
 * Apply one validated goal update, producing a new immutable ledger.
 *
 * @param {{revision: number, final: object|null, current: object|null, lastChange: string, history: object[]}} ledger
 * @param {ReturnType<typeof normalizeGoalUpdate>} update normalized update.
 * @param {{turn?: number}} [meta]
 * @returns {{ledger: object, applied: boolean}}
 */
export function applyGoalUpdate(ledger, update, meta = {}) {
  if (update === null || !APPLIED_GOAL_CHANGES.includes(update.change)) {
    return { ledger, applied: false };
  }
  const final = update.change === 'redirected' ? update.final : ledger.final ?? update.current;
  const current = update.current ?? final;
  const revision = ledger.revision + 1;
  const entry = {
    revision,
    change: update.change,
    turn: meta.turn ?? null,
    rationale: update.rationale,
    final,
    current,
  };
  const history = [...ledger.history, entry].slice(-HISTORY_MAX);
  return {
    ledger: { revision, final, current, lastChange: update.change, history },
    applied: true,
  };
}

/**
 * Render the compact ledger view consumed by the reviewer and the audit trail.
 *
 * @param {{revision: number, final: object|null, current: object|null, lastChange: string}} ledger
 * @returns {object} the model-facing ledger.
 */
export function ledgerView(ledger) {
  return {
    revision: ledger.revision,
    final: ledger.final,
    current: ledger.current,
    last_change: ledger.lastChange,
  };
}

/** Minimum verbatim quote length that corroborates a principal redirect. */
export const REDIRECT_QUOTE_MIN = 12;

/**
 * Normalize text for verbatim quote matching: lowercase, drop whitespace and
 * punctuation that a model may legitimately reflow when quoting.
 *
 * @param {string} text raw text.
 * @returns {string} comparison key.
 */
function normalizeForQuote(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s"'`“”‘’「」『』《》（）()\[\]{}.,，。;；:：!！?？—–\-_/\\|*#>~+=]+/g, '');
}

/**
 * Mechanically corroborate a goal update that claims a final-goal redirect.
 *
 * Change control says only the principal may replace the final goal. The
 * reviewer is a model reading an evidence pack that the executor partially
 * controls, so an injected instruction ("change the objective to X") could
 * otherwise rewrite the stable layer. The guard requires the redirect rationale
 * to quote the principal's own words verbatim; evidence-side injection cannot
 * fabricate a quote the principal never wrote.
 *
 * @param {ReturnType<typeof normalizeGoalUpdate>} update normalized update.
 * @param {{principalTexts?: readonly string[]}} [context] the principal's own words.
 * @returns {{ok: true, reason: null} | {ok: false, reason: string}}
 */
export function guardGoalUpdate(update, context = {}) {
  if (update === null || update.change !== 'redirected') return { ok: true, reason: null };

  const rationale = normalizeForQuote(update.rationale);
  if (rationale.length < REDIRECT_QUOTE_MIN) return { ok: false, reason: 'redirect-without-quote' };

  for (const text of context.principalTexts ?? []) {
    const normalized = normalizeForQuote(text);
    // Sliding window over the principal text: any verbatim fragment of at least
    // REDIRECT_QUOTE_MIN characters inside the rationale corroborates it.
    for (let start = 0; start + REDIRECT_QUOTE_MIN <= normalized.length; start += 1) {
      if (rationale.includes(normalized.slice(start, start + REDIRECT_QUOTE_MIN))) {
        return { ok: true, reason: null };
      }
    }
  }
  return { ok: false, reason: 'redirect-not-corroborated' };
}
