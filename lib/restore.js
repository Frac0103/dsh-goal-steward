/**
 * Session inheritance: replay the audit trail into live session state.
 *
 * A reviewer instance is an office holder, not the institution. The host
 * reloads the plugin on HMR, applies config changes, and restarts between
 * sessions — but the conversation (and the charter the principal and executor
 * already agreed on) survives all of that. If the new instance re-anchored the
 * ledger to the opening message, a legitimate redirect would silently revert:
 * the work would be judged against a goal the principal already changed.
 *
 * So the durable audit trail doubles as the institutional memory:
 *
 *   - the **ledger** is inherited (the charter is not re-derived);
 *   - the **previous findings** are inherited (the reviewer does not forget
 *     what it already reported);
 *   - the **cadence counters are not** inherited. Each appointment opens a new
 *     budget: a restarted reviewer re-checks the charter once, then settles
 *     into the routine cadence, instead of starting with a silently exhausted
 *     session budget.
 *
 * Pure functions over already-read records; file access lives in `audit.js`.
 *
 * @module dsh-goal-steward/restore
 */

import { normalizeGoal } from './goals.js';

/** How many earlier findings are carried into the next appointment. */
const PREVIOUS_FINDINGS_MAX = 5;

/**
 * Rebuild one ledger from an audit record's `goals` snapshot.
 *
 * Two shapes are accepted: the current one stores the full final/current goal
 * objects, and the legacy one (<= 0.2.0-alpha.6) stores only their objective
 * strings. Reading both means an upgrade does not lose a session's charter.
 *
 * @param {unknown} snapshot stored `goals` field.
 * @returns {{revision: number, final: object|null, current: object|null, lastChange: string, history: object[]}|null}
 *   the rebuilt ledger, or null when the snapshot carries no goal.
 */
export function ledgerFromSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const final = normalizeGoal(snapshot.final) ?? normalizeGoal({ objective: snapshot.finalGoal });
  const current = normalizeGoal(snapshot.current) ?? normalizeGoal({ objective: snapshot.currentGoal });
  if (final === null && current === null) return null;
  const revision = Number.isInteger(snapshot.revision) && snapshot.revision >= 0 ? snapshot.revision : 1;
  return {
    revision,
    final,
    current: current ?? final,
    lastChange: typeof snapshot.lastChange === 'string' && snapshot.lastChange.length > 0 ? snapshot.lastChange : 'inherited',
    // History is not needed to govern (the evidence pack and steering message use
    // final/current only); the audit trail itself is the surviving history.
    history: [],
  };
}

/**
 * Replay one session's audit records into the state a new instance should start
 * from.
 *
 * @param {object[]} records this session's audit records, in file order.
 * @returns {{ledger: object|null, previousFindings: object[]}|null} inherited
 *   state, or null when there is nothing to inherit.
 */
export function restoreSessionState(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  let ledger = null;
  const previousFindings = [];
  for (const record of records) {
    if (record === null || typeof record !== 'object' || record.event !== 'review') continue;
    const snapshot = ledgerFromSnapshot(record.goals);
    if (snapshot !== null) ledger = snapshot;
    if (record.outcome === 'ok' && typeof record.verdict === 'string' && typeof record.evidence === 'string') {
      previousFindings.push({
        turn: typeof record.turn === 'number' ? record.turn : -1,
        severity: typeof record.severity === 'number' ? record.severity : 0,
        drift_type: typeof record.driftType === 'string' ? record.driftType : null,
        evidence: record.evidence,
      });
      if (previousFindings.length > PREVIOUS_FINDINGS_MAX) previousFindings.shift();
    }
  }
  if (ledger === null && previousFindings.length === 0) return null;
  return { ledger, previousFindings };
}
