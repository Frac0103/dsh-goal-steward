/**
 * Unit tests for the `/steward` command surface.
 *
 * The command is the principal's direct channel to the stable layer: it runs
 * against the session without creating a model message, so the executor cannot
 * argue with it and the reviewer never sees the request. These tests pin the
 * grammar, the ledger semantics, and the fail-open contract of that channel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPrincipalGoal,
  COMMAND_NAME,
  createStewardCommand,
  parseCommandInput,
  renderFindings,
  renderStatus,
} from '../lib/commands.js';
import { createLedger } from '../lib/goals.js';

// --------------------------------------------------------------------------- fixtures

/** In-memory session state plus captured audit records. */
function makeHarness(overrides = {}) {
  const state = {
    ledger: null,
    reviews: 0,
    steers: 0,
    previousFindings: [],
    ...overrides.state,
  };
  const records = [];
  const deps = {
    config: { audit: true },
    auditPath: '/tmp/goal-steward/audit.jsonl',
    getState: () => state,
    inherit: async () => null,
    writeAudit: async (record) => { records.push(record); },
    isDisposed: () => false,
    ...overrides.deps,
  };
  const command = createStewardCommand(deps);
  return { state, records, command };
}

/** Invoke the command handler with one raw input. */
async function run(command, rawInput, agent = { id: 'session-1' }) {
  return command.handler({ agent, rawInput, attachments: [], signal: new AbortController().signal });
}

// --------------------------------------------------------------------------- grammar

test('the command is registered under a stable lowercase name', () => {
  const { command } = makeHarness();
  assert.equal(command.name, COMMAND_NAME);
  assert.equal(command.name, 'steward');
  assert.equal(command.recordInput, false, 'the audit record is the authoritative copy of the input');
  assert.equal(typeof command.description, 'string');
  assert.equal(typeof command.input.hint, 'string');
});

test('an empty invocation is "status", not an error', () => {
  assert.deepEqual(parseCommandInput(''), { action: 'status', argument: '' });
  assert.deepEqual(parseCommandInput('   '), { action: 'status', argument: '' });
  assert.deepEqual(parseCommandInput('STATUS'), { action: 'status', argument: '' });
  assert.deepEqual(parseCommandInput('why'), { action: 'why', argument: '' });
  assert.deepEqual(parseCommandInput('help'), { action: 'help', argument: '' });
});

test('a goal keeps its inner whitespace but not its edges', () => {
  assert.deepEqual(parseCommandInput('goal   ship the  reviewer  '), { action: 'goal', argument: 'ship the  reviewer' });
  assert.deepEqual(parseCommandInput('goal'), { action: 'goal', argument: '' });
});

test('an unknown subcommand is classified as unknown', () => {
  assert.deepEqual(parseCommandInput('wat is this'), { action: 'unknown', argument: 'wat is this' });
});

// --------------------------------------------------------------------------- ledger semantics

test('a principal goal on an empty ledger starts a redirected revision 1', () => {
  const ledger = applyPrincipalGoal(null, 'ship the reviewer');
  assert.equal(ledger.revision, 1);
  assert.equal(ledger.lastChange, 'redirected');
  assert.equal(ledger.final.objective, 'ship the reviewer');
  assert.equal(ledger.current.objective, 'ship the reviewer', 'the current goal resets to the new destination');
  assert.equal(ledger.history.length, 1);
  assert.equal(ledger.history[0].change, 'redirected');
});

test('a principal goal advances an existing ledger and caps its history', () => {
  const base = createLedger({ initialIntent: 'old objective' });
  const first = applyPrincipalGoal(base, 'new objective');
  assert.equal(first.revision, 2);
  assert.equal(first.final.objective, 'new objective');
  assert.equal(first.history.at(-1).revision, 2);

  let ledger = first;
  for (let index = 0; index < 20; index += 1) ledger = applyPrincipalGoal(ledger, `objective ${index}`);
  assert.equal(ledger.revision, 22);
  assert.equal(ledger.history.length, 10, 'history is bounded');
});

test('an empty, blank or control-only objective is refused', () => {
  for (const value of ['', '   ', null, undefined, 42, '\u0000\u0001']) {
    assert.equal(applyPrincipalGoal(null, value), null);
  }
});

test('a hostile objective is clamped, not trusted', () => {
  const ledger = applyPrincipalGoal(null, `ship ${'x'.repeat(1000)}`);
  assert.ok(ledger.final.objective.length <= 220);
  assert.equal(ledger.final.objective.includes('\n'), false);
});

// --------------------------------------------------------------------------- rendering

test('status explains an empty ledger instead of pretending it is set', () => {
  const text = renderStatus({ ledger: null, reviews: 0, steers: 0, findings: [], auditDisabled: false, auditPath: '/tmp/a.jsonl' });
  assert.match(text, /尚未建立/);
  assert.match(text, /\/steward status/);
});

test('status shows both levels, criteria and the latest finding', () => {
  const ledger = applyPrincipalGoal(null, 'ship the reviewer');
  ledger.final.success_criteria = ['an audit record exists'];
  ledger.final.constraints = ['do not change method'];
  const text = renderStatus({
    ledger,
    reviews: 3,
    steers: 1,
    findings: [{ turn: 4, severity: 2, drift_type: 'scope_creep', evidence: 'an unrelated module' }],
    auditDisabled: true,
    auditPath: '/tmp/a.jsonl',
  });
  assert.match(text, /最终目标：ship the reviewer/);
  assert.match(text, /成功判据：an audit record exists/);
  assert.match(text, /硬约束：do not change method/);
  assert.match(text, /revision 1/);
  assert.match(text, /本实例评审：3 次；发声：1 次/);
  assert.match(text, /scope_creep/);
  assert.match(text, /审计流水：已关闭/);
});

test('findings explain an empty history as a design choice', () => {
  assert.match(renderFindings({ findings: [] }), /暂无历史发现/);
  const text = renderFindings({
    findings: [
      { turn: 2, severity: 2, drift_type: null, evidence: 'first' },
      { turn: 5, severity: 3, drift_type: 'goal_substitution', evidence: 'second' },
    ],
  });
  assert.match(text, /turn 2 · severity 2/);
  assert.match(text, /turn 5 · severity 3 · goal_substitution/);
});

// --------------------------------------------------------------------------- handler

test('status reads the live ledger', async () => {
  const { command } = makeHarness({
    state: { ledger: createLedger({ initialIntent: 'ship the reviewer' }), reviews: 1, steers: 0, previousFindings: [] },
  });
  const result = await run(command, 'status');
  assert.equal(result.kind, 'success');
  assert.match(result.text, /最终目标：ship the reviewer/);
  assert.match(result.text, /revision 1/);
});

test('status replays the audit trail when this instance has no ledger yet', async () => {
  const inheritedLedger = applyPrincipalGoal(null, 'inherited objective');
  const { command, state } = makeHarness({
    deps: {
      inherit: async () => ({ ledger: inheritedLedger, previousFindings: [{ turn: 3, severity: 2, drift_type: 'scope_creep', evidence: 'inherited finding' }] }),
    },
  });
  const result = await run(command, '');
  assert.equal(result.kind, 'success');
  assert.match(result.text, /最终目标：inherited objective/);
  assert.match(result.text, /inherited finding/);
  assert.equal(state.ledger, inheritedLedger, 'the resolved ledger is adopted by the session state');
});

test('goal sets the final goal and writes a principal-command audit record', async () => {
  const { command, state, records } = makeHarness();
  const result = await run(command, 'goal ship the reviewer end to end');
  assert.equal(result.kind, 'success');
  assert.match(result.text, /最终目标已更新（revision 1）/);
  assert.match(result.text, /ship the reviewer end to end/);
  assert.equal(state.ledger.final.objective, 'ship the reviewer end to end');

  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.event, 'command');
  assert.equal(record.action, 'set-goal');
  assert.equal(record.outcome, 'ok');
  assert.equal(record.trigger, 'principal-command');
  assert.equal(record.goalChange, 'redirected');
  assert.equal(record.goalApplied, true);
  assert.equal(record.sessionId, 'session-1');
  assert.equal(record.turn, null);
  assert.equal(record.goals.final.objective, 'ship the reviewer end to end');
  assert.equal(record.goals.current.objective, 'ship the reviewer end to end');
  assert.equal(record.goals.revision, 1);
});

test('goal with an empty objective is refused without touching the ledger', async () => {
  const ledger = createLedger({ initialIntent: 'keep me' });
  const { command, state, records } = makeHarness({ state: { ledger } });
  const result = await run(command, 'goal    ');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /用法/);
  assert.equal(state.ledger, ledger);
  assert.equal(records.length, 0);
});

test('a failed audit write still applies the goal, with an honest warning', async () => {
  const { command, state } = makeHarness({
    deps: { writeAudit: async () => { throw new Error('disk full'); } },
  });
  const result = await run(command, 'goal ship it anyway');
  assert.equal(result.kind, 'success');
  assert.equal(state.ledger.final.objective, 'ship it anyway');
  assert.match(result.text, /审计写入失败/);
});

test('why lists the reviewer history', async () => {
  const { command } = makeHarness({
    state: { previousFindings: [{ turn: 2, severity: 2, drift_type: 'scope_creep', evidence: 'unrelated module' }] },
  });
  const result = await run(command, 'why');
  assert.equal(result.kind, 'success');
  assert.match(result.text, /turn 2 · severity 2 · scope_creep/);
  assert.match(result.text, /unrelated module/);
});

test('help renders the same guidance as status', async () => {
  const { command } = makeHarness();
  assert.equal((await run(command, 'help')).kind, 'success');
});

test('an unknown subcommand returns usage instead of guessing', async () => {
  const { command } = makeHarness();
  const result = await run(command, 'wat');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /未知子命令/);
  assert.match(result.text, /用法/);
});

test('a retired instance refuses to act', async () => {
  const { command } = makeHarness({ deps: { isDisposed: () => true } });
  const result = await run(command, 'goal after retirement');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /已卸载/);
});

test('an unexpected failure becomes a readable error, not a throw', async () => {
  const { command } = makeHarness({ deps: { getState() { throw new Error('state exploded'); } } });
  const result = await run(command, 'status');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /命令执行失败（state exploded）/);

  const missingAgent = await command.handler({ rawInput: 'status' });
  assert.equal(missingAgent.kind, 'error');
  assert.match(missingAgent.text, /无法识别当前会话/);
});

test('a throwing replay is fail-open: status still renders the local ledger', async () => {
  const { command } = makeHarness({ deps: { inherit: async () => { throw new Error('audit exploded'); } } });
  const result = await run(command, 'status');
  assert.equal(result.kind, 'success', 'a broken trace must not break the status view');
  assert.match(result.text, /尚未建立/);
});
