# 路线图

版本目标是**每一步都能独立交付价值，且随时可回滚**。

## 0.1 — 目标治理层骨架（当前）

- 常驻系统提示治理协议（第一道防线）
- 回合边界独立评审（第二道防线）
- 三层目标宪章（稳定层 / 战役层 / 战术层）
- 六类偏离分类 + 五级升级阶梯
- 严格裁决校验（举证、taxonomy、severity 一致性）
- 管理例外式节奏 + 发声预算
- JSONL 审计流水
- 三档预设，fail-open
- 理论登记表与自动生成的理论文档（`lib/theory.js` → `docs/theory.md`）

## 0.2 — 双层目标账本、持久化与变更控制

- ✅ 双层目标模型：final（最终目标）/ current（当前目标）分开记账，带 revision 与历史（已完成）
- ✅ 目标变更分类：refined / phase_advance / redirected / silent_substitution（已完成）
- ✅ 审计记录带完整宪章快照 + 跨实例回放：重载/重启后的新实例从审计流水继承账本与历史结论，评审计数另起（已完成，见 design §5.4 / architecture §11.1）
- 宪章落盘：工作区 `.dsh/goal-steward/goals.json`（用户可读、可改、可版本控制）
- 宪章变更控制工具：`steward_charter`（读 / 提议 / 确认三段式）
- 跨会话继承：同一工作区的宪章可被新会话复用

对应理论条目：`change-control`、`contract-theory`、`mbo`。

## 0.3 — 可视化与人工监督

- ✅ `/steward` 命令面：`status` / `goal <目标>` / `why`，用户主权命令通道 + 文本版治理状态（已完成，见 architecture §12）
- ✅ L4 正样本实机验证：headless profile + 真实模型完成一次审计闭环（记录见 [verification/l4-headless-dogfood.md](./verification/l4-headless-dogfood.md)）
- 会话内"治理状态胶囊"：在轨（绿）/ 存疑（黄）/ 偏离（红）
- 点击展开审计流水与本次评审证据包
- 设置页：三档预设切换、预算调整、评审模型选择

## 0.4 — 真子代理 Reviewer（调查权）

- 高风险任务或交付前评审时，升级为独立子代理
- 具备只读调查工具（读会话日志、读宪章、查工作区文件）
- 仍然禁止写操作与方法指令；结论必须落到证据

对应理论条目：`audit-independence`（信息隔离在"有调查权"与"不越权"之间重新平衡）。

## 0.5 — 组织级治理

- 对 Agent Team 的每个 teammate 建立各自的 Reviewer
- 团队级宪章：Lead 的意图成为 teammate 的稳定层
- 跨 agent 的偏离汇总：谁在偏离、偏离如何传播

对应理论条目：`three-lines`、`commanders-intent`、`principal-agent`。

## 非目标（明确不做）

- 不做"代码质量评审"（那是另一类插件的事）
- 不做"完成声明硬门禁"（与完成验证类插件职责重叠）
- 不做"每一步都审查"的默认配置（那会违背管理例外与非阻塞设计）
