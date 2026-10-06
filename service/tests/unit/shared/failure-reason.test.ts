import { APIConnectionError } from "openai";
import { describe, expect, it } from "vitest";
import { QuotaExhaustedError } from "../../../src/domain/errors/quota-exhausted.error";
import { failureReason } from "../../../src/shared/failure-reason";

describe("failureReason", () => {
  it("leads with the error's NAME, which is the diagnostic half", () => {
    expect(failureReason(new QuotaExhaustedError("gpt-oss-120b"))).toMatch(/^QuotaExhaustedError: /);
  });

  it("names an SDK error by its CLASS, because the SDK never sets `name`", () => {
    // openai's error classes leave `name` at the inherited "Error", so this line used to read
    // `Error: Connection error.` - the one thing it needed to say was missing (C94).
    const error = new APIConnectionError({});
    expect(error.name).toBe("Error");
    expect(failureReason(error)).toBe("APIConnectionError: Connection error.");
  });

  it("appends the cause's code, which is where a transport fault keeps its diagnosis", () => {
    const cause = Object.assign(new Error("connect ECONNRESET 1.2.3.4:443"), { code: "ECONNRESET" });
    expect(failureReason(new APIConnectionError({ cause }))).toBe(
      "APIConnectionError: Connection error. (ECONNRESET)",
    );
  });

  it("falls back to the cause's own name and message when it carries no code", () => {
    const error = new Error("wrapped", { cause: new RangeError("out of range") });
    expect(failureReason(error)).toBe("Error: wrapped (RangeError: out of range)");
  });

  it("never repeats a cause the message already states", () => {
    const cause = Object.assign(new Error("boom"), { code: "ECONNRESET" });
    expect(failureReason(new Error("failed with ECONNRESET", { cause }))).toBe(
      "Error: failed with ECONNRESET",
    );
  });

  it("still redacts and still truncates, cause included", () => {
    const cause = Object.assign(new Error("x"), { code: "gsk-cause" });
    // The cause is rendered BEFORE redaction, so a key echoed there is scrubbed like any other.
    expect(
      failureReason(new Error("upstream said gsk-message", { cause }), ["gsk-message", "gsk-cause"]),
    ).toBe("Error: upstream said [redacted] ([redacted])");
    const long = failureReason(new Error("x".repeat(400)));
    expect(long.length).toBe(300);
    expect(long.endsWith("…")).toBe(true);
  });

  it("collapses whitespace, because this is one line in an API response", () => {
    expect(failureReason(new Error("two\n  lines"))).toBe("Error: two lines");
  });

  it("handles what is not an Error at all", () => {
    expect(failureReason("plain string")).toBe("plain string");
    expect(failureReason(undefined)).toBe("undefined");
  });
});
