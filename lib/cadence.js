/**
 * Cadence and steering decisions.
 *
 * Management-by-exception lives here: the reviewer's default answer is
 * "do not review, do not speak". Only explicit triggers spend money or produce
 * a steering message. Pure functions — unit-testable without the host runtime.
 *
 * @module dsh-goal-steward/cadence
 */

/**
 * @typedef {object} SessionState
 * @property {number} lastReviewTurn Turn number of the last completed review (-Infinity before the first).
 * @property {number} reviews Completed reviewer calls in this session.
 * @property {number} steers Steering messages sent in this session.
 * @property {number} steersThisTurn Steering messages sent in the current turn.
 * @property {number} steersTurn Turn number `steersThisTurn` refers to.
 */

/** Create the initial per-session state. */
export function createSessionState() {
  return {
    lastReviewTurn: Number.NEGATIVE_INFINITY,
    reviews: 0,
    steers: 0,
    steersThisTurn: 0,
    steersTurn: -1,
    charter: null,
    previousFindings: [],
  };
}

/**
 * Decide whether this turn warrants a reviewer call.
 *
 * Triggers, in priority order:
 * 1. the goal changed since the last review (forced);
 * 2. the cadence gap reached `maxTurnGap` (forced);
 * 3. the first review of a session (charter establishment), when routine
 *    cadence is enabled at all;
 * 4. the routine cadence `reviewEveryTurns` reached (not forced);
 * 5. `reviewEveryTurns === 0` (gentle preset) never reviews routinely.
 *
 * @param {object} input
 * @param {number} input.turn current turn number.
 * @param {SessionState} input.state per-session state.
 * @param {boolean} input.goalChanged whether the durable goal changed since the last review.
 * @param {import('./config.js').GoalStewardConfig} input.config resolved config.
 * @returns {{review: boolean, reason: string}}
 */
export function decideReview(input) {
  const { turn, state, goalChanged, config } = input;

  if (!Number.isFinite(turn)) return { review: false, reason: 'no-turn' };
  if (state.reviews >= config.maxReviewsPerSession) return { review: false, reason: 'session-budget' };
  // One audit per turn: a steering message reopens the turn, and re-auditing the
  // same turn would let a reviewer talk to itself.
  if (state.lastReviewTurn === turn) return { review: false, reason: 'already-reviewed' };

  const gap = turn - state.lastReviewTurn;

  if (goalChanged) return { review: true, reason: 'goal-changed' };
  if (Number.isFinite(gap) && gap >= config.maxTurnGap) return { review: true, reason: 'max-turn-gap' };

  // The first audit of a session is where the stable layer is written down; it
  // is the one review that is structural rather than exception-driven.
  if (state.reviews === 0 && config.reviewEveryTurns > 0) return { review: true, reason: 'initial' };

  if (config.reviewEveryTurns > 0 && gap >= config.reviewEveryTurns) {
    return { review: true, reason: 'cadence' };
  }
  return { review: false, reason: 'not-due' };
}

/**
 * Decide whether one validated verdict may be delivered to the executor.
 *
 * The default posture is silence. A steering message additionally needs an
 * in-turn budget, a session budget, and an explicit configured severity floor.
 *
 * @param {object} input
 * @param {{severity: number, steer: string}} input.verdict validated verdict.
 * @param {SessionState} input.state per-session state.
 * @param {number} input.turn current turn number.
 * @param {import('./config.js').GoalStewardConfig} input.config resolved config.
 * @returns {{steer: boolean, reason: string}}
 */
export function decideSteer(input) {
  const { verdict, state, turn, config } = input;

  if (verdict.severity < config.steerSeverity) return { steer: false, reason: 'below-threshold' };
  if (typeof verdict.steer !== 'string' || verdict.steer.length === 0) return { steer: false, reason: 'no-steer-text' };
  if (state.steers >= config.maxSteersPerSession) return { steer: false, reason: 'session-steer-budget' };

  const steersThisTurn = state.steersTurn === turn ? state.steersThisTurn : 0;
  if (steersThisTurn >= config.maxSteersPerTurn) return { steer: false, reason: 'turn-steer-budget' };

  return { steer: true, reason: 'steer' };
}

/**
 * Fold one completed review into the session state.
 *
 * @param {object} input
 * @param {SessionState} input.state per-session state.
 * @param {number} input.turn reviewed turn.
 * @param {{severity: number, drift_type: string|null, evidence: string, steer: string}} input.verdict validated verdict.
 * @param {boolean} input.steered whether a steering message was actually delivered.
 * @returns {void}
 */
export function recordReview(input) {
  const { state, turn, verdict, steered } = input;
  state.lastReviewTurn = turn;
  state.reviews += 1;
  if (state.steersTurn !== turn) {
    state.steersTurn = turn;
    state.steersThisTurn = 0;
  }
  if (steered) {
    state.steers += 1;
    state.steersThisTurn += 1;
  }
  state.previousFindings.push({
    turn,
    severity: verdict.severity,
    drift_type: verdict.drift_type,
    evidence: verdict.evidence,
  });
  if (state.previousFindings.length > 5) state.previousFindings.shift();
}
