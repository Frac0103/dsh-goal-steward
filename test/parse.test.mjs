import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, parseVerdict, clampText } from '../lib/parse.js';

test('extracts a JSON object out of prose and code fences', () => {
  const text = 'Sure.\n```json\n{"verdict":"on_track","severity":0}\n```\nDone.';
  assert.equal(extractJsonObject(text), '{"verdict":"on_track","severity":0}');
});

test('extracts a JSON object containing braces inside strings', () => {
  const text = '{"evidence":"the {x} call","verdict":"on_track","severity":0}';
  assert.equal(extractJsonObject(text), text);
});

test('returns null when there is no object', () => {
  assert.equal(extractJsonObject('no json here'), null);
  assert.equal(extractJsonObject(undefined), null);
});

test('accepts a clean on_track verdict', () => {
  const verdict = parseVerdict('{"verdict":"on_track","severity":0,"drift_type":null,"evidence":"","steer":"","charter":null}');
  assert.equal(verdict.verdict, 'on_track');
  assert.equal(verdict.severity, 0);
  assert.equal(verdict.drift_type, null);
  assert.equal(verdict.steer, '');
});

test('repairs a mismatched numeric severity from the verdict name', () => {
  const verdict = parseVerdict('{"verdict":"drift","severity":99,"drift_type":"scope_creep","evidence":"turn 3 added a feature nobody asked for","steer":"Drop the extra feature."}');
  assert.equal(verdict.severity, 2);
  assert.equal(verdict.reportedSeverity, 99);
});

test('rejects a drift verdict without a taxonomy code', () => {
  assert.equal(parseVerdict('{"verdict":"drift","severity":2,"evidence":"something","steer":"fix it"}'), null);
});

test('rejects a drift verdict without evidence', () => {
  assert.equal(parseVerdict('{"verdict":"drift","severity":2,"drift_type":"scope_creep","steer":"fix it"}'), null);
});

test('rejects a drift verdict without steering text', () => {
  assert.equal(parseVerdict('{"verdict":"drift","severity":2,"drift_type":"scope_creep","evidence":"turn 3"}'), null);
});

test('drops steering text below the steering threshold', () => {
  const verdict = parseVerdict('{"verdict":"watch","severity":1,"evidence":"a whisper","steer":"should be ignored"}');
  assert.equal(verdict.severity, 1);
  assert.equal(verdict.steer, '');
  assert.equal(verdict.drift_type, null);
});

test('rejects an unknown verdict name', () => {
  assert.equal(parseVerdict('{"verdict":"vibes","severity":2}'), null);
});

test('rejects malformed JSON', () => {
  assert.equal(parseVerdict('{"verdict":"drift",'), null);
});

test('normalizes a charter and caps its lists', () => {
  const verdict = parseVerdict(JSON.stringify({
    verdict: 'on_track',
    severity: 0,
    charter: {
      objective: 'ship a reviewer plugin',
      success_criteria: ['a', 'b', 'c', 'd', 'e'],
      constraints: ['keep it small'],
      non_goals: [],
    },
  }));
  assert.equal(verdict.charter.objective, 'ship a reviewer plugin');
  assert.equal(verdict.charter.success_criteria.length, 4);
  assert.deepEqual(verdict.charter.non_goals, []);
});

test('clampText collapses whitespace and truncates', () => {
  assert.equal(clampText('  a\n\n b  ', 100), 'a b');
  assert.equal(clampText('abcdef', 3), 'abc');
  assert.equal(clampText(null, 3), '');
});
