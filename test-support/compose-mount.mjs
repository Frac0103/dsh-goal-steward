/**
 * Real-composition harness: the same service topology the official
 * `@deepseek-ai/dsh-agent-loop-testkit` mounts, inlined for one reason:
 *
 *   testkit@0.2.0-rc.2 statically imports `@deepseek-ai/dsh-working-directory`
 *   and `@deepseek-ai/dsh-fs-local`, but `dsh-working-directory` has no
 *   0.2.0-rc.2 publication and is not declared in the package's dependencies or
 *   peerDependencies. Third-party consumers therefore cannot install it.
 *
 * This module mounts exactly the mandatory prerequisite spine documented in the
 * testkit README — LLM, session, session-projection registry, system-prompt
 * registry, tool registry, agent registry — and leaves AgentLoop to the caller,
 * mirroring `mountAgentLoopTestDependencies` + `mountAgentLoopTestHarness`.
 *
 * Nothing here mocks a host service: the real plugins are mounted. Only the
 * model boundary is scripted, by intercepting the `llm/stream` waterfall.
 *
 * @module dsh-goal-steward/test/compose/mount
 */

import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SessionStore from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';

/**
 * Mount the prerequisite services an AgentLoop test needs.
 *
 * The caller owns the context and its disposal; the caller also mounts
 * AgentLoop, because load-order-sensitive consumers (such as the plugin under
 * test) must be mounted after the prerequisites and before the loop.
 *
 * @param {Context} ctx fresh, empty context.
 * @param {{systemPrompt?: object, tools?: object}} [options] forwarded plugin config.
 * @returns {Promise<void>} resolved after every prerequisite is active.
 */
export async function mountPrerequisiteServices(ctx, options = {}) {
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SystemPrompt, options.systemPrompt ?? {});
  await ctx.plugin(ToolRuntime, options.tools ?? {});
  await ctx.plugin(AgentRegistry);
}

/**
 * Mount the production AgentLoop on top of the prerequisites.
 *
 * @param {Context} ctx context that already carries the prerequisite services.
 * @returns {Promise<void>} resolved after AgentLoop activates.
 */
export async function mountAgentLoop(ctx) {
  await ctx.plugin(AgentLoop, { agents: [] });
}

/**
 * Dispose a test context, tolerating both cordis disposal surfaces.
 *
 * @param {Context} ctx context to dispose.
 * @returns {Promise<void>} resolved after teardown settles.
 */
export async function disposeContext(ctx) {
  if (typeof ctx?.fiber?.dispose === 'function') {
    await ctx.fiber.dispose();
    return;
  }
  if (typeof ctx?.dispose === 'function') {
    await ctx.dispose();
  }
}

export { Context };
