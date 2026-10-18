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

## [0.2.0-alpha.10] - 2026-10-18

### Fixed
- release workflow 上传的资产名带版本号（`dsh-goal-steward-0.2.0-alpha.N.tgz`），导致 README 中版本无关的安装 URL（`.../releases/download/<tag>/dsh-goal-steward.tgz`）404。workflow 现在固定以 `dsh-goal-steward.tgz` 上传；alpha.9 的资产已回填为稳定名并验证下载。
- 安装文档中的 `releases/latest`（GitHub 会排除 prerelease）改为显式 tag URL。

### Verified
- **发布资产安装路径端到端验证**：全新 headless profile 执行 `dsh plugin --profile <name> add <release URL>` → 资产下载安装、`dsh.profile.bundles` 自动追加、composed config 出现 `dsh-goal-steward` 行。记录见 `docs/verification/l4-headless-dogfood.md` 附录。

## [0.2.0-alpha.9] - 2026-10-18

### Added
- **L4 实机验证（真实宿主 + 真实模型）**：用 headless profile 安装**发布 tarball**，真实 `deepseek-official/deepseek-flash` 完成一次完整审计闭环（真实加载路径、路由继承、证据包、解析、审计落盘、默认沉默），延迟约 1.4 s。记录见 `docs/verification/l4-headless-dogfood.md`（含审计原文与复现步骤）。
- **发布流水线** `.github/workflows/release.yml`：推送 `v*` tag → `npm pack` → 从 CHANGELOG 生成 release notes → 上传 `dsh-goal-steward.tgz` 资产。`v0.2.0-alpha.8` 的资产已补传并验证可下载。
- **文档链接门禁** `scripts/check-docs.mjs`：9 个 markdown 文件的相对链接与锚点（含生成文档的显式 `<a id>` 锚点）全部校验，纳入 `npm run verify` 与 CI。
- `scripts/release-notes.mjs`：从 CHANGELOG 提取某个 tag 的发布说明。
- README 徽章；Desktop / CLI / 手工三种安装路径按真实 CLI 语法重写（Desktop profile 由桌面进程管理，npm CLI 会拒绝操作，需用桌面插件管理器）。

### Changed
- 安装文档不再使用 `releases/latest` 链接（GitHub 的 latest 会排除 prerelease）；改为显式 tag URL。
- `npm run verify` = 语法检查 + 文档链接门禁 + 全部测试。

### Verified
- 197 个测试全绿；覆盖率 line 99.62% / branch 91.69% / function 100%（Node 24）。
- 发布 tarball 通过 `dsh plugin --profile <scratch> add file:...tgz` 安装并从真实 Host 启动成功。

## [0.2.0-alpha.8] - 2026-10-18

### Added
- **`/steward` 用户主权命令通道**（宿主存在 `commands` 服务时自动安装，UI-less 宿主自动缺席）：
  - `/steward` · `/steward status`：最终目标 / 当前目标 / 成功判据 / 硬约束 / revision / 本实例评审与发声次数 / 最近发现 / 审计文件位置；
  - `/steward goal <新目标>`：由用户直接设定最终目标（revision +1、当前目标同步重置），写入 `event: "command"`、`trigger: "principal-command"` 的审计记录；
  - `/steward why`：最近 5 条评审结论；
  - 命令不产生模型消息、`recordInput: false`、永不抛错、`ctx.inject(['commands'])` 迟到绑定、卸载即注销；目标文本走与评审员相同的归一化（长度 / 控制字符 / 列表上限）。
- **覆盖率门禁**：Node 22/24 CI lane 用 `--test-coverage-lines=99 --test-coverage-branches=90 --test-coverage-functions=99` 跑测试；新增 `npm run test:coverage`。
- **防御性路径测试层** `test/robustness.test.mjs`（12 条）：抛错的会话日志 / surface / requestHeader / goal 服务、stream 缺 finish / provider error / aborted、severity 3 steer 形状等。
- 理论登记新增机制 `principal-command-channel`（委托—代理 + RACI + 变更控制），`docs/theory.md` 重新生成。
- 设计文档新增 §5.5「用户主权：给委托人一个直接入口」，架构文档新增 §12「命令面：/steward」。

### Changed
- 测试总数 **197**（纯函数/契约 122 + 对抗性 30 + 假上下文 37 + 真实组装 8），覆盖率 99.62% line / 91.39% branch / 100% function。
- devDependencies 增加 `@deepseek-ai/dsh-commands@0.2.0-rc.2`（真实组装层挂载生产 CommandsRuntime）。
- `npm run test:compose` 覆盖三个真实组装套件。

## [0.2.0-alpha.7] - 2026-10-18

### Added
- **换届不换账：新实例从审计流水回放继承会话档案**。在此之前，重载/重启后的评审员会把宪章重新锚定到开场指令——用户中途做过的合法重定向会悄悄回滚，工作被拿旧目标审判。现在：
  - 审计记录 `goals` 改为**完整快照**（`final` / `current` 目标对象，含成功判据、约束、非目标），账本可被原样重建；
  - `lib/audit.js` 新增只读 `readAuditRecords(config, sessionId)`：按会话过滤、坏行跳过、文件缺失返回空，全部 fail-open；
  - 新模块 `lib/restore.js`（纯函数）：取最后一份非空账本快照 + 最近 5 条历史结论；兼容旧格式（只有 `finalGoal` / `currentGoal` 字符串）的记录；
  - 继承是**部分的**：账本与历史结论继承，`reviews` / `steers` / `lastReviewTurn` **不继承**——账本是机构档案，预算是一个任期的运营额度，新任期重新建立节奏；
  - 无审计流水（`audit: false`）时无从回放，行为退回按开场指令重新锚定。
- 理论登记新增机制 `ledger-inheritance`（契约理论 + 审计独立性 + 委托—代理），`docs/theory.md` 重新生成。
- 设计文档新增 §5.4「换届不换账：审计流水作为机构记忆」，架构文档新增 §11.1「回放」。
- 测试新增 12 条：`test/restore.test.mjs` 10 条回放契约、假上下文 2 条（重载继承 + 审计关闭重新锚定）、真实组装 1 条（真实注册表下继承）。

### Changed
- **审计 schema 变更**：`goals.finalGoal` / `goals.currentGoal` 两个字符串字段被 `goals.final` / `goals.current` 完整目标对象取代。消费审计流水的脚本需要同步；回放模块两种格式都认，升级不丢历史。
- 测试总数 145（纯函数/契约 84 + 对抗性 30 + 假上下文 24 + 真实组装 7）。

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
