import { describe, it, expect } from "vitest";
import { getClientIp } from "./client-ip";

function makeReq(headers: Record<string, string>): Request {
  return new Request("http://x", { headers });
}

describe("getClientIp", () => {
  it("prefers CF-Connecting-IP when present", () => {
    const req = makeReq({
      "CF-Connecting-IP": "1.1.1.1",
      "X-Forwarded-For": "evil-spoof, 9.9.9.9",
    });
    expect(getClientIp(req)).toBe("1.1.1.1");
  });

  it("falls back to last X-Forwarded-For entry, not first", () => {
    const req = makeReq({
      "X-Forwarded-For": "spoofed-by-client, 1.2.3.4, 5.6.7.8",
    });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("returns null when no IP header", () => {
    expect(getClientIp(makeReq({}))).toBeNull();
  });

  it("ignores empty entries in XFF", () => {
    const req = makeReq({ "X-Forwarded-For": ", , 1.2.3.4" });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });
});
