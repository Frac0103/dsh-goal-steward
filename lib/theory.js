/**
 * Theory registry — the single source of truth for the management-science
 * foundation of dsh-goal-steward.
 *
 * Every runtime mechanism in this package must trace back to an entry here.
 * The runtime never imports this module (prompts and decisions must not change
 * because a citation changed), but two things depend on it:
 *
 * 1. `scripts/theory-doc.mjs` generates `docs/theory.md` from this registry, so
 *    the published theory document cannot drift away from the code.
 * 2. `test/theory.test.mjs` enforces referential integrity: every drift code,
 *    every mechanism, and every theory entry must resolve. A rule with no
 *    theoretical basis, or a citation with no rule, fails CI.
 *
 * Fields
 * - `id`          stable key used by mechanisms and drift codes.
 * - `name`        English and Chinese names.
 * - `source`      primary literature; the edition actually used for the claim.
 * - `proposition` the one-sentence claim taken from the model.
 * - `translation` how that claim becomes a rule in this plugin.
 * - `guards`      failure modes the rule exists to prevent.
 * - `limits`      where the analogy to an AI agent breaks; documented, not hidden.
 *
 * @module dsh-goal-steward/theory
 */

/** Every theoretical model this package is built on. */
export const THEORY = Object.freeze([
  {
    id: 'xy-theory',
    name: { en: 'Theory X / Theory Y', zh: 'X 理论 / Y 理论' },
    source: 'Douglas McGregor, The Human Side of Enterprise (1960)',
    proposition:
      'Supervision style is a self-fulfilling assumption: treat people as lazy and they comply passively; treat them as self-directed and they take ownership.',
    translation:
      'Asymmetric stance: the executor (Lead agent) is governed by Theory Y — it owns method, is told intent rather than steps, and may rebut audit findings. The reviewer is governed by Theory X — it is assumed to drift into rubber-stamping or nagging, so it is mechanically bounded (silence by default, budgets, evidence requirements).',
    guards: ['micromanagement', 'executor learned helplessness', 'reviewer capture'],
    limits:
      'An AI has no intrinsic motivation to protect; Theory Y here is a stance about information efficiency (the executor has fresher local context), not about dignity.',
  },
  {
    id: 'bounded-rationality',
    name: { en: 'Bounded rationality / satisficing', zh: '有限理性 / 满意即止' },
    source: 'Herbert A. Simon, Administrative Behavior (1947)',
    proposition:
      'Actors do not optimize globally; they satisfice inside attention, memory, and information limits.',
    translation:
      'The executor is assumed to be locally optimal and globally myopic: attention decays over turns, and compaction acts like organizational forgetting. The reviewer exists to supply the missing global view, not to question competence.',
    guards: ['local optimization', 'attention decay', 'compaction-induced memory loss'],
    limits:
      'An AI has no attention in the human sense; the analogue is context occupancy and truncation, which is more mechanical and more measurable than human attention.',
  },
  {
    id: 'goal-displacement',
    name: { en: 'Goal displacement', zh: '目标置换' },
    source: 'Robert K. Merton, Social Theory and Social Structure (1949)',
    proposition:
      'When rules or means become the measure of success, they displace the original goal; the organization keeps working, on the wrong thing.',
    translation:
      'Drift code `goal_substitution`, plus the stable-layer audit: the reviewer compares current work against the charter, never against effort, polish, or output volume.',
    guards: ['goal_substitution', 'process worship', 'effort theater'],
    limits:
      'Merton described a structural response to bureaucratic rules; the AI analogue is prompt-induced or reward-induced, and reversible with prompt changes, which makes it cheaper to fix but easier to reintroduce.',
  },
  {
    id: 'mbo',
    name: { en: 'Management by Objectives', zh: '目标管理（MBO）' },
    source: 'Peter F. Drucker, The Practice of Management (1954)',
    proposition:
      'Work is governed by agreed, explicit objectives and reviewed against them; without a written objective, control degenerates into supervision of activity.',
    translation:
      'The goal charter is written down, split into objective, success criteria, hard constraints, and non-goals. The reviewer audits the charter rather than activity.',
    guards: ['activity without purpose', 'supervision of busyness'],
    limits:
      'MBO assumes negotiated objectives between manager and employee over weeks; here the objective is often one sentence given once, so the charter must be derived and then confirmed, not assumed final.',
  },
  {
    id: 'okr-smart',
    name: { en: 'OKR + SMART criteria', zh: 'OKR + SMART 原则' },
    source: 'Andrew Grove, High Output Management (1983); Doran, "There is an S.M.A.R.T. way" (1981)',
    proposition:
      'An objective only controls behavior when it is paired with verifiable key results and is Specific, Measurable, Achievable, Relevant, Time-bound.',
    translation:
      'The charter carries `success_criteria`; the reviewer may return a charter update when the stable layer is unclear or changed. A drift finding requires citing which stable-layer item is violated.',
    guards: ['unfalsifiable goals', 'premature_convergence'],
    limits:
      'Not every conversation has measurable key results (e.g. exploratory discussion). The plugin therefore never blocks on a missing KR; it records the gap instead.',
  },
  {
    id: 'pdca',
    name: { en: 'PDCA / Deming cycle', zh: 'PDCA 循环（戴明环）' },
    source: 'W. Edwards Deming, Out of the Crisis (1986)',
    proposition:
      'Control is a loop: plan, do, check, act — with checks scheduled, not improvised.',
    translation:
      'Audits happen at boundaries: the first turn establishes the charter (Plan), execution runs without interruption (Do), scheduled reviews check alignment (Check), steering and charter updates correct it (Act).',
    guards: ['no-feedback execution', 'ad-hoc supervision'],
    limits:
      'PDCA assumes a process that repeats; a one-shot conversation has one cycle. The design therefore treats each session as a compact, single-cycle instance.',
  },
  {
    id: 'management-by-exception',
    name: { en: 'Management by exception', zh: '例外管理原则' },
    source: 'Frederick W. Taylor, The Principles of Scientific Management (1911); modern controlling practice',
    proposition:
      'Attention is the scarce resource; managers should intervene only where actual results deviate from standard beyond a tolerance.',
    translation:
      'Reviewer silence is the default. Reviews happen only on explicit triggers (first turn, cadence, forced gap, goal change), and steering only above a configured severity floor with per-turn and per-session budgets.',
    guards: ['reviewer noise', 'alert fatigue', 'goal drift unnoticed'],
    limits:
      'Exception management needs a reliable standard to compare against; here the standard is model-derived, so the false-negative risk is real and is recorded in the audit trail rather than assumed away.',
  },
  {
    id: 'three-lines',
    name: { en: 'Three lines of defence (COSO)', zh: '三道防线（COSO 模型）' },
    source: 'COSO, Enterprise Risk Management — Integrated Framework (2004, updated 2017)',
    proposition:
      'Resilient control comes from layers: operational self-control, independent risk oversight, and governing-body assurance — with the last layer holding final authority.',
    translation:
      'Line 1: the standing governance protocol in the system prompt (executor self-check, zero extra calls). Line 2: the isolated reviewer at turn boundaries. Line 3: the principal (user), reached only by escalation.',
    guards: ['single point of control failure', 'reviewer overreach', 'executor blindness'],
    limits:
      'In an organization the three lines are separate people with separate careers; here they are roles inside one process, so the separation is procedural rather than social.',
  },
  {
    id: 'raci',
    name: { en: 'RACI responsibility matrix', zh: 'RACI 权责矩阵' },
    source: 'Project Management Institute, PMBOK Guide (responsibility assignment matrix)',
    proposition:
      'Every decision needs exactly one accountable role, and consultation must be scoped — consulting everyone is a way to paralyze delivery.',
    translation:
      'Method and route are R/A for the executor, and the reviewer is only Informed — not Consulted. The reviewer may audit alignment but is structurally forbidden from prescribing technology, tools, or plans.',
    guards: ['reviewer micromanagement', 'method paralysis'],
    limits:
      'RACI is a static chart for teams; this one is enforced by prompt constraints and verdict schema, so its force is probabilistic rather than organizational.',
  },
  {
    id: 'change-control',
    name: { en: 'Change control / CCB', zh: '变更控制 / 变更控制委员会' },
    source: 'Project Management Institute, PMBOK Guide',
    proposition:
      'Baseline changes must be requested, approved, and recorded; silent baseline drift destroys accountability.',
    translation:
      'The stable layer changes only through an explicit charter update returned by the reviewer and surfaced to the principal. The executor is forbidden from silently substituting a nearby objective. (Tooling for a formal charter file lands in 0.2.)',
    guards: ['silent objective substitution', 'scope creep'],
    limits:
      'A single-user conversation has no committee; the principal is the entire CCB, so the mechanism is a pause-and-ask protocol, not a quorum process.',
  },
  {
    id: 'escalation-ladder',
    name: { en: 'Graduated escalation / tiered authorization', zh: '分级升级 / 分级授权' },
    source: 'Incident command and corporate delegation-of-authority practice',
    proposition:
      'Authority should increase with evidence strength; low-confidence observations should inform, not block.',
    translation:
      'Five rungs: L0 record, L1 watch, L2 drift (steer, non-blocking), L3 goal conflict (stop and ask the principal), L4 hard violation (reserved). The verdict schema makes the rung machine-checkable.',
    guards: ['crying wolf', 'false vetoes', 'unreported weak signals'],
    limits:
      'Escalation in an organization carries cost and delay; here an L2 steer is cheap, which makes over-escalation more tempting — hence the budgets and the evidence requirement.',
  },
  {
    id: 'audit-independence',
    name: { en: 'Audit independence', zh: '审计独立性' },
    source: 'Institute of Internal Auditors, International Standards for the Professional Practice of Internal Auditing; AICPA independence rules',
    proposition:
      'Independence is not a personality trait; it comes from structural separation — information, program, timing, and incentive.',
    translation:
      'Information isolation: the reviewer sees only an evidence pack, never the executor reasoning. Program isolation: no tools, no write authority. Timing isolation: audit at turn boundaries only. Incentive isolation: the reviewer prompt forbids improving the work or proposing methods.',
    guards: ['self-review bias', 'sycophancy loop', 'capture'],
    limits:
      'On a single-model host the reviewer shares the executor weights; the fourth separation (model) is unavailable until another provider is configured, and this is stated rather than glossed over.',
  },
  {
    id: 'regulatory-capture',
    name: { en: 'Regulatory capture', zh: '监管俘获' },
    source: 'George J. Stigler, "The Theory of Economic Regulation" (1971)',
    proposition:
      'A regulator that depends on the regulated party gradually adopts its point of view; oversight degrades from inside.',
    translation:
      'The reviewer is structurally prevented from depending on the executor: no tools, no shared context, no ability to accept tasks, plus an explicit rule against softening findings to be agreeable.',
    guards: ['rubber stamping', 'capture'],
    limits:
      'Capture is a social process over time; an LLM reviewer cannot be captured in the same way, but it can be anchored by repeated prompts or by seeing only the executor output — hence the no-anchoring rule on previous findings.',
  },
  {
    id: 'goodhart',
    name: { en: "Goodhart's law", zh: '古德哈特定律' },
    source: 'Charles Goodhart, "Problems of Monetary Management" (1975)',
    proposition:
      'Once a measure becomes a target, it stops being a good measure.',
    translation:
      'Drift code `proxy_optimization` (tests passing, files written, tokens spent) is named explicitly. The reviewer itself may not be measured by pass rate; its health metric is the lagging indicator of principal corrections, read from the audit trail.',
    guards: ['proxy_optimization', 'reviewer metric gaming'],
    limits:
      'Any automated audit is itself a proxy for goal alignment; the design cannot escape Goodhart, only expose the proxy and keep it auditable.',
  },
  {
    id: 'escalation-of-commitment',
    name: { en: 'Escalation of commitment', zh: '承诺升级' },
    source: 'Barry M. Staw, "Knee-deep in the big muddy" (1976)',
    proposition:
      'Decision makers pour more resources into a failing course because of prior investment, not expected return.',
    translation:
      'Drift code `escalation_of_commitment`; the reviewer sees the previous findings so that a repeated failing line is recognized as a pattern, not a new attempt.',
    guards: ['sunk-cost continuation'],
    limits:
      'An AI has no career to protect; the analogue is context investment and plan attachment, which is weaker but still observable in repeated tool calls.',
  },
  {
    id: 'principal-agent',
    name: { en: 'Principal–agent problem', zh: '委托—代理问题' },
    source: 'Jensen & Meckling, "Theory of the Firm" (1976)',
    proposition:
      'An agent who knows more than the principal can report progress selectively; the cost is measured in the principal\'s verification effort.',
    translation:
      'The governance protocol requires honest reporting of what was done, verified, and not verified. The audit trail lets the principal verify the reviewer without reading the whole transcript.',
    guards: ['reporting inflation', 'unverified completion claims'],
    limits:
      'Human agents respond to incentives; an LLM responds to prompt and context. The mechanism is therefore a reporting norm plus an audit surface, not a contract.',
  },
  {
    id: 'commanders-intent',
    name: { en: "Commander's intent / Auftragstaktik", zh: '任务式指挥 / 指挥官意图' },
    source: '19th-century Prussian military doctrine; modern mission command',
    proposition:
      'Centralize the intent, decentralize execution: subordinates who understand the goal outperform those following exhaustive orders, because battlefield information is fresher than the order.',
    translation:
      'The system prompt states the stable layer as intent and hands the executor full discretion over route, milestones, and tools. Audits check the intent, never the orders.',
    guards: ['over-specification', 'detail paralysis', 'unresponsive plans'],
    limits:
      'Mission command assumes trained subordinates; here the executor may be any model, so intent must be restated (the standing protocol) rather than assumed internalized.',
  },
  {
    id: 'feedforward-feedback',
    name: { en: 'Feedforward / concurrent / feedback control', zh: '前馈 / 同期 / 反馈控制' },
    source: 'Norbert Wiener, Cybernetics (1948), applied in management control theory',
    proposition:
      'Good control anticipates (feedforward), monitors during execution (concurrent), and corrects after output (feedback); relying on one is insufficient.',
    translation:
      'Feedforward: the first-turn charter audit and plan check. Concurrent: mandatory-gap audits while work is in flight. Feedback: the pre-delivery check against success criteria.',
    guards: ['post-hoc-only correction', 'planning without verification'],
    limits:
      'Concurrent control here is sampled, not continuous; unbounded continuous auditing would violate the cost and non-interference constraints.',
  },
  {
    id: 'contract-theory',
    name: { en: 'Constraint persistence as contract terms', zh: '约束即契约条款' },
    source: 'Coase (1937); Williamson, transaction-cost economics (1975)',
    proposition:
      'Obligations that are written into the agreement survive changes of personnel and attention; unwritten ones decay.',
    translation:
      'Drift code `constraint_decay`: hard constraints and non-goals are charter items, not conversational etiquette, and are re-shown to the reviewer every audit. (Persistent charter file lands in 0.2.)',
    guards: ['constraint_decay'],
    limits:
      'A contract is enforceable in court; a charter is enforced only by prompts and audits, so enforcement is best-effort and must be visible as such.',
  },
]);

/** Runtime mechanisms a theory entry can justify. */
export const MECHANISMS = Object.freeze({
  'asymmetric-stance': {
    name: { en: 'Asymmetric trust posture', zh: '非对称信任姿态' },
    modules: ['lib/prompt.js', 'lib/config.js'],
    status: 'implemented',
  },
  'standing-protocol': {
    name: { en: 'Standing governance protocol in the system prompt', zh: '系统提示中的常驻治理协议' },
    modules: ['lib/prompt.js', 'lib/index.js'],
    status: 'implemented',
  },
  'goal-charter': {
    name: { en: 'Three-layer goal charter', zh: '三层目标宪章' },
    modules: ['lib/prompt.js', 'lib/evidence.js', 'lib/reviewer.js'],
    status: 'implemented',
  },
  'two-level-goals': {
    name: { en: 'Two-level goal model (final vs current goal)', zh: '双层目标模型（最终目标 / 当前目标）' },
    modules: ['lib/goals.js', 'lib/evidence.js'],
    status: 'implemented',
  },
  'goal-change-classification': {
    name: { en: 'Goal-change classification (evolution vs substitution)', zh: '目标变更分类（演进 / 替换）' },
    modules: ['lib/goals.js', 'lib/parse.js'],
    status: 'implemented',
  },
  'goal-ledger': {
    name: { en: 'Versioned goal ledger', zh: '带版本的目标账本' },
    modules: ['lib/goals.js', 'lib/cadence.js', 'lib/index.js'],
    status: 'implemented',
  },
  'redirect-corroboration': {
    name: { en: 'Verbatim-quote gate for final-goal redirects', zh: '最终目标重定向的逐字引用闸门' },
    modules: ['lib/goals.js', 'lib/reviewer.js'],
    status: 'implemented',
  },
  'drift-taxonomy': {
    name: { en: 'Six-code drift taxonomy', zh: '六类偏离分类法' },
    modules: ['lib/prompt.js', 'lib/parse.js'],
    status: 'implemented',
  },
  'evidence-standard': {
    name: { en: 'Evidence required for actionable findings', zh: '可执行判定必须举证' },
    modules: ['lib/parse.js'],
    status: 'implemented',
  },
  'exception-cadence': {
    name: { en: 'Management-by-exception audit cadence', zh: '例外管理式审计节奏' },
    modules: ['lib/cadence.js', 'lib/index.js'],
    status: 'implemented',
  },
  'escalation-ladder': {
    name: { en: 'Five-rung escalation ladder', zh: '五级升级阶梯' },
    modules: ['lib/prompt.js', 'lib/parse.js', 'lib/cadence.js'],
    status: 'implemented',
  },
  'non-blocking-steer': {
    name: { en: 'Non-blocking steering channel', zh: '非阻塞纠偏通道' },
    modules: ['lib/reviewer.js', 'lib/index.js'],
    status: 'implemented',
  },
  'three-lines': {
    name: { en: 'Three lines of defence wiring', zh: '三道防线接线' },
    modules: ['lib/index.js', 'lib/prompt.js'],
    status: 'implemented',
  },
  'lifecycle-revocation': {
    name: { en: 'Revocable reviewer appointment (unload/reload)', zh: '评审员任免与交接（卸载 / 重载）' },
    modules: ['lib/index.js'],
    status: 'implemented',
  },
  'ledger-inheritance': {
    name: { en: 'Audit-trail replay as institutional memory', zh: '审计流水回放：换届不换账' },
    modules: ['lib/audit.js', 'lib/restore.js', 'lib/index.js'],
    status: 'implemented',
  },
  'method-noninterference': {
    name: { en: 'Method non-interference rule', zh: '方法不干预规则' },
    modules: ['lib/prompt.js'],
    status: 'implemented',
  },
  'information-isolation': {
    name: { en: 'Evidence-only reviewer input', zh: '评审员仅见证据包' },
    modules: ['lib/evidence.js', 'lib/reviewer.js'],
    status: 'implemented',
  },
  'program-isolation': {
    name: { en: 'Tool-less reviewer authority', zh: '评审员无工具权限' },
    modules: ['lib/reviewer.js', 'lib/index.js'],
    status: 'implemented',
  },
  'budget-and-cooling': {
    name: { en: 'Review and steering budgets', zh: '评审与发声预算' },
    modules: ['lib/config.js', 'lib/cadence.js'],
    status: 'implemented',
  },
  'anti-goodhart': {
    name: { en: 'Pass-rate is not the reviewer metric', zh: '通过率不是评审员指标' },
    modules: ['lib/prompt.js'],
    status: 'implemented',
  },
  'honest-reporting': {
    name: { en: 'Honest reporting norm', zh: '诚实汇报规范' },
    modules: ['lib/prompt.js'],
    status: 'implemented',
  },
  'audit-trail': {
    name: { en: 'JSONL audit trail', zh: 'JSONL 审计流水' },
    modules: ['lib/audit.js', 'lib/index.js'],
    status: 'implemented',
  },
  'charter-change-control': {
    name: { en: 'Formal charter change control', zh: '宪章变更控制' },
    modules: ['docs/roadmap.md'],
    status: 'planned',
  },
  'model-isolation': {
    name: { en: 'Separate reviewer model', zh: '评审员独立模型' },
    modules: ['lib/config.js'],
    status: 'planned',
  },
});

/** Drift code → theory entries that justify treating it as a drift. */
export const DRIFT_THEORY = Object.freeze({
  goal_substitution: ['goal-displacement', 'goodhart'],
  scope_creep: ['mbo', 'change-control', 'contract-theory'],
  premature_convergence: ['okr-smart', 'bounded-rationality'],
  proxy_optimization: ['goodhart', 'mbo'],
  constraint_decay: ['contract-theory', 'bounded-rationality'],
  escalation_of_commitment: ['escalation-of-commitment'],
});

/** Theory entries implied by the four independence sources. */
export const INDEPENDENCE_THEORY = Object.freeze({
  information: ['audit-independence', 'regulatory-capture'],
  program: ['audit-independence', 'raci'],
  timing: ['audit-independence', 'pdca'],
  incentive: ['audit-independence', 'goodhart', 'regulatory-capture'],
});

/** Mechanism → theory entries that justify it. Every mechanism must appear here. */
export const MECHANISM_THEORY = Object.freeze({
  'asymmetric-stance': ['xy-theory', 'raci'],
  'standing-protocol': ['mbo', 'commanders-intent', 'three-lines'],
  'goal-charter': ['mbo', 'okr-smart', 'change-control'],
  'two-level-goals': ['mbo', 'okr-smart', 'commanders-intent'],
  'goal-change-classification': ['change-control', 'contract-theory', 'goal-displacement'],
  'goal-ledger': ['mbo', 'principal-agent', 'audit-independence'],
  'redirect-corroboration': ['change-control', 'principal-agent', 'contract-theory'],
  'drift-taxonomy': ['goal-displacement', 'goodhart', 'escalation-of-commitment', 'contract-theory'],
  'evidence-standard': ['escalation-ladder', 'management-by-exception'],
  'exception-cadence': ['management-by-exception', 'pdca', 'feedforward-feedback'],
  'escalation-ladder': ['escalation-ladder'],
  'non-blocking-steer': ['raci', 'escalation-ladder'],
  'three-lines': ['three-lines'],
  'lifecycle-revocation': ['principal-agent', 'raci', 'three-lines'],
  'ledger-inheritance': ['contract-theory', 'audit-independence', 'principal-agent'],
  'method-noninterference': ['raci', 'commanders-intent'],
  'information-isolation': ['audit-independence', 'bounded-rationality'],
  'program-isolation': ['audit-independence', 'raci'],
  'budget-and-cooling': ['management-by-exception', 'goodhart'],
  'anti-goodhart': ['goodhart', 'regulatory-capture'],
  'honest-reporting': ['principal-agent'],
  'audit-trail': ['audit-independence', 'management-by-exception'],
  'charter-change-control': ['change-control', 'contract-theory'],
  'model-isolation': ['audit-independence'],
});

/** All ids declared once, for referential-integrity checks. */
export const THEORY_IDS = Object.freeze(THEORY.map((entry) => entry.id));
