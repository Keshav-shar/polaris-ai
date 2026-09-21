import { describe, expect, it } from "vitest";
import { uuidV5 } from "../../../src/shared/ids";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("uuidV5", () => {
  it("matches the well-known v5 vector for www.example.com in the DNS namespace", () => {
    expect(uuidV5("www.example.com", DNS_NAMESPACE)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("is deterministic and sensitive to name and namespace", () => {
    const ns = "0f1e2d3c-4b5a-4968-8776-655443322110";
    expect(uuidV5("a", ns)).toBe(uuidV5("a", ns));
    expect(uuidV5("a", ns)).not.toBe(uuidV5("b", ns));
    expect(uuidV5("a", ns)).not.toBe(uuidV5("a", DNS_NAMESPACE));
  });

  it("rejects a namespace that is not a UUID", () => {
    expect(() => uuidV5("a", "not-a-uuid")).toThrow(TypeError);
  });
});
