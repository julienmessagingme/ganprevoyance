import { describe, it, expect } from "vitest";
import {
  createPdfFromText,
  createTxtFromQA,
  sanitizeFileName,
  buildQaFileName,
} from "./file-gen";

describe("createPdfFromText", () => {
  it("returns a Buffer that starts with the PDF magic bytes", async () => {
    const buf = await createPdfFromText("Hello world. This is a test.", "Mon doc");
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("handles empty title gracefully", async () => {
    const buf = await createPdfFromText("body only", "");
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("wraps long text across multiple pages", async () => {
    const longText = "Line of text. ".repeat(2000);
    const buf = await createPdfFromText(longText, "Long");
    // We don't introspect the PDF — just sanity check that it grew.
    expect(buf.length).toBeGreaterThan(5000);
  });
});

describe("createTxtFromQA", () => {
  it("formats a full QA with theme + subtheme", () => {
    const buf = createTxtFromQA("Quels sont les tarifs ?", "9000€/an", "Tarifs", "Cycle 1");
    const text = buf.toString("utf8");
    expect(text).toContain("THÈME: Tarifs");
    expect(text).toContain("SOUS-THÈME: Cycle 1");
    expect(text).toContain("QUESTION:");
    expect(text).toContain("Quels sont les tarifs ?");
    expect(text).toContain("RÉPONSE:");
    expect(text).toContain("9000€/an");
  });

  it("omits theme block when theme is empty", () => {
    const buf = createTxtFromQA("Q", "A");
    const text = buf.toString("utf8");
    expect(text).not.toContain("THÈME");
    expect(text).not.toContain("SOUS-THÈME");
    expect(text).toContain("QUESTION:");
  });

  it("trims question and answer", () => {
    const buf = createTxtFromQA("  Q  ", "  A  ");
    const text = buf.toString("utf8");
    expect(text).toContain("QUESTION:\nQ");
    expect(text).toContain("RÉPONSE:\nA");
  });
});

describe("sanitizeFileName", () => {
  it("replaces unsafe chars and collapses underscores", () => {
    expect(sanitizeFileName("évidemment / malicieux:.pdf")).toBe(
      "videmment_malicieux_.pdf"
    );
  });

  it("preserves safe chars", () => {
    expect(sanitizeFileName("safe-name_v1.2.txt")).toBe("safe-name_v1.2.txt");
  });

  it("caps length at 200", () => {
    const long = "a".repeat(300);
    expect(sanitizeFileName(long).length).toBe(200);
  });

  it("falls back to 'file' for empty input", () => {
    expect(sanitizeFileName("")).toBe("file");
  });

  it("falls back to 'file' for input that's all unsafe chars", () => {
    // After replace + collapse + trim, this becomes empty.
    expect(sanitizeFileName("???")).toBe("file");
  });
});

describe("buildQaFileName", () => {
  it("includes theme and subtheme when provided", () => {
    const name = buildQaFileName("Quels sont les tarifs ?", "Tarifs", "Cycle 1");
    expect(name).toMatch(/^QA_Tarifs_Cycle_1_/);
    expect(name).toMatch(/\.txt$/);
  });

  it("falls back to QA_<preview>.txt without theme", () => {
    const name = buildQaFileName("Quelle est la rentrée ?");
    expect(name).toMatch(/^QA_/);
    expect(name).toMatch(/\.txt$/);
    expect(name).not.toContain("__"); // no double underscores from missing parts
  });
});
