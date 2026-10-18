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
| `lib/audit.js` | `audit.jsonl` 审计落盘（best-effort） | node:fs |
| `lib/theory.js` | 管理学理论登记表与机制追溯（纯数据；不被运行时引用，供文档生成与 CI 校验） | 否 |

可测试的部分（config/cadence/parse/evidence）全部是纯函数，`npm test` 无需宿主即可运行。

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

7. `redirected` 还须通过**逐字引用闸门**：`rationale` 必须包含至少 12 个字符的用户原话（去空白/标点后匹配用户消息），否则整条更新被拒绝，审计 `outcome: "guarded"`，账本不变。

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
{"ts":"2026-10-18T08:00:00.000Z","v":1,"event":"review","outcome":"ok","trigger":"cadence","sessionId":"…","turn":7,"verdict":"drift","severity":2,"driftType":"scope_creep","evidence":"…","steer":"…","steered":true,"route":{"provider":"…","model":"…","source":"session"},"goalChange":"none","goalApplied":false,"goalRationale":"","goals":{"revision":2,"lastChange":"refined","finalGoal":"…","currentGoal":"…"},"elapsedMs":2310,"reviewsSoFar":2,"steersSoFar":1}
```

失败与跳过也会记录（`outcome: "skip" | "error"`），以便复盘"该报没报"的情况。

## 11. 失败模式：一律 fail-open

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

**原则**：审查者可以让执行者停下来，但审查者自己不能把对话弄挂。**原则**：审查者可以让执行者停下来，但审查者自己不能把对话弄挂。

## 12. 隐私与数据边界

- 证据包只在本机内存中构造，通过宿主已配置的模型路由发出；不额外落盘。
- 审计文件只在本机 `$DSH_HOME` 下，不联网。
- 不读取工作区文件内容；工具调用只记录 `name + 参数摘要`。
- 子代理会话默认不审计，避免二次采集。

## 13. 成本

一次评审 ≈ 1.2k–2k 输入 token + ≤900 输出 token。标准档（每 3 回合 + 首轮 + 强制间隔）在 20 回合的对话里约 6–8 次评审。全部有硬上限，可在配置里调到 0。

## 14. 开发与测试

```bash
npm run check   # 每个 lib/*.js 用 node --check 解析
npm test        # node --test：40 个纯函数单元测试
npm run verify  # 两者
```

调试建议：

1. 先用 `preset: strict` + `logEvents: true` 观察日志。
2. 查看 `$DSH_HOME/goal-steward/audit.jsonl` 复盘每次裁决。
3. Reviewer 提示词在 `lib/prompt.js`，可直接改后热重载（若 profile 启用 HMR）。

## 15. 理论追溯

运行时不 import `lib/theory.js`：提示词与裁决逻辑不应因为引用文献变动而改变行为。理论表通过两条路径约束工程：

1. `scripts/theory-doc.mjs` 从 `lib/theory.js` **生成** [theory.md](./theory.md)，文档不可能与代码脱节；
2. `test/theory.test.mjs` 在 CI 中校验追溯完整性：每个机制必须有理论依据、每个引用必须落到机制、每个偏离代码必须有理论来源、每个被引用的模块路径必须真实存在。

因此"加一条规则"在工程上的完整定义是：登记机制 → 引用理论 → 落到模块 → 写测试 → 重新生成文档。
