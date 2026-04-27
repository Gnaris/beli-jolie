import { describe, it, expect } from "vitest";
import {
  ANKORSTORE_DESCRIPTION_MIN_CHARS,
  ankorstoreDescriptionLength,
  composeAnkorstoreDescription,
} from "@/lib/ankorstore-description";

describe("composeAnkorstoreDescription", () => {
  it("appends 'Référence : <ref>' on a new line at the end", () => {
    expect(composeAnkorstoreDescription("Bracelet doré.", "REF-001")).toBe(
      "Bracelet doré.\nRéférence : REF-001",
    );
  });

  it("returns just 'Référence : <ref>' when the description is empty", () => {
    expect(composeAnkorstoreDescription("", "REF-002")).toBe("Référence : REF-002");
    expect(composeAnkorstoreDescription(null, "REF-002")).toBe("Référence : REF-002");
    expect(composeAnkorstoreDescription(undefined, "REF-002")).toBe("Référence : REF-002");
  });

  it("trims whitespace around the description and reference before composing", () => {
    expect(composeAnkorstoreDescription("  Bracelet doré.  \n", " REF-003 ")).toBe(
      "Bracelet doré.\nRéférence : REF-003",
    );
  });
});

describe("ankorstoreDescriptionLength", () => {
  it("counts the description plus the reference suffix", () => {
    // 14 chars + "\n" + "Référence : " (12) + "REF-001" (7) = 14 + 1 + 12 + 7 = 34
    expect(ankorstoreDescriptionLength("Bracelet doré.", "REF-001")).toBe(34);
  });

  it("counts only the suffix when the description is empty", () => {
    // "Référence : R1" = 14
    expect(ankorstoreDescriptionLength("", "R1")).toBe(14);
  });

  it("can push a short description above the 30-char minimum", () => {
    // Short desc alone = 16 chars; with "REF-1234567" (7+4=11 → "Référence : REF-1234567" = 23) → 16+1+23 = 40
    expect(ankorstoreDescriptionLength("Bague élégante.", "REF-1234567")).toBeGreaterThanOrEqual(
      ANKORSTORE_DESCRIPTION_MIN_CHARS,
    );
  });

  it("still falls below 30 chars when both pieces are very short", () => {
    expect(ankorstoreDescriptionLength("", "R1")).toBeLessThan(ANKORSTORE_DESCRIPTION_MIN_CHARS);
  });
});

describe("ANKORSTORE_DESCRIPTION_MIN_CHARS", () => {
  it("is 30 (the value imposed by Ankorstore)", () => {
    expect(ANKORSTORE_DESCRIPTION_MIN_CHARS).toBe(30);
  });
});
