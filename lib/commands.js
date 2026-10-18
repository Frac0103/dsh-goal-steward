/**
 * The human command surface: `/steward`.
 *
 * The reviewer is a model-mediated reviewer; the principal is the owner of the
 * stable layer. The design document gives the principal sole authority over the
 * final goal (RACI: the principal keeps the `A`), and until now that authority
 * only existed as a *veto*: the reviewer could propose a redirect only with a
 * verbatim quote, but the principal had no direct way to record a new one. A
 * veto without an alternative is not sovereignty.
 *
 * This module adds the missing channel. `/steward goal <objective>` is executed
 * by the command registry directly against the session — no model message is
 * created, no executor reasoning is involved, and the reviewer never sees the
 * request. That is the mechanical difference between "the principal changed the
 * goal" and "the executor convinced the reviewer to change the goal".
 *
 * Commands never throw: the registry would settle a throw as an error, but a
 * governance layer should hand the user a readable failure instead of an
 * exception in the transcript.
 *
 * @module dsh-goal-steward/commands
 */

import { normalizeGoal } from './goals.js';

/** Registry name (lowercase, no slash). */
export const COMMAND_NAME = 'steward';

/** Discovery description shown by the UI command palette. */
export const COMMAND_DESCRIPTION = '目标治理（dsh-goal-steward）：查看账本/历史发现，或由你直接设定最终目标';

/** Composer input hint (the command owns its grammar). */
export const COMMAND_INPUT_HINT = 'status | goal <新的最终目标> | why';

/** Ledger history entries retained by a principal-set goal. */
const HISTORY_MAX = 10;

/**
 * Parse one `/steward ...` argument string.
 *
 * @param {unknown} rawInput everything after the command name.
 * @returns {{action: 'status'|'goal'|'why'|'help'|'unknown', argument: string}}
 */
export function parseCommandInput(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (text.length === 0) return { action: 'status', argument: '' };
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  const action = (match?.[1] ?? '').toLowerCase();
  const argument = (match?.[2] ?? '').trim();
  if (action === 'status' || action === 'goal' || action === 'why' || action === 'help') {
    return { action, argument };
  }
  return { action: 'unknown', argument: text };
}

/**
 * Record a principal-set final goal in the two-level ledger.
 *
 * The command channel is the principal speaking, so the classification is the
 * same `redirected` used for a corroborated reviewer redirect — authority, not
 * intent, decides the classification. The current goal resets to the new final
 * goal: the principal just redefined the destination, so keeping a phase goal
 * that served the old destination would leave the ledger self-contradictory.
 *
 * @param {object|null} ledger current ledger.
 * @param {unknown} objective new final objective (untrusted command text).
 * @returns {{revision: number, final: object, current: object, lastChange: string, history: object[]}|null}
 *   the new ledger, or null when the objective is unusable.
 */
export function applyPrincipalGoal(ledger, objective) {
  const goal = normalizeGoal({ objective });
  if (goal === null) return null;
  const rationale = 'set by the principal via /steward goal';
  const previous = ledger !== null && typeof ledger === 'object' ? ledger : null;
  const revision = (Number.isInteger(previous?.revision) ? previous.revision : 0) + 1;
  const entry = { revision, change: 'redirected', turn: null, rationale, final: goal, current: goal };
  const history = [...(Array.isArray(previous?.history) ? previous.history : []), entry].slice(-HISTORY_MAX);
  return { revision, final: goal, current: goal, lastChange: 'redirected', history };
}

/**
 * Render the `/steward status` view.
 *
 * @param {object} input
 * @param {object|null} input.ledger current ledger.
 * @param {number} input.reviews reviews spent by this instance.
 * @param {number} input.steers steering messages sent by this instance.
 * @param {readonly object[]} input.findings recent findings.
 * @param {boolean} input.auditDisabled whether the audit trail is off.
 * @param {string} input.auditPath audit file path (when enabled).
 * @returns {string} human-readable status text.
 */
export function renderStatus(input) {
  const ledger = input.ledger ?? null;
  const lines = ['dsh-goal-steward — 目标治理'];
  if (ledger === null || ledger.final === null || ledger.final === undefined) {
    lines.push('目标账本：尚未建立（首轮评审会从会话开场指令锚定；也可以现在用 /steward goal <目标> 设定）。');
  } else {
    lines.push(`最终目标：${ledger.final.objective}`);
    const current = ledger.current?.objective;
    if (typeof current === 'string' && current.length > 0 && current !== ledger.final.objective) {
      lines.push(`当前目标：${current}`);
    }
    const criteria = ledger.final.success_criteria ?? [];
    if (criteria.length > 0) lines.push(`成功判据：${criteria.join('；')}`);
    const constraints = ledger.final.constraints ?? [];
    if (constraints.length > 0) lines.push(`硬约束：${constraints.join('；')}`);
    lines.push(`账本版本：revision ${ledger.revision}（最近变更：${ledger.lastChange}）`);
  }

  lines.push(`本实例评审：${input.reviews} 次；发声：${input.steers} 次`);
  const last = input.findings.at(-1);
  if (last !== undefined) {
    const drift = last.drift_type === null || last.drift_type === undefined ? '' : ` · ${last.drift_type}`;
    lines.push(`最近发现：turn ${last.turn} · severity ${last.severity}${drift} — ${last.evidence === '' ? '（无附证）' : last.evidence}`);
  }
  lines.push(input.auditDisabled
    ? '审计流水：已关闭（关闭审计后账本无法跨重启继承）'
    : `审计流水：${input.auditPath}`);
  lines.push(`用法：/steward ${COMMAND_INPUT_HINT}`);
  return lines.join('\n');
}

/**
 * Render the `/steward why` view: the reviewer's recent findings, newest last.
 *
 * @param {{findings: readonly object[]}} input recent findings.
 * @returns {string} human-readable findings text.
 */
export function renderFindings(input) {
  const findings = input.findings ?? [];
  if (findings.length === 0) {
    return '暂无历史发现：本实例还没有产生过出声的评审结论（默认沉默是设计行为，不是没有在工作）。';
  }
  const lines = ['dsh-goal-steward — 最近发现（旧→新）'];
  for (const finding of findings) {
    const drift = finding.drift_type === null || finding.drift_type === undefined ? '' : ` · ${finding.drift_type}`;
    lines.push(`turn ${finding.turn} · severity ${finding.severity}${drift}`);
    if (typeof finding.evidence === 'string' && finding.evidence.length > 0) lines.push(`  ${finding.evidence}`);
  }
  lines.push('完整裁决（含 steer 原文与目标快照）见审计流水。');
  return lines.join('\n');
}

/**
 * Build the command definition registered with `ctx.commands`.
 *
 * All host interaction is injected so the handler can be tested without a host
 * and so the caller owns the audit/config lifecycle.
 *
 * @param {object} deps
 * @param {import('./config.js').GoalStewardConfig} deps.config resolved config.
 * @param {(sessionId: string) => object} deps.getState read-or-create session state.
 * @param {(sessionId: string) => Promise<{ledger: object|null, previousFindings: object[]}|null>} deps.inherit audit replay for a session.
 * @param {(record: object) => Promise<void>} deps.writeAudit audit writer (never throws in production).
 * @param {() => boolean} deps.isDisposed whether the owning plugin instance was unloaded.
 * @param {string} deps.auditPath audit file path shown by `status`.
 * @returns {{name: string, description: string, input: {hint: string}, recordInput: boolean, handler: Function}}
 */
export function createStewardCommand(deps) {
  /** @param {object} state session state */
  const statusOf = (state) => renderStatus({
    ledger: state.ledger ?? null,
    reviews: state.reviews,
    steers: state.steers,
    findings: state.previousFindings ?? [],
    auditDisabled: deps.config.audit !== true,
    auditPath: deps.auditPath,
  });

  /** Resolve a session state, replaying the audit trail for the ledger when needed. */
  const resolveState = async (sessionId) => {
    const state = deps.getState(sessionId);
    if (state.ledger === null || state.ledger === undefined) {
      let inherited = null;
      try {
        inherited = await deps.inherit(sessionId);
      } catch {
        // Replay is optional: a status view with "not established yet" is more
        // useful to the principal than an error caused by an unreadable trail.
        inherited = null;
      }
      if (inherited !== null && inherited.ledger !== null) state.ledger = inherited.ledger;
      if ((state.previousFindings ?? []).length === 0 && Array.isArray(inherited?.previousFindings)) {
        state.previousFindings = inherited.previousFindings;
      }
    }
    return state;
  };

  /** Apply `/steward goal <objective>`: write the ledger and the audit record. */
  const setGoal = async (sessionId, state, argument) => {
    const ledger = applyPrincipalGoal(state.ledger ?? null, argument);
    if (ledger === null) {
      return { kind: 'error', text: `goal-steward：用法是 /steward goal <新的最终目标>（目标不能为空）。` };
    }
    state.ledger = ledger;
    let audited = true;
    try {
      await deps.writeAudit({
        event: 'command',
        action: 'set-goal',
        outcome: 'ok',
        trigger: 'principal-command',
        sessionId,
        turn: null,
        goalChange: ledger.lastChange,
        goalApplied: true,
        goalRationale: 'set by the principal via /steward goal',
        goals: {
          revision: ledger.revision,
          lastChange: ledger.lastChange,
          final: ledger.final,
          current: ledger.current,
        },
      });
    } catch {
      audited = false;
    }
    return {
      kind: 'success',
      text: [
        `最终目标已更新（revision ${ledger.revision}）：${ledger.final.objective}`,
        '当前目标已同步重置为该目标。',
        audited
          ? '该变更已作为 principal-command 写入审计流水，下一次评审将以此为准。'
          : '注意：审计写入失败，该变更只在本实例内存中生效，重启后会回退。',
      ].join('\n'),
    };
  };

  return {
    name: COMMAND_NAME,
    description: COMMAND_DESCRIPTION,
    input: { hint: COMMAND_INPUT_HINT },
    // The audit record is the authoritative copy of a stated goal; do not repeat
    // the raw command line in the session log as well.
    recordInput: false,
    /**
     * Execute one `/steward` invocation.
     *
     * @param {{agent: {id: string}, rawInput?: string}} invocation command invocation.
     * @returns {Promise<{kind: 'success'|'error', text: string}>} UI-rendered result.
     */
    handler: async (invocation) => {
      try {
        if (deps.isDisposed()) {
          return { kind: 'error', text: 'goal-steward：治理实例已卸载，命令不可用（重新加载插件后可用）。' };
        }
        const sessionId = invocation?.agent?.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          return { kind: 'error', text: 'goal-steward：无法识别当前会话。' };
        }
        const state = await resolveState(sessionId);
        const { action, argument } = parseCommandInput(invocation?.rawInput);
        switch (action) {
          case 'status':
            return { kind: 'success', text: statusOf(state) };
          case 'help':
            return { kind: 'success', text: statusOf(state) };
          case 'why':
            return { kind: 'success', text: renderFindings({ findings: state.previousFindings ?? [] }) };
          case 'goal':
            return await setGoal(sessionId, state, argument);
          default:
            return {
              kind: 'error',
              text: `goal-steward：未知子命令。用法：/steward ${COMMAND_INPUT_HINT}`,
            };
        }
      } catch (error) {
        return {
          kind: 'error',
          text: `goal-steward：命令执行失败（${error instanceof Error ? error.message : String(error)}）。治理层不会因此影响对话。`,
        };
      }
    },
  };
}
