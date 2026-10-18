import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidencePack,
  collectFinalAssistantText,
  collectHumanIntent,
  collectRecentActions,
  deriveCharter,
  isHumanMessage,
} from '../lib/evidence.js';

/** Build a dense fake session log. */
function makeEvents(list) {
  return list.map((event, seq) => ({ seq, ...event }));
}

const events = makeEvents([
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'build me a reviewer plugin' }] } },
  { type: 'tool/call', data: { turn: 1, step: 1, name: 'read', arguments: '{"file_path":"a.ts"}' } },
  { type: 'assistant/message', data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'I will write the plugin skeleton.' }] } } },
  { type: 'user/message', data: { source: { kind: 'tool' }, content: [{ type: 'text', text: 'tool feedback' }] } },
  { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'also publish it to github' }] } },
]);

test('human messages are distinguished from tool feedback', () => {
  assert.equal(isHumanMessage(events[1]), true);
  assert.equal(isHumanMessage(events[4]), false);
});

test('human intent is collected oldest first', () => {
  const intent = collectHumanIntent(events);
  assert.deepEqual(intent, ['build me a reviewer plugin', 'also publish it to github']);
});

test('tool calls become action digests', () => {
  const actions = collectRecentActions(events);
  assert.equal(actions.length, 1);
  assert.match(actions[0], /turn 1 step 1: read/);
});

test('the final assistant message is read through the surface', () => {
  const text = collectFinalAssistantText(events, [0, 1, 2, 3]);
  assert.equal(text, 'I will write the plugin skeleton.');
});

test('the final assistant message falls back to the event log', () => {
  assert.equal(collectFinalAssistantText(events, []), 'I will write the plugin skeleton.');
});

test('a stored charter wins over a derived one', () => {
  const stored = { objective: 'stored', success_criteria: [], constraints: [], non_goals: [] };
  assert.deepEqual(deriveCharter({ storedCharter: stored, goalObjective: 'goal', humanIntent: ['hi'] }), stored);
});

test('the goal objective wins over the first human message', () => {
  const charter = deriveCharter({ goalObjective: 'the real objective', humanIntent: ['chit chat'] });
  assert.equal(charter.objective, 'the real objective');
});

test('the pack contains no executor reasoning field', () => {
  const pack = buildEvidencePack({
    turn: 4,
    reviewsSoFar: 1,
    charter: { objective: 'ship it', success_criteria: [], constraints: [], non_goals: [] },
    humanIntent: ['do the thing'],
    finalMessage: 'done',
    recentActions: ['turn 4 step 1: edit'],
    previousFindings: [],
  });
  const parsed = JSON.parse(pack);
  assert.equal(parsed.turn, 4);
  assert.equal(parsed.goal_charter.objective, 'ship it');
  assert.equal('reasoning' in parsed, false);
  assert.match(pack, /The executor reasoning is intentionally excluded/);
});

test('the pack shrinks actions, then old messages, to fit the budget', () => {
  const pack = buildEvidencePack({
    turn: 9,
    humanIntent: ['x'.repeat(500), 'y'.repeat(500), 'z'.repeat(500)],
    recentActions: Array.from({ length: 18 }, (_, i) => `action ${i} ${'a'.repeat(150)}`),
    maxChars: 1_800,
  });
  assert.ok(pack.length <= 1_800, `pack was ${pack.length} chars`);
  const parsed = JSON.parse(pack);
  assert.equal(parsed.principal_messages.at(-1), 'z'.repeat(500));
});
