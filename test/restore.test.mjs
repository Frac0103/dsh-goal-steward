/**
 * Unit tests for session inheritance.
 *
 * The audit trail is the plugin's only durable record, so it is also the
 * mechanism by which a reloaded or restarted reviewer inherits the session's
 * ledger and earlier findings instead of re-anchoring the charter to the opening
 * message. These tests pin the replay contract:
 *
 *   - the newest ledger snapshot wins, whichever audit-record shape wrote it;
 *   - only institutional memory is inherited (ledger + findings), never the
 *     cadence counters;
 *   - a torn line or a missing file degrades to "no memory", never to a throw.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendAuditRecord, readAuditRecords } from '../lib/audit.js';
import { ledgerFromSnapshot, restoreSessionState } from '../lib/restore.js';

// --------------------------------------------------------------------------- fixtures

/** Ledger snapshot in the current audit shape. */
function snapshot(overrides = {}) {
  return {
    revision: 2,
    lastChange: 'refined',
    final: { objective: 'ship the reviewer', success_criteria: ['it audits'], constraints: [], non_goals: [] },
    current: { objective: 'phase two: verify it live', success_criteria: [], constraints: [], non_goals: [] },
    ...overrides,
  };
}

/** One `ok` audit record. */
function okRecord(overrides = {}) {
  return {
    ts: '2026-10-18T08:00:00.000Z',
    v: 1,
    event: 'review',
    outcome: 'ok',
    sessionId: 'session-a',
    turn: 1,
    verdict: 'on_track',
    severity: 0,
    driftType: null,
    evidence: '',
    goals: snapshot(),
    ...overrides,
  };
}

// --------------------------------------------------------------------------- ledgerFromSnapshot

test('an empty or unusable snapshot yields no ledger', () => {
  for (const value of [null, undefined, 'nope', 42, [], {}, { revision: 3 }]) {
    assert.equal(ledgerFromSnapshot(value), null);
  }
});

test('a current-shape snapshot is rebuilt in full', () => {
  const ledger = ledgerFromSnapshot(snapshot());
  assert.equal(ledger.revision, 2);
  assert.equal(ledger.lastChange, 'refined');
  assert.equal(ledger.final.objective, 'ship the reviewer');
  assert.deepEqual(ledger.final.success_criteria, ['it audits']);
  assert.equal(ledger.current.objective, 'phase two: verify it live');
  assert.deepEqual(ledger.history, []);
});

test('a legacy snapshot that stored only objective strings is still honoured', () => {
  const ledger = ledgerFromSnapshot({
    revision: 3,
    lastChange: 'redirected',
    finalGoal: 'maintain the reviewer for my team',
    currentGoal: null,
  });
  assert.equal(ledger.revision, 3);
  assert.equal(ledger.final.objective, 'maintain the reviewer for my team');
  assert.equal(ledger.current.objective, 'maintain the reviewer for my team', 'a missing current level inherits final');
});

test('a hostile snapshot is normalized and capped, not trusted', () => {
  const ledger = ledgerFromSnapshot({
    revision: -99,
    lastChange: '',
    final: { objective: `ship ${'x'.repeat(1000)}`, success_criteria: Array.from({ length: 20 }, (_, i) => `criterion ${i}`) },
  });
  assert.equal(ledger.revision, 1, 'an invalid revision falls back to 1');
  assert.equal(ledger.lastChange, 'inherited');
  assert.ok(ledger.final.objective.length <= 220);
  assert.ok(ledger.final.success_criteria.length <= 4);
});

// --------------------------------------------------------------------------- restoreSessionState

test('no records means nothing to inherit', () => {
  for (const records of [undefined, null, [], [{ nope: true }], [{ event: 'lifecycle' }]]) {
    assert.equal(restoreSessionState(records), null);
  }
});

test('the newest ledger snapshot wins, even when later records carry none', () => {
  const records = [
    okRecord({ turn: 1, goals: snapshot({ revision: 1, lastChange: 'initial' }) }),
    okRecord({ turn: 3, goals: snapshot({ revision: 2, lastChange: 'refined' }) }),
    okRecord({ turn: 4, outcome: 'error', goals: null }),
  ];
  const inherited = restoreSessionState(records);
  assert.equal(inherited.ledger.revision, 2);
  assert.equal(inherited.ledger.lastChange, 'refined');
});

test('earlier findings are replayed in order and capped at five', () => {
  const records = Array.from({ length: 8 }, (_, index) => okRecord({
    turn: index + 1,
    verdict: 'drift',
    severity: 2,
    driftType: 'scope_creep',
    evidence: `finding ${index + 1}`,
  }));
  records.push(okRecord({ turn: 9, outcome: 'skip', verdict: null }));
  const inherited = restoreSessionState(records);
  assert.equal(inherited.previousFindings.length, 5);
  assert.deepEqual(inherited.previousFindings.map((finding) => finding.evidence), [
    'finding 4', 'finding 5', 'finding 6', 'finding 7', 'finding 8',
  ]);
  assert.equal(inherited.previousFindings.at(-1).drift_type, 'scope_creep');
  assert.equal(inherited.previousFindings.at(-1).severity, 2);
});

test('findings without a recorded evidence string are not replayed', () => {
  const inherited = restoreSessionState([okRecord({ evidence: null })]);
  assert.equal(inherited.previousFindings.length, 0);
  assert.notEqual(inherited.ledger, null, 'the ledger is still inherited');
});

// --------------------------------------------------------------------------- readAuditRecords

test('readAuditRecords filters by session and skips torn lines', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-restore-'));
  try {
    const config = { audit: true, auditDir: dir };
    await appendAuditRecord(config, { event: 'review', sessionId: 'session-a', turn: 1, outcome: 'ok', goals: snapshot() });
    await appendAuditRecord(config, { event: 'review', sessionId: 'session-b', turn: 1, outcome: 'ok', goals: snapshot() });
    // Simulate a crash mid-write: a torn trailing line and a non-JSON line.
    appendFileSync(path.join(dir, 'audit.jsonl'), '{"event":"review","sessionId":"session-a"\nnot json\n', 'utf8');

    const records = await readAuditRecords(config, 'session-a');
    assert.equal(records.length, 1);
    assert.equal(records[0].sessionId, 'session-a');
    const inherited = restoreSessionState(records);
    assert.equal(inherited.ledger.revision, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAuditRecords is fail-open: missing file and missing session are empty', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-restore-'));
  try {
    assert.deepEqual(await readAuditRecords({ audit: true, auditDir: dir }, 'session-a'), []);
    await appendAuditRecord({ audit: true, auditDir: dir }, { event: 'review', sessionId: 'session-a', outcome: 'ok' });
    assert.deepEqual(await readAuditRecords({ audit: true, auditDir: dir }, 'session-missing'), []);
    assert.deepEqual(await readAuditRecords({ audit: true, auditDir: dir }, undefined), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
