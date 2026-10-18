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
