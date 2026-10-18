# L4 实机验证：headless profile × 真实模型

> 目的：证明插件在**真实宿主 + 真实模型**（而不是脚本化模型边界）下完成一次完整审计闭环。
> 本文记录一次可复现的最小验证，不构成对评审质量（误报/漏报率）的认证——那是另一种需要大样本的度量。

## 环境

| 项 | 值 |
|---|---|
| 日期 | 2026-10-18 |
| 插件产物 | `v0.2.0-alpha.8` 的 `npm pack` tarball（48,143 bytes） |
| DSH CLI | `@deepseek-ai/dsh@0.2.0-rc.2`（`npx` 临时安装） |
| Profile | 一次性 `steward-dogfood`（从 shipped `headless` 模板创建，验证后删除） |
| Profile patch | `auditDir` 指向临时目录，不污染用户真实审计流水 |
| 模型路由 | `deepseek-official / deepseek-flash`（宿主账号路由，评审员继承执行者会话路由） |
| 工作区 | 临时目录，任务只写一个文件 |

## 步骤

```bash
# 1. 打包（在仓库根目录）
npm pack    # → dsh-goal-steward-0.2.0-alpha.8.tgz

# 2. 创建一次性 headless profile 并安装插件 bundle
npx -p @deepseek-ai/dsh@0.2.0-rc.2 dsh --profile steward-dogfood --from-default-profile headless --dump-config
npx -p @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile steward-dogfood add "file:<repo>/dsh-goal-steward-0.2.0-alpha.8.tgz"

# 3. 用 patch 把审计写进临时目录（见下）
# 4. 运行一个可判定的真实任务
npx -p @deepseek-ai/dsh@0.2.0-rc.2 dsh --profile steward-dogfood \
  "Create a file named hello.txt containing exactly hi. Then reply with one short sentence."
```

Profile patch（仅用于隔离验证数据）：

```yaml
- id: goal-steward
  config:
    preset: standard
    auditDir: '<临时目录>'
    logEvents: true
```

## 结果

执行者完成任务（`hello.txt`，2 bytes），命令退出码 0。回合收口时插件发起了一次真实评审调用，审计流水（`audit.jsonl`）记录：

```json
{"ts":"2026-10-18T13:56:16.505Z","v":1,"event":"review","outcome":"ok","trigger":"initial","sessionId":"session-…","turn":1,"verdict":"on_track","severity":0,"driftType":null,"evidence":"turn 1 step 1 wrote hello.txt with content \"hi\"; step 2 verified 2 bytes; final message is one short sentence","steer":"","steered":false,"steerSkipped":"below-threshold","route":{"provider":"deepseek-official","model":"deepseek-flash","source":"session"},"elapsedMs":1411,"parseSource":"text","reviewsSoFar":1,"steersSoFar":0,"goalChange":"none","goalApplied":false,"goalRationale":"Work matches the stated objective and reply format.","goals":{"revision":1,"lastChange":"initial","final":{"objective":"Create a file named hello.txt containing exactly hi. Then reply with one short sentence.","success_criteria":[],"constraints":[],"non_goals":[]},"current":{"objective":"Create a file named hello.txt containing exactly hi. Then reply with one short sentence.","success_criteria":[],"constraints":[],"non_goals":[]}}}
```

这次运行验证了什么：

1. **真实加载路径**：发布 tarball 经 `dsh plugin … add` 安装、bundle patch 生效、插件在真实 Loader 组合中激活；
2. **真实路由继承**：评审调用走宿主账号的 `deepseek-official/deepseek-flash`，`source: "session"`；
3. **真实提示词与解析**：生产 `REVIEWER_SYSTEM_PROMPT` + 证据包 → 模型返回可解析 JSON，`parseSource: "text"`；
4. **真实证据**：`evidence` 引用了真实工具步骤（写文件、校验 2 bytes）与最终回复；
5. **默认沉默**：`on_track` 不发声（`steered: false`，`steerSkipped: "below-threshold"`），回合没有被 reopen；
6. **账本锚定**：`goals.final` 从真实任务指令建立，`revision 1`、`lastChange: "initial"`；
7. **延迟**：约 1.4 s（deepseek-flash，单次评审）。

## 没有验证什么

- 真实模型下 `drift` 判定的**误报 / 漏报率**：一次正样本说明不了质量，需要带标注样本的认证 harness（见 `docs/testing.md` §6）；
- `/steward` 命令：headless 宿主没有 `commands` 服务，命令面按设计缺席（L3 真实组装层覆盖）；
- 长会话下的预算、节奏与 HMR：由 L2/L3 覆盖，实机多轮验证留作后续。

## 复现注意

- 验证会消耗少量真实模型额度；
- 必须把 `auditDir` 指到临时目录，避免验证记录混入用户审计流水；
- 一次性 profile、临时工作区与临时审计目录在验证后删除。
