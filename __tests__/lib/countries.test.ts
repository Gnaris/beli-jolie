import { describe, it, expect } from "vitest";
import {
  resolveCountryCode,
  countryName,
  countryFlagUrl,
  findCountry,
  isKnownCountry,
  COUNTRIES,
  getCountryByIso,
  getCountryByPfsRef,
  listManufacturingCountries,
  countryLabel,
} from "@/lib/countries";

describe("resolveCountryCode", () => {
  it("accepte un code ISO alpha-2 valide", () => {
    expect(resolveCountryCode("FR")).toBe("FR");
    expect(resolveCountryCode("fr")).toBe("FR");
    expect(resolveCountryCode("PT")).toBe("PT");
    expect(resolveCountryCode("MU")).toBe("MU");
  });

  it("résout un nom FR classique", () => {
    expect(resolveCountryCode("France")).toBe("FR");
    expect(resolveCountryCode("Portugal")).toBe("PT");
    expect(resolveCountryCode("Suisse")).toBe("CH");
  });

  it("résout les noms remontés par PFS (uppercase, avec accents et tirets)", () => {
    expect(resolveCountryCode("PORTUGAL")).toBe("PT");
    expect(resolveCountryCode("SUISSE")).toBe("CH");
    expect(resolveCountryCode("ALLEMAGNE")).toBe("DE");
    expect(resolveCountryCode("ETATS-UNIS")).toBe("US");
    expect(resolveCountryCode("ROYAUME-UNI")).toBe("GB");
    expect(resolveCountryCode("PAYS-BAS")).toBe("NL");
    expect(resolveCountryCode("NORVÈGE")).toBe("NO");
    expect(resolveCountryCode("GRÈCE")).toBe("GR");
    expect(resolveCountryCode("SUÈDE")).toBe("SE");
    expect(resolveCountryCode("SLOVÉNIE")).toBe("SI");
  });

  it("résout les DOM-TOM et territoires PFS", () => {
    expect(resolveCountryCode("RÉUNION")).toBe("RE"); // alias : canonique "La Réunion"
    expect(resolveCountryCode("La Réunion")).toBe("RE");
    expect(resolveCountryCode("MARTINIQUE")).toBe("MQ");
    expect(resolveCountryCode("GUADELOUPE")).toBe("GP");
    expect(resolveCountryCode("GUYANE FRANÇAISE")).toBe("GF");
    expect(resolveCountryCode("MAYOTTE")).toBe("YT");
    expect(resolveCountryCode("NOUVELLE-CALÉDONIE")).toBe("NC");
    expect(resolveCountryCode("POLYNÉSIE FRANÇAISE")).toBe("PF");
  });

  it("résout les pays ajoutés pour PFS", () => {
    expect(resolveCountryCode("ILE MAURICE")).toBe("MU");
    expect(resolveCountryCode("Île Maurice")).toBe("MU");
    expect(resolveCountryCode("PORTO RICO")).toBe("PR");
    expect(resolveCountryCode("SAINT-MARTIN (FRANÇAIS)")).toBe("MF"); // via alias SAINTMARTIN
    expect(resolveCountryCode("WALLIS ET FUTUNA")).toBe("WF");
  });

  it("résout via alias les variantes courantes", () => {
    expect(resolveCountryCode("USA")).toBe("US");
    expect(resolveCountryCode("UK")).toBe("GB");
    expect(resolveCountryCode("Angleterre")).toBe("GB");
  });

  it("retourne null pour null / vide / inconnu", () => {
    expect(resolveCountryCode(null)).toBe(null);
    expect(resolveCountryCode(undefined)).toBe(null);
    expect(resolveCountryCode("")).toBe(null);
    expect(resolveCountryCode("   ")).toBe(null);
    expect(resolveCountryCode("PAYSINEXISTANT")).toBe(null);
    expect(resolveCountryCode("ZZ")).toBe(null);
  });
});

describe("countryName", () => {
  it("retourne le nom canonique pour un code ISO", () => {
    expect(countryName("FR")).toBe("France");
    expect(countryName("MU")).toBe("Île Maurice");
  });

  it("est tolérant aux anciens noms bruts (PORTUGAL → 'Portugal')", () => {
    expect(countryName("PORTUGAL")).toBe("Portugal");
    expect(countryName("ETATS-UNIS")).toBe("États-Unis");
    expect(countryName("RÉUNION")).toBe("La Réunion");
  });

  it("retourne vide pour null/inconnu", () => {
    expect(countryName(null)).toBe("");
    expect(countryName("PAYSINEXISTANT")).toBe("");
  });
});

describe("countryFlagUrl", () => {
  it("génère une URL en lowercase pour un code ISO", () => {
    expect(countryFlagUrl("FR")).toBe("https://flagcdn.com/w40/fr.png");
    expect(countryFlagUrl("PT", 80)).toBe("https://flagcdn.com/w80/pt.png");
  });

  it("est tolérant aux anciens noms bruts", () => {
    expect(countryFlagUrl("PORTUGAL")).toBe("https://flagcdn.com/w40/pt.png");
    expect(countryFlagUrl("SUISSE")).toBe("https://flagcdn.com/w40/ch.png");
  });
});

describe("findCountry / isKnownCountry", () => {
  it("findCountry renvoie l'objet pays complet", () => {
    expect(findCountry("PORTUGAL")).toMatchObject({ code: "PT", name: "Portugal" });
    expect(findCountry("XX")).toBe(null);
  });

  it("isKnownCountry couvre ISO + noms tolérés", () => {
    expect(isKnownCountry("FR")).toBe(true);
    expect(isKnownCountry("PORTUGAL")).toBe(true);
    expect(isKnownCountry("PAYSINEXISTANT")).toBe(false);
  });
});

describe("Pays de fabrication (mapping marketplaces figé)", () => {
  it("expose la Chine avec toutes ses refs marketplaces", () => {
    const cn = getCountryByIso("CN");
    expect(cn).not.toBeNull();
    expect(cn?.name).toBe("Chine");
    expect(cn?.nameEn).toBe("China");
    expect(cn?.pfsCountryRef).toBe("Chine");
    expect(cn?.efashionProvenanceId).toBe(1);
    expect(cn?.faireCountryCode).toBe("CHN");
  });

  it("getCountryByIso tolère casse et espaces, retourne null pour inconnu", () => {
    expect(getCountryByIso("cn")?.code).toBe("CN");
    expect(getCountryByIso("  CN  ")?.code).toBe("CN");
    expect(getCountryByIso(null)).toBeNull();
    expect(getCountryByIso("")).toBeNull();
    expect(getCountryByIso("ZZ")).toBeNull();
  });

  it("getCountryByPfsRef retrouve la Chine via 'Chine'", () => {
    expect(getCountryByPfsRef("Chine")?.code).toBe("CN");
    expect(getCountryByPfsRef(null)).toBeNull();
    expect(getCountryByPfsRef("Ref inconnue")).toBeNull();
  });

  it("countryLabel renvoie FR par défaut et EN sur demande", () => {
    expect(countryLabel("CN")).toBe("Chine");
    expect(countryLabel("CN", "en")).toBe("China");
    expect(countryLabel("FR", "en")).toBe("France");
    expect(countryLabel(null)).toBe("");
  });

  it("listManufacturingCountries : uniquement les pays configurés côté marketplaces", () => {
    const list = listManufacturingCountries();
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      expect(
        c.pfsCountryRef != null ||
          c.efashionProvenanceId != null ||
          c.faireCountryCode != null,
      ).toBe(true);
    }
    expect(list.find((c) => c.code === "CN")).toBeTruthy();
  });

  it("chaque entrée COUNTRIES a un code ISO alpha-2 et un nom FR", () => {
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("pas de doublons dans les refs marketplaces", () => {
    const pfsRefs = COUNTRIES.filter((c) => c.pfsCountryRef).map((c) => c.pfsCountryRef);
    expect(new Set(pfsRefs).size).toBe(pfsRefs.length);
    const efIds = COUNTRIES.filter((c) => c.efashionProvenanceId != null).map(
      (c) => c.efashionProvenanceId,
    );
    expect(new Set(efIds).size).toBe(efIds.length);
  });
});
