# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [0.1.0-alpha.2] - 2026-10-18

### Added
- `lib/theory.js`：管理学理论登记表（19 条理论、18 条运行时机制、六类偏离与四重独立性的理论来源），作为单一数据源
- `docs/theory.md`：由 `npm run docs:theory` 从代码生成的完整理论文档，含机制追溯矩阵、类比失效边界与证伪指标
- `test/theory.test.mjs`：9 条追溯完整性测试——无依据的机制、无机制的引用、断裂的模块路径都会让 CI 失败
- 治理协议与评审员提示词中加入三道防线 / 例外管理的角色定位
- `docs/roadmap.md`：0.1–0.5 路线图与明确非目标

## [0.1.0-alpha.3] - 2026-10-18

### Fixed
- **稳定层锚点修复**（实机 dogfooding 第一轮发现）：宪章目标此前取「最近 4 条用户消息中最早的一条」，当会话超过 4 条用户消息后，一句两字的"你重新试试"会变成推导出的目标。现在改为从**整个会话的第一条用户指令**（`principal_initial_message`）推导，并新增 `goal_charter_source` 字段（`reviewer-recorded` / `goal-service` / `initial-message`）让评审员知道锚点来源。
- 评审员提示词新增两条规则：短回复（"继续""go ahead""重新试试"）不能替换开场宪章；当来源是 `initial-message` 且开场指令更完整时，可以返回修正后的宪章。

### Added
- 6 条锚点回归测试（总测试数 65）。

## [0.2.0-alpha.1] - 2026-10-18

### Added
- **双层目标模型**：`lib/goals.js` 维护 `final`（最终目标）/ `current`（当前目标）两级账本，带 revision 与历史
- **目标变更分类**：`none` / `refined` / `phase_advance` / `redirected` / `silent_substitution`；合法演进写入账本，静默替换判为 drift 且**不**改写账本
- 评审员契约新增 `goal_update` 字段（取代 v0.1 的 `charter`），证据包新增 `goal_ledger`
- steer 消息同时给出当前目标与最终目标，执行者可对照自己正在服务哪一层
- 审计流水新增 `goalChange` / `goalApplied` / `goalRationale` / `goals{revision,lastChange,finalGoal,currentGoal}`
- 理论登记新增 3 条机制（双层目标、目标变更分类、目标账本），`docs/theory.md` 重新生成
- 测试 86 个（新增 21 条，覆盖目标账本、变更分类与实机接线）
## [0.2.0-alpha.2] - 2026-10-18

### Fixed
- 实机审计出现 `reviewer produced no text`：推理模型的思考会吃掉输出预算，导致没有正文块。现在 `maxReviewTokens` 默认 900 → 2000，并在正文为空时从推理块兜底解析 JSON（审计记录 `parseSource: "reasoning"`）。
- 新增 1 条回归测试（总计 87 条）

## [0.2.0-alpha.3] - 2026-10-18

### Added
- **真实组装测试层** `test/compose/`：挂载真实 LLM / session / projection / system-prompt / tools / agent 服务与真实 AgentLoop，只把模型边界换成 `llm/stream` 脚本流（官方 `docs/testing.md` 对用户可见插件要求的 non-unit REAL-composition 层）
  - 断言治理协议进入真实组装后的模型请求
  - 断言 `agent/turn-stopping` 在真实回合收口触发、评审调用走真实 `ctx.llm.stream`、证据包含双层目标账本
  - 断言审计 JSONL 落盘字段（`outcome` / `verdict` / `parseSource` / `goalChange` / `goals`）
  - 断言 drift 裁决经真实 `agent.steer()` 进入 session 日志，并出现在执行者下一次真实模型请求中
- `test-support/compose-mount.mjs`：按官方 testkit 同拓扑内联的服务挂载助手。官方 `@deepseek-ai/dsh-agent-loop-testkit@0.2.0-rc.2` 存在发布缺陷——静态 import 了未发布、也未声明的 `@deepseek-ai/dsh-working-directory@0.2.0-rc.2`，第三方无法安装
- `docs/testing.md`：四层测试策略、mock 边界原则、CI 注意事项与后续缺口
- `npm run test:compose` 脚本

### Changed
- CI 安装改为 `npm ci`（**不能**带 `--legacy-peer-deps`：真实服务包以 peer 依赖形式安装；已实际踩坑）
- devDependencies 版本锁定到宿主同代 `0.2.0-rc.2`
- 测试总数 89（L1 纯函数 77 + L2 假上下文 10 + L3 真实组装 2）

## [0.2.0-alpha.4] - 2026-10-18

### Added
- **逐字引用闸门**：`redirected`（改写最终目标）必须由评审员逐字引用用户原话（≥12 字符，去空白/标点匹配），否则拒绝改写、不发声、审计记 `outcome: "guarded"`。证据侧注入无法伪造用户没说过的话。
- **对抗性测试层** `test/redteam/`（30 条）：契约攻击、证据包注入、结构性边界（静态证明评审员无工具/无网络/无子进程、只有审计模块可写文件、guard 先于 apply、全仓库单一 steer 调用点）
- 真实组装层新增红线用例：真实回合中伪造的最终目标重定向被拦住，账本 `finalGoal` 不变、不发声
- `clampText` 剥离 C0/C1 控制字符，防止模型输出向审计 JSONL 或 steer 消息注入换行/终端控制
- 理论登记新增机制 `redirect-corroboration`（变更控制 + 委托—代理 + 契约理论），`docs/theory.md` 重新生成

### Changed
- CI 的 Node 20 lane 自动跳过真实组装层（宿主服务包需要 Node ≥22 的 `Promise.withResolvers`）；插件本身仍声明 `engines.node >= 20`
- 测试总数 120（纯函数/契约 74 + 对抗性 30 + 假上下文 13 + 真实组装 3）

## [0.2.0-alpha.6] - 2026-10-18

### Added
- **治理实例的生命周期语义**（任免与交接）：插件宿主会热重载、禁用、关机，重复的 bundle 配置还可能挂载两次。这些现在被当作治理语义实现，而不是部署细节：
  - 卸载时按"先失能、后注销"执行：`disposed` 门禁置位 → `abort()` 在飞评审调用 → 移除 `agent/turn-stopping` / `agent/disposed` 监听器与治理提示词段 → 清空会话状态；
  - **退役的评审员不再发声**：卸载后到达的裁决既不 `steer` 也不写审计；
  - **重复挂载被拒绝**：提示词段名就是单例锁，第二个实例捕获注册异常后放弃安装（fail-open，记 `installation skipped` 日志），不会出现双评审；
  - **重载即新任期**：重新挂载后协议与回合边界评审都恢复，会话状态从头建立；
  - 安装期任何异常都不阻断宿主（fail-open）。
- **L2 生命周期测试** `test/mock/lifecycle.test.mjs`（6 条）：销毁清理、重复挂载拒绝 + 卸载后重装、安装失败 fail-open、卸载中止在飞调用并丢弃裁决、重载后重新治理、agent 销毁后节奏状态清零。fake ctx 实现了 cordis effect 语义（收集、逆序销毁、安装失败回滚）与同名 section 拒绝。
- **L3 生命周期测试** `test/compose/lifecycle.compose.test.mjs`（3 条）：真实注册表下的卸载/重载、真实双挂载只审一次、真实在飞退役（无 plugin 消息、无审计记录）。
- 理论登记新增机制 `lifecycle-revocation`（委托—代理 + RACI + 三道防线），`docs/theory.md` 重新生成。
- 设计文档新增 §5.3「任免与交接：治理角色也有任期」，架构文档新增 §11「生命周期」。

### Changed
- 测试总数 133（纯函数/契约 74 + 对抗性 30 + 假上下文 23 + 真实组装 6）。
- 架构文档的成本估算与测试计数对齐当前默认值（`maxReviewTokens: 2000`）。

## [0.2.0-alpha.5] - 2026-10-18

### Changed
- **重定向佐证源收紧**：`redirected` 的逐字引用只能来自**开场指令之后**的用户消息。开场指令不能佐证一次"变化"——拿最初目标原文来证明目标被改过在逻辑上不可能。
- 新增 4 条假上下文用例：开场白佐证重定向 → `guarded`；后续消息佐证 → 账本 revision +1；审计 schema 快照锁定；审计不可写时 fail-open。
- 测试总数 124（纯函数/契约 74 + 对抗性 30 + 假上下文 17 + 真实组装 3）。

## [Unreleased]

### Planned
- 宪章持久化到工作区 `.dsh/goal-steward/charter.md`，并提供宪章读写工具
- Web UI：会话内治理状态胶囊（在轨/存疑/偏离）+ 审计流水面板
- 高风险任务升级为真子代理 Reviewer（具备日志/文件调查权）
- 多模型隔离（`reviewProvider` / `reviewModel`）

## [0.1.0-alpha.1] - 2026-10-18

### Added
- 常驻系统提示治理协议（`lib/prompt.js`），order 700，位于 team policy 与 tool docs 之间
- `agent/turn-stopping` 回合边界审计：首次 / 每 N 轮 / 强制间隔 / 目标变更触发
- 证据包构造（`lib/evidence.js`）：宪章、用户原话、最终输出、工具调用摘要、历史结论；含字符预算收缩
- 角色隔离的 Reviewer 调用（`lib/reviewer.js`）：独立 system prompt、temperature 0、无工具、继承或指定路由
- 严格裁决校验（`lib/parse.js`）：宽容提取 JSON、verdict/severity 一致性、drift 必须有 taxonomy + 证据 + 指令
- 管理例外式的升级阶梯（`lib/cadence.js`）：默认沉默、严重度门槛、每回合/每会话说话预算
- 分级 steer（L2 纠偏 / L3 要求停下来问用户），以 `source.kind = plugin` 注入
- JSONL 审计流水（`lib/audit.js`），默认 `$DSH_HOME/goal-steward/audit.jsonl`
- 三档预设 `gentle` / `standard` / `strict`，非法配置降级不抛错（`lib/config.js`）
- fail-open：任何评审失败都不影响回合正常关闭
- 40 个纯函数单元测试与语法检查脚本
- 设计文档（管理学依据）与架构文档
