import { describe, it, expect } from "vitest";
import { suggestIso2FromName, COUNTRY_ISO2_OPTIONS } from "@/lib/marketplace-excel/country-iso";

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
});
