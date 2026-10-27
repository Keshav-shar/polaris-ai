import { describe, expect, it } from "vitest";
import { transportFaultCode } from "../../../src/shared/transport-fault";

describe("transportFaultCode", () => {
  it("finds a socket code on the error, in a cause chain, or spelled out in a message", () => {
    expect(transportFaultCode(Object.assign(new Error("boom"), { code: "ECONNRESET" }))).toBe("ECONNRESET");
    // undici's shape: "fetch failed" wrapping the real error.
    expect(
      transportFaultCode(new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ENOTFOUND" }) })),
    ).toBe("ENOTFOUND");
    expect(transportFaultCode(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe("ECONNREFUSED");
    expect(transportFaultCode({ cause: { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } } })).toBe("UND_ERR_CONNECT_TIMEOUT");
  });

  // What AbortSignal.timeout() throws: our own timeout on a search that never answered (C115).
  it("names a client-side timeout", () => {
    expect(transportFaultCode(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(
      "TimeoutError",
    );
  });

  it("is undefined for anything that is not a transport fault", () => {
    expect(transportFaultCode(new Error("Wikipedia search failed with HTTP 503"))).toBeUndefined();
    expect(transportFaultCode("ECONNRESET as a bare string")).toBeUndefined();
    expect(transportFaultCode(undefined)).toBeUndefined();
    expect(transportFaultCode(null)).toBeUndefined();
  });

  it("stops walking a cause chain after a bounded depth", () => {
    let deep: unknown = { code: "ECONNRESET" };
    for (let i = 0; i < 10; i++) deep = { cause: deep };
    expect(transportFaultCode(deep)).toBeUndefined();
  });
});
