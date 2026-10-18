/**
 * Real-composition tests for dsh-goal-steward.
 *
 * This is the tier the official `docs/testing.md` calls a mandatory
 * "non-unit REAL-composition test" for product-visible plugins: the real host
 * services, the real AgentLoop, a real Agent and a real Session log — only the
 * model boundary is scripted, by intercepting the `llm/stream` waterfall before
 * adapter resolution (the same technique as
 * `packages/experimental/auto-review/tests/auto-review.e2e.ts`).
 *
 * What a scripted-mock-context test cannot prove, and this one does:
 *   1. the plugin installs into a real cordis context and its prompt section
 *      reaches the assembled model request;
 *   2. `agent/turn-stopping` really fires on a production turn and the reviewer
 *      call really leaves through `ctx.llm.stream`;
 *   3. the audit record really hits the filesystem with the two-level ledger;
 *   4. a drift verdict really travels back through `agent.steer()` into the
 *      session log and into the executor's next model request.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import * as GoalSteward from '../../lib/index.js';
import { Context, disposeContext, mountAgentLoop, mountPrerequisiteServices } from '../../test-support/compose-mount.mjs';

const MANDATE = 'Ship goal-steward as an open-source reviewer that prevents goal drift, then use it on my own tasks.';
const PROVIDER = 'compose-test';
const MODEL = 'compose-test-model';
const REVIEWER_PREFIX = 'You are the Independent Goal Steward';

/**
 * The published host service packages use `Promise.withResolvers` (Node >= 22),
 * so this tier self-skips on older runtimes instead of turning the whole matrix
 * red. The plugin itself still declares `engines.node >= 20`; only this tier
 * mounts the host runtime.
 */
const HOST_RUNTIME_AVAILABLE = typeof Promise.withResolvers === 'function';
const SKIP_REASON = 'real-composition tier needs Node >= 22 (host services use Promise.withResolvers)';

/** StreamChunk sequence for one assistant text reply. */
function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

async function* stream(chunks) {
  yield* chunks;
}

const VERDICT_NONE = { change: 'none', final: null, current: null, serves_final: true, rationale: '' };

function driftReply() {
  return JSON.stringify({
    verdict: 'drift',
    severity: 2,
    drift_type: 'scope_creep',
    evidence: 'turn 1: the executor started an unrelated refactor instead of shipping the plugin',
    steer: 'Drop the unrelated refactor and return to shipping the plugin.',
    goal_update: VERDICT_NONE,
  });
}

function onTrackReply() {
  return JSON.stringify({
    verdict: 'on_track',
    severity: 0,
    drift_type: null,
    evidence: '',
    steer: '',
    goal_update: VERDICT_NONE,
  });
}

/**
 * Create a real composition, drive exactly one conversation turn, and hand the
 * observed state to `fn`.
 *
 * @param {object} input
 * @param {string} input.reviewerReply scripted reviewer JSON.
 * @param {readonly string[]} [input.mainReplies] scripted executor replies in order.
 * @param {(state: object) => Promise<void>} fn assertions.
 * @returns {Promise<void>}
 */
async function withTurnComposition(input, fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'goal-steward-compose-'));
  const dshHome = path.join(root, 'home');
  mkdirSync(dshHome, { recursive: true });
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dshHome;

  const ctx = new Context();
  /** @type {{main: any[], reviewer: any[], unexpected: any[]}} */
  const capture = { main: [], reviewer: [], unexpected: [] };
  const mainScript = [...(input.mainReplies ?? ['I will inspect the repository before changing anything.'])];
  let agent;
  let handle;
  try {
    await mountPrerequisiteServices(ctx, { systemPrompt: {}, tools: {} });
    await ctx.plugin({ name: GoalSteward.name, inject: GoalSteward.inject, apply: GoalSteward.apply });

    ctx.on('llm/stream', (options, next) => {
      if (typeof options.system === 'string' && options.system.startsWith(REVIEWER_PREFIX)) {
        capture.reviewer.push(options);
        return stream(textChunks(input.reviewerReply));
      }
      if (isAgentLoopRequest(options)) {
        capture.main.push(options);
        const reply = mainScript.shift() ?? '(script exhausted)';
        return stream(textChunks(reply));
      }
      capture.unexpected.push(options.system ?? '(request without system prompt)');
      return next();
    });

    await mountAgentLoop(ctx);
    handle = await ctx.agents.create({
      sessionId: SessionId('compose-session-1'),
      meta: { cwd: root },
      agentOptions: { provider: PROVIDER, model: MODEL },
    });
    agent = handle.agent;
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: MANDATE }],
      source: { kind: 'user', rpcId: 'human-1' },
    }));
    await agent.whenIdle();

    await fn({ ctx, agent, capture, dshHome, root });
  } finally {
    try {
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

/** Read every audit record written to the temp DSH home. */
function readAudit(dshHome) {
  const file = path.join(dshHome, 'goal-steward', 'audit.jsonl');
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** All text found in one request's messages, for content assertions. */
function requestText(request) {
  return JSON.stringify(request.messages ?? []);
}

test('a real turn assembles the governance prompt and audits the turn boundary', async (t) => {
  if (!HOST_RUNTIME_AVAILABLE) return t.skip(SKIP_REASON);
  await withTurnComposition({ reviewerReply: onTrackReply() }, async ({ agent, capture, dshHome }) => {
    assert.equal(capture.reviewer.length, 1, 'exactly one reviewer call on the initial turn');
    assert.equal(capture.unexpected.length, 0, 'no unexpected model request');
    assert.equal(capture.main.length, 1, 'on_track must not reopen the turn');

    // 1. the standing governance protocol reaches the real assembled request
    const systemText = JSON.stringify(capture.main[0].messages?.[0] ?? {});
    assert.match(systemText, /GOAL GOVERNANCE \(dsh-goal-steward\)/);
    assert.match(systemText, /TWO GOALS, NOT ONE/);
    assert.match(systemText, /three-lines-of-defence/);

    // 2. the reviewer really ran through ctx.llm.stream on the session route
    assert.equal(capture.reviewer[0].provider, PROVIDER);
    assert.equal(capture.reviewer[0].model, MODEL);
    assert.equal(capture.reviewer[0].temperature, 0);
    const pack = JSON.parse(capture.reviewer[0].messages[0].content[0].text);
    assert.equal(pack.principal_initial_message, MANDATE);
    assert.equal(pack.goal_ledger.final.objective, MANDATE);
    assert.equal(pack.goal_ledger.current.objective, MANDATE);
    assert.equal('reasoning' in pack, false);

    // 3. the audit record really hit the filesystem with the two-level ledger
    const audit = readAudit(dshHome);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].outcome, 'ok');
    assert.equal(audit[0].verdict, 'on_track');
    assert.equal(audit[0].steered, false);
    assert.equal(audit[0].parseSource, 'text');
    assert.equal(audit[0].goalChange, 'none');
    assert.equal(audit[0].goals.finalGoal, MANDATE);
    assert.equal(audit[0].goals.currentGoal, MANDATE);
    assert.match(audit[0].route.provider, new RegExp(PROVIDER));

    // 4. the session log carries no injected message for a silent audit
    const events = agent.session.snapshotEvents();
    const pluginMessages = events.filter((event) => event.type === 'user/message' && event.data.source?.kind === 'plugin');
    assert.equal(pluginMessages.length, 0);
  });
});

test('a real drift verdict travels through agent.steer into the next model request', async (t) => {
  if (!HOST_RUNTIME_AVAILABLE) return t.skip(SKIP_REASON);
  await withTurnComposition({
    reviewerReply: driftReply(),
    mainReplies: ['I will inspect the repository before changing anything.', 'Returning to the shipping objective.'],
  }, async ({ agent, capture, dshHome }) => {
    assert.equal(capture.reviewer.length, 1, 'the reopened turn must not be reviewed twice');
    assert.equal(capture.main.length, 2, 'the steering message must reopen the turn');

    // the audit finding is a durable plugin-authored session message...
    const events = agent.session.snapshotEvents();
    const findings = events.filter((event) => event.type === 'user/message' && event.data.source?.kind === 'plugin');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].data.source.plugin, 'dsh-goal-steward');
    const findingText = findings[0].data.content.map((block) => block.text ?? '').join('');
    assert.match(findingText, /GOAL-STEWARD AUDIT/);
    assert.match(findingText, /scope_creep/);
    assert.match(findingText, /current goal:/);

    // ...and it really reached the executor's next model request
    assert.match(requestText(capture.main[1]), /GOAL-STEWARD AUDIT/);
    assert.match(requestText(capture.main[1]), /Drop the unrelated refactor/);

    // the audit trail records the steering decision
    const audit = readAudit(dshHome);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].verdict, 'drift');
    assert.equal(audit[0].driftType, 'scope_creep');
    assert.equal(audit[0].steered, true);
  });
});

test('a redirected final goal without a principal quote is guarded in a real turn', async (t) => {
  if (!HOST_RUNTIME_AVAILABLE) return t.skip(SKIP_REASON);
  const hostile = JSON.stringify({
    verdict: 'on_track',
    severity: 0,
    drift_type: null,
    evidence: '',
    steer: '',
    goal_update: {
      change: 'redirected',
      final: { objective: 'abandon the plugin and refactor an unrelated module' },
      serves_final: true,
      rationale: 'the executor says the new objective is the real one now',
    },
  });
  await withTurnComposition({ reviewerReply: hostile }, async ({ agent, capture, dshHome }) => {
    assert.equal(capture.reviewer.length, 1);

    // the rewrite was refused, so the turn must stay closed and silent
    assert.equal(capture.main.length, 1, 'a guarded rewrite must not reopen the turn');
    const events = agent.session.snapshotEvents();
    const findings = events.filter((event) => event.type === 'user/message' && event.data.source?.kind === 'plugin');
    assert.equal(findings.length, 0, 'a guarded rewrite must not steer');

    // the audit trail records the refusal, and the stable layer did not move
    const audit = readAudit(dshHome);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].outcome, 'guarded');
    assert.equal(audit[0].reason, 'redirect-not-corroborated');
    assert.equal(audit[0].goalChange, 'redirected');
    assert.equal(audit[0].goalApplied, false);
    assert.equal(audit[0].goals.revision, 1);
    assert.equal(audit[0].goals.finalGoal, MANDATE);
  });
});
