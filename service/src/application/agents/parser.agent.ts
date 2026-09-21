import { DEFAULT_MAX_DEPTH, MAX_DEPTH_CEILING } from "../../config/constants";
import { QuotaExhaustedError } from "../../domain/errors/quota-exhausted.error";
import { RawParserOutput } from "../../domain/schemas/agent-io.schema";
import { ParsedRequest } from "../../domain/schemas/node.schema";
import type { Logger } from "../../shared/logger";
import type { GenerateStructured } from "../llm/structured";
import { buildParserUserPrompt, PARSER_SYSTEM_PROMPT } from "./parser.prompt";

// null → default depth; any stated depth is clamped to [1, MAX_DEPTH_CEILING]. Throws ZodError on an empty topic.
export function toParsedRequest(raw: RawParserOutput): ParsedRequest {
  const maxDepth =
    raw.maxDepth === null ? DEFAULT_MAX_DEPTH : Math.min(MAX_DEPTH_CEILING, Math.max(1, raw.maxDepth));
  return ParsedRequest.parse({ topic: raw.topic.trim(), maxDepth });
}

export type ParserAgentDeps = {
  generate: GenerateStructured;
  logger: Pick<Logger, "warn">;
};

export type ParserAgent = {
  parse(raw: string): Promise<ParsedRequest>;
};

export function createParserAgent({ generate, logger }: ParserAgentDeps): ParserAgent {
  return {
    async parse(raw) {
      try {
        const output = await generate({
          schema: RawParserOutput,
          system: PARSER_SYSTEM_PROMPT,
          user: buildParserUserPrompt(raw),
          label: "parser",
        });
        return toParsedRequest(output);
      } catch (error) {
        // An exhausted daily quota is not something a fallback can paper over: every node of the run
        // would die the same way. Fail here, before start-tree-build creates the run.
        if (error instanceof QuotaExhaustedError) throw error;
        // Otherwise a tree can still be built from the prompt itself, so parsing never blocks a request.
        logger.warn("parser fallback", { error });
        return { topic: raw.trim(), maxDepth: DEFAULT_MAX_DEPTH };
      }
    },
  };
}
