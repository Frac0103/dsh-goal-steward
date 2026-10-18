/**
 * Real-composition test for the `/steward` command surface.
 *
 * This tier mounts the production `CommandsRuntime`, the production AgentLoop and
 * a real session, and drives the command exactly the way an interactive adapter
 * does: `ctx.commands.execute(agent, '/steward ...', [], signal)`. It proves the
 * end-to-end claim behind the user-sovereignty channel:
 *
 *   1. the command is discovered by the real registry and settles a result the
 *      UI could render;
 *   2. a goal stated through the command becomes the ledger the *next real
 *      review* audits against;
 *   3. the command text never enters a model request — it is a human command,
 *      not a prompt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import * as GoalSteward from '../../lib/index.js';
import {
  Context,
  disposeContext,
  mountAgentLoop,
  mountCommands,
  mountPrerequisiteServices,
} from '../../test-support/compose-mount.mjs';

const MANDATE = 'Ship goal-steward as an open-source reviewer that prevents goal drift, then use it on my own tasks.';
const PRINCIPAL_GOAL = 'Ship the /steward command so I can set the goal myself, then verify it end to end.';
const PROVIDER = 'compose-command';
const MODEL = 'compose-command-model';
const REVIEWER_PREFIX = 'You are the Independent Goal Steward';

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

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

async function* stream(text) {
  yield* textChunks(text);
}

function readAudit(dir) {
  const file = path.join(dir, 'audit.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('a /steward goal becomes the ledger the next real review audits', async (t) => {
  if (!HOST_RUNTIME_AVAILABLE) return t.skip(SKIP_REASON);

  const root = mkdtempSync(path.join(tmpdir(), 'goal-steward-compose-command-'));
  const dshHome = path.join(root, 'home');
  const auditDir = path.join(root, 'audit');
  mkdirSync(dshHome, { recursive: true });
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dshHome;

  const ctx = new Context();
  const capture = { main: [], reviewer: [], unexpected: [] };
  let handle;
  try {
    await mountPrerequisiteServices(ctx, { systemPrompt: {}, tools: {} });
    // The plugin is mounted before the command registry: the command surface is
    // optional and late-bound, exactly as in a profile where a UI bundle appears
    // after the governance bundle.
    const pluginFiber = ctx.plugin(
      { name: GoalSteward.name, inject: GoalSteward.inject, apply: GoalSteward.apply },
      { audit: true, auditDir, reviewEveryTurns: 1, maxTurnGap: 100, logEvents: false },
    );
    await pluginFiber;
    await mountCommands(ctx);

    ctx.on('llm/stream', (options, next) => {
      if (typeof options.system === 'string' && options.system.startsWith(REVIEWER_PREFIX)) {
        capture.reviewer.push(options);
        return stream(ON_TRACK_REPLY);
      }
      if (isAgentLoopRequest(options)) {
        capture.main.push(options);
        return stream('I will inspect the repository before changing anything.');
      }
      capture.unexpected.push(options.system ?? '(request without system prompt)');
      return next();
    });

    await mountAgentLoop(ctx);
    handle = await ctx.agents.create({
      sessionId: SessionId('compose-command-session-1'),
      meta: { cwd: root },
      agentOptions: { provider: PROVIDER, model: MODEL },
    });
    const agent = handle.agent;
    const runTurn = async (text) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user', rpcId: `human-${text.length}` } }));
      await agent.whenIdle();
    };

    // Turn 1 establishes the ledger by anchor (revision 1).
    await runTurn(MANDATE);
    assert.equal(capture.reviewer.length, 1);
    assert.equal(capture.main.length, 1);

    // The command is discoverable by the real registry.
    const listed = await ctx.commands.execute(agent, '/steward status', [], new AbortController().signal);
    assert.ok(listed !== undefined, 'the registry resolves /steward');
    assert.equal(listed.result.kind, 'success');
    assert.match(listed.result.text, /最终目标：Ship goal-steward/);
    assert.match(listed.result.text, /审计流水：/);

    const setGoal = await ctx.commands.execute(agent, `/steward goal ${PRINCIPAL_GOAL}`, [], new AbortController().signal);
    assert.ok(setGoal !== undefined);
    assert.equal(setGoal.result.kind, 'success');
    assert.match(setGoal.result.text, /最终目标已更新（revision 2）/);
    assert.match(setGoal.result.text, /PRINCIPAL_GOAL|Ship the \/steward command/);

    // Turn 2: the reviewer must judge against the principal's stated goal, and
    // the command text must not leak into the executor's model request.
    await runTurn('Continue.');
    assert.equal(capture.reviewer.length, 2, 'turn 2 is reviewed (reviewEveryTurns: 1)');
    const pack = JSON.parse(capture.reviewer[1].messages[0].content[0].text);
    assert.equal(pack.goal_ledger.final.objective, PRINCIPAL_GOAL);
    assert.equal(pack.goal_ledger.current.objective, PRINCIPAL_GOAL);
    assert.equal(pack.goal_ledger.revision, 2);
    assert.equal(pack.principal_initial_message, MANDATE, 'the opening mandate is still carried as evidence');

    const secondRequest = JSON.stringify(capture.main[1].messages ?? []);
    assert.doesNotMatch(secondRequest, /\/steward goal/, 'the command line never becomes a model message');
    assert.doesNotMatch(secondRequest, /Ship the \/steward command so I can set the goal myself/, 'the command result is not a model message either');

    // The durable trail records the command between the two reviews.
    const audit = readAudit(auditDir);
    assert.deepEqual(audit.map((record) => record.event), ['review', 'command', 'review']);
    assert.equal(audit[1].trigger, 'principal-command');
    assert.equal(audit[1].goals.final.objective, PRINCIPAL_GOAL);
    assert.equal(audit[2].goals.final.objective, PRINCIPAL_GOAL);
    assert.equal(audit[2].goals.revision, 2);

    // Unloading the plugin must retire the command with it: a dismissed reviewer
    // does not keep a human control surface either.
    await pluginFiber.dispose();
    const afterUnload = await ctx.commands.execute(agent, '/steward status', [], new AbortController().signal);
    assert.equal(afterUnload, undefined, 'a retired instance must not keep its command registered');
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
});
