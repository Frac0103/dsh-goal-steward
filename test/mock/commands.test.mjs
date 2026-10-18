/**
 * Mock-host integration for the `/steward` command surface.
 *
 * This drives the real `apply()` with a fake command registry: it proves that
 * the optional `commands` injection is wired, that the handler registered under
 * `/steward` can rewrite the ledger, and — the important part — that the next
 * real review anchors on the principal's stated goal rather than on the opening
 * message. The reviewer never sees the command; it only sees the ledger.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply } from '../../lib/index.js';

// --------------------------------------------------------------------------- fixtures

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

async function* fakeStream(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

const ON_TRACK_REPLY = JSON.stringify({
  verdict: 'on_track',
  severity: 0,
  drift_type: null,
  evidence: '',
  steer: '',
  goal_update: { change: 'none', final: null, current: null, serves_final: true, rationale: '' },
});

/**
 * Fake cordis context with services, effects (generator or function bodies) and
 * a command registry.
 */
function makeHost({ withCommands = true } = {}) {
  const handlers = new Map();
  const sections = new Map();
  const effects = [];
  const commands = [];
  const llmCalls = [];
  const warnings = [];

  const services = {};
  if (withCommands) {
    services.commands = {
      register(definition) {
        commands.push(definition);
        return () => {
          const index = commands.indexOf(definition);
          if (index >= 0) commands.splice(index, 1);
        };
      },
    };
  }

  const ctx = {
    logger: { info() {}, warn: (message) => warnings.push(String(message)), error() {}, debug() {} },
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
        const effect = execute();
        if (typeof effect === 'function') {
          collected.push(effect);
        } else if (effect !== null && effect !== undefined) {
          let step = effect.next();
          while (step.done !== true) {
            if (typeof step.value !== 'function') throw new TypeError('invalid effect');
            collected.push(step.value);
            step = effect.next();
          }
        }
      } catch (error) {
        dispose();
        throw error;
      }
      effects.push(dispose);
      return dispose;
    },
    inject(deps, callback) {
      if (deps.every((name) => services[name] !== undefined)) callback(ctx);
      return { then: (resolve) => resolve() };
    },
    systemPrompt: {
      section(spec) {
        if (sections.has(spec.name)) throw new Error(`prompt section "${spec.name}" is already registered`);
        sections.set(spec.name, spec);
        return () => sections.delete(spec.name);
      },
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    get(name) {
      return services[name];
    },
    llm: {
      stream(options) {
        llmCalls.push(options);
        return fakeStream(ON_TRACK_REPLY);
      },
    },
  };

  // Services are exposed both as `ctx.commands` and through `ctx.get('commands')`,
  // exactly as the cordis inject contract provides them.
  for (const [name, service] of Object.entries(services)) {
    Object.defineProperty(ctx, name, { value: service, enumerable: false });
  }

  return {
    ctx,
    commands,
    llmCalls,
    warnings,
    get commandsService() { return services.commands; },
    countHandlers(event) { return handlers.get(event)?.size ?? 0; },
    async runTurnStopping(agent, turn = 1) {
      const listeners = [...(handlers.get('agent/turn-stopping') ?? [])];
      assert.equal(listeners.length, 1, 'exactly one turn-stopping listener must be live');
      await listeners[0]({ agent, turn, signal: new AbortController().signal });
    },
    dispose() {
      for (const dispose of effects.splice(0).reverse()) dispose();
    },
  };
}


function makeAgent() {
  const events = makeEvents();
  const steered = [];
  return {
    agent: {
      id: 'session-command-1',
      session: {
        header: { cwd: 'D:/project', origin: 'user' },
        snapshotEvents: () => events,
        surface: { nodes: events.map((event) => event.seq) },
        requestHeader: () => ({ config: { provider: 'fake-provider', model: 'fake-model' } }),
      },
      steer(message) {
        steered.push(message);
      },
    },
    steered,
  };
}

async function stopTurn(host, agent, turn = 1) {
  return host.runTurnStopping(agent, turn);
}

/** Read every audit record in a directory. */
function readAudit(dir) {
  const file = path.join(dir, 'audit.jsonl');
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// --------------------------------------------------------------------------- tests

test('the command surface is installed when the registry exists', () => {
  const host = makeHost();
  apply(host.ctx, { audit: false });
  assert.equal(host.commands.length, 1);
  const definition = host.commands[0];
  assert.equal(definition.name, 'steward');
  assert.equal(typeof definition.handler, 'function');
  assert.equal(typeof definition.description, 'string');
  host.dispose();
});

test('without a command registry the reviewer still installs', () => {
  const host = makeHost({ withCommands: false });
  apply(host.ctx, { audit: false });
  assert.equal(host.commands.length, 0);
  assert.equal(host.countHandlers('agent/turn-stopping'), 1);
  host.dispose();
});

test('a principal-set goal becomes the ledger the next review audits', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-command-'));
  try {
    const host = makeHost();
    const { agent } = makeAgent();
    apply(host.ctx, { audit: true, auditDir: dir });

    const command = host.commands[0];
    const agentId = agent.id;
    const result = await command.handler({ agent, rawInput: 'goal ship the reviewer end to end', attachments: [], signal: new AbortController().signal });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /最终目标已更新/);
    assert.match(result.text, /ship the reviewer end to end/);

    // The command touched the ledger without creating a reviewer call.
    assert.equal(host.llmCalls.length, 0);

    // The next turn's review must anchor on the principal's goal, not on the
    // opening message the executor happened to start from.
    await host.runTurnStopping(agent, 1);
    assert.equal(host.llmCalls.length, 1);
    const pack = JSON.parse(host.llmCalls[0].messages[0].content[0].text);
    assert.equal(pack.goal_ledger.final.objective, 'ship the reviewer end to end');
    assert.equal(pack.goal_ledger.current.objective, 'ship the reviewer end to end');
    assert.equal(pack.goal_ledger.revision, 1);
    assert.equal(pack.principal_initial_message, 'build a goal governance plugin and publish it to GitHub');

    const audit = readAudit(dir);
    assert.equal(audit.length, 2, 'one command record, then one review record');
    assert.equal(audit[0].event, 'command');
    assert.equal(audit[0].trigger, 'principal-command');
    assert.equal(audit[1].event, 'review');
    assert.equal(audit[1].sessionId, agentId);
    assert.equal(audit[1].goals.final.objective, 'ship the reviewer end to end');
    host.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the command audit record schema is locked', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-command-'));
  try {
    const host = makeHost();
    const { agent } = makeAgent();
    apply(host.ctx, { audit: true, auditDir: dir });
    await host.commands[0].handler({ agent, rawInput: 'goal ship it', attachments: [], signal: new AbortController().signal });
    const record = readAudit(dir)[0];
    assert.deepEqual(Object.keys(record).sort(), [
      'action', 'event', 'goalApplied', 'goalChange', 'goalRationale', 'goals',
      'outcome', 'sessionId', 'trigger', 'ts', 'turn', 'v',
    ]);
    assert.deepEqual(Object.keys(record.goals).sort(), ['current', 'final', 'lastChange', 'revision']);
    assert.equal(record.turn, null);
    host.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('status reports the ledger and the audit location', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'goal-steward-command-'));
  try {
    const host = makeHost();
    const { agent } = makeAgent();
    apply(host.ctx, { audit: true, auditDir: dir });
    const status = await host.commands[0].handler({ agent, rawInput: 'status', attachments: [], signal: new AbortController().signal });
    assert.equal(status.kind, 'success');
    assert.match(status.text, /尚未建立/);
    assert.match(status.text, /audit\.jsonl/);
    host.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
