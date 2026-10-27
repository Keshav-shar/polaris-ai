import { describe, expect, it } from "vitest";
import { secretValues } from "../../../src/composition/secrets";
import { parseEnv } from "../../../src/config/env";
import { failureReason } from "../../../src/shared/failure-reason";

describe("secretValues", () => {
  // C103: `llmKeys` covered the LLM key only, so a search or storage SDK error echoing ITS credential reached a
  // stored articleFailureReason - which the API serves - unredacted.
  it("lists every configured secret, not only the LLM key", () => {
    const env = parseEnv({
      LLM_API_KEY: "llm-secret-123",
      TAVILY_API_KEY: "tvly-secret-456",
      SUPABASE_SERVICE_ROLE_KEY: "sb-secret-789",
      AWS_SECRET_ACCESS_KEY: "aws-secret-000",
    });
    expect(secretValues(env).sort()).toEqual(
      ["aws-secret-000", "llm-secret-123", "sb-secret-789", "tvly-secret-456"].sort(),
    );
  });

  it("skips unset values, so redaction never matches an empty string", () => {
    expect(secretValues(parseEnv({}))).toEqual([]);
  });

  it("is what makes a stored failure reason safe to serve", () => {
    const env = parseEnv({ TAVILY_API_KEY: "tvly-secret-456" });
    const reason = failureReason(new Error("401 for key tvly-secret-456"), secretValues(env));
    expect(reason).not.toContain("tvly-secret-456");
  });
});
