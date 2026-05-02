import { describe, it, expect } from "vitest";
import { suggestIso2FromName, COUNTRY_ISO2_OPTIONS } from "@/lib/marketplace-excel/country-iso";
import { PFS_COUNTRIES } from "@/lib/marketplace-excel/pfs-taxonomy";

describe("country-iso — suggestIso2FromName", () => {
  it("resolves common countries case and accent insensitively", () => {
    expect(suggestIso2FromName("France")).toBe("FR");
    expect(suggestIso2FromName("france")).toBe("FR");
    expect(suggestIso2FromName("FRANCE")).toBe("FR");
    expect(suggestIso2FromName("Chine")).toBe("CN");
    expect(suggestIso2FromName("chine")).toBe("CN");
    expect(suggestIso2FromName("Italie")).toBe("IT");
    expect(suggestIso2FromName("Turquie")).toBe("TR");
  });

  it("handles accented characters", () => {
    expect(suggestIso2FromName("Algérie")).toBe("DZ");
    expect(suggestIso2FromName("algerie")).toBe("DZ");
    expect(suggestIso2FromName("Brésil")).toBe("BR");
    expect(suggestIso2FromName("bresil")).toBe("BR");
    expect(suggestIso2FromName("Côte d'Ivoire")).toBe("CI");
    expect(suggestIso2FromName("cote d ivoire")).toBe("CI");
  });

  it("resolves aliases / alternative French spellings", () => {
    expect(suggestIso2FromName("Bélarus")).toBe("BY");
    expect(suggestIso2FromName("Biélorussie")).toBe("BY");
    expect(suggestIso2FromName("République tchèque")).toBe("CZ");
    expect(suggestIso2FromName("Tchéquie")).toBe("CZ");
    expect(suggestIso2FromName("Viet Nam")).toBe("VN");
    expect(suggestIso2FromName("Vietnam")).toBe("VN");
    expect(suggestIso2FromName("Hong Kong")).toBe("HK");
    expect(suggestIso2FromName("Ile Maurice")).toBe("MU");
    expect(suggestIso2FromName("Maurice")).toBe("MU");
    expect(suggestIso2FromName("Swaziland")).toBe("SZ");
    expect(suggestIso2FromName("Eswatini")).toBe("SZ");
  });

  it("returns null for empty / unknown input", () => {
    expect(suggestIso2FromName(null)).toBeNull();
    expect(suggestIso2FromName(undefined)).toBeNull();
    expect(suggestIso2FromName("")).toBeNull();
    expect(suggestIso2FromName("   ")).toBeNull();
    expect(suggestIso2FromName("Atlantide")).toBeNull();
    expect(suggestIso2FromName("Narnia")).toBeNull();
  });

  it("provides a complete ISO2 options list", () => {
    expect(COUNTRY_ISO2_OPTIONS.length).toBeGreaterThan(200);
    for (const { iso } of COUNTRY_ISO2_OPTIONS) {
      expect(iso).toMatch(/^[A-Z]{2}$/);
    }
    const isos = new Set(COUNTRY_ISO2_OPTIONS.map((o) => o.iso));
    expect(isos.size).toBe(COUNTRY_ISO2_OPTIONS.length);
  });

  it("resolves canonical PFS country labels used by the click-to-fill suggestion", () => {
    // These are the exact strings returned by clicking a PFS suggestion chip
    // in the country quick-create modal. They must resolve to the ISO2 code
    // so the ISO field auto-fills in the same click.
    const canonicalSamples: [string, string][] = [
      ["France", "FR"],
      ["Chine", "CN"],
      ["Turquie", "TR"],
      ["Italie", "IT"],
      ["Espagne", "ES"],
      ["Allemagne", "DE"],
      ["Portugal", "PT"],
      ["Brésil", "BR"],
      ["Antilles Néerlandaises", "BQ"],
      ["Bosnie", "BA"],
      ["République Tchéque", "CZ"],
      ["Viet Nam", "VN"],
      ["Ile Maurice", "MU"],
      ["Etats-Unis", "US"],
      ["Hong Kong", "HK"],
      ["Bélarus", "BY"],
      ["Swaziland", "SZ"],
    ];
    for (const [name, expected] of canonicalSamples) {
      expect(suggestIso2FromName(name), `PFS label "${name}"`).toBe(expected);
    }
  });

  it("resolves the vast majority of PFS country labels (bonus ISO match)", () => {
    // When the user clicks a PFS suggestion, the ISO auto-fills "if found".
    // We don't require 100% — some countries (Kosovo etc.) have no ISO2
    // alpha-2 — but we want coverage to stay high so the feature feels reliable.
    const resolved = PFS_COUNTRIES.filter((name) => suggestIso2FromName(name));
    const ratio = resolved.length / PFS_COUNTRIES.length;
    expect(ratio).toBeGreaterThan(0.9);
  });
});
