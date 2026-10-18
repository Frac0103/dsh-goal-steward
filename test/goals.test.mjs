import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGoalUpdate,
  createLedger,
  ledgerView,
  normalizeGoal,
  normalizeGoalUpdate,
} from '../lib/goals.js';

const DRIFT = { severity: 2, drift_type: 'goal_substitution', evidence: 'turn 3: scope changed', steer: 'return to the objective' };
const CLEAN = { severity: 0, drift_type: null, evidence: '', steer: '' };

// ------------------------------------------------------------------ normalizeGoal

test('a goal needs an objective and caps its fields', () => {
  const goal = normalizeGoal({
    objective: `  ${'x'.repeat(300)}  `,
    success_criteria: ['a', 'b', 'c', 'd', 'e'],
    constraints: ['  keep it small  '],
    non_goals: [],
  });
  assert.equal(goal.objective.length, 220);
  assert.equal(goal.success_criteria.length, 4);
  assert.deepEqual(goal.constraints, ['keep it small']);
  assert.deepEqual(goal.non_goals, []);
});

test('a goal without an objective is rejected', () => {
  assert.equal(normalizeGoal({ success_criteria: ['a'] }), null);
  assert.equal(normalizeGoal(null), null);
  assert.equal(normalizeGoal('nope'), null);
});

// ------------------------------------------------------------ normalizeGoalUpdate

test('a missing goal update means no change', () => {
  const update = normalizeGoalUpdate(undefined, CLEAN);
  assert.equal(update.change, 'none');
  assert.equal(update.final, null);
  assert.equal(update.current, null);
});

test('an unknown change kind collapses to none', () => {
  assert.equal(normalizeGoalUpdate({ change: 'vibes' }, CLEAN).change, 'none');
});

test('refined rewrites the current goal only', () => {
  const update = normalizeGoalUpdate({
    change: 'refined',
    current: { objective: 'phase two: install and dogfood', success_criteria: ['audit file exists'] },
    serves_final: true,
    rationale: 'the principal moved the task forward',
  }, CLEAN);
  assert.equal(update.change, 'refined');
  assert.equal(update.current.objective, 'phase two: install and dogfood');
  assert.equal(update.final, null);
});

test('refined without a current goal is rejected', () => {
  assert.equal(normalizeGoalUpdate({ change: 'refined' }, CLEAN), null);
});

test('redirected must carry the replacement final goal and defaults current to it', () => {
  const update = normalizeGoalUpdate({
    change: 'redirected',
    final: { objective: 'a different terminal objective' },
  }, CLEAN);
  assert.equal(update.change, 'redirected');
  assert.equal(update.current.objective, 'a different terminal objective');
});

test('redirected without a final goal is rejected', () => {
  assert.equal(normalizeGoalUpdate({ change: 'redirected', current: { objective: 'x' } }, CLEAN), null);
});

test('silent substitution is a diagnosis, never a rewrite', () => {
  const update = normalizeGoalUpdate({ change: 'silent_substitution', serves_final: false }, DRIFT);
  assert.equal(update.change, 'silent_substitution');
  assert.equal(update.final, null);
  assert.equal(update.current, null);
});

test('silent substitution below the drift threshold is rejected', () => {
  assert.equal(normalizeGoalUpdate({ change: 'silent_substitution' }, { ...DRIFT, severity: 1 }), null);
});

test('silent substitution must be classified as goal substitution', () => {
  assert.equal(normalizeGoalUpdate({ change: 'silent_substitution' }, { ...DRIFT, drift_type: 'scope_creep' }), null);
});

test('a current goal that stops serving the final goal cannot be silently rewritten', () => {
  assert.equal(normalizeGoalUpdate({ change: 'refined', current: { objective: 'x' }, serves_final: false }, CLEAN), null);
});

// ---------------------------------------------------------------------- ledger

test('a fresh ledger anchors both levels to the opening mandate', () => {
  const ledger = createLedger({ initialIntent: 'build the plugin and publish it' });
  assert.equal(ledger.revision, 1);
  assert.equal(ledger.final.objective, 'build the plugin and publish it');
  assert.equal(ledger.current.objective, 'build the plugin and publish it');
  assert.equal(ledger.lastChange, 'initial');
});

test('a durable goal objective wins over the opening mandate', () => {
  const ledger = createLedger({ goalObjective: 'durable goal', initialIntent: 'mandate' });
  assert.equal(ledger.final.objective, 'durable goal');
});

test('an empty mandate creates an unset ledger', () => {
  const ledger = createLedger({});
  assert.equal(ledger.revision, 0);
  assert.equal(ledger.lastChange, 'unset');
  assert.equal(ledger.final, null);
});

test('none and silent_substitution never rewrite the ledger', () => {
  const ledger = createLedger({ initialIntent: 'objective' });
  assert.equal(applyGoalUpdate(ledger, normalizeGoalUpdate(undefined, CLEAN)).applied, false);
  assert.equal(applyGoalUpdate(ledger, normalizeGoalUpdate({ change: 'silent_substitution' }, DRIFT)).applied, false);
});

test('a refined current goal advances the revision and keeps the final goal', () => {
  const ledger = createLedger({ initialIntent: 'the final objective' });
  const update = normalizeGoalUpdate({ change: 'refined', current: { objective: 'phase two' } }, CLEAN);
  const { ledger: next, applied } = applyGoalUpdate(ledger, update, { turn: 4 });
  assert.equal(applied, true);
  assert.equal(next.revision, 2);
  assert.equal(next.final.objective, 'the final objective');
  assert.equal(next.current.objective, 'phase two');
  assert.equal(next.lastChange, 'refined');
  assert.equal(next.history.at(-1).turn, 4);
});

test('a redirected final goal replaces both levels', () => {
  const ledger = createLedger({ initialIntent: 'old objective' });
  const update = normalizeGoalUpdate({ change: 'redirected', final: { objective: 'new objective' } }, CLEAN);
  const { ledger: next } = applyGoalUpdate(ledger, update, { turn: 7 });
  assert.equal(next.final.objective, 'new objective');
  assert.equal(next.current.objective, 'new objective');
  assert.equal(next.revision, 2);
});

test('the revision history is capped', () => {
  let ledger = createLedger({ initialIntent: 'objective' });
  for (let i = 0; i < 15; i += 1) {
    const update = normalizeGoalUpdate({ change: 'phase_advance', current: { objective: `phase ${i}` } }, CLEAN);
    ledger = applyGoalUpdate(ledger, update).ledger;
  }
  assert.equal(ledger.revision, 16);
  assert.equal(ledger.history.length, 10);
});

test('the ledger view exposes exactly the model-facing fields', () => {
  const ledger = createLedger({ initialIntent: 'objective' });
  const view = ledgerView(ledger);
  assert.deepEqual(Object.keys(view).sort(), ['current', 'final', 'last_change', 'revision']);
  assert.equal(view.final.objective, 'objective');
});
