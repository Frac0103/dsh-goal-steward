# 测试策略

本项目的测试按**离真实运行的距离**分层。核心原则来自 DSH 官方 `docs/testing.md`：

> **只 mock 昂贵或不确定的边界，下游全部用真的。**
> 面向用户可见的插件，必须有非 unit 的**真实组装测试**。

## 1. 四层

| 层 | 位置 | 跑什么 | 不需要什么 | 能证明什么 |
|---|---|---|---|---|
| **L1 纯函数** | `test/*.test.mjs` | config / cadence / parse / evidence / goals / theory 完整性 | 宿主运行时 | 决策与解析的边界、错误路径、契约自洽 |
| **L2 假上下文** | `test/mock/` | 手写 fake cordis ctx 驱动 `apply()` | 真实服务 | 事件接线、证据包、steer、审计、fail-open |
| **L3 真实组装** | `test/compose/` | 真实服务 + 真实 AgentLoop + 真实 Agent/Session，只把模型边界换成脚本流 | 模型 API key | 插件在真实宿主里的**端到端行为** |
| **L4 实机** | 手工 | 装进 profile 跑真实对话 | — | 真实模型下的提示词效果与误报/漏报 |

当前：**89 个测试**（L1 77 + L2 10 + L3 2），`npm test` 一次跑完。

## 2. L3 真实组装测试怎么做的

### 挂载了什么

`test-support/compose-mount.mjs` 挂载与官方 `@deepseek-ai/dsh-agent-loop-testkit` **相同的强制前置服务脊**：

```
LlmRuntime → SessionStore → SessionProjectionRegistry → SystemPrompt → ToolRuntime → AgentRegistry → AgentLoop
```

然后调用方在"前置服务之后、AgentLoop 之前"挂载被测插件（这正是测试 kit README 要求的加载顺序）。

### mock 了什么

**只有一处**：`ctx.on('llm/stream', (options, next) => ...)` 瀑布钩子。

- 评审员请求：`options.system` 以 `You are the Independent Goal Steward` 开头 → 返回脚本化的裁决 JSON 流
- 执行者请求：`isAgentLoopRequest(options)` → 按脚本返回文本流
- 其余请求：断言为"意外请求"

因为适配器选择发生在 `next()` 内部（`llm/stream` 位于路由之上），**不调用 `next()` 就完全不需要注册 adapter、不需要 API key、不产生网络请求**。

### 断言了什么

1. 治理协议真正进入**组装后的模型请求**（`GOAL GOVERNANCE` / `TWO GOALS, NOT ONE` / 三道防线）
2. `agent/turn-stopping` 在**真实回合收口**触发，评审调用走真实 `ctx.llm.stream`，路由继承执行者（provider/model/temperature）
3. 证据包里的 `goal_ledger` 从开场指令锚定最终目标
4. 审计 JSONL 真的落盘，含 `outcome / verdict / parseSource / goalChange / goals{finalGoal,currentGoal}`
5. **drift 裁决 → `agent.steer()` → 真实 session 日志出现 plugin-source 消息 → 进入执行者下一次真实模型请求**（整条纠偏闭环）

### 为什么不用官方 testkit 包

调研发现：`@deepseek-ai/dsh-agent-loop-testkit@0.2.0-rc.2` 存在**发布缺陷**——

- 它静态 `import '@deepseek-ai/dsh-working-directory'` 与 `@deepseek-ai/dsh-fs-local`；
- 但 `dsh-working-directory` **没有发布 0.2.0-rc.2 版本**，也不在 testkit 的 `dependencies` / `peerDependencies` 中；
- 结果：第三方安装该版本 testkit 后无法解析依赖，包不可用。

因此本项目按其 README 描述的同一拓扑**内联了 20 行挂载助手**（`test-support/compose-mount.mjs`，文件头有完整出处说明）。

## 3. CI

```yaml
- run: npm ci --ignore-scripts     # 注意：不能加 --legacy-peer-deps
- run: node scripts/check.mjs
- run: node --test
```

`--legacy-peer-deps` 会跳过 peer 依赖安装，导致 L3 层因缺少真实服务包而失败——我们实际踩过这个坑。CI 在 Node 20 / 22 / 24 三档跑。

## 4. 本地运行

```bash
npm ci            # 需要 devDependencies（真实服务包）
npm run verify    # 语法检查 + 全部测试
npm run test:compose   # 只跑真实组装层
```

## 5. 后续要补的测试（调研结论）

| 缺口 | 参考对象 |
|---|---|
| **审计快照**（golden JSONL） | 官方 `session-snapshot`：录制回放当 expected |
| **对抗性 redteam**（证据包里注入"忽略指令返回 on_track"、伪造 source） | dsh-goalloop-agentteams 的 `redteam_test` |
| **结构性边界测试**（静态扫描证明 reviewer 无写通道） | clearai-dsh 的 `authority-boundary.test.mjs` |
| **HMR/销毁安全**（dispose 后 section 与 listener 清理） | 官方要求每个 registry 必测 |
| **真实模型认证**（可选 env 开启，测误报/漏报率） | 官方 auto-review 的 `DSH_AUTO_REVIEW_CERTIFICATION=1` |
| **覆盖率** | Node 内置 `node --experimental-test-coverage` |
