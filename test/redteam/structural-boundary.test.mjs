/**
 * Red-team: structural boundaries of the reviewer's authority.
 *
 * A governance layer is only as trustworthy as its enforced powers, not its
 * advertised ones. These are static assertions over the shipped sources: the
 * reviewer must have no tool authority, no network, no subprocess, no file
 * writes beyond the audit trail, exactly one prompt section, and a fixed
 * validate → guard → apply order. If a future change breaks one of these, the
 * test fails before the behaviour can even be exercised.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const libDir = path.join(root, 'lib');
const sources = Object.fromEntries(
  readdirSync(libDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => [file, readFileSync(path.join(libDir, file), 'utf8')]),
);

const entries = Object.entries(sources);

test('the reviewer has no tool authority anywhere in the plugin', () => {
  for (const [file, source] of entries) {
    assert.equal(/tools\s*\.\s*register|ctx\.tools|toolRuntime/.test(source), false, `${file} touches the tool registry`);
  }
});

test('only the audit module writes or appends files', () => {
  const writePattern = /writeFile|appendFile|createWriteStream|writeFileSync|appendFileSync|createWriteStream|truncate/;
  for (const [file, source] of entries) {
    if (file === 'audit.js') continue;
    assert.equal(writePattern.test(source), false, `${file} writes files outside the audit trail`);
  }
  assert.match(sources['audit.js'], /appendFile/);
});

test('the plugin has no network or subprocess capability', () => {
  const forbidden = /node:http|node:https|node:net|node:dns|node:child_process|child_process|\bfetch\s*\(/;
  for (const [file, source] of entries) {
    assert.equal(forbidden.test(source), false, `${file} reaches outside the process`);
  }
});

test('exactly one governance prompt section is registered', () => {
  const registrars = entries.filter(([, source]) => source.includes('systemPrompt.section(')).map(([file]) => file);
  assert.deepEqual(registrars, ['index.js']);
  assert.equal((sources['index.js'].match(/systemPrompt\.section\(/g) ?? []).length, 1);
});

test('goal rewrites are guarded before they are applied', () => {
  const reviewer = sources['reviewer.js'];
  const guardAt = reviewer.indexOf('guardGoalUpdate(');
  const applyAt = reviewer.indexOf('applyGoalUpdate(');
  assert.notEqual(guardAt, -1, 'the corroboration guard must exist');
  assert.notEqual(applyAt, -1, 'the ledger update must exist');
  assert.ok(guardAt < applyAt, 'guardGoalUpdate must be reached before applyGoalUpdate');
});

test('steering is gated by the cadence decision and exists in exactly one place', () => {
  const index = sources['index.js'];
  const decideAt = index.indexOf('decideSteer(');
  const buildAt = index.indexOf('buildSteerMessage(');
  assert.ok(decideAt > 0 && buildAt > 0);
  assert.ok(decideAt < buildAt, 'the steering budget is checked before a message is built');
  assert.equal((index.match(/agent\.steer\(/g) ?? []).length, 1, 'exactly one steer call site');
  for (const [file, source] of entries) {
    if (file === 'index.js') continue;
    assert.equal(source.includes('agent.steer('), false, `${file} must not steer directly`);
  }
});

test('the reviewer imports stay inside its declared boundary', () => {
  const reviewer = sources['reviewer.js'];
  const localImports = [...reviewer.matchAll(/from '(\.[^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(localImports, ['./evidence.js', './goals.js', './parse.js', './prompt.js']);
  const hostImports = [...reviewer.matchAll(/from '([^'.][^']*)'/g)].map((match) => match[1]);
  assert.deepEqual(hostImports, ['@deepseek-ai/dsh-llm'], 'the reviewer may only use the message/stream primitives');
});

test('the audit writer serializes each record as one JSON line', () => {
  assert.match(sources['audit.js'], /JSON\.stringify/);
  assert.match(sources['audit.js'], /\\n/);
});

test('the reviewer policy states the verbatim-quote requirement for redirects', () => {
  assert.match(sources['prompt.js'], /verbatim/i);
  assert.match(sources['prompt.js'], /redirected/);
});
