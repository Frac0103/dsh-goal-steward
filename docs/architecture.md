# 架构文档

本文说明 `dsh-goal-steward` 如何落到 DeepSeek Harness 的运行时能力上。设计依据见 [design.md](./design.md)。

## 1. 兼容性与形态

| 项 | 值 |
|---|---|
| 目标宿主 | DeepSeek Harness `>=0.2.0-rc.1 <0.3.0` |
| 插件形态 | Cordis host 插件（bundle patch） |
| 模块系统 | 纯 ESM，**无构建步骤**（`lib/*.js` 直接由宿主加载） |
| 运行时 | Node.js `>=20`（使用 `AbortSignal.any` / `AbortSignal.timeout`） |
| 依赖 | 仅 peer：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-session`；无第三方运行时依赖 |
| 前端 | 无（0.3 才考虑客户端 UI） |

## 2. 安装

### 方式 A：作为 bundle 安装（推荐）

把包安装进 profile，并让 bundle patch 挂载插件。使用 DSH 的插件管理器安装本地路径、tarball 或 git 地址均可；安装后 profile 的 `cordis.patch.yml` 会获得一条：

```yaml
- insert:
    - id: goal-steward
      name: 'dsh-goal-steward'
```

### 方式 B：手工挂载（开发调试）

1. 把仓库链接/拷贝进 profile 的 `node_modules`（例如 `pnpm add file:D:\project\dsh-goal-steward`）。
2. 在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: goal-steward
      name: 'dsh-goal-steward'
      config:
        preset: standard
```

3. 让 DSH 重新加载配置（插件管理器操作或重启应用）。

### 卸载

删除上述 patch 条目并移除包；插件无任何持久化副作用，只有 `audit.jsonl` 审计文件（可随时删除）。

## 3. 数据流

```
                         用户消息
                            │
                            ▼
        ┌─────────────────────────────────────────┐
        │ 执行者的正常 agent loop                  │
        │  ├─ system prompt 组装                   │
        │  │   └─ [本插件] section 700: 治理协议    │  ← 第一道防线：零成本
        │  ├─ 工具调用 / 推理 / 写入                 │
        │  └─ 回合即将收口                          │
        └───────────────┬─────────────────────────┘
                        │ agent/turn-stopping (serial)
                        ▼
        ┌─────────────────────────────────────────┐
        │ 是否到审计点？（cadence.js）              │
        │  首次 / 每 N 轮 / 强制间隔 / 目标变更      │
        └───────────────┬─────────────────────────┘
                 否 ────┴──── 是
                  │             │
                  ▼             ▼
              回合结束   ┌──────────────────────────────┐
                        │ 组装证据包（evidence.js）      │
                        │ 宪章 + 用户原话 + 最终输出      │
                        │ + 工具调用摘要 + 上次结论       │
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │ 独立 LLM 调用（reviewer.js）   │
                        │ 角色隔离 + 信息隔离 + 无工具    │
                        │ 输出严格 JSON 裁决             │
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │ 校验（parse.js）              │
                        │ 不在契约内 = 无效，按 L0 处理  │
                        └──────────────┬───────────────┘
                         ┌─────────────┴─────────────┐
                         ▼                           ▼
                 L0/L1：只写审计日志           L2/L3：agent.steer()
                 （默认路径）                  注入审计发现，回合继续
```

## 4. 宿主能力映射

| 宿主能力 | 用法 | 代码位置 |
|---|---|---|
| `ctx.systemPrompt.section()` | 注册 order 700 的常驻治理协议段（位于 team policy 与 tool docs 之间） | `lib/index.js` |
| `ctx.on('agent/turn-stopping')` | 回合收口前的审计点（serial 事件，await 后才允许回合关闭） | `lib/index.js` |
| `agent.steer(message)` | 把审计发现作为 plugin-source 用户消息注入 inbox，不阻塞主流程 | `lib/reviewer.js` |
| `ctx.llm.stream(GenerateOptions)` | 独立的评审调用（`system` + 单条 user 消息；`temperature: 0`） | `lib/reviewer.js` |
| `BlockAssembler` | 把流式 chunk 装配成最终文本 | `lib/reviewer.js` |
| `createUserMessage()` | 构造带 `source: {kind:'plugin'}` 的注入消息 | `lib/reviewer.js` |
| `session.snapshotEvents()` / `session.surface.nodes` | 读取事件日志与模型可见面，用于构造证据包 | `lib/evidence.js` |
| `session.requestHeader()` | 继承执行者当前的 provider/model 路由 | `lib/reviewer.js` |
| `session.header.parentSession` | 识别子代理会话（默认不审计） | `lib/reviewer.js` |
| `ctx.get('goals')`（可选） | 读取持久化目标作为稳定层锚点 | `lib/reviewer.js` |
| `ctx.on('agent/disposed')` | 清理会话状态 | `lib/index.js` |
| `ctx.inject(['commands'])`（可选） + `ctx.commands.register()` | 注册 `/steward` 人类命令：直接读写治理状态，不经过模型 | `lib/index.js` / `lib/commands.js` |

## 5. 模块职责

| 文件 | 职责 | 依赖宿主？ |
|---|---|---|
| `lib/index.js` | 插件入口（`name` / `inject` / `apply`）、生命周期、编排 | 是 |
| `lib/config.js` | 配置解析与三档预设，非法值降级不抛错 | 否（纯函数） |
| `lib/prompt.js` | 治理协议与 Reviewer 系统提示词（纯文本常量） | 否 |
| `lib/evidence.js` | 证据包构造、宪章推导、事件日志读取 | 否（纯函数） |
| `lib/goals.js` | 双层目标账本：归一化、变更分类、revision 与历史 | 否（纯函数） |
| `lib/cadence.js` | 审计节奏与说话预算的状态机 | 否（纯函数） |
| `lib/parse.js` | 裁决 JSON 的宽容提取与严格校验 | 否（纯函数） |
| `lib/reviewer.js` | 评审调用、路由解析、steer 消息构造 | 是 |
| `lib/audit.js` | `audit.jsonl` 审计落盘与回放读取（best-effort / fail-open） | node:fs |
| `lib/restore.js` | 审计记录回放为会话状态（账本 + 历史结论） | 否（纯函数） |
| `lib/commands.js` | `/steward` 人类命令：状态视图、用户主权设定最终目标 | 否（纯函数 + 注入式宿主接口） |
| `lib/theory.js` | 管理学理论登记表与机制追溯（纯数据；不被运行时引用，供文档生成与 CI 校验） | 否 |

可测试的部分（config/cadence/parse/evidence/goals/restore/commands 的纯逻辑）全部是纯函数，`npm test` 无需宿主即可运行。

## 6. 证据包格式

Reviewer 收到的全部输入就是这一段 JSON：

```json
{
  "turn": 7,
  "reviews_so_far": 2,
  "goal_ledger": {
    "revision": 3,
    "final": { "objective": "做出可安装的目标治理插件并发布到 GitHub", "success_criteria": ["能安装", "能检测偏离"], "constraints": ["不改宿主代码"], "non_goals": ["0.2 前不做 Web UI"] },
    "current": { "objective": "用真实会话验证双层目标账本", "success_criteria": ["审计流水出现 goalChange"], "constraints": [], "non_goals": [] },
    "last_change": "refined"
  },
  "principal_initial_message": "……开场指令……",
  "principal_messages": ["……最近用户原话摘要……"],
  "executor_final_message": "……执行者本轮最终可见输出……",
  "recent_actions": ["turn 7 step 2: edit {\"file_path\":\"lib/goals.js\"…}"],
  "previous_findings": [],
  "note": "Evidence only. The executor reasoning is intentionally excluded."
}
```

约束：

- 不包含执行者的推理过程、系统提示、文件内容。
- 有字符预算（默认 12k），超限时先丢工具摘要、再丢较早的用户消息；**目标账本与最终输出永不丢弃**。
- 单条用户消息截断 700 字符，最终输出截断 2000 字符，工具摘要截断 180 字符。

## 7. 裁决契约

```json
{
  "verdict": "on_track | watch | drift | goal_conflict | hard_violation",
  "severity": 0,
  "drift_type": null,
  "evidence": "",
  "steer": "",
  "goal_update": {
    "change": "none | refined | phase_advance | redirected | silent_substitution",
    "final": null,
    "current": null,
    "serves_final": true,
    "rationale": ""
  }
}
```

验证规则（`lib/parse.js`）：

1. 必须能提取出一个平衡的 JSON 对象（容忍 markdown 代码围栏与前后散文）。
2. `verdict` 必须是五个枚举值之一；`severity` 由 verdict 推导（模型的数值字段仅作诊断记录），防止自相矛盾。
3. `severity >= 2` 时：`drift_type` 必须是六类之一、`evidence` 非空、`steer` 非空；任一缺失 → 整个裁决作废（按 L0 处理）。
4. `severity < 2` 时：强制清空 `steer`，防止"温和提醒"夹带指令。
5. `goal_update` 缺失时按"无变化"处理；出现时 `change` 必须是五类之一：
   - `refined` / `phase_advance` 必须带 `current`；`redirected` 必须带 `final`（`current` 缺省等于 `final`）；
   - `silent_substitution` 必须同时满足 drift 要件（`severity >= 2`、`drift_type = goal_substitution`、有证据与 steer），且**永不改写账本**；
   - `serves_final: false` 只允许出现在 `silent_substitution` 上。
6. 账本更新是原子的：`goal_update` 不合法 → 整个裁决作废（不做半截写入）。

7. `redirected` 还须通过**逐字引用闸门**：`rationale` 必须包含至少 12 个字符的用户原话（去空白/标点后匹配**开场指令之后**的用户消息；开场指令本身不能佐证一次"变化"），否则整条更新被拒绝，审计 `outcome: "guarded"`，账本不变。

**为什么这么严**：无证据的指控会让审查者变成噪音源；而"无 taxonomy 的 drift"不可统计、不可复盘。宁可漏报（fail-open），不可误报。**为什么这么严**：无证据的指控会让审查者变成噪音源；而"无 taxonomy 的 drift"不可统计、不可复盘。宁可漏报（fail-open），不可误报。

## 8. 触发规则

| 触发 | 条件 | 是否消耗会话预算 |
|---|---|---|
| `initial` | 本会话第一次审计（建立双层目标账本） | 是 |
| `goal-changed` | 持久化 goal 的 revision 变化 | 是 |
| `max-turn-gap` | 距上次审计 ≥ `maxTurnGap`（默认 6） | 是 |
| `cadence` | 距上次审计 ≥ `reviewEveryTurns`（标准 3） | 是 |
| 同一回合不重复审计 | `lastReviewTurn === turn` | 不消耗 |
| 子代理会话 | `header.parentSession` 存在 | 默认跳过 |

说话预算（说话 = 发 `steer`）：`steerSeverity` 门槛 + 每回合上限 + 每会话上限，三者同时满足才说。

## 9. 配置

| 键 | 默认（standard） | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `preset` | `standard` | `gentle` / `standard` / `strict` |
| `reviewEveryTurns` | `3` | 例行审计间隔；`0` = 只在强制触发时审计 |
| `maxTurnGap` | `6` | 强制审计间隔 |
| `steerSeverity` | `2` | 触发 steer 的最低严重度 |
| `maxReviewsPerSession` | `60` | 每会话评审调用上限 |
| `maxSteersPerTurn` | `2` | 每回合 steer 上限 |
| `maxSteersPerSession` | `12` | 每会话 steer 上限 |
| `timeoutMs` | `45000` | 单次评审超时 |
| `maxReviewTokens` | `2000` | 评审输出上限（推理模型的思考也占预算；正文为空时从推理块兜底解析） |
| `maxInputChars` | `12000` | 证据包上限 |
| `reviewProvider` / `reviewModel` | 继承执行者 | 指向另一模型即获得"模型隔离" |
| `temperature` | `0` | 评审采样温度 |
| `includeChildSessions` | `false` | 是否审计子代理会话 |
| `audit` | `true` | 是否落审计文件 |
| `auditDir` | `$DSH_HOME/goal-steward` | 审计目录 |
| `logEvents` | `true` | 是否把一行摘要打到宿主日志 |

> 配置非法时会降级为预设默认值而不是抛错——治理层不能因为配置写错而瘫痪。

## 10. 审计记录

`$DSH_HOME/goal-steward/audit.jsonl`，每行一条，含：

```json
{"ts":"2026-10-18T08:00:00.000Z","v":1,"event":"review","outcome":"ok","trigger":"cadence","sessionId":"…","turn":7,"verdict":"drift","severity":2,"driftType":"scope_creep","evidence":"…","steer":"…","steered":true,"route":{"provider":"…","model":"…","source":"session"},"goalChange":"none","goalApplied":false,"goalRationale":"","goals":{"revision":2,"lastChange":"refined","final":{"objective":"…","success_criteria":["…"],"constraints":[],"non_goals":[]},"current":{"objective":"…","success_criteria":[],"constraints":[],"non_goals":[]}},"elapsedMs":2310,"reviewsSoFar":2,"steersSoFar":1}
```

失败与跳过也会记录（`outcome: "skip" | "error"`），以便复盘"该报没报"的情况。`goals` 里存的是**完整快照**（不只是目标字符串），因此审计流水可以原样重建账本；`goals.final` / `goals.current` 是 0.2.0-alpha.7 起的形状，更早的记录只有 `finalGoal` / `currentGoal` 两个字符串字段，回放模块两种都认。

## 11. 生命周期：任免与交接

插件实例不是永久的：宿主在 HMR、profile 启停、进程关闭时都会卸载它，重复的 bundle 配置还可能把它挂载两次。这两件事都被当成治理语义处理，而不是部署细节。

| 事件 | 行为 |
|---|---|
| 重复挂载 | 第二个实例在注册提示词段时被宿主注册表拒绝（section 名唯一），`apply()` 捕获后记 `installation skipped` 日志并放弃安装；不会出现双评审 |
| 卸载（HMR / 禁用 / 关机） | 先置 `disposed` 门禁并 `abort()` 在飞评审调用，再移除 `agent/turn-stopping`、`agent/disposed` 监听器与治理提示词段，最后清空会话状态 |
| 在飞评审遭遇卸载 | 模型调用被中止；即使回复仍然到达，裁决结果被丢弃——不 steer、不写审计 |
| 重新挂载 / 重启 | 提示词段可重新注册；会话的**账本与历史结论从审计流水回放继承**，评审计数从头开始（见 11.1） |
| 安装期任何异常 | fail-open：记 warn 日志并放弃安装，不阻断宿主 |

### 11.1 回放：审计流水就是机构记忆

治理角色会换届，但机构不能失忆。如果新实例把宪章重新锚定到开场指令，用户中途做过的合法重定向就会悄悄回滚，工作会被拿"旧目标"来审判。所以审计流水同时承担第二个职责：**新实例的继承档案**。

- `readAuditRecords(config, sessionId)`（`lib/audit.js`）只读地取出本会话的记录，坏行跳过、文件缺失返回空——回放永远 fail-open；
- `restoreSessionState(records)`（`lib/restore.js`，纯函数）取**最后一份非空账本快照**和最近 5 条历史结论；
- 继承是**部分的**：账本 + 历史结论继承，`reviews` / `steers` / `lastReviewTurn` **不继承**——每一任期重新建立预算与节奏。理由：账本是机构档案，预算是一个任期的运营额度；否则一次重启就会让会话预算"静默耗尽"或"无限重置"。
- 没有审计流水（`audit: false`）时无从回放，会话按开场指令重新锚定，行为与旧版一致。
- 每个会话每个实例只回放一次（`restored` 标记 + 并发去重），成本与审计文件规模线性相关；审计流水是追加式小文件，正常情况下每会话仅有数条到数十条记录。

不变量（测试锁定）：

1. 每个上下文最多一个治理实例（提示词段名即单例锁）；
2. 卸载后提示词段与全部监听器都被移除；
3. 卸载后不再产生 plugin-source 会话消息、不再追加审计记录；
4. 重载后治理协议与回合边界评审都恢复；
5. 重载后第一次评审的证据包里，账本 revision 与 `current` 目标来自上一任期（不是重新锚定），历史结论也在；
6. 卸载后 `/steward` 命令一并注销，退役实例不再有任何人机控制面。

覆盖：L1 `test/restore.test.mjs`（10 条回放契约）、L2 `test/mock/lifecycle.test.mjs`（7 条）、L3 `test/compose/lifecycle.compose.test.mjs`（4 条，真实注册表 + 真实 AgentLoop）。

## 12. 命令面：/steward（用户主权通道）

最终目标的变更只有两种合法来源：**用户自己的话**，或者**评审员引用用户自己的话**。前者此前只有"否决权"——评审员的 `redirected` 会被逐字引用闸门拦下，但用户没有一个直接写下新目标的入口。`/steward` 补上了这个入口。

命令由宿主 `commands` 服务承载：交互式适配器把 `/steward ...` 交给 handler 执行，**不产生模型消息**，结果文本由 UI 渲染在会话之外。因此它与"执行者说服评审员改目标"在机制上不可能混淆：命令通道只对人有入口。

| 子命令 | 行为 |
|---|---|
| `/steward` · `/steward status` | 打印最终目标 / 当前目标 / 成功判据 / 硬约束 / revision / 本实例评审与发声次数 / 最近发现 / 审计文件位置 |
| `/steward goal <新目标>` | 用户直接把最终目标写入账本：`revision + 1`、`lastChange: redirected`、当前目标同步重置；写一条 `event: "command"`、`trigger: "principal-command"` 的审计记录 |
| `/steward why` | 打印最近 5 条历史结论（旧→新） |
| `/steward help` | 与 status 相同的用法提示 |

工程约束：

- 命令是**可选依赖**：`ctx.inject(['commands'])` 迟到绑定，UI-less 宿主不挂载命令注册表时评审员照常工作；卸载插件时命令随子 fiber 一起注销（L3 断言：退役实例的 `/steward` 不再解析）。
- 命令**永不抛错**：任何内部异常都转换为 `{kind:'error', text}`，不会在 UI 里变成崩溃。
- `recordInput: false`：命令原文不重复写进会话日志，审计记录才是权威副本。
- 目标文本经过与评审员输出相同的 `normalizeGoal`（长度 / 控制字符 / 列表上限），命令通道不成为注入的新入口。
- 审计写入失败时命令仍成功，但明确告知"只在本实例内存生效，重启会回退"。

不变量（测试锁定）：命令注册于 `/steward` 名字下；`goal` 写入账本与审计；下一次真实评审的证据包以命令设定的目标为准；命令文本不出现在任何模型请求里；卸载后命令不可解析。

覆盖：`test/commands.test.mjs`（22 条语法/账本/渲染/失败路径）、`test/mock/commands.test.mjs`（5 条接线 + 审计 schema）、`test/compose/commands.compose.test.mjs`（真实 CommandsRuntime + AgentLoop 端到端）。

## 13. 失败模式：一律 fail-open

| 失败 | 行为 |
|---|---|
| 评审调用超时 / 报错 | 记审计，回合正常关闭 |
| 裁决 JSON 不可解析 | 记审计，视为 L0，不打扰执行者 |
| 审计文件写不了 | 静默忽略（可选日志警告） |
| 拿不到路由（首轮无 requestHeader） | 跳过本次，下个触发点再试 |
| `agent.steer()` 抛错 | 记审计，回合正常关闭 |
| 插件配置非法 | 降级到预设默认值 |
| 宿主 API 缺失（如 goals） | 可选服务缺失不影响主流程 |
| 未经佐证的最终目标重定向 | 拒绝改写账本，审计 `outcome: "guarded"`，不发声 |
| 重复挂载 | 第二个实例放弃安装，记 warn 日志 |
| 安装 / 卸载期间出错 | fail-open：安装失败放弃安装；卸载后不再有任何治理动作 |

**原则**：审查者可以让执行者停下来，但审查者自己不能把对话弄挂。

## 14. 隐私与数据边界

- 证据包只在本机内存中构造，通过宿主已配置的模型路由发出；不额外落盘。
- 审计文件只在本机 `$DSH_HOME` 下，不联网。
- 不读取工作区文件内容；工具调用只记录 `name + 参数摘要`。
- 子代理会话默认不审计，避免二次采集。

## 15. 成本

一次评审 ≈ 1.2k–2k 输入 token + ≤2k 输出 token（默认 `maxReviewTokens: 2000`，推理模型的思考也计入）。标准档（每 3 回合 + 首轮 + 强制间隔）在 20 回合的对话里约 6–8 次评审。全部有硬上限，可在配置里调到 0。

## 16. 开发与测试

```bash
npm run check   # 每个 lib/*.js 用 node --check 解析
npm run check:docs # 文档相对链接 + 锚点门禁
npm test        # node --test：197 个测试（L1 纯函数 / L2 假上下文 / redteam / L3 真实组装）
npm run test:coverage  # 覆盖率报告（Node 22+ 在 CI 中同时做阈值门禁）
npm run verify  # 前三者
```

调试建议：

1. 先用 `preset: strict` + `logEvents: true` 观察日志。
2. 查看 `$DSH_HOME/goal-steward/audit.jsonl` 复盘每次裁决。
3. Reviewer 提示词在 `lib/prompt.js`，可直接改后热重载（若 profile 启用 HMR；插件卸载/重载安全性有 L2/L3 测试覆盖，见第 11 节）。

## 17. 理论追溯

运行时不 import `lib/theory.js`：提示词与裁决逻辑不应因为引用文献变动而改变行为。理论表通过两条路径约束工程：

1. `scripts/theory-doc.mjs` 从 `lib/theory.js` **生成** [theory.md](./theory.md)，文档不可能与代码脱节；
2. `test/theory.test.mjs` 在 CI 中校验追溯完整性：每个机制必须有理论依据、每个引用必须落到机制、每个偏离代码必须有理论来源、每个被引用的模块路径必须真实存在。

因此"加一条规则"在工程上的完整定义是：登记机制 → 引用理论 → 落到模块 → 写测试 → 重新生成文档。
