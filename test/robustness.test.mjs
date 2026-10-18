/**
 * Defensive-path tests.
 *
 * The governance layer sits on top of a host whose optional surfaces can be
 * missing, throwing, or shape-shifted by a version skew. Every one of those
 * reads therefore has a fallback, and this file exercises the fallbacks
 * directly: a reviewer that throws on a broken host would be worse than no
 * reviewer at all.
 *
 * These are unit-level tests for the failure branches the behaviour suites do
 * not reach (coverage-guided, but each assertion is a real contract).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectFinalAssistantText,
  collectInitialIntent,
  surfaceSeqs,
  snapshotEvents,
} from '../lib/evidence.js';
import { parseVerdict } from '../lib/parse.js';
import { resolveConfig } from '../lib/config.js';
import {
  buildSteerMessage,
  goalSnapshot,
  isChildSession,
  resolveRoute,
  streamReviewerText,
} from '../lib/reviewer.js';

// --------------------------------------------------------------------------- evidence fallbacks

test('a throwing session log degrades to an empty snapshot', () => {
  assert.deepEqual(snapshotEvents({ snapshotEvents() { throw new Error('log exploded'); } }), []);
  assert.deepEqual(snapshotEvents({ snapshotEvents: () => 'not an array' }), []);
  assert.deepEqual(snapshotEvents(undefined), []);
});

test('a throwing session surface degrades to an empty sequence list', () => {
  const session = {};
  Object.defineProperty(session, 'surface', {
    get() { throw new Error('surface exploded'); },
  });
  assert.deepEqual(surfaceSeqs(session), []);
  assert.deepEqual(surfaceSeqs({ surface: { nodes: () => [] } }), []);
});

test('an empty transcript has no initial intent and no final message', () => {
  assert.equal(collectInitialIntent([]), '');
  assert.equal(collectFinalAssistantText([], []), '');
  // Events that are assistant messages but carry no text are skipped too.
  assert.equal(collectFinalAssistantText([
    { type: 'assistant/message', data: { turn: 1, message: { content: [] } } },
  ], []), '');
});

// --------------------------------------------------------------------------- parse fallbacks

test('balanced-but-invalid JSON is not a verdict', () => {
  assert.equal(parseVerdict('{"verdict": "drift", }'), null);
  assert.equal(parseVerdict(''), null);
  assert.equal(parseVerdict('{oops}'), null);
});

// --------------------------------------------------------------------------- reviewer fallbacks

test('a throwing session header means "not a child session"', () => {
  const agent = {};
  Object.defineProperty(agent, 'session', {
    get() { throw new Error('session exploded'); },
  });
  assert.equal(isChildSession(agent), false);
  const throwingHeader = { session: {} };
  Object.defineProperty(throwingHeader.session, 'header', {
    get() { throw new Error('header exploded'); },
  });
  assert.equal(isChildSession(throwingHeader), false);
});

test('the reviewer route prefers an explicit config route', () => {
  const config = resolveConfig({ reviewProvider: 'explicit-provider', reviewModel: 'explicit-model' });
  assert.deepEqual(resolveRoute(config, { session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }), {
    provider: 'explicit-provider',
    model: 'explicit-model',
    source: 'config',
  });

  const fallback = resolveConfig({});
  assert.equal(resolveRoute(fallback, { session: { requestHeader() { throw new Error('no header yet'); } } }), null);
  assert.equal(resolveRoute(fallback, {}), null);
  assert.equal(resolveRoute(fallback, { session: { requestHeader: () => ({ config: { provider: '', model: '' } }) } }), null);
});

test('a throwing goal service is an absent goal service', () => {
  const ctx = { get() { throw new Error('service exploded'); } };
  assert.equal(goalSnapshot(ctx, {}), undefined);
  const throwingGoal = { get: () => ({ get() { throw new Error('goal exploded'); } }) };
  assert.equal(goalSnapshot({ get: () => throwingGoal.get() }, {}), undefined);
  assert.equal(goalSnapshot({ get: () => ({ get: () => null }) }, {}), undefined);
  assert.deepEqual(goalSnapshot({ get: () => ({ get: () => ({ objective: 'ship it' }) }) }, {}), { objective: 'ship it' });
});

// --------------------------------------------------------------------------- stream terminal states

/** Fake ctx whose reviewer stream is one scripted chunk list. */
function streamContext(chunks) {
  return {
    llm: {
      stream() {
        return (async function* replay() {
          yield* chunks;
        })();
      },
    },
  };
}

const TEXT_REPLY = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'hello' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
  { type: 'finish', reason: { kind: 'stop' } },
];

test('a stream that ends without a finish chunk is an error, not a silent success', async () => {
  await assert.rejects(
    () => streamReviewerText(streamContext(TEXT_REPLY.slice(0, 3)), {}),
    /ended without a finish chunk/,
  );
});

test('provider failures surface the finish reason, not a generic parse failure', async () => {
  await assert.rejects(
    () => streamReviewerText(streamContext([
      { type: 'finish', reason: { kind: 'error', failure: { code: 'E_PROVIDER', message: 'upstream exploded' } } },
    ]), {}),
    /reviewer stream error: E_PROVIDER upstream exploded/,
  );
  await assert.rejects(
    () => streamReviewerText(streamContext([{ type: 'finish', reason: { kind: 'aborted' } }]), {}),
    /reviewer stream aborted: unknown/,
  );
});

test('both the text and the reasoning blocks are drained', async () => {
  const reply = await streamReviewerText(streamContext([
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'thinking' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: 'verdict' },
    { type: 'block-end', index: 1, block: { type: 'text', text: 'verdict' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]), {});
  assert.equal(reply.text, 'verdict');
  assert.equal(reply.reasoning, 'thinking');
  assert.equal(reply.finishKind, 'stop');
});

// --------------------------------------------------------------------------- steering message shape

test('a severity-3 finding names the final goal and demands a pause', () => {
  const message = buildSteerMessage({
    severity: 3,
    drift_type: 'goal_substitution',
    evidence: 'turn 4: the work serves an unrelated module',
    steer: 'Stop and ask the principal which objective is current.',
  }, 4, {
    final: { objective: 'ship the reviewer' },
    current: { objective: 'refactor an unrelated module' },
  });
  assert.match(message.content[0].text, /goal_conflict \(severity 3\)/);
  assert.match(message.content[0].text, /final goal: ship the reviewer/);
  assert.match(message.content[0].text, /current goal: refactor an unrelated module/);
  assert.match(message.content[0].text, /Stop this line of work/);
});

test('a steering message without a ledger still carries the finding', () => {
  const message = buildSteerMessage({
    severity: 2,
    drift_type: null,
    evidence: 'evidence line',
    steer: 'return to the objective',
  }, 7, null);
  assert.match(message.content[0].text, /finding: unspecified/);
  assert.doesNotMatch(message.content[0].text, /current goal:/);
  assert.equal(message.source.note, 'audit-turn-7');
});
