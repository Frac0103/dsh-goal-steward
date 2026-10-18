# dsh-goal-steward

> 给每个对话常设一位**独立的目标评审员**：它确认任务的终极目标，审计推进过程中的目标偏离，但**不限制任务推进**。

**English:** An independent goal-governance layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Every conversation gets a standing goal charter plus a role-isolated reviewer that audits stable-layer alignment at turn boundaries. The reviewer has no tools, no authority over method, and defaults to silence — it steers the executor only when it can cite evidence of drift. The design is derived from management science (MBO, PDCA, management-by-exception, COSO three-lines, RACI, change control) rather than ad-hoc prompt engineering. See [docs/design.md](./docs/design.md).

---

## 它解决什么问题

AI 执行任务时最贵的失败不是"做错了"，而是"**做完了才发现做的不是用户要的**"。这类失败有七种形态：

| 形态 | 例子 |
|---|---|
| 目标替换 | 用户要"能设置成功"，AI 在优化"代码写得多" |
| 范围蔓延 | 需求越加越多，交付边界失守 |
| 过早收敛 | 目标没确认就开工 |
| 代理指标优化 | 测试数在涨，但被要求的功能没前进 |
| 约束遗忘 | 多轮后忘了用户早先说的"不要动那个文件" |
| 承诺升级 | 明知路线失败，因沉没成本继续加速 |
| 汇报美化 | 把"做过"说成"做成" |

常见的"AI 审查"插件审的是**输出质量**或**完成声明是否属实**；本插件审的是**过程级的目标对齐**——任务进行到一半就发现跑偏。

## 两层机制

```
第一层（零成本，每轮生效）
  常驻系统提示：目标宪章 + 自检三问 + 六类偏离 + 升级规则
  → 执行者自己的"第一道防线"

第二层（管理例外，按节奏触发）
  回合边界 → 证据包 → 独立 Reviewer（角色隔离/信息隔离/程序隔离/时点隔离）
           → 严格 JSON 裁决 → L0 记录 / L1 标注 / L2 质询 / L3 暂停升级
  → 默认沉默；只有能举证的偏离才发声
```

**为什么它不会限制推进**：

- 只审**稳定层**（目标 / 成功判据 / 硬约束 / 非目标），方法层完全不看；
- L1/L2 只往 inbox 注入一条消息，**不阻塞**主流程；
- 每轮最多 1 次评审、每回合最多 2 次说话、有会话总预算；
- 无证据的判定直接作废（宁可漏报，不可误报）；
- 执行者可以反驳，争议升级给用户。

设计依据（管理学模型逐条对应）见 **[docs/design.md](./docs/design.md)**；技术实现见 **[docs/architecture.md](./docs/architecture.md)**。

## 安装

> 当前为源码阶段，尚未发布 npm 包；用**本地路径 / tarball / git 地址**安装。

```bash
# 在 DSH profile 中，三种来源任选其一
dsh plugin add "file:D:/project/dsh-goal-steward"
dsh plugin add "https://github.com/17620395967/dsh-goal-steward/releases/latest/download/dsh-goal-steward.tgz"
dsh plugin add "github:17620395967/dsh-goal-steward"
```

或手工挂载：把仓库放进 profile 的 `node_modules`，并在 profile `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: goal-steward
      name: 'dsh-goal-steward'
      config:
        preset: standard
```

零配置即可运行：默认 `standard` 档。

## 配置

三档预设，也可逐项覆盖：

| 档位 | 审计频率 | 说话门槛 | 适合 |
|---|---|---|---|
| `gentle` | 只在目标变更时 | 仅 L3 | 几乎零打扰 |
| `standard`（默认） | 首轮 + 每 3 轮 + 强制间隔 6 | L2 | 平衡 |
| `strict` | 每轮 | L1 | 高风险/长链路任务 |

```yaml
- insert:
    - id: goal-steward
      name: 'dsh-goal-steward'
      config:
        preset: standard
        reviewEveryTurns: 3
        steerSeverity: 2
        maxSteersPerSession: 12
        # reviewProvider: other-provider
        # reviewModel: other-model
```

完整配置表见 [docs/architecture.md#9-配置](./docs/architecture.md#9-配置)。

## 审计与复盘

每一次评审（包括跳过与失败）都会写一行 JSONL：

```
$DSH_HOME/goal-steward/audit.jsonl
```

你可以复盘"它报过什么、为什么没报、有没有该报没报"。

## 与其他插件的关系

| 类型 | 代表 | 本插件的位置 |
|---|---|---|
| 答案质量审查 | dsh-answer-reviewer、dsh-quality-review | 互补：它管"答得好不好"，我们管"是不是在做对的事" |
| 完成声明验证 | dsh-gungnir、dsh-goalloop-agentteams | 互补：它管"结果真不真"，我们管"过程对不对" |
| 顾问/第二意见 | dsh-advisor-flow、dsh-advisor-plugin | 不同：那是"咨询"，我们是"审计" |
| 推理措辞漂移 | dsh-anchored-monitor | 不同：启发式 vs 目标语义 |

一句话：**它们是质检员，我们是独立董事。**

## 状态

`0.1.0-alpha.1` — 早期版本，接口与提示词仍会变。当前已实现：常驻治理协议、回合边界审计、证据包、严格裁决校验、分级 steer、审计流水、三档预设、40 个单元测试。

路线图见 [docs/design.md#12-已知局限与路线图](./docs/design.md#12-已知局限与路线图)：
0.2 宪章持久化 → 0.3 Web UI 治理胶囊 → 0.4 真子代理调查 → 0.5 多模型隔离与组织级治理。

## 开发

```bash
npm run check   # 每个 lib/*.js 用 node --check 解析
npm test        # 40 个纯函数单元测试（无需宿主）
npm run verify  # 两者
```

欢迎 issue 与 PR，尤其是：不同管理模型的映射论证、证据包字段的取舍、Reviewer 提示词的对抗性测试。

## 许可

[MIT](./LICENSE) © 2026 Jiahao Ma
