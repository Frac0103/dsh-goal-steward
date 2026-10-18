/**
 * Lifecycle tests for the governance layer.
 *
 * The host is not a single long-lived process: a plugin instance is unloaded on
 * HMR reload, profile toggle, and shutdown, and a second instance can be mounted
 * by a duplicated bundle entry. Both are governance events, not plumbing
 * details:
 *
 *   - a retired reviewer that still steers is an authority nobody appointed;
 *   - two live reviewers audit every turn twice and compete to steer.
 *
 * These tests drive the real `apply()` against a fake context that implements
 * cordis effect semantics (collect, reverse-dispose, setup-failure rollback) and
 * a host registry that refuses duplicate prompt section names, which is the same
 * singleton lock the real `dsh-system-prompt` registry provides.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply } from '../../lib/index.js';

// --------------------------------------------------------------------------- fixtures

/** Dense fake session log (index === seq), same shape as apply.test.mjs. */
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
    {
      seq: 2,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 2,
        message: { content: [{ type: 'text', text: 'I added an unrelated module and some docs.' }] },
      },
    },
  ];
}

/** One-shot gate that lets a test hold a reviewer call open. */
function makeGate() {
  let release;
  let markStarted;
  const promise = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  return {
    promise,
    started,
    release: () => release(),
    markStarted: () => markStarted(),
  };
}

/** StreamChunk sequence for one assistant reply. */
function chunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

const ON_TRACK_REPLY = JSON.stringify({
  verdict: 'on_track',
  severity: 0,
  drift_type: null,
  evidence: '',
  steer: '',
  goal_update: { change: 'none', final: null, current: null, serves_final: true, rationale: '' },
});

const DRIFT_REPLY = JSON.stringify({
  verdict: 'drift',
  severity: 2,
  drift_type: 'scope_creep',
  evidence: 'turn 1: the executor added an unrelated module',
  steer: 'Return to the stated objective.',
  goal_update: { change: 'none', final: null, current: null, serves_final: true, rationale: '' },
});

/**
 * Cordis-like host with effect-semantics and a name-unique prompt registry.
 *
 * `sectionError` injects an infrastructure failure; `gate` holds the reviewer
 * stream open so a test can retire the plugin mid-call.
 */
function makeHost({ reply = ON_TRACK_REPLY, sectionError = null, gate = null } = {}) {
  const sections = new Map();
  const handlers = new Map();
  const effects = [];
  const warnings = [];
  const llmCalls = [];
  /** @type {{signal: AbortSignal|undefined}|null} */
  let reviewerStream;

  const ctx = {
    logger: {
      info() {},
      debug() {},
      error() {},
      warn(message) { warnings.push(String(message)); },
    },
    effect(execute) {
      const collected = [];
      const dispose = () => {
        for (const disposer of collected.splice(0).reverse()) {
          try {
            disposer();
          } catch {
            // teardown is best-effort
          }
        }
      };
      try {
        const iterator = execute();
        let step = iterator.next();
        while (step.done !== true) {
          if (typeof step.value !== 'function') throw new TypeError('invalid effect');
          collected.push(step.value);
          step = iterator.next();
        }
      } catch (error) {
        // cordis rolls back the disposers it already collected, then rethrows.
        dispose();
        throw error;
      }
      effects.push(dispose);
      return dispose;
    },
    systemPrompt: {
      section(spec) {
        if (sectionError !== null) throw new Error(sectionError);
        if (sections.has(spec.name)) {
          throw new Error(`prompt section "${spec.name}" is already registered`);
        }
        sections.set(spec.name, spec);
        return () => sections.delete(spec.name);
      },
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    get() {
      return undefined;
    },
    llm: {
      stream(options) {
        llmCalls.push(options);
        reviewerStream = { signal: options.signal };
        const body = (async function* () {
          if (gate !== null) {
            gate.markStarted();
            await gate.promise;
          }
          yield* chunks(reply);
        })();
        return body;
      },
    },
  };

  return {
    ctx,
    sections,
    handlers,
    warnings,
    llmCalls,
    get reviewerSignal() { return reviewerStream?.signal; },
    countHandlers(event) { return handlers.get(event)?.size ?? 0; },
    totalHandlers() { return [...handlers.values()].reduce((sum, set) => sum + set.size, 0); },
    dispose() {
      for (const dispose of effects.splice(0).reverse()) dispose();
    },
    async emitTurnStopping(agent, turn = 1) {
      const listeners = [...(handlers.get('agent/turn-stopping') ?? [])];
      assert.equal(listeners.length, 1, 'exactly one turn-stopping listener must be live');
      await listeners[0]({ agent, turn, signal: new AbortController().signal });
    },
  };
}

/** Fake live agent with its own steering inbox. */
function makeAgent(events = makeEvents()) {
  const steered = [];
  const agent = {
    id: 'session-lifecycle-1',
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

/** Run `fn` with a temporary audit directory. */
async function withAuditDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-lifecycle-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------- tests

test('disposing the plugin unregisters the section and every listener', () => {
  const host = makeHost();
  apply(host.ctx, { audit: false });
  assert.equal(host.sections.size, 1);
  assert.equal(host.countHandlers('agent/turn-stopping'), 1);
  assert.equal(host.countHandlers('agent/disposed'), 1);

  host.dispose();

  assert.equal(host.sections.size, 0, 'the governance protocol must leave the prompt');
  assert.equal(host.totalHandlers(), 0, 'no listener may survive the unload');
});

test('a second mount is refused without a throw, and re-mounting after dispose works', () => {
  const host = makeHost();
  apply(host.ctx, { audit: false });
  assert.doesNotThrow(() => apply(host.ctx, { audit: false }));

  assert.equal(host.sections.size, 1, 'a duplicate mount must not assemble a second protocol');
  assert.equal(host.countHandlers('agent/turn-stopping'), 1, 'a duplicate mount must not run a second reviewer');
  assert.match(host.warnings.join('\n'), /installation skipped: prompt section .* already registered/);

  host.dispose();
  apply(host.ctx, { audit: false });
  assert.equal(host.sections.size, 1, 'a reload must be able to install again');
  assert.equal(host.countHandlers('agent/turn-stopping'), 1);
  host.dispose();
});

test('an install-time registry failure is fail-open', () => {
  const host = makeHost({ sectionError: 'prompt registry offline' });
  assert.doesNotThrow(() => apply(host.ctx, { audit: false }));
  assert.equal(host.sections.size, 0);
  assert.equal(host.totalHandlers(), 0);
  assert.match(host.warnings.join('\n'), /installation skipped: prompt registry offline/);
  host.dispose();
});

test('retirement aborts the in-flight reviewer call and drops its finding', async () => {
  await withAuditDir(async (dir) => {
    const gate = makeGate();
    const host = makeHost({ reply: DRIFT_REPLY, gate });
    const { agent, steered } = makeAgent();
    apply(host.ctx, { audit: true, auditDir: dir });

    const turn = host.emitTurnStopping(agent, 1);
    await gate.started;
    assert.equal(host.llmCalls.length, 1, 'the reviewer call must be live before retirement');

    host.dispose();
    assert.equal(host.reviewerSignal?.aborted, true, 'unload must abort the reviewer call, not wait for the timeout');

    // The reply can still arrive after the abort (buffered stream, provider race).
    gate.release();
    await turn;

    assert.equal(steered.length, 0, 'a retired reviewer must not steer');
    assert.equal(existsSync(path.join(dir, 'audit.jsonl')), false, 'a retired reviewer must not keep issuing findings');
  });
});

test('a live reviewer still works before retirement, and a reloaded one starts clean', async () => {
  await withAuditDir(async (dir) => {
    const host = makeHost({ reply: DRIFT_REPLY });
    const { agent, steered } = makeAgent();
    apply(host.ctx, { audit: true, auditDir: dir });

    await host.emitTurnStopping(agent, 1);
    assert.equal(steered.length, 1, 'the live instance must steer');
    assert.equal(existsSync(path.join(dir, 'audit.jsonl')), true);

    host.dispose();
    apply(host.ctx, { audit: true, auditDir: dir });
    await host.emitTurnStopping(agent, 1);
    assert.equal(steered.length, 2, 'the reloaded instance must govern again');
    assert.equal(host.llmCalls.length, 2);
    host.dispose();
  });
});

test('an agent disposal forgets its cadence state', async () => {
  const host = makeHost({ reply: ON_TRACK_REPLY });
  const { agent } = makeAgent();
  apply(host.ctx, { audit: false });

  await host.emitTurnStopping(agent, 1);
  assert.equal(host.llmCalls.length, 1);

  // Without forgetting, turn 1 would be suppressed as already-reviewed.
  const disposed = [...host.handlers.get('agent/disposed')];
  assert.equal(disposed.length, 1);
  disposed[0] && disposed[0]({ agent });

  await host.emitTurnStopping(agent, 1);
  assert.equal(host.llmCalls.length, 2, 'a disposed agent must start a fresh review cadence');
  host.dispose();
});
