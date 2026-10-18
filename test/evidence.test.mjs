import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidencePack,
  collectFinalAssistantText,
  collectHumanIntent,
  collectInitialIntent,
  collectRecentActions,
  isHumanMessage,
} from '../lib/evidence.js';
import { createLedger, ledgerView } from '../lib/goals.js';

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

test('the pack contains no executor reasoning field', () => {
  const pack = buildEvidencePack({
    turn: 4,
    reviewsSoFar: 1,
    ledger: { revision: 1, final: { objective: 'ship it' }, current: { objective: 'ship it' }, last_change: 'initial' },
    humanIntent: ['do the thing'],
    finalMessage: 'done',
    recentActions: ['turn 4 step 1: edit'],
    previousFindings: [],
  });
  const parsed = JSON.parse(pack);
  assert.equal(parsed.turn, 4);
  assert.equal(parsed.goal_ledger.final.objective, 'ship it');
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

// --- stable-layer anchoring (regression from live dogfooding) -----------------

test('the opening mandate is the first principal message, not the oldest in the recent window', () => {
  assert.equal(collectInitialIntent(events), 'build me a reviewer plugin');
});

test('the opening mandate skips non-principal sources', () => {
  const toolOnly = makeEvents([
    { type: 'user/message', data: { source: { kind: 'tool' }, content: [{ type: 'text', text: 'tool feedback' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'the real mandate' }] } },
  ]);
  assert.equal(collectInitialIntent(toolOnly), 'the real mandate');
});

test('the opening mandate wins over the oldest recent message', () => {
  const intent = collectHumanIntent([
    ...makeEvents([
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'the original objective' }] } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'go ahead' }] } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] } },
    ]),
  ]);
  assert.deepEqual(intent, ['the original objective', 'go ahead', 'continue']);
});

test('the pack carries the two-level goal ledger separately from recent messages', () => {
  const ledger = createLedger({ initialIntent: 'the original objective' });
  const pack = buildEvidencePack({
    turn: 5,
    ledger: ledgerView(ledger),
    initialMessage: 'the original objective',
    humanIntent: ['go ahead', 'continue'],
  });
  const parsed = JSON.parse(pack);
  assert.equal(parsed.principal_initial_message, 'the original objective');
  assert.deepEqual(parsed.principal_messages, ['go ahead', 'continue']);
  assert.equal(parsed.goal_ledger.revision, 1);
  assert.equal(parsed.goal_ledger.final.objective, 'the original objective');
  assert.equal(parsed.goal_ledger.current.objective, 'the original objective');
});
