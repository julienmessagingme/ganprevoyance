import { describe, it, expect, beforeEach } from "vitest";

describe("schools", () => {
  beforeEach(() => {
    process.env.MM_TOKEN_GANPREV = "tok-ganprev";
    process.env.OPENAI_VS_GANPREV = "vs_ganprev_test";
  });

  it("exposes 1 school (gan-prev)", async () => {
    const { SCHOOLS } = await import("./schools");
    expect(SCHOOLS.length).toBe(1);
    expect(SCHOOLS[0].slug).toBe("gan-prev");
  });

  it("isValidSchoolSlug accepts known slugs only", async () => {
    const { isValidSchoolSlug } = await import("./schools");
    expect(isValidSchoolSlug("gan-prev")).toBe(true);
    expect(isValidSchoolSlug("nope")).toBe(false);
    expect(isValidSchoolSlug("")).toBe(false);
  });

  it("getSchoolToken returns env value when set, undefined otherwise", async () => {
    const { getSchoolToken } = await import("./schools");
    expect(getSchoolToken("gan-prev")).toBe("tok-ganprev");
    expect(getSchoolToken("does-not-exist")).toBeUndefined();
  });

  it("getSchoolVectorStoreId returns env value when set, undefined otherwise", async () => {
    const { getSchoolVectorStoreId } = await import("./schools");
    expect(getSchoolVectorStoreId("gan-prev")).toBe("vs_ganprev_test");
    expect(getSchoolVectorStoreId("does-not-exist")).toBeUndefined();
  });

  it("each school has both tokenEnv and vectorStoreEnv defined", async () => {
    const { SCHOOLS } = await import("./schools");
    for (const s of SCHOOLS) {
      expect(s.tokenEnv).toMatch(/^MM_TOKEN_/);
      expect(s.vectorStoreEnv).toMatch(/^OPENAI_VS_/);
    }
  });
});
