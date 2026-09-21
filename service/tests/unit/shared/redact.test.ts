import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../../src/shared/redact";

describe("redactSecrets", () => {
  it("removes every secret it is given, not just the first", () => {
    // With failover a single run calls both providers, so either key can come back in an error.
    const text = "primary sk-aaa failed, fallback gsk-bbb failed too";
    expect(redactSecrets(text, ["sk-aaa", "gsk-bbb"])).toBe(
      "primary [redacted] failed, fallback [redacted] failed too",
    );
  });

  it("replaces every occurrence, not only the first", () => {
    expect(redactSecrets("sk-aaa and sk-aaa", ["sk-aaa"])).toBe("[redacted] and [redacted]");
  });

  it("leaves no tail when one secret is a prefix of another", () => {
    // Shortest-first would turn "sk-aaa-long" into "[redacted]-long", leaking the distinguishing part.
    expect(redactSecrets("sk-aaa-long", ["sk-aaa", "sk-aaa-long"])).toBe("[redacted]");
  });

  it("ignores empty and missing secrets rather than shredding the text", () => {
    expect(redactSecrets("nothing to hide", ["", undefined])).toBe("nothing to hide");
  });

  it("returns the text unchanged when no secret appears in it", () => {
    expect(redactSecrets("ECONNREFUSED 127.0.0.1:8911", ["sk-aaa"])).toBe("ECONNREFUSED 127.0.0.1:8911");
  });
});
