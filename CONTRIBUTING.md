# Contributing

欢迎参与 `dsh-goal-steward`。这个项目的核心不是代码量，而是**设计论证**是否站得住：

1. 每一条治理规则都应该能回答："它对应哪个失败模式？来自哪个管理学模型？成本是多少？"
2. 如果一条规则只会增加打扰而不降低偏离率，它应该被删掉。

## 开发流程

```bash
npm run check   # 语法检查（每个 lib/*.js 经 node --check）
npm test        # 单元测试（node --test，无需宿主运行时）
npm run verify  # 两者
```

提交前请确保 `npm run verify` 通过。

## 可贡献的方向

- **设计辩论**：对 RACI 划分、升级阶梯、宪章分层提出反例或改进。
- **提示词对抗测试**：构造让 Reviewer 误报/漏报的场景，附上证据包与期望裁决。
- **证据包取舍**：字段增减、预算策略、隐私边界。
- **管理学映射**：补充或修正 [docs/design.md](./docs/design.md) 中的文献与模型对应。
- **功能**：见 [CHANGELOG](./CHANGELOG.md) 的 Planned 部分。

## 约定

- 纯 ESM，无构建步骤，无第三方运行时依赖。
- `lib/config.js`、`lib/cadence.js`、`lib/parse.js`、`lib/evidence.js` 必须保持宿主无关（纯函数），并附带测试。
- 任何新增的宿主 API 调用都必须 fail-open，且不能阻塞回合关闭。
- 提交信息使用 Conventional Commits 风格（`feat:` / `fix:` / `docs:` / `test:` / `chore:`）。
