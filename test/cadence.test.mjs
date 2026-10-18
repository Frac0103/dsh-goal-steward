import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideReview, decideSteer, createSessionState, recordReview } from '../lib/cadence.js';
import { resolveConfig } from '../lib/config.js';

const standard = resolveConfig(undefined);

test('the first turn of a session is the initial audit', () => {
  const decision = decideReview({ turn: 1, state: createSessionState(), goalChanged: false, config: standard });
  assert.deepEqual(decision, { review: true, reason: 'initial' });
});

test('the routine cadence triggers after the configured gap', () => {
  const state = createSessionState();
  state.lastReviewTurn = 1;
  state.reviews = 1;
  const decision = decideReview({ turn: 4, state, goalChanged: false, config: standard });
  assert.deepEqual(decision, { review: true, reason: 'cadence' });
});

test('a goal change forces a review regardless of cadence', () => {
  const state = createSessionState();
  state.lastReviewTurn = 2;
  const decision = decideReview({ turn: 3, state, goalChanged: true, config: standard });
  assert.deepEqual(decision, { review: true, reason: 'goal-changed' });
});

test('the max turn gap forces a review', () => {
  const state = createSessionState();
  state.lastReviewTurn = 2;
  const decision = decideReview({ turn: 8, state, goalChanged: false, config: standard });
  assert.deepEqual(decision, { review: true, reason: 'max-turn-gap' });
});

test('one turn is never reviewed twice', () => {
  const state = createSessionState();
  state.lastReviewTurn = 3;
  const decision = decideReview({ turn: 3, state, goalChanged: true, config: standard });
  assert.equal(decision.review, false);
});

test('the gentle preset never reviews routinely, not even the first turn', () => {
  const gentle = resolveConfig({ preset: 'gentle', maxTurnGap: 100 });
  const decision = decideReview({ turn: 1, state: createSessionState(), goalChanged: false, config: gentle });
  assert.equal(decision.review, false);
  const later = decideReview({ turn: 30, state: createSessionState(), goalChanged: false, config: gentle });
  assert.equal(later.review, false);
  const forced = decideReview({ turn: 30, state: createSessionState(), goalChanged: true, config: gentle });
  assert.equal(forced.review, true);
});

test('the session review budget is enforced', () => {
  const state = createSessionState();
  state.reviews = standard.maxReviewsPerSession;
  const decision = decideReview({ turn: 9, state, goalChanged: true, config: standard });
  assert.deepEqual(decision, { review: false, reason: 'session-budget' });
});

test('steering respects the severity floor and turn budget', () => {
  const state = createSessionState();
  const drift = { severity: 2, steer: 'correct course' };
  assert.deepEqual(decideSteer({ verdict: drift, state, turn: 3, config: standard }), { steer: true, reason: 'steer' });

  state.steersThisTurn = standard.maxSteersPerTurn;
  state.steersTurn = 3;
  assert.deepEqual(decideSteer({ verdict: drift, state, turn: 3, config: standard }), { steer: false, reason: 'turn-steer-budget' });
});

test('watch severity never steers at standard intensity', () => {
  const decision = decideSteer({ verdict: { severity: 1, steer: 'x' }, state: createSessionState(), turn: 3, config: standard });
  assert.deepEqual(decision, { steer: false, reason: 'below-threshold' });
});

test('recording a review folds the previous finding in', () => {
  const state = createSessionState();
  recordReview({
    state,
    turn: 3,
    verdict: { severity: 2, drift_type: 'scope_creep', evidence: 'turn 3', steer: 'stop' },
    steered: true,
  });
  assert.equal(state.lastReviewTurn, 3);
  assert.equal(state.reviews, 1);
  assert.equal(state.steers, 1);
  assert.equal(state.previousFindings.length, 1);
  assert.equal(state.previousFindings[0].drift_type, 'scope_creep');
});

test('previous findings are capped at five', () => {
  const state = createSessionState();
  for (let turn = 1; turn <= 9; turn += 1) {
    recordReview({ state, turn, verdict: { severity: 1, drift_type: null, evidence: '', steer: '' }, steered: false });
  }
  assert.equal(state.previousFindings.length, 5);
});
