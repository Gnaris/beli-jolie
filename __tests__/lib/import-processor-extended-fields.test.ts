import { describe, it, expect } from "vitest";
import { boolish, parseJSON, readStatus, type ProductImportRow } from "@/lib/import-processor";

/**
 * Couvre l'extension de l'import produit (mai 2026) qui aligne l'Excel/JSON sur
 * le formulaire manuel : Code SH, couleur principale, taille unique, statut,
 * best seller, traductions EN.
 */

describe("boolish", () => {
  it("reconnaît true/1/oui/yes/vrai/x comme vrai", () => {
    expect(boolish("true")).toBe(true);
    expect(boolish("TRUE")).toBe(true);
    expect(boolish("1")).toBe(true);
    expect(boolish("oui")).toBe(true);
    expect(boolish("Yes")).toBe(true);
    expect(boolish("vrai")).toBe(true);
    expect(boolish("x")).toBe(true);
  });

  it("reconnaît false/0/non/no/faux comme faux", () => {
    expect(boolish("false")).toBe(false);
    expect(boolish("0")).toBe(false);
    expect(boolish("non")).toBe(false);
    expect(boolish("NO")).toBe(false);
    expect(boolish("faux")).toBe(false);
  });

  it("retourne undefined pour valeur vide ou inconnue", () => {
    expect(boolish("")).toBeUndefined();
    expect(boolish(undefined)).toBeUndefined();
    expect(boolish(null)).toBeUndefined();
    expect(boolish("peut-être")).toBeUndefined();
  });
});

describe("readStatus", () => {
  it("accepte les valeurs canoniques", () => {
    expect(readStatus("OFFLINE")).toBe("OFFLINE");
    expect(readStatus("ONLINE")).toBe("ONLINE");
    expect(readStatus("ARCHIVED")).toBe("ARCHIVED");
  });

  it("accepte les alias FR (insensibles à la casse + accents)", () => {
    expect(readStatus("en ligne")).toBe("ONLINE");
    expect(readStatus("Hors ligne")).toBe("OFFLINE");
    expect(readStatus("brouillon")).toBe("OFFLINE");
    expect(readStatus("archivé")).toBe("ARCHIVED");
    expect(readStatus("publié")).toBe("ONLINE");
  });

  it("rejette SYNCING (état système, pas un statut admin)", () => {
    expect(readStatus("SYNCING")).toBeUndefined();
  });

  it("retourne undefined pour valeur vide ou inconnue", () => {
    expect(readStatus("")).toBeUndefined();
    expect(readStatus(undefined)).toBeUndefined();
    expect(readStatus("FOO")).toBeUndefined();
  });
});

describe("parseJSON — nouveaux champs niveau produit", () => {
  function makePayload(extra: Record<string, unknown>) {
    return JSON.stringify([
      {
        reference: "TEST-001",
        name: "Article test",
        description: "Description test",
        category: "Bijoux",
        colors: [{ color: "Doré", saleType: "UNIT", unitPrice: 10, stock: 5, size: "Unique" }],
        ...extra,
      },
    ]);
  }

  it("extrait hs_code (alias hs_code / hsCode / code_sh)", () => {
    const r1 = parseJSON(makePayload({ hs_code: "71171900" }));
    const r2 = parseJSON(makePayload({ hsCode: "71171900" }));
    const r3 = parseJSON(makePayload({ code_sh: "71171900" }));
    expect(r1[0].hsCode).toBe("71171900");
    expect(r2[0].hsCode).toBe("71171900");
    expect(r3[0].hsCode).toBe("71171900");
  });

  it("extrait primary_color (alias primary_color / primaryColor / couleur_principale)", () => {
    const r = parseJSON(makePayload({ primary_color: "Doré" }));
    expect(r[0].primaryColor).toBe("Doré");
    const r2 = parseJSON(makePayload({ couleur_principale: "Argenté" }));
    expect(r2[0].primaryColor).toBe("Argenté");
  });

  it("extrait taille_unique_details (alias multiples)", () => {
    const r1 = parseJSON(makePayload({ taille_unique_details: "52-56" }));
    expect(r1[0].sizeDetailsTu).toBe("52-56");
    const r2 = parseJSON(makePayload({ detail_taille_unique: "M-L" }));
    expect(r2[0].sizeDetailsTu).toBe("M-L");
    const r3 = parseJSON(makePayload({ sizeDetailsTu: "Unique" }));
    expect(r3[0].sizeDetailsTu).toBe("Unique");
  });

  it("extrait status normalisé", () => {
    expect(parseJSON(makePayload({ status: "ONLINE" }))[0].status).toBe("ONLINE");
    expect(parseJSON(makePayload({ status: "Hors ligne" }))[0].status).toBe("OFFLINE");
    expect(parseJSON(makePayload({ status: "archivé" }))[0].status).toBe("ARCHIVED");
    expect(parseJSON(makePayload({ status: "" }))[0].status).toBeUndefined();
  });

  it("extrait isBestSeller (alias best_seller / isBestSeller / bestseller)", () => {
    expect(parseJSON(makePayload({ best_seller: "true" }))[0].isBestSeller).toBe(true);
    expect(parseJSON(makePayload({ isBestSeller: true }))[0].isBestSeller).toBe(true);
    expect(parseJSON(makePayload({ bestseller: "non" }))[0].isBestSeller).toBe(false);
  });

  it("extrait traductions EN (name_en / description_en)", () => {
    const r = parseJSON(
      makePayload({
        name_en: "Test Item",
        description_en: "English description",
      }),
    );
    expect(r[0].nameEn).toBe("Test Item");
    expect(r[0].descriptionEn).toBe("English description");
  });

  it("laisse les nouveaux champs undefined si absents (rétro-compat)", () => {
    const r = parseJSON(makePayload({}));
    const row = r[0];
    expect(row.hsCode).toBeUndefined();
    expect(row.primaryColor).toBeUndefined();
    expect(row.sizeDetailsTu).toBeUndefined();
    expect(row.status).toBeUndefined();
    expect(row.isBestSeller).toBeUndefined();
    expect(row.nameEn).toBeUndefined();
    expect(row.descriptionEn).toBeUndefined();
  });

  it("propage les champs produit-niveau identiquement à chaque variante (héritage post-parse)", () => {
    // parseJSON émet une row par couleur, en duplicant les champs produit
    const payload = JSON.stringify([
      {
        reference: "MULTI-001",
        name: "Pack multi-couleurs",
        category: "Vêtement",
        hs_code: "62052000",
        primary_color: "Bleu",
        status: "ONLINE",
        best_seller: "true",
        name_en: "Multi pack",
        colors: [
          { color: "Bleu", saleType: "UNIT", unitPrice: 12, stock: 10, size: "M" },
          { color: "Rouge", saleType: "UNIT", unitPrice: 12, stock: 5, size: "L" },
        ],
      },
    ]);
    const rows = parseJSON(payload);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.hsCode).toBe("62052000");
      expect(r.primaryColor).toBe("Bleu");
      expect(r.status).toBe("ONLINE");
      expect(r.isBestSeller).toBe(true);
      expect(r.nameEn).toBe("Multi pack");
    }
  });
});

describe("ProductImportRow — type contract", () => {
  it("expose toutes les colonnes manuelles attendues", () => {
    // Compilation-only test : si le type ProductImportRow régresse en perdant
    // un champ, ce test ne compilera plus.
    const r: ProductImportRow = {
      _rowIndex: 1,
      reference: "X",
      name: "X",
      color: "X",
      saleType: "UNIT",
      unitPrice: 1,
      stock: 0,
      hsCode: "71171900",
      primaryColor: "Doré",
      sizeDetailsTu: "52-56",
      status: "ONLINE",
      isBestSeller: true,
      nameEn: "X",
      descriptionEn: "X",
    };
    expect(r.hsCode).toBe("71171900");
  });
});
