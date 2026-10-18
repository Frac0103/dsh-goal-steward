/**
 * Referential-integrity tests for the theory registry.
 *
 * The point of this file is to make the theoretical foundation *falsifiable at
 * the code level*: a mechanism without a citation, a citation without a
 * mechanism, a drift code without a model, or a broken module path all fail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DRIFT_THEORY,
  INDEPENDENCE_THEORY,
  MECHANISMS,
  MECHANISM_THEORY,
  THEORY,
  THEORY_IDS,
} from '../lib/theory.js';
import { DRIFT_TYPES } from '../lib/prompt.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const idSet = new Set(THEORY_IDS);

test('theory ids are unique', () => {
  assert.equal(idSet.size, THEORY_IDS.length);
});

test('every theory entry is complete', () => {
  for (const entry of THEORY) {
    assert.ok(entry.id, 'missing id');
    assert.ok(entry.name?.en && entry.name?.zh, `${entry.id}: missing bilingual name`);
    assert.ok(entry.source.length > 10, `${entry.id}: missing source`);
    assert.ok(entry.proposition.length > 20, `${entry.id}: missing proposition`);
    assert.ok(entry.translation.length > 20, `${entry.id}: missing translation`);
    assert.ok(entry.limits.length > 10, `${entry.id}: missing limits`);
    assert.ok(Array.isArray(entry.guards) && entry.guards.length > 0, `${entry.id}: missing guards`);
  }
});

test('every mechanism has a theory mapping and vice versa', () => {
  const mechanismIds = Object.keys(MECHANISMS).sort();
  const mappedIds = Object.keys(MECHANISM_THEORY).sort();
  assert.deepEqual(mappedIds, mechanismIds);
});

test('every mechanism citation resolves to a known theory', () => {
  for (const [mechanism, citations] of Object.entries(MECHANISM_THEORY)) {
    assert.ok(citations.length > 0, `${mechanism}: no citations`);
    for (const id of citations) assert.ok(idSet.has(id), `${mechanism}: unknown theory id ${id}`);
  }
});

test('no theory entry is an orphan citation', () => {
  const referenced = new Set(Object.values(MECHANISM_THEORY).flat());
  for (const id of THEORY_IDS) assert.ok(referenced.has(id), `${id} is cited by no mechanism`);
});

test('every drift code has a theoretical basis', () => {
  assert.deepEqual(Object.keys(DRIFT_THEORY).sort(), [...DRIFT_TYPES].sort());
  for (const [code, ids] of Object.entries(DRIFT_THEORY)) {
    assert.ok(ids.length > 0, `${code}: no theory`);
    for (const id of ids) assert.ok(idSet.has(id), `${code}: unknown theory id ${id}`);
  }
});

test('the four independence sources each have a theory basis', () => {
  assert.deepEqual(Object.keys(INDEPENDENCE_THEORY).sort(), ['incentive', 'information', 'program', 'timing']);
  for (const [source, ids] of Object.entries(INDEPENDENCE_THEORY)) {
    assert.ok(ids.length > 0, `${source}: no theory`);
    for (const id of ids) assert.ok(idSet.has(id), `${source}: unknown theory id ${id}`);
  }
});

test('every referenced module path exists on disk', () => {
  for (const [mechanism, definition] of Object.entries(MECHANISMS)) {
    for (const module of definition.modules) {
      assert.ok(existsSync(path.join(root, module)), `${mechanism}: missing module ${module}`);
    }
  }
});

test('planned mechanisms are documented in the roadmap', () => {
  const roadmap = path.join(root, 'docs', 'roadmap.md');
  assert.ok(existsSync(roadmap), 'docs/roadmap.md is referenced by planned mechanisms');
});
