/**
 * Generate `docs/theory.md` from `lib/theory.js`.
 *
 * The theory document is a *derived artifact*: the registry in code is the
 * source of truth, and this script formats it. CI does not need to regenerate
 * the document, but `npm run docs:theory` must be able to reproduce it exactly —
 * a theory claim that exists only in the markdown is a claim nobody can test.
 *
 * @module dsh-goal-steward/scripts/theory-doc
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRIFT_THEORY, INDEPENDENCE_THEORY, MECHANISMS, MECHANISM_THEORY, THEORY } from '../lib/theory.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const byId = new Map(THEORY.map((entry) => [entry.id, entry]));

/** Stable ordering for mechanism tables. */
const mechanismIds = Object.keys(MECHANISMS).sort();

/** Render the mechanism → theory reverse map as inline citations. */
function citations(mechanism) {
  return MECHANISM_THEORY[mechanism]
    .map((id) => {
      const entry = byId.get(id);
      return `[${entry.name.zh}](#${id})`;
    })
    .join('、');
}

/** Markdown link anchor for one theory entry (explicit HTML anchor keeps links valid on GitHub). */
function heading(entry) {
  return `<a id="${entry.id}"></a>\n### ${entry.name.zh} · ${entry.name.en}`;
}

const lines = [];
lines.push('# 理论支撑：这个插件的管理学依据');
lines.push('');
lines.push('> 本文档由 `lib/theory.js` **自动生成**（`npm run docs:theory`），请勿手工编辑。');
lines.push('> 理论登记在代码里，文档从代码生成，`test/theory.test.mjs` 在 CI 中强制追溯完整性：');
lines.push('> 一条运行时机制如果没有理论依据，或者一条引用没有落成机制，测试都会失败。');
lines.push('');
lines.push('这个文件回答三个问题：');
lines.push('');
lines.push('1. **每条规则背后的管理学命题是什么**（谁在什么年代提出的什么主张）；');
lines.push('2. **它是怎么落成运行时机制的**（对应哪个模块、哪个配置项、哪一级裁决）；');
lines.push('3. **类比在哪里会失效**（不掩饰边界，才能知道这个设计什么时候不该信）。');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 1. 理论总览');
lines.push('');
lines.push('| 理论 | 提出者 / 年代 | 一句话主张 |');
lines.push('|---|---|---|');
for (const entry of THEORY) {
  lines.push(`| [${entry.name.zh}](#${entry.id}) | ${entry.source} | ${entry.proposition} |`);
}
lines.push('');
lines.push('## 2. 机制追溯矩阵');
lines.push('');
lines.push('| 机制 | 状态 | 落在哪个模块 | 理论依据 |');
lines.push('|---|---|---|---|');
for (const id of mechanismIds) {
  const mechanism = MECHANISMS[id];
  const status = mechanism.status === 'implemented' ? '已实现' : '计划中';
  const modules = mechanism.modules.map((module) => `\`${module}\``).join('、');
  lines.push(`| ${mechanism.name.zh} | ${status} | ${modules} | ${citations(id)} |`);
}
lines.push('');
lines.push('## 3. 理论条文与落法');
lines.push('');
for (const entry of THEORY) {
  lines.push(heading(entry));
  lines.push('');
  lines.push(`**出处**：${entry.source}`);
  lines.push('');
  lines.push(`**命题**：${entry.proposition}`);
  lines.push('');
  lines.push(`**在本插件中的落法**：${entry.translation}`);
  lines.push('');
  lines.push(`**防的失败模式**：${entry.guards.join('、')}`);
  lines.push('');
  lines.push(`**类比的边界**：${entry.limits}`);
  lines.push('');
}
lines.push('## 4. 六类偏离的理论来源');
lines.push('');
lines.push('| 偏离代码 | 理论依据 |');
lines.push('|---|---|');
for (const [code, ids] of Object.entries(DRIFT_THEORY)) {
  const refs = ids.map((id) => `[${byId.get(id).name.zh}](#${id})`).join('、');
  lines.push(`| \`${code}\` | ${refs} |`);
}
lines.push('');
lines.push('## 5. 四重独立性分别由什么理论支撑');
lines.push('');
lines.push('| 独立性 | 理论依据 | 在本插件中的实现 |');
lines.push('|---|---|---|');
const independenceImpl = {
  information: '`lib/evidence.js`：评审员只收到证据包，看不到执行者推理与系统提示',
  program: '`lib/reviewer.js`：评审调用无工具、无写权限，唯一动作是返回裁决',
  timing: '`lib/index.js`：只在 `agent/turn-stopping` 边界评审，不在执行中途插嘴',
  incentive: '`lib/prompt.js`：禁止提方法建议；通过率不是评审员指标；审计流水可复盘',
};
for (const [source, ids] of Object.entries(INDEPENDENCE_THEORY)) {
  const refs = ids.map((id) => `[${byId.get(id).name.zh}](#${id})`).join('、');
  lines.push(`| ${source} | ${refs} | ${independenceImpl[source]} |`);
}
lines.push('');
lines.push('## 6. 这个设计如何被证伪');
lines.push('');
lines.push('理论支撑不等于有效。下面这些指标可以推翻它：');
lines.push('');
lines.push('| 假设 | 观测指标 | 若指标恶化则说明 |');
lines.push('|---|---|---|');
lines.push('| 审计能减少目标偏离 | 用户事后纠正的频率（同一意图被反复纠正） | 审计没有拦住偏离 |');
lines.push('| 审计能更早发现偏离 | 从偏离发生到被用户指出的平均轮数 | 审计发现得太晚，等于没有 |');
lines.push('| 默认沉默不会造成噪音 | steer 后被用户忽略或撤销的比例 | 审查者变成噪音源 |');
lines.push('| 举证要求能抑制误报 | 被判定 drift 之后执行者成功反驳的比例 | 判定标准过松或证据不可靠 |');
lines.push('| 成本可接受 | 每千 token 的评审开销、每会话评审次数 | 治理成本高于收益 |');
lines.push('');
lines.push('审计流水（`$DSH_HOME/goal-steward/audit.jsonl`）保留了计算这些指标所需的原始记录。');
lines.push('');
lines.push('## 7. 理论使用的三条纪律');
lines.push('');
lines.push('1. **不把类比当证明**：管理学讲的是人组成的组织，AI 不是人。这里用的是"同构的失控机制"，不是"相同的对象"。');
lines.push('2. **不引入无法落地的理论**：凡是不能变成模块、配置项或裁决规则的理论，不登记进 `lib/theory.js`。');
lines.push('3. **允许理论被工程反证**：如果某条规则在实践中持续产生噪音或没有降低偏离率，应当删掉规则并更新理论条目，而不是反过来拿理论为规则辩护。');
lines.push('');

const outFile = path.join(root, 'docs', 'theory.md');
writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');
console.log(`theory-doc: wrote ${path.relative(root, outFile)} (${THEORY.length} theories, ${mechanismIds.length} mechanisms)`);
