/**
 * Mock-host integration test for the plugin wiring.
 *
 * This drives the real `apply()` with a hand-built cordis context, the real
 * `@deepseek-ai/dsh-llm` message/assembler classes, and a scripted event log.
 * It is the layer between the pure-function unit tests and a live profile: it
 * proves that event wiring, evidence construction, verdict validation, steering
 * and audit persistence actually compose.
 *
 * Dependency note: this test needs the `@deepseek-ai/dsh-llm` devDependency
 * (peer of the published package). `npm ci` installs it in CI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply, inject, name } from '../../lib/index.js';

// --------------------------------------------------------------------------- fixtures

/** Dense fake session log (index === seq). */
function makeEvents() {
  return [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    {
      seq: 1,
      type: 'user/message',
      data: {
        source: { kind: 'user', rpcId: 'rpc-1' },
        content: [{ type: 'text', text: 'build a goal governance plugin and publish it to GitHub' }],
      },
    },
    { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, name: 'edit', arguments: '{"file_path":"lib/unrelated.js"}' } },
    {
      seq: 3,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 2,
        message: { content: [{ type: 'text', text: 'I added a new unrelated module and some docs.' }] },
      },
    },
  ];
}

/** Scripted streaming reply in the host's StreamChunk protocol. */
async function* fakeStream(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

/** Cordis-like context with the minimum surface this plugin touches. */
function makeContext({ reply, throwOnReview = false } = {}) {
  const handlers = new Map();
  const sections = [];
  const disposers = [];
  const llmCalls = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(generator) {
      const iterator = generator();
      let step = iterator.next();
      while (step.done !== true) {
        if (typeof step.value === 'function') disposers.push(step.value);
        step = iterator.next();
      }
      return () => {};
    },
    systemPrompt: {
      section(spec) {
        sections.push(spec);
        return () => {};
      },
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return () => {};
    },
    get(service) {
      return service === 'goals' ? undefined : undefined;
    },
    llm: {
      stream(options) {
        llmCalls.push(options);
        if (throwOnReview) throw new Error('provider exploded');
        return fakeStream(reply);
      },
    },
    dispose() {
      for (const disposer of disposers.reverse()) {
        try {
          disposer();
        } catch {
          // disposal is best-effort
        }
      }
    },
  };
  return { ctx, handlers, sections, llmCalls };
}

/** Fake live agent with its own steering inbox. */
function makeAgent(events = makeEvents()) {
  const steered = [];
  const agent = {
    id: 'session-test-1',
    session: {
      header: { cwd: 'D:/project', origin: 'user' },
      snapshotEvents: () => events,
      surface: { nodes: events.map((event) => event.seq) },
      requestHeader: () => ({ config: { provider: 'fake-provider', model: 'fake-model' } }),
    },
    steer(message) {
      steered.push(message);
    },
  };
  return { agent, steered };
}

/** Drive the registered turn-stopping handler. */
async function stopTurn(handlers, agent, turn = 1) {
  const listeners = handlers.get('agent/turn-stopping') ?? [];
  assert.equal(listeners.length, 1, 'exactly one turn-stopping listener must be registered');
  const controller = new AbortController();
  await listeners[0]({ agent, turn, signal: controller.signal });
}

const DRIFT_REPLY = JSON.stringify({
  verdict: 'drift',
  severity: 2,
  drift_type: 'scope_creep',
  evidence: 'turn 1 step 1: edit touched a file unrelated to the stated objective',
  steer: 'Return to the stated objective before adding new files.',
  goal_update: { change: 'none', final: null, current: null, serves_final: true, rationale: '' },
});

const REFINE_REPLY = JSON.stringify({
  verdict: 'on_track',
  severity: 0,
  drift_type: null,
  evidence: '',
  steer: '',
  goal_update: {
    change: 'refined',
    current: {
      objective: 'phase two: verify the reviewer in a live conversation',
      success_criteria: ['an audit record exists'],
    },
    serves_final: true,
    rationale: 'the principal moved from building to verifying',
  },
});

const SILENT_SUBSTITUTION_REPLY = JSON.stringify({
  verdict: 'drift',
  severity: 2,
  drift_type: 'goal_substitution',
  evidence: 'turn 1: the executor replaced the objective with an unrelated refactor',
  steer: 'Return to the recorded objective and drop the refactor.',
  goal_update: {
    change: 'silent_substitution',
    serves_final: false,
    rationale: 'the current work no longer serves the final goal',
  },
});

const ON_TRACK_REPLY = JSON.stringify({
  verdict: 'on_track',
  severity: 0,
  drift_type: null,
  evidence: '',
  steer: '',
  goal_update: { change: 'none', final: null, current: null, serves_final: true, rationale: '' },
});

// --------------------------------------------------------------------------- tests

test('apply installs the governance section and one turn-stopping listener', () => {
  const { ctx, handlers, sections } = makeContext({ reply: ON_TRACK_REPLY });
  apply(ctx, { audit: false });
  assert.equal(name, 'dsh-goal-steward');
  assert.ok(inject.includes('systemPrompt') && inject.includes('llm'));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'goal-steward:governance');
  assert.equal(sections[0].order, 700);
  assert.match(sections[0].text, /GOAL GOVERNANCE/);
  assert.match(sections[0].text, /three-lines-of-defence/);
  assert.equal((handlers.get('agent/disposed') ?? []).length, 1);
  ctx.dispose();
});

test('disabled configuration installs nothing', () => {
  const { ctx, handlers, sections } = makeContext({ reply: ON_TRACK_REPLY });
  apply(ctx, { enabled: false });
  assert.equal(sections.length, 0);
  assert.equal(handlers.size, 0);
  ctx.dispose();
});

test('a drift verdict produces one evidence-backed steering message', async () => {
  const { ctx, handlers, llmCalls } = makeContext({ reply: DRIFT_REPLY });
  const { agent, steered } = makeAgent();
  apply(ctx, { audit: false });
  await stopTurn(handlers, agent, 1);

  assert.equal(llmCalls.length, 1, 'exactly one reviewer call');
  const call = llmCalls[0];
  assert.equal(call.provider, 'fake-provider');
  assert.equal(call.model, 'fake-model');
  assert.equal(call.temperature, 0);
  assert.match(call.system, /Independent Goal Steward/);
  assert.match(call.system, /second line of defence/);

  const pack = JSON.parse(call.messages[0].content[0].text);
  assert.equal(pack.turn, 1);
  assert.equal(pack.principal_initial_message, 'build a goal governance plugin and publish it to GitHub');
  assert.equal(pack.goal_ledger.revision, 1);
  assert.equal(pack.goal_ledger.final.objective, 'build a goal governance plugin and publish it to GitHub');
  assert.equal(pack.goal_ledger.current.objective, 'build a goal governance plugin and publish it to GitHub');
  assert.equal(pack.principal_messages[0], 'build a goal governance plugin and publish it to GitHub');
  assert.equal(pack.executor_final_message, 'I added a new unrelated module and some docs.');
  assert.ok(pack.recent_actions.length >= 1);
  assert.equal('reasoning' in pack, false);

  assert.equal(steered.length, 1);
  const message = steered[0];
  assert.equal(message.role, 'user');
  assert.equal(message.source.kind, 'plugin');
  assert.equal(message.source.plugin, 'dsh-goal-steward');
  assert.match(message.content[0].text, /GOAL-STEWARD AUDIT/);
  assert.match(message.content[0].text, /scope_creep/);
  assert.match(message.content[0].text, /unrelated to the stated objective/);
  ctx.dispose();
});

test('an on-track verdict stays silent', async () => {
  const { ctx, handlers, llmCalls } = makeContext({ reply: ON_TRACK_REPLY });
  const { agent, steered } = makeAgent();
  apply(ctx, { audit: false });
  await stopTurn(handlers, agent, 1);
  assert.equal(llmCalls.length, 1);
  assert.equal(steered.length, 0);
  ctx.dispose();
});

test('a malformed verdict is audited and never steers', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-test-'));
  try {
    const { ctx, handlers } = makeContext({ reply: 'I think this looks fine to me.' });
    const { agent, steered } = makeAgent();
    apply(ctx, { audit: true, auditDir: dir });
    await stopTurn(handlers, agent, 1);
    assert.equal(steered.length, 0);
    const audit = readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].outcome, 'error');
    assert.equal(audit[0].reason, 'unparseable-verdict');
    ctx.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a provider failure is audited, swallowed, and never steers', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-test-'));
  try {
    const { ctx, handlers } = makeContext({ throwOnReview: true });
    const { agent, steered } = makeAgent();
    apply(ctx, { audit: true, auditDir: dir });
    await stopTurn(handlers, agent, 1);
    assert.equal(steered.length, 0);
    const audit = readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(audit[0].outcome, 'error');
    assert.match(audit[0].reason, /call-failed/);
    ctx.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('child sessions are not audited by default', async () => {
  const { ctx, handlers, llmCalls } = makeContext({ reply: DRIFT_REPLY });
  const { agent } = makeAgent();
  agent.session.header.parentSession = 'parent-session';
  apply(ctx, { audit: false });
  await stopTurn(handlers, agent, 1);
  assert.equal(llmCalls.length, 0);
  ctx.dispose();
});

test('a zero steering budget keeps the finding silent but audited', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-test-'));
  try {
    const { ctx, handlers } = makeContext({ reply: DRIFT_REPLY });
    const { agent, steered } = makeAgent();
    apply(ctx, { audit: true, auditDir: dir, maxSteersPerTurn: 0 });
    await stopTurn(handlers, agent, 1);
    assert.equal(steered.length, 0);
    const audit = readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(audit[0].outcome, 'ok');
    assert.equal(audit[0].steered, false);
    assert.equal(audit[0].steerSkipped, 'turn-steer-budget');
    ctx.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the same turn is never reviewed twice', async () => {
  const { ctx, handlers, llmCalls } = makeContext({ reply: ON_TRACK_REPLY });
  const { agent } = makeAgent();
  apply(ctx, { audit: false });
  await stopTurn(handlers, agent, 1);
  await stopTurn(handlers, agent, 1);
  assert.equal(llmCalls.length, 1);
  ctx.dispose();
});

test('a gentle preset only audits on forced triggers', async () => {
  const { ctx, handlers, llmCalls } = makeContext({ reply: ON_TRACK_REPLY });
  const { agent } = makeAgent();
  apply(ctx, { audit: false, preset: 'gentle' });
  await stopTurn(handlers, agent, 1);
  assert.equal(llmCalls.length, 0, 'gentle does not audit the first turn');
  ctx.dispose();
});

// ------------------------------------------------- two-level goal ledger in action

test('a refined current goal is written to the ledger and the audit trail', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-test-'));
  try {
    const { ctx, handlers } = makeContext({ reply: REFINE_REPLY });
    const { agent, steered } = makeAgent();
    apply(ctx, { audit: true, auditDir: dir });
    await stopTurn(handlers, agent, 1);
    assert.equal(steered.length, 0, 'a legitimate refinement is not drift');
    const audit = readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(audit[0].outcome, 'ok');
    assert.equal(audit[0].goalChange, 'refined');
    assert.equal(audit[0].goalApplied, true);
    assert.equal(audit[0].goals.revision, 2);
    assert.equal(audit[0].goals.finalGoal, 'build a goal governance plugin and publish it to GitHub');
    assert.equal(audit[0].goals.currentGoal, 'phase two: verify the reviewer in a live conversation');
    ctx.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a silent substitution is flagged as drift and never rewrites the ledger', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-test-'));
  try {
    const { ctx, handlers } = makeContext({ reply: SILENT_SUBSTITUTION_REPLY });
    const { agent, steered } = makeAgent();
    apply(ctx, { audit: true, auditDir: dir });
    await stopTurn(handlers, agent, 1);
    assert.equal(steered.length, 1, 'silent substitution must steer');
    assert.match(steered[0].content[0].text, /goal_substitution/);
    const audit = readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(audit[0].goalChange, 'silent_substitution');
    assert.equal(audit[0].goalApplied, false);
    assert.equal(audit[0].goals.revision, 1, 'the ledger must keep its original revision');
    assert.equal(audit[0].goals.currentGoal, 'build a goal governance plugin and publish it to GitHub');
    ctx.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
