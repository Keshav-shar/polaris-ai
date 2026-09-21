import type { LlmPort } from "../application/ports/llm.port";
import { type Env, isLlmConfigured, requireLlmEnv } from "../config/env";
import { createFailoverLlm, type SwitchableLlm } from "../infrastructure/llm/failover.adapter";
import { createOpenAiCompatibleLlm } from "../infrastructure/llm/openai-compatible.adapter";
import type { Logger } from "../shared/logger";

// What the rest of the process needs to know about the LLM: the port itself, the model currently
// answering (the expansion-cache namespace, so it must track a failover), and the requests/day the run
// can actually draw on - the SUM of both profiles when failover is live.
export type LlmStack = {
  llm: SwitchableLlm;
  activeModel(): string;
  dailyRequestBudget: number | undefined;
};

function fixed(llm: LlmPort, model: string): SwitchableLlm {
  return { chat: (messages, options) => llm.chat(messages, options), activeModel: () => model };
}

// Throws EnvError naming the ACTIVE profile's missing variables. Call once per process: each adapter
// holds its own limiter. Which profile is live is logged, because it decides both the cost and the cache
// namespace. When the OTHER profile is fully configured it is wired as an automatic, one-way failover
// target (docs/conflicts.md C59) - a daily quota then continues the build instead of halting it.
export function createLlmFromEnv(env: Env, logger?: Logger): LlmStack {
  const activeEnv = requireLlmEnv(env);
  const other = env.LLM_PROVIDER === "primary" ? "fallback" : "primary";
  const hasFailover = isLlmConfigured(env, other);

  logger?.info("llm provider selected", {
    provider: activeEnv.provider,
    model: activeEnv.model,
    failoverTo: hasFailover ? requireLlmEnv(env, other).model : null,
  });

  const activeLlm = createOpenAiCompatibleLlm(activeEnv);
  if (!hasFailover) {
    return {
      llm: fixed(activeLlm, activeEnv.model),
      activeModel: () => activeEnv.model,
      dailyRequestBudget: activeEnv.dailyRequestBudget,
    };
  }

  const otherEnv = requireLlmEnv(env, other);
  const llm = createFailoverLlm({
    primary: { llm: activeLlm, model: activeEnv.model },
    fallback: { llm: createOpenAiCompatibleLlm(otherEnv), model: otherEnv.model },
    logger: logger ?? { warn: () => {} },
  });

  // Undefined on either side means "no known ceiling", which must stay undefined rather than collapse to
  // the other profile's number - a warning against half the real budget is worse than none.
  const budget =
    activeEnv.dailyRequestBudget === undefined || otherEnv.dailyRequestBudget === undefined
      ? undefined
      : activeEnv.dailyRequestBudget + otherEnv.dailyRequestBudget;

  return { llm, activeModel: () => llm.activeModel(), dailyRequestBudget: budget };
}
