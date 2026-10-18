/**
 * Configuration resolution for dsh-goal-steward.
 *
 * The plugin is run-ready with zero configuration. Three presets express the
 * governance-intensity dial; every individual field can still be overridden on
 * top of a preset. Resolution is deliberately dependency-free and total: an
 * invalid configuration degrades to the preset default instead of throwing,
 * because a governance layer must never be able to break a conversation.
 *
 * @module dsh-goal-steward/config
 */

/** Governance presets. `standard` is the documented default. */
export const PRESETS = Object.freeze({
  gentle: Object.freeze({
    reviewEveryTurns: 0,
    maxTurnGap: 10,
    steerSeverity: 3,
    maxSteersPerTurn: 1,
    maxSteersPerSession: 6,
  }),
  standard: Object.freeze({
    reviewEveryTurns: 3,
    maxTurnGap: 6,
    steerSeverity: 2,
    maxSteersPerTurn: 2,
    maxSteersPerSession: 12,
  }),
  strict: Object.freeze({
    reviewEveryTurns: 1,
    maxTurnGap: 2,
    steerSeverity: 1,
    maxSteersPerTurn: 3,
    maxSteersPerSession: 24,
  }),
});

/**
 * @typedef {object} GoalStewardConfig
 * @property {boolean} enabled Kill switch.
 * @property {'gentle'|'standard'|'strict'} preset Governance-intensity preset.
 * @property {number} reviewEveryTurns Routine audit cadence in turns; 0 audits only on forced triggers.
 * @property {number} maxTurnGap Forced audit when this many turns elapsed since the last review.
 * @property {number} minReviewStepSteps Reserved: minimum steps in a turn before it deserves an audit.
 * @property {number} steerSeverity Minimum severity that produces a steering message (2 = drift).
 * @property {number} maxReviewsPerSession Hard budget on reviewer model calls per session.
 * @property {number} maxSteersPerTurn Hard cap on steering messages within one turn.
 * @property {number} maxSteersPerSession Hard cap on steering messages per session.
 * @property {number} timeoutMs Wall-clock budget for one reviewer call.
 * @property {number} maxReviewTokens Output token budget for the reviewer call.
 * @property {number} maxInputChars Evidence-pack character budget.
 * @property {string|undefined} reviewProvider Reviewer route provider; defaults to the agent's own route.
 * @property {string|undefined} reviewModel Reviewer route model; defaults to the agent's own route.
 * @property {number} temperature Reviewer sampling temperature (0 for determinism).
 * @property {boolean} includeChildSessions Audit subagent/workflow child sessions too.
 * @property {boolean} audit Persist one JSONL audit record per review.
 * @property {string|undefined} auditDir Audit directory; defaults to `$DSH_HOME/goal-steward`.
 * @property {boolean} logEvents Mirror one-line review summaries to the host log.
 */

/** @type {Readonly<GoalStewardConfig>} */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  preset: 'standard',
  reviewEveryTurns: PRESETS.standard.reviewEveryTurns,
  maxTurnGap: PRESETS.standard.maxTurnGap,
  minReviewStepSteps: 2,
  steerSeverity: PRESETS.standard.steerSeverity,
  maxReviewsPerSession: 60,
  maxSteersPerTurn: PRESETS.standard.maxSteersPerTurn,
  maxSteersPerSession: PRESETS.standard.maxSteersPerSession,
  timeoutMs: 45_000,
  maxReviewTokens: 900,
  maxInputChars: 12_000,
  reviewProvider: undefined,
  reviewModel: undefined,
  temperature: 0,
  includeChildSessions: false,
  audit: true,
  auditDir: undefined,
  logEvents: true,
});

const NUMBER_KEYS = /** @type {const} */ ([
  ['reviewEveryTurns', 0, 100],
  ['maxTurnGap', 1, 100],
  ['minReviewStepSteps', 0, 100],
  ['steerSeverity', 0, 4],
  ['maxReviewsPerSession', 1, 10_000],
  ['maxSteersPerTurn', 0, 100],
  ['maxSteersPerSession', 0, 10_000],
  ['timeoutMs', 1_000, 600_000],
  ['maxReviewTokens', 64, 32_000],
  ['maxInputChars', 1_000, 200_000],
  ['temperature', 0, 2],
]);

const BOOLEAN_KEYS = /** @type {const} */ ([
  'enabled',
  'includeChildSessions',
  'audit',
  'logEvents',
]);

const STRING_KEYS = /** @type {const} */ ([
  'reviewProvider',
  'reviewModel',
  'auditDir',
]);

/** Clamp a finite number into an inclusive range, or fall back. */
function clampNumber(value, fallback, lo, hi) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  if (rounded < lo) return lo;
  if (rounded > hi) return hi;
  return rounded;
}

/** Trim a non-empty string, or fall back to `undefined`. */
function optionalString(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Resolve one untrusted cordis entry config against the presets.
 *
 * Unknown keys are ignored on purpose: the profile patch layer is shared, and a
 * forgotten experimental key must not disable governance entirely.
 *
 * @param {unknown} raw untrusted entry config (may be undefined).
 * @returns {Readonly<GoalStewardConfig>} a frozen, fully populated config.
 */
export function resolveConfig(raw) {
  const input = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const requestedPreset = typeof input.preset === 'string' ? input.preset : '';
  const presetName = Object.hasOwn(PRESETS, requestedPreset) ? requestedPreset : 'standard';
  const preset = PRESETS[presetName];

  /** @type {GoalStewardConfig} */
  const merged = {
    ...DEFAULT_CONFIG,
    ...preset,
    preset: presetName,
  };

  for (const key of BOOLEAN_KEYS) {
    if (typeof input[key] === 'boolean') merged[key] = input[key];
  }
  for (const [key, lo, hi] of NUMBER_KEYS) {
    if (Object.hasOwn(input, key)) merged[key] = clampNumber(input[key], merged[key], lo, hi);
  }
  for (const key of STRING_KEYS) {
    if (Object.hasOwn(input, key)) merged[key] = optionalString(input[key], merged[key]);
  }

  // `reviewEveryTurns: 0` means "forced triggers only" and must not be
  // normalized away; the cadence comparison in index.js treats 0 specially.
  if (merged.steerSeverity > 4) merged.steerSeverity = 4;

  return Object.freeze(merged);
}
