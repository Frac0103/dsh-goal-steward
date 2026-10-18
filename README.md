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

设计论证见 **[docs/design.md](./docs/design.md)**，理论登记表见 **[docs/theory.md](./docs/theory.md)**，技术实现见 **[docs/architecture.md](./docs/architecture.md)**。

## 理论支撑（Theory）

这个项目不是拍脑袋的 prompt 工程：它把管理学里经过组织实践检验的控制模型，逐条翻译成 agent 运行时机制。**理论登记在代码里**（[`lib/theory.js`](./lib/theory.js)），理论文档由代码生成（[`docs/theory.md`](./docs/theory.md)），CI 强制追溯完整性——一条运行时机制没有理论依据、或一条引用没有落成机制，测试直接失败。

| 管理学模型 | 落成的机制 |
|---|---|
| **X/Y 理论**（麦格雷戈 1960） | 非对称姿态：对执行者用 Y 理论（不干预方法），对审查者用 X 理论（默认沉默/预算化/必须举证） |
| **有限理性 / 满意即止**（西蒙 1947） | 解释 AI 为什么会漂移；审计补的是全局视角，不是质疑能力 |
| **目标置换**（默顿 1949） | 六类偏离分类法中的 `goal_substitution` |
| **MBO · OKR · SMART**（德鲁克/格鲁夫/多兰） | 三层目标宪章 + 可验证的成功判据 |
| **PDCA + 前馈/同期/反馈控制**（戴明/维纳） | 首轮建章 → 执行期沉默 → 强制间隔审计 → 交付前验收 |
| **例外管理原则**（泰勒以降） | 默认沉默；只在显式触发点评审；发声预算 |
| **COSO 三道防线** | 自检（第一道）→ 独立评审（第二道）→ 用户裁决（第三道） |
| **RACI**（PMI） | 方法选择的 Reviewer 只有 `I`（仅知情），结构上禁止微观管理 |
| **变更控制 / CCB**（PMI） | 稳定层变更必须走宪章更新，禁止静默换目标 |
| **审计独立性**（IIA） | 信息 / 程序 / 时点 / 激励四重隔离 |
| **监管俘获**（斯蒂格勒 1971） | 防止评审员退化成橡皮图章 |
| **古德哈特定律**（1975） | 防代理指标优化；通过率不是评审员指标 |
| **承诺升级**（斯托 1976） | 用历史结论识别"明知失败还加速" |
| **委托—代理问题**（詹森/麦克林 1976） | 诚实汇报规范 + 可复盘的审计流水 |
| **任务式指挥 / Auftragstaktik** | 给意图不给步骤：执行者拥有路线选择权 |
| **契约理论**（科斯/威廉姆森） | 把硬约束写成条款而非礼貌，防止约束衰减 |

完整推导（每条理论的落地方式、**类比的失效边界**、以及**如何证伪这套设计**）见 [`docs/theory.md`](./docs/theory.md)。

## 双层目标模型：最终目标 vs 当前目标

一个"目标"其实混了两个控制对象。本插件把它们分开记账：

| 层 | 定义 | 谁能改 | 变化是否合法 |
|---|---|---|---|
| **最终目标**（final） | 委托人的终局目标 | 只有用户显式改口 | 不能悄悄换 |
| **当前目标**（current） | 当前阶段正在做的事 | Reviewer 按对话演进并记入账本 | 本来就该随阶段推进而变 |

每次审计，Reviewer 会给观察到的目标变更打上五类标签之一：

| 标签 | 含义 | 对账本的影响 |
|---|---|---|
| `none` | 没变，工作服务于已记录目标 | 不改 |
| `refined` | 用户或证据细化了当前目标（最终目标不变） | 写当前目标 |
| `phase_advance` | 当前阶段完成，合法进入下一阶段 | 写当前目标 |
| `redirected` | 用户**显式**改变了最终目标 | 写最终目标（须引用用户原话） |
| `silent_substitution` | 执行者悄悄换目标，或当前目标不再服务最终目标 | **不改账本**，判为偏离并纠偏 |

这样"根据对话调整目标"和"防止目标漂移"不再矛盾：**演进被允许并被记录，替换被发现并被拦下**。账本带 revision 与历史，审计流水里能看到 `final` / `current` / `goalChange`。

## 用户主权：`/steward` 命令

否决权不等于主权。评审员改写最终目标必须逐字引用你的原话，但**你自己**也需要一个直接写目标的入口——`/steward` 就是这个人机通道：命令由宿主直接执行，**不产生模型消息**，执行者没有机会插话，评审员也看不到请求。

```text
/steward                    # 查看最终目标 / 当前目标 / 成功判据 / revision / 最近发现 / 审计文件
/steward goal <新的最终目标>  # 由你直接设定最终目标（账本 revision +1，写入审计）
/steward why                # 看评审员最近报过什么（最近 5 条结论）
```

命令结果由 UI 渲染在会话之外；UI-less 宿主没有命令注册表时，这个通道自动缺席，评审员照常工作。详见 [docs/design.md §5.5](./docs/design.md) 与 [docs/architecture.md §12](./docs/architecture.md)。

## 安装

> 当前为源码阶段，尚未发布 npm 包；用**本地路径 / tarball / git 地址**安装。

```bash
# 在 DSH profile 中，三种来源任选其一
dsh plugin add "file:D:/project/dsh-goal-steward"
dsh plugin add "https://github.com/Frac0103/dsh-goal-steward/releases/latest/download/dsh-goal-steward.tgz"
dsh plugin add "github:Frac0103/dsh-goal-steward"
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

`0.2.0-alpha.8` — 早期版本，接口与提示词仍会变。当前已实现：常驻治理协议、回合边界审计、证据包、严格裁决校验、分级 steer、审计流水、三档预设、**双层目标账本（final / current）与目标变更分类**、**最终目标重定向的逐字引用闸门**、**可卸载/可重载的治理实例（退役不发声、重复挂载只审一次）**、**审计流水回放继承（换届不换账）**、**`/steward` 用户主权命令通道（status / goal / why）**、**197 个测试（纯函数 + 对抗性 + 假上下文 + 真实组装）与覆盖率门禁**。

路线图见 [docs/design.md#12-已知局限与路线图](./docs/design.md#12-已知局限与路线图)：
Web UI 治理胶囊 → 真子代理调查 → 多模型隔离与组织级治理。

## 开发

```bash
npm ci            # 需要 devDependencies（真实宿主服务包，用于真实组装测试）
npm run check     # 每个 lib/*.js 用 node --check 解析
npm test          # 197 个测试：纯函数 122 + 对抗性 30 + 假上下文 37 + 真实组装 8
npm run test:redteam  # 只跑对抗性测试（契约攻击 / 证据注入 / 结构性边界）
npm run test:compose  # 只跑真实组装层（真实服务 + 真实 AgentLoop，脚本化模型边界）
npm run test:coverage # 覆盖率报告（Node 22+ CI 用 line 99 / branch 85 / function 95 门禁）
npm run verify    # check + test
```

测试分四层（L1 纯函数 / L2 假上下文 / L3 真实组装 / L4 实机），设计依据与后续缺口见 [docs/testing.md](./docs/testing.md)。

欢迎 issue 与 PR，尤其是：不同管理模型的映射论证、证据包字段的取舍、Reviewer 提示词的对抗性测试。

## 许可

[MIT](./LICENSE) © 2026 Jiahao Ma
