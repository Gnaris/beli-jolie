import { describe, expect, it } from "vitest";
import {
  buildGeoFilterWhere,
  DOMTOM_CODES,
  parseGeoCountries,
  parseGeoZone,
  resolveGeoZone,
  UE_HORS_FR_CODES,
} from "@/lib/admin-client-geo-filter";

describe("resolveGeoZone", () => {
  it("mappe FR vers metropole", () => {
    expect(resolveGeoZone("FR")).toBe("metropole");
    expect(resolveGeoZone("fr")).toBe("metropole");
  });

  it("mappe les DOM-TOM", () => {
    expect(resolveGeoZone("RE")).toBe("domtom");
    expect(resolveGeoZone("GP")).toBe("domtom");
    expect(resolveGeoZone("NC")).toBe("domtom");
  });

  it("mappe les pays UE hors FR", () => {
    expect(resolveGeoZone("BE")).toBe("ue");
    expect(resolveGeoZone("DE")).toBe("ue");
    expect(resolveGeoZone("ES")).toBe("ue");
  });

  it("tout le reste tombe sur intl", () => {
    expect(resolveGeoZone("CN")).toBe("intl");
    expect(resolveGeoZone("US")).toBe("intl");
    expect(resolveGeoZone("GB")).toBe("intl"); // UK n'est plus UE
    expect(resolveGeoZone("CH")).toBe("intl");
  });

  it("renvoie null pour vide / null", () => {
    expect(resolveGeoZone(null)).toBeNull();
    expect(resolveGeoZone("")).toBeNull();
    expect(resolveGeoZone(undefined)).toBeNull();
  });
});

describe("parseGeoZone", () => {
  it("accepte les 4 valeurs typées", () => {
    expect(parseGeoZone("metropole")).toBe("metropole");
    expect(parseGeoZone("domtom")).toBe("domtom");
    expect(parseGeoZone("ue")).toBe("ue");
    expect(parseGeoZone("intl")).toBe("intl");
  });

  it("rejette les valeurs inconnues", () => {
    expect(parseGeoZone("")).toBeNull();
    expect(parseGeoZone("europe")).toBeNull();
    expect(parseGeoZone(undefined)).toBeNull();
  });
});

describe("parseGeoCountries", () => {
  it("découpe la liste CSV + uppercase + dédoublonne", () => {
    expect(parseGeoCountries("fr,be,DE,fr")).toEqual(["FR", "BE", "DE"]);
  });

  it("filtre les codes non ISO-2", () => {
    expect(parseGeoCountries("FR,XYZ,,BE")).toEqual(["FR", "BE"]);
  });

  it("renvoie [] pour vide / absent", () => {
    expect(parseGeoCountries(undefined)).toEqual([]);
    expect(parseGeoCountries("")).toEqual([]);
  });
});

describe("buildGeoFilterWhere", () => {
  it("vide quand ni zone ni pays", () => {
    expect(buildGeoFilterWhere(null, [])).toEqual({});
  });

  it("zone metropole → FR seul", () => {
    expect(buildGeoFilterWhere("metropole", [])).toEqual({ addressCountry: "FR" });
  });

  it("zone domtom → in DOM-TOM", () => {
    const w = buildGeoFilterWhere("domtom", []);
    expect(w).toEqual({ addressCountry: { in: [...DOMTOM_CODES] } });
  });

  it("zone ue → in UE hors FR", () => {
    const w = buildGeoFilterWhere("ue", []);
    expect(w).toEqual({ addressCountry: { in: [...UE_HORS_FR_CODES] } });
    // FR ne doit pas être dans la liste
    expect(UE_HORS_FR_CODES).not.toContain("FR");
  });

  it("zone intl → notIn metropole+domtom+ue", () => {
    const w = buildGeoFilterWhere("intl", []);
    expect(w).toHaveProperty("addressCountry");
    const cond = (w as { addressCountry: { notIn: string[]; not: null } }).addressCountry;
    expect(cond.not).toBeNull();
    expect(cond.notIn).toContain("FR");
    expect(cond.notIn).toContain("RE");
    expect(cond.notIn).toContain("BE");
    expect(cond.notIn).not.toContain("CN");
  });

  it("pays seuls → in liste", () => {
    expect(buildGeoFilterWhere(null, ["FR", "BE"])).toEqual({
      addressCountry: { in: ["FR", "BE"] },
    });
  });

  it("zone + pays → AND des 2 contraintes", () => {
    const w = buildGeoFilterWhere("ue", ["BE", "DE"]);
    expect(w).toEqual({
      AND: [
        { addressCountry: { in: [...UE_HORS_FR_CODES] } },
        { addressCountry: { in: ["BE", "DE"] } },
      ],
    });
  });
});
