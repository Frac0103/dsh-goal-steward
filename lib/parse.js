/**
 * Tolerant parsing and validation of one reviewer reply.
 *
 * The reviewer is a model call, so its output is untrusted input. This module
 * never throws on malformed output: it either returns a validated verdict or
 * `null`, and the caller records the failure instead of interrupting the turn.
 * Pure functions only — unit-testable without the host runtime.
 *
 * @module dsh-goal-steward/parse
 */

import { normalizeGoalUpdate } from './goals.js';
import { DRIFT_TYPES, VERDICT_SEVERITY } from './prompt.js';

/** Maximum accepted length of the free-text finding fields. */
const EVIDENCE_MAX = 240;
const STEER_MAX = 320;

/** Cut a string to `max` characters, collapsing whitespace. */
export function clampText(value, max) {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : normalized.slice(0, max).trimEnd();
}

/**
 * Extract the first balanced JSON object from arbitrary model text.
 * Handles code fences, leading prose, and trailing prose.
 *
 * @param {string} text raw model output.
 * @returns {string|null} the JSON object substring, or null.
 */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Validate one parsed reviewer object.
 *
 * @param {unknown} value parsed JSON value.
 * @returns {{verdict: string, severity: number, drift_type: string|null, evidence: string, steer: string, goal_update: object, reportedSeverity: number}|null}
 */
export function validateVerdict(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const verdict = value.verdict;
  if (typeof verdict !== 'string' || !Object.hasOwn(VERDICT_SEVERITY, verdict)) return null;

  const expectedSeverity = VERDICT_SEVERITY[verdict];
  const rawSeverity = typeof value.severity === 'number' && Number.isFinite(value.severity)
    ? Math.trunc(value.severity)
    : expectedSeverity;
  // The verdict name is authoritative; a mismatched numeric field is repaired
  // rather than trusted, because the ladder is the contract.
  const severity = expectedSeverity;

  let driftType = null;
  if (severity >= 2) {
    driftType = typeof value.drift_type === 'string' && DRIFT_TYPES.includes(value.drift_type)
      ? value.drift_type
      : null;
    // A drifting verdict without a taxonomy code is not actionable evidence.
    if (driftType === null) return null;
  }

  const evidence = clampText(value.evidence, EVIDENCE_MAX);
  if (severity >= 2 && evidence.length === 0) return null;

  const steer = severity >= 2 ? clampText(value.steer, STEER_MAX) : '';
  if (severity >= 2 && steer.length === 0) return null;

  const goalUpdate = normalizeGoalUpdate(value.goal_update, {
    severity,
    drift_type: driftType,
    evidence,
    steer,
  });
  // An unusable goal update invalidates the verdict: the ledger is the stable
  // layer, and half-applied rewrites are worse than a dropped audit.
  if (goalUpdate === null) return null;

  return {
    verdict,
    severity,
    drift_type: driftType,
    evidence,
    steer,
    goal_update: goalUpdate,
    // Keep the raw numeric field for diagnostics when the model disagreed.
    reportedSeverity: rawSeverity,
  };
}

/**
 * Parse one raw reviewer reply into a validated verdict.
 *
 * @param {string} text raw model text.
 * @returns {ReturnType<typeof validateVerdict>} the verdict, or null when unusable.
 */
export function parseVerdict(text) {
  const json = extractJsonObject(text);
  if (json === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return validateVerdict(parsed);
}
