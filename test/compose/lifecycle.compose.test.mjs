/**
 * Real-composition tests for the plugin lifecycle.
 *
 * The mock-context lifecycle tests prove the wiring; this tier proves the same
 * properties against the real registries and the real AgentLoop:
 *
 *   1. unloading the plugin really removes the prompt section from assembled
 *      model requests and really stops the turn-boundary reviewer;
 *   2. a reloaded plugin really governs again (the section name is reusable and
 *      the session state starts clean);
 *   3. a duplicated mount is refused by the real prompt registry and a turn is
 *      still audited exactly once;
 *   4. retirement during an in-flight reviewer call really suppresses the
 *      finding — no plugin message reaches the session log, no audit record is
 *      written — even though the scripted reply arrives after the unload.
 *
 * Only the model boundary is scripted, as in `reviewer.compose.test.mjs`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import * as GoalSteward from '../../lib/index.js';
import { Context, disposeContext, mountAgentLoop, mountPrerequisiteServices } from '../../test-support/compose-mount.mjs';

const MANDATE = 'Ship goal-steward as an open-source reviewer that prevents goal drift, then use it on my own tasks.';
const PROVIDER = 'compose-lifecycle';
const MODEL = 'compose-lifecycle-model';
const REVIEWER_PREFIX = 'You are the Independent Goal Steward';
const PROTOCOL_HEADING = /GOAL GOVERNANCE \(dsh-goal-steward\)/g;

/** Same Node gate as the other composition tier; the plugin itself is Node 20. */
const HOST_RUNTIME_AVAILABLE = typeof Promise.withResolvers === 'function';
const SKIP_REASON = 'real-composition tier needs Node >= 22 (host services use Promise.withResolvers)';

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
  evidence: 'turn 1: the executor started an unrelated refactor',
  steer: 'Drop the unrelated refactor and return to shipping the plugin.',
  goal_update: { change: 'none', final: null, current: null, serves_final: true, rationale: '' },
});

/** StreamChunk sequence for one assistant text reply. */
function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

/** One-shot gate that holds a reviewer call open until the test releases it. */
function makeGate() {
  let release;
  let started;
  const promise = new Promise((resolve) => { release = resolve; });
  const startedPromise = new Promise((resolve) => { started = resolve; });
  return {
    promise,
    started: startedPromise,
    release: () => release(),
    markStarted: () => started(),
  };
}

/**
 * Reviewer stream; when a gate is present the reply is held until release, so a
 * test can unload the plugin while the call is in flight.
 *
 * @param {string} text scripted verdict JSON.
 * @param {ReturnType<typeof makeGate>|null} gate optional one-shot gate.
 */
async function* reviewerStream(text, gate) {
  if (gate !== null) {
    gate.markStarted();
    await gate.promise;
  }
  yield* textChunks(text);
}

/** All text found in one request's messages, for content assertions. */
function requestText(request) {
  return JSON.stringify(request.messages ?? []);
}

/** Read every audit record written to the temp DSH home. */
function readAudit(dshHome) {
  const file = path.join(dshHome, 'goal-steward', 'audit.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/**
 * Mount the real composition, then hand lifecycle controls to `fn`.
 *
 * @param {object} input
 * @param {string} [input.reviewerReply] scripted reviewer JSON.
 * @param {ReturnType<typeof makeGate>} [input.gate] hold the reviewer reply open.
 * @param {(state: object) => Promise<void>} fn assertions.
 * @returns {Promise<void>}
 */
async function withLifecycleComposition(input, fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'goal-steward-compose-lifecycle-'));
  const dshHome = path.join(root, 'home');
  mkdirSync(dshHome, { recursive: true });
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dshHome;

  const ctx = new Context();
  const capture = { main: [], reviewer: [], unexpected: [] };
  const reviewerReply = input.reviewerReply ?? ON_TRACK_REPLY;
  const gate = input.gate ?? null;
  /** @type {Array<Awaited<ReturnType<typeof ctx.plugin>>>} */
  const mounted = [];
  let handle;
  try {
    await mountPrerequisiteServices(ctx, { systemPrompt: {}, tools: {} });

    const mountPlugin = async () => {
      const fiber = ctx.plugin({ name: GoalSteward.name, inject: GoalSteward.inject, apply: GoalSteward.apply });
      await fiber;
      mounted.push(fiber);
      return fiber;
    };
    await mountPlugin();

    ctx.on('llm/stream', (options, next) => {
      if (typeof options.system === 'string' && options.system.startsWith(REVIEWER_PREFIX)) {
        capture.reviewer.push(options);
        return reviewerStream(reviewerReply, gate);
      }
      if (isAgentLoopRequest(options)) {
        capture.main.push(options);
        return (async function* () {
          yield* textChunks('I will inspect the repository before changing anything.');
        })();
      }
      capture.unexpected.push(options.system ?? '(request without system prompt)');
      return next();
    });

    await mountAgentLoop(ctx);
    handle = await ctx.agents.create({
      sessionId: SessionId('compose-lifecycle-session-1'),
      meta: { cwd: root },
      agentOptions: { provider: PROVIDER, model: MODEL },
    });
    const agent = handle.agent;

    let turnCount = 0;
    const turn = async (text = 'Continue.') => {
      turnCount += 1;
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user', rpcId: `human-${turnCount}` },
      }));
      await agent.whenIdle();
    };

    /** Dispose the most recently mounted plugin fiber (unload / HMR reload). */
    const unloadPlugin = async () => {
      const fiber = mounted.pop();
      if (fiber !== undefined) await fiber.dispose();
    };

    /** The session log's plugin-authored messages (audit findings). */
    const pluginMessages = () => agent.session.snapshotEvents()
      .filter((event) => event.type === 'user/message' && event.data.source?.kind === 'plugin');

    await fn({ ctx, agent, capture, turn, mountPlugin, unloadPlugin, pluginMessages, dshHome, root });
  } finally {
    try {
      for (const fiber of mounted.splice(0).reverse()) {
        try {
          await fiber.dispose();
        } catch {
          // teardown is best-effort
        }
      }
      if (handle !== undefined) await handle.dispose();
    } finally {
      try {
        await disposeContext(ctx);
      } finally {
        process.env.DSH_HOME = previousHome;
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
}

// --------------------------------------------------------------------------- tests

test('unloading removes the protocol and the reviewer; reloading restores both', async (t) => {
  if (!HOST_RUNTIME_AVAILABLE) return t.skip(SKIP_REASON);
  await withLifecycleComposition({}, async ({ capture, turn, mountPlugin, unloadPlugin }) => {
    await turn(MANDATE);
    assert.equal(capture.reviewer.length, 1, 'the first turn is reviewed');
    assert.equal((requestText(capture.main[0]).match(PROTOCOL_HEADING) ?? []).length, 1);

    await unloadPlugin();
    await turn('Continue.');

    assert.equal(capture.reviewer.length, 1, 'an unloaded reviewer must not run');
    assert.doesNotMatch(requestText(capture.main[1]), /GOAL GOVERNANCE \(dsh-goal-steward\)/, 'the protocol must leave the assembled prompt');

    await mountPlugin();
    await turn('Carry on.');

    assert.equal(capture.reviewer.length, 2, 'the reloaded reviewer must govern again');
    assert.equal((requestText(capture.main[2]).match(PROTOCOL_HEADING) ?? []).length, 1, 'the protocol must return exactly once');
  });
});

test('a duplicated mount is refused in a real context and a turn is audited once', async (t) => {
  if (!HOST_RUNTIME_AVAILABLE) return t.skip(SKIP_REASON);
  await withLifecycleComposition({}, async ({ capture, turn, mountPlugin, dshHome }) => {
    await mountPlugin();

    await turn(MANDATE);

    assert.equal(capture.reviewer.length, 1, 'exactly one reviewer call per turn');
    assert.equal((requestText(capture.main[0]).match(PROTOCOL_HEADING) ?? []).length, 1, 'exactly one governance protocol');
    assert.equal(readAudit(dshHome).length, 1, 'the turn must be audited exactly once');
  });
});

test('retirement during an in-flight reviewer call drops the finding', async (t) => {
  if (!HOST_RUNTIME_AVAILABLE) return t.skip(SKIP_REASON);
  const gate = makeGate();
  await withLifecycleComposition({ reviewerReply: DRIFT_REPLY, gate }, async ({ capture, turn, unloadPlugin, pluginMessages, dshHome }) => {
    const pending = turn(MANDATE);
    await gate.started;
    assert.equal(capture.reviewer.length, 1);

    await unloadPlugin();
    gate.release();
    await pending;

    assert.equal(capture.main.length, 1, 'a retired reviewer must not reopen the turn');
    assert.equal(pluginMessages().length, 0, 'no audit finding may reach the session log after retirement');
    assert.deepEqual(readAudit(dshHome), [], 'no audit record may be written after retirement');
  });
});
