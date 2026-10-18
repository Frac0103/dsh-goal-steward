# 理论支撑：这个插件的管理学依据

> 本文档由 `lib/theory.js` **自动生成**（`npm run docs:theory`），请勿手工编辑。
> 理论登记在代码里，文档从代码生成，`test/theory.test.mjs` 在 CI 中强制追溯完整性：
> 一条运行时机制如果没有理论依据，或者一条引用没有落成机制，测试都会失败。

这个文件回答三个问题：

1. **每条规则背后的管理学命题是什么**（谁在什么年代提出的什么主张）；
2. **它是怎么落成运行时机制的**（对应哪个模块、哪个配置项、哪一级裁决）；
3. **类比在哪里会失效**（不掩饰边界，才能知道这个设计什么时候不该信）。

---

## 1. 理论总览

| 理论 | 提出者 / 年代 | 一句话主张 |
|---|---|---|
| [X 理论 / Y 理论](#xy-theory) | Douglas McGregor, The Human Side of Enterprise (1960) | Supervision style is a self-fulfilling assumption: treat people as lazy and they comply passively; treat them as self-directed and they take ownership. |
| [有限理性 / 满意即止](#bounded-rationality) | Herbert A. Simon, Administrative Behavior (1947) | Actors do not optimize globally; they satisfice inside attention, memory, and information limits. |
| [目标置换](#goal-displacement) | Robert K. Merton, Social Theory and Social Structure (1949) | When rules or means become the measure of success, they displace the original goal; the organization keeps working, on the wrong thing. |
| [目标管理（MBO）](#mbo) | Peter F. Drucker, The Practice of Management (1954) | Work is governed by agreed, explicit objectives and reviewed against them; without a written objective, control degenerates into supervision of activity. |
| [OKR + SMART 原则](#okr-smart) | Andrew Grove, High Output Management (1983); Doran, "There is an S.M.A.R.T. way" (1981) | An objective only controls behavior when it is paired with verifiable key results and is Specific, Measurable, Achievable, Relevant, Time-bound. |
| [PDCA 循环（戴明环）](#pdca) | W. Edwards Deming, Out of the Crisis (1986) | Control is a loop: plan, do, check, act — with checks scheduled, not improvised. |
| [例外管理原则](#management-by-exception) | Frederick W. Taylor, The Principles of Scientific Management (1911); modern controlling practice | Attention is the scarce resource; managers should intervene only where actual results deviate from standard beyond a tolerance. |
| [三道防线（COSO 模型）](#three-lines) | COSO, Enterprise Risk Management — Integrated Framework (2004, updated 2017) | Resilient control comes from layers: operational self-control, independent risk oversight, and governing-body assurance — with the last layer holding final authority. |
| [RACI 权责矩阵](#raci) | Project Management Institute, PMBOK Guide (responsibility assignment matrix) | Every decision needs exactly one accountable role, and consultation must be scoped — consulting everyone is a way to paralyze delivery. |
| [变更控制 / 变更控制委员会](#change-control) | Project Management Institute, PMBOK Guide | Baseline changes must be requested, approved, and recorded; silent baseline drift destroys accountability. |
| [分级升级 / 分级授权](#escalation-ladder) | Incident command and corporate delegation-of-authority practice | Authority should increase with evidence strength; low-confidence observations should inform, not block. |
| [审计独立性](#audit-independence) | Institute of Internal Auditors, International Standards for the Professional Practice of Internal Auditing; AICPA independence rules | Independence is not a personality trait; it comes from structural separation — information, program, timing, and incentive. |
| [监管俘获](#regulatory-capture) | George J. Stigler, "The Theory of Economic Regulation" (1971) | A regulator that depends on the regulated party gradually adopts its point of view; oversight degrades from inside. |
| [古德哈特定律](#goodhart) | Charles Goodhart, "Problems of Monetary Management" (1975) | Once a measure becomes a target, it stops being a good measure. |
| [承诺升级](#escalation-of-commitment) | Barry M. Staw, "Knee-deep in the big muddy" (1976) | Decision makers pour more resources into a failing course because of prior investment, not expected return. |
| [委托—代理问题](#principal-agent) | Jensen & Meckling, "Theory of the Firm" (1976) | An agent who knows more than the principal can report progress selectively; the cost is measured in the principal's verification effort. |
| [任务式指挥 / 指挥官意图](#commanders-intent) | 19th-century Prussian military doctrine; modern mission command | Centralize the intent, decentralize execution: subordinates who understand the goal outperform those following exhaustive orders, because battlefield information is fresher than the order. |
| [前馈 / 同期 / 反馈控制](#feedforward-feedback) | Norbert Wiener, Cybernetics (1948), applied in management control theory | Good control anticipates (feedforward), monitors during execution (concurrent), and corrects after output (feedback); relying on one is insufficient. |
| [约束即契约条款](#contract-theory) | Coase (1937); Williamson, transaction-cost economics (1975) | Obligations that are written into the agreement survive changes of personnel and attention; unwritten ones decay. |

## 2. 机制追溯矩阵

| 机制 | 状态 | 落在哪个模块 | 理论依据 |
|---|---|---|---|
| 通过率不是评审员指标 | 已实现 | `lib/prompt.js` | [古德哈特定律](#goodhart)、[监管俘获](#regulatory-capture) |
| 非对称信任姿态 | 已实现 | `lib/prompt.js`、`lib/config.js` | [X 理论 / Y 理论](#xy-theory)、[RACI 权责矩阵](#raci) |
| JSONL 审计流水 | 已实现 | `lib/audit.js`、`lib/index.js` | [审计独立性](#audit-independence)、[例外管理原则](#management-by-exception) |
| 评审与发声预算 | 已实现 | `lib/config.js`、`lib/cadence.js` | [例外管理原则](#management-by-exception)、[古德哈特定律](#goodhart) |
| 宪章变更控制 | 计划中 | `docs/roadmap.md` | [变更控制 / 变更控制委员会](#change-control)、[约束即契约条款](#contract-theory) |
| 六类偏离分类法 | 已实现 | `lib/prompt.js`、`lib/parse.js` | [目标置换](#goal-displacement)、[古德哈特定律](#goodhart)、[承诺升级](#escalation-of-commitment)、[约束即契约条款](#contract-theory) |
| 五级升级阶梯 | 已实现 | `lib/prompt.js`、`lib/parse.js`、`lib/cadence.js` | [分级升级 / 分级授权](#escalation-ladder) |
| 可执行判定必须举证 | 已实现 | `lib/parse.js` | [分级升级 / 分级授权](#escalation-ladder)、[例外管理原则](#management-by-exception) |
| 例外管理式审计节奏 | 已实现 | `lib/cadence.js`、`lib/index.js` | [例外管理原则](#management-by-exception)、[PDCA 循环（戴明环）](#pdca)、[前馈 / 同期 / 反馈控制](#feedforward-feedback) |
| 目标变更分类（演进 / 替换） | 已实现 | `lib/goals.js`、`lib/parse.js` | [变更控制 / 变更控制委员会](#change-control)、[约束即契约条款](#contract-theory)、[目标置换](#goal-displacement) |
| 三层目标宪章 | 已实现 | `lib/prompt.js`、`lib/evidence.js`、`lib/reviewer.js` | [目标管理（MBO）](#mbo)、[OKR + SMART 原则](#okr-smart)、[变更控制 / 变更控制委员会](#change-control) |
| 带版本的目标账本 | 已实现 | `lib/goals.js`、`lib/cadence.js`、`lib/index.js` | [目标管理（MBO）](#mbo)、[委托—代理问题](#principal-agent)、[审计独立性](#audit-independence) |
| 诚实汇报规范 | 已实现 | `lib/prompt.js` | [委托—代理问题](#principal-agent) |
| 评审员仅见证据包 | 已实现 | `lib/evidence.js`、`lib/reviewer.js` | [审计独立性](#audit-independence)、[有限理性 / 满意即止](#bounded-rationality) |
| 方法不干预规则 | 已实现 | `lib/prompt.js` | [RACI 权责矩阵](#raci)、[任务式指挥 / 指挥官意图](#commanders-intent) |
| 评审员独立模型 | 计划中 | `lib/config.js` | [审计独立性](#audit-independence) |
| 非阻塞纠偏通道 | 已实现 | `lib/reviewer.js`、`lib/index.js` | [RACI 权责矩阵](#raci)、[分级升级 / 分级授权](#escalation-ladder) |
| 评审员无工具权限 | 已实现 | `lib/reviewer.js`、`lib/index.js` | [审计独立性](#audit-independence)、[RACI 权责矩阵](#raci) |
| 系统提示中的常驻治理协议 | 已实现 | `lib/prompt.js`、`lib/index.js` | [目标管理（MBO）](#mbo)、[任务式指挥 / 指挥官意图](#commanders-intent)、[三道防线（COSO 模型）](#three-lines) |
| 三道防线接线 | 已实现 | `lib/index.js`、`lib/prompt.js` | [三道防线（COSO 模型）](#three-lines) |
| 双层目标模型（最终目标 / 当前目标） | 已实现 | `lib/goals.js`、`lib/evidence.js` | [目标管理（MBO）](#mbo)、[OKR + SMART 原则](#okr-smart)、[任务式指挥 / 指挥官意图](#commanders-intent) |

## 3. 理论条文与落法

<a id="xy-theory"></a>
### X 理论 / Y 理论 · Theory X / Theory Y

**出处**：Douglas McGregor, The Human Side of Enterprise (1960)

**命题**：Supervision style is a self-fulfilling assumption: treat people as lazy and they comply passively; treat them as self-directed and they take ownership.

**在本插件中的落法**：Asymmetric stance: the executor (Lead agent) is governed by Theory Y — it owns method, is told intent rather than steps, and may rebut audit findings. The reviewer is governed by Theory X — it is assumed to drift into rubber-stamping or nagging, so it is mechanically bounded (silence by default, budgets, evidence requirements).

**防的失败模式**：micromanagement、executor learned helplessness、reviewer capture

**类比的边界**：An AI has no intrinsic motivation to protect; Theory Y here is a stance about information efficiency (the executor has fresher local context), not about dignity.

<a id="bounded-rationality"></a>
### 有限理性 / 满意即止 · Bounded rationality / satisficing

**出处**：Herbert A. Simon, Administrative Behavior (1947)

**命题**：Actors do not optimize globally; they satisfice inside attention, memory, and information limits.

**在本插件中的落法**：The executor is assumed to be locally optimal and globally myopic: attention decays over turns, and compaction acts like organizational forgetting. The reviewer exists to supply the missing global view, not to question competence.

**防的失败模式**：local optimization、attention decay、compaction-induced memory loss

**类比的边界**：An AI has no attention in the human sense; the analogue is context occupancy and truncation, which is more mechanical and more measurable than human attention.

<a id="goal-displacement"></a>
### 目标置换 · Goal displacement

**出处**：Robert K. Merton, Social Theory and Social Structure (1949)

**命题**：When rules or means become the measure of success, they displace the original goal; the organization keeps working, on the wrong thing.

**在本插件中的落法**：Drift code `goal_substitution`, plus the stable-layer audit: the reviewer compares current work against the charter, never against effort, polish, or output volume.

**防的失败模式**：goal_substitution、process worship、effort theater

**类比的边界**：Merton described a structural response to bureaucratic rules; the AI analogue is prompt-induced or reward-induced, and reversible with prompt changes, which makes it cheaper to fix but easier to reintroduce.

<a id="mbo"></a>
### 目标管理（MBO） · Management by Objectives

**出处**：Peter F. Drucker, The Practice of Management (1954)

**命题**：Work is governed by agreed, explicit objectives and reviewed against them; without a written objective, control degenerates into supervision of activity.

**在本插件中的落法**：The goal charter is written down, split into objective, success criteria, hard constraints, and non-goals. The reviewer audits the charter rather than activity.

**防的失败模式**：activity without purpose、supervision of busyness

**类比的边界**：MBO assumes negotiated objectives between manager and employee over weeks; here the objective is often one sentence given once, so the charter must be derived and then confirmed, not assumed final.

<a id="okr-smart"></a>
### OKR + SMART 原则 · OKR + SMART criteria

**出处**：Andrew Grove, High Output Management (1983); Doran, "There is an S.M.A.R.T. way" (1981)

**命题**：An objective only controls behavior when it is paired with verifiable key results and is Specific, Measurable, Achievable, Relevant, Time-bound.

**在本插件中的落法**：The charter carries `success_criteria`; the reviewer may return a charter update when the stable layer is unclear or changed. A drift finding requires citing which stable-layer item is violated.

**防的失败模式**：unfalsifiable goals、premature_convergence

**类比的边界**：Not every conversation has measurable key results (e.g. exploratory discussion). The plugin therefore never blocks on a missing KR; it records the gap instead.

<a id="pdca"></a>
### PDCA 循环（戴明环） · PDCA / Deming cycle

**出处**：W. Edwards Deming, Out of the Crisis (1986)

**命题**：Control is a loop: plan, do, check, act — with checks scheduled, not improvised.

**在本插件中的落法**：Audits happen at boundaries: the first turn establishes the charter (Plan), execution runs without interruption (Do), scheduled reviews check alignment (Check), steering and charter updates correct it (Act).

**防的失败模式**：no-feedback execution、ad-hoc supervision

**类比的边界**：PDCA assumes a process that repeats; a one-shot conversation has one cycle. The design therefore treats each session as a compact, single-cycle instance.

<a id="management-by-exception"></a>
### 例外管理原则 · Management by exception

**出处**：Frederick W. Taylor, The Principles of Scientific Management (1911); modern controlling practice

**命题**：Attention is the scarce resource; managers should intervene only where actual results deviate from standard beyond a tolerance.

**在本插件中的落法**：Reviewer silence is the default. Reviews happen only on explicit triggers (first turn, cadence, forced gap, goal change), and steering only above a configured severity floor with per-turn and per-session budgets.

**防的失败模式**：reviewer noise、alert fatigue、goal drift unnoticed

**类比的边界**：Exception management needs a reliable standard to compare against; here the standard is model-derived, so the false-negative risk is real and is recorded in the audit trail rather than assumed away.

<a id="three-lines"></a>
### 三道防线（COSO 模型） · Three lines of defence (COSO)

**出处**：COSO, Enterprise Risk Management — Integrated Framework (2004, updated 2017)

**命题**：Resilient control comes from layers: operational self-control, independent risk oversight, and governing-body assurance — with the last layer holding final authority.

**在本插件中的落法**：Line 1: the standing governance protocol in the system prompt (executor self-check, zero extra calls). Line 2: the isolated reviewer at turn boundaries. Line 3: the principal (user), reached only by escalation.

**防的失败模式**：single point of control failure、reviewer overreach、executor blindness

**类比的边界**：In an organization the three lines are separate people with separate careers; here they are roles inside one process, so the separation is procedural rather than social.

<a id="raci"></a>
### RACI 权责矩阵 · RACI responsibility matrix

**出处**：Project Management Institute, PMBOK Guide (responsibility assignment matrix)

**命题**：Every decision needs exactly one accountable role, and consultation must be scoped — consulting everyone is a way to paralyze delivery.

**在本插件中的落法**：Method and route are R/A for the executor, and the reviewer is only Informed — not Consulted. The reviewer may audit alignment but is structurally forbidden from prescribing technology, tools, or plans.

**防的失败模式**：reviewer micromanagement、method paralysis

**类比的边界**：RACI is a static chart for teams; this one is enforced by prompt constraints and verdict schema, so its force is probabilistic rather than organizational.

<a id="change-control"></a>
### 变更控制 / 变更控制委员会 · Change control / CCB

**出处**：Project Management Institute, PMBOK Guide

**命题**：Baseline changes must be requested, approved, and recorded; silent baseline drift destroys accountability.

**在本插件中的落法**：The stable layer changes only through an explicit charter update returned by the reviewer and surfaced to the principal. The executor is forbidden from silently substituting a nearby objective. (Tooling for a formal charter file lands in 0.2.)

**防的失败模式**：silent objective substitution、scope creep

**类比的边界**：A single-user conversation has no committee; the principal is the entire CCB, so the mechanism is a pause-and-ask protocol, not a quorum process.

<a id="escalation-ladder"></a>
### 分级升级 / 分级授权 · Graduated escalation / tiered authorization

**出处**：Incident command and corporate delegation-of-authority practice

**命题**：Authority should increase with evidence strength; low-confidence observations should inform, not block.

**在本插件中的落法**：Five rungs: L0 record, L1 watch, L2 drift (steer, non-blocking), L3 goal conflict (stop and ask the principal), L4 hard violation (reserved). The verdict schema makes the rung machine-checkable.

**防的失败模式**：crying wolf、false vetoes、unreported weak signals

**类比的边界**：Escalation in an organization carries cost and delay; here an L2 steer is cheap, which makes over-escalation more tempting — hence the budgets and the evidence requirement.

<a id="audit-independence"></a>
### 审计独立性 · Audit independence

**出处**：Institute of Internal Auditors, International Standards for the Professional Practice of Internal Auditing; AICPA independence rules

**命题**：Independence is not a personality trait; it comes from structural separation — information, program, timing, and incentive.

**在本插件中的落法**：Information isolation: the reviewer sees only an evidence pack, never the executor reasoning. Program isolation: no tools, no write authority. Timing isolation: audit at turn boundaries only. Incentive isolation: the reviewer prompt forbids improving the work or proposing methods.

**防的失败模式**：self-review bias、sycophancy loop、capture

**类比的边界**：On a single-model host the reviewer shares the executor weights; the fourth separation (model) is unavailable until another provider is configured, and this is stated rather than glossed over.

<a id="regulatory-capture"></a>
### 监管俘获 · Regulatory capture

**出处**：George J. Stigler, "The Theory of Economic Regulation" (1971)

**命题**：A regulator that depends on the regulated party gradually adopts its point of view; oversight degrades from inside.

**在本插件中的落法**：The reviewer is structurally prevented from depending on the executor: no tools, no shared context, no ability to accept tasks, plus an explicit rule against softening findings to be agreeable.

**防的失败模式**：rubber stamping、capture

**类比的边界**：Capture is a social process over time; an LLM reviewer cannot be captured in the same way, but it can be anchored by repeated prompts or by seeing only the executor output — hence the no-anchoring rule on previous findings.

<a id="goodhart"></a>
### 古德哈特定律 · Goodhart's law

**出处**：Charles Goodhart, "Problems of Monetary Management" (1975)

**命题**：Once a measure becomes a target, it stops being a good measure.

**在本插件中的落法**：Drift code `proxy_optimization` (tests passing, files written, tokens spent) is named explicitly. The reviewer itself may not be measured by pass rate; its health metric is the lagging indicator of principal corrections, read from the audit trail.

**防的失败模式**：proxy_optimization、reviewer metric gaming

**类比的边界**：Any automated audit is itself a proxy for goal alignment; the design cannot escape Goodhart, only expose the proxy and keep it auditable.

<a id="escalation-of-commitment"></a>
### 承诺升级 · Escalation of commitment

**出处**：Barry M. Staw, "Knee-deep in the big muddy" (1976)

**命题**：Decision makers pour more resources into a failing course because of prior investment, not expected return.

**在本插件中的落法**：Drift code `escalation_of_commitment`; the reviewer sees the previous findings so that a repeated failing line is recognized as a pattern, not a new attempt.

**防的失败模式**：sunk-cost continuation

**类比的边界**：An AI has no career to protect; the analogue is context investment and plan attachment, which is weaker but still observable in repeated tool calls.

<a id="principal-agent"></a>
### 委托—代理问题 · Principal–agent problem

**出处**：Jensen & Meckling, "Theory of the Firm" (1976)

**命题**：An agent who knows more than the principal can report progress selectively; the cost is measured in the principal's verification effort.

**在本插件中的落法**：The governance protocol requires honest reporting of what was done, verified, and not verified. The audit trail lets the principal verify the reviewer without reading the whole transcript.

**防的失败模式**：reporting inflation、unverified completion claims

**类比的边界**：Human agents respond to incentives; an LLM responds to prompt and context. The mechanism is therefore a reporting norm plus an audit surface, not a contract.

<a id="commanders-intent"></a>
### 任务式指挥 / 指挥官意图 · Commander's intent / Auftragstaktik

**出处**：19th-century Prussian military doctrine; modern mission command

**命题**：Centralize the intent, decentralize execution: subordinates who understand the goal outperform those following exhaustive orders, because battlefield information is fresher than the order.

**在本插件中的落法**：The system prompt states the stable layer as intent and hands the executor full discretion over route, milestones, and tools. Audits check the intent, never the orders.

**防的失败模式**：over-specification、detail paralysis、unresponsive plans

**类比的边界**：Mission command assumes trained subordinates; here the executor may be any model, so intent must be restated (the standing protocol) rather than assumed internalized.

<a id="feedforward-feedback"></a>
### 前馈 / 同期 / 反馈控制 · Feedforward / concurrent / feedback control

**出处**：Norbert Wiener, Cybernetics (1948), applied in management control theory

**命题**：Good control anticipates (feedforward), monitors during execution (concurrent), and corrects after output (feedback); relying on one is insufficient.

**在本插件中的落法**：Feedforward: the first-turn charter audit and plan check. Concurrent: mandatory-gap audits while work is in flight. Feedback: the pre-delivery check against success criteria.

**防的失败模式**：post-hoc-only correction、planning without verification

**类比的边界**：Concurrent control here is sampled, not continuous; unbounded continuous auditing would violate the cost and non-interference constraints.

<a id="contract-theory"></a>
### 约束即契约条款 · Constraint persistence as contract terms

**出处**：Coase (1937); Williamson, transaction-cost economics (1975)

**命题**：Obligations that are written into the agreement survive changes of personnel and attention; unwritten ones decay.

**在本插件中的落法**：Drift code `constraint_decay`: hard constraints and non-goals are charter items, not conversational etiquette, and are re-shown to the reviewer every audit. (Persistent charter file lands in 0.2.)

**防的失败模式**：constraint_decay

**类比的边界**：A contract is enforceable in court; a charter is enforced only by prompts and audits, so enforcement is best-effort and must be visible as such.

## 4. 六类偏离的理论来源

| 偏离代码 | 理论依据 |
|---|---|
| `goal_substitution` | [目标置换](#goal-displacement)、[古德哈特定律](#goodhart) |
| `scope_creep` | [目标管理（MBO）](#mbo)、[变更控制 / 变更控制委员会](#change-control)、[约束即契约条款](#contract-theory) |
| `premature_convergence` | [OKR + SMART 原则](#okr-smart)、[有限理性 / 满意即止](#bounded-rationality) |
| `proxy_optimization` | [古德哈特定律](#goodhart)、[目标管理（MBO）](#mbo) |
| `constraint_decay` | [约束即契约条款](#contract-theory)、[有限理性 / 满意即止](#bounded-rationality) |
| `escalation_of_commitment` | [承诺升级](#escalation-of-commitment) |

## 5. 四重独立性分别由什么理论支撑

| 独立性 | 理论依据 | 在本插件中的实现 |
|---|---|---|
| information | [审计独立性](#audit-independence)、[监管俘获](#regulatory-capture) | `lib/evidence.js`：评审员只收到证据包，看不到执行者推理与系统提示 |
| program | [审计独立性](#audit-independence)、[RACI 权责矩阵](#raci) | `lib/reviewer.js`：评审调用无工具、无写权限，唯一动作是返回裁决 |
| timing | [审计独立性](#audit-independence)、[PDCA 循环（戴明环）](#pdca) | `lib/index.js`：只在 `agent/turn-stopping` 边界评审，不在执行中途插嘴 |
| incentive | [审计独立性](#audit-independence)、[古德哈特定律](#goodhart)、[监管俘获](#regulatory-capture) | `lib/prompt.js`：禁止提方法建议；通过率不是评审员指标；审计流水可复盘 |

## 6. 这个设计如何被证伪

理论支撑不等于有效。下面这些指标可以推翻它：

| 假设 | 观测指标 | 若指标恶化则说明 |
|---|---|---|
| 审计能减少目标偏离 | 用户事后纠正的频率（同一意图被反复纠正） | 审计没有拦住偏离 |
| 审计能更早发现偏离 | 从偏离发生到被用户指出的平均轮数 | 审计发现得太晚，等于没有 |
| 默认沉默不会造成噪音 | steer 后被用户忽略或撤销的比例 | 审查者变成噪音源 |
| 举证要求能抑制误报 | 被判定 drift 之后执行者成功反驳的比例 | 判定标准过松或证据不可靠 |
| 成本可接受 | 每千 token 的评审开销、每会话评审次数 | 治理成本高于收益 |

审计流水（`$DSH_HOME/goal-steward/audit.jsonl`）保留了计算这些指标所需的原始记录。

## 7. 理论使用的三条纪律

1. **不把类比当证明**：管理学讲的是人组成的组织，AI 不是人。这里用的是"同构的失控机制"，不是"相同的对象"。
2. **不引入无法落地的理论**：凡是不能变成模块、配置项或裁决规则的理论，不登记进 `lib/theory.js`。
3. **允许理论被工程反证**：如果某条规则在实践中持续产生噪音或没有降低偏离率，应当删掉规则并更新理论条目，而不是反过来拿理论为规则辩护。

