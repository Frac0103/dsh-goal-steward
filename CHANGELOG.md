# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

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
