import { describe, expect, it } from "vitest";
import { DomainError } from "../../../../src/domain/errors/domain-error";
import { StructuredOutputError } from "../../../../src/domain/errors/structured-output.error";

describe("StructuredOutputError", () => {
  it("is a DomainError with a stable code, its label and the last error", () => {
    const error = new StructuredOutputError("parser", "topic: Required");
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("STRUCTURED_OUTPUT_INVALID");
    expect(error.name).toBe("StructuredOutputError");
    expect(error.label).toBe("parser");
    expect(error.message).toContain("topic: Required");
  });
});
