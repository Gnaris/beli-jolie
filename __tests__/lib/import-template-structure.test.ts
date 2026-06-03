import { describe, it, expect, beforeAll } from "vitest";
import * as ExcelJS from "exceljs";
import { parseExcel } from "@/lib/import-processor";

/**
 * Vérifie que le template Excel (depuis juin 2026) peut être re-parsé sans
 * perte. Structure cible (5 lignes d'en-tête figées) :
 *   Ligne 1 : bandeaux de section fusionnés (« Fiche produit » / « Variante »)
 *   Ligne 2 : headers (Référence *, Nom *, …)
 *   Ligne 3 : statut « Obligatoire » / « Facultatif »
 *   Ligne 4 : exemple « (ex : ...) »
 *   Ligne 5+ : données
 *
 * On vérifie :
 *   - bandeau (ligne 1) ignoré
 *   - ligne « Obligatoire/Facultatif » (ligne 3) filtrée
 *   - ligne d'exemples (ligne 4) filtrée
 *   - les 3 produits-exemple sont bien lus
 *   - les champs obligatoires conservés
 *   - 3 références distinctes
 *   - compatibilité ancien fichier sans bandeau
 */

async function buildTemplateBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Produits");

  const PRODUCT_COLS = [
    { key: "reference", header: "Référence *", required: true, example: "PRD-001" },
    { key: "name", header: "Nom *", required: true, example: "Produit Étoile" },
    { key: "description", header: "Description *", required: true, example: "Produit fin" },
    { key: "name_en", header: "Nom (EN)", required: false, example: "" },
    { key: "description_en", header: "Description (EN)", required: false, example: "" },
    { key: "category", header: "Catégorie *", required: true, example: "Accessoires" },
    { key: "sub_categories", header: "Sous-catégories", required: false, example: "Sautoir" },
    { key: "tags", header: "Tags", required: false, example: "tag1,tag2" },
    { key: "composition", header: "Composition *", required: true, example: "Coton:100" },
    { key: "primary_color", header: "Couleur principale", required: false, example: "Doré" },
    { key: "pays_fabrication", header: "Pays fabrication *", required: true, example: "France" },
    { key: "saison", header: "Saison *", required: true, example: "Été 2026" },
    { key: "hs_code", header: "Code SH", required: false, example: "71171900" },
    { key: "taille_unique_details", header: "Détail taille unique", required: false, example: "" },
    { key: "dimension_length", header: "Longueur (cm)", required: false, example: "" },
    { key: "dimension_width", header: "Largeur (cm)", required: false, example: "" },
    { key: "dimension_height", header: "Hauteur (cm)", required: false, example: "" },
    { key: "dimension_diameter", header: "Diamètre (cm)", required: false, example: "" },
    { key: "dimension_circumference", header: "Circonférence (cm)", required: false, example: "" },
    { key: "similar_refs", header: "Réf. similaires", required: false, example: "" },
    { key: "status", header: "Statut", required: false, example: "OFFLINE" },
    { key: "best_seller", header: "Best Seller", required: false, example: "false" },
  ];

  const VARIANT_COLS = [
    { key: "color", header: "Couleur *", required: true, example: "Doré" },
    { key: "sale_type", header: "Type de vente *", required: true, example: "UNIT" },
    { key: "size", header: "Taille *", required: true, example: "M" },
    { key: "is_primary", header: "Primaire", required: false, example: "true" },
    { key: "unit_price", header: "Prix unitaire *", required: true, example: "12.50" },
    { key: "stock", header: "Stock *", required: true, example: "200" },
    { key: "pack_qty", header: "Qté pack", required: false, example: "" },
    { key: "discount_type", header: "Type remise", required: false, example: "PERCENT" },
    { key: "discount_value", header: "Valeur remise", required: false, example: "10" },
    { key: "weight_g", header: "Poids (g)", required: false, example: "30" },
  ];

  const ALL_COLS = [...PRODUCT_COLS, ...VARIANT_COLS];

  // Ligne 1 : bandeaux fusionnés (texte de section)
  ws.mergeCells(1, 1, 1, PRODUCT_COLS.length);
  ws.getCell(1, 1).value = "🛍️ Fiche produit";
  ws.mergeCells(1, PRODUCT_COLS.length + 1, 1, ALL_COLS.length);
  ws.getCell(1, PRODUCT_COLS.length + 1).value = "🎨 Variante";

  // Ligne 2 : headers
  ALL_COLS.forEach((c, i) => {
    ws.getCell(2, i + 1).value = c.header;
  });

  // Ligne 3 : Obligatoire / Facultatif
  ALL_COLS.forEach((c, i) => {
    ws.getCell(3, i + 1).value = c.required ? "Obligatoire" : "Facultatif";
  });

  // Ligne 4 : exemples
  ALL_COLS.forEach((c, i) => {
    ws.getCell(4, i + 1).value = c.example ? `(ex : ${c.example})` : "(—)";
  });

  // Lignes 5-9 : 3 produits-exemple (5 lignes au total — TSH-002 en a 3)
  const samples: Record<string, string | number>[] = [
    {
      reference: "TSH-001", name: "T-shirt Essentiel", description: "T-shirt col rond",
      category: "T-shirt", composition: "Coton:100", tags: "basique",
      pays_fabrication: "Portugal", saison: "Été 2026", status: "OFFLINE",
      color: "Blanc", sale_type: "UNIT", size: "M", unit_price: 14.90, stock: 500,
      weight_g: 180, is_primary: "true",
    },
    {
      reference: "TSH-002", name: "T-shirt Oversize", description: "Oversize",
      category: "T-shirt", composition: "Coton:90,Élasthanne:10", tags: "oversize",
      pays_fabrication: "Turquie", saison: "Automne 2026", status: "OFFLINE",
      color: "Noir", sale_type: "UNIT", size: "L", unit_price: 24.90, stock: 300,
      weight_g: 220, is_primary: "true",
    },
    {
      reference: "TSH-002",
      color: "Kaki", sale_type: "UNIT", size: "M", unit_price: 24.90, stock: 200,
    },
    {
      reference: "TSH-002",
      color: "Beige", sale_type: "UNIT", size: "S", unit_price: 24.90, stock: 250,
      discount_type: "PERCENT", discount_value: 10,
    },
    {
      reference: "MOC-001", name: "Mocassin Cambridge", description: "Cuir",
      category: "Mocassin", composition: "Cuir:100", pays_fabrication: "Italie",
      status: "OFFLINE",
      color: "Marron", sale_type: "UNIT", size: "43", unit_price: 89.90, stock: 80,
      weight_g: 380, is_primary: "true",
    },
  ];

  samples.forEach((s, idx) => {
    ALL_COLS.forEach((c, i) => {
      const v = s[c.key];
      ws.getCell(5 + idx, i + 1).value = v ?? "";
    });
  });

  const arrBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrBuffer);
}

describe("Excel template — bandeau + Obligatoire/Facultatif + exemple", () => {
  let parsed: ReturnType<typeof parseExcel>;

  beforeAll(async () => {
    const buffer = await buildTemplateBuffer();
    parsed = parseExcel(buffer);
  });

  it("ignore le bandeau de section (ligne 1)", () => {
    const refs = parsed.map((r) => r.reference);
    // Aucun ref ne doit contenir « Fiche produit » ou « Variante »
    expect(refs.every((r) => !r.toLowerCase().includes("fiche produit"))).toBe(true);
    expect(refs.every((r) => !r.toLowerCase().includes("variante"))).toBe(true);
  });

  it("filtre la ligne « Obligatoire / Facultatif » (ligne 3)", () => {
    const refs = parsed.map((r) => r.reference.toLowerCase());
    expect(refs.includes("obligatoire")).toBe(false);
    expect(refs.includes("facultatif")).toBe(false);
  });

  it("filtre la ligne d'exemples (ligne 4)", () => {
    const refs = parsed.map((r) => r.reference);
    expect(refs.every((r) => !r.toLowerCase().startsWith("(ex"))).toBe(true);
  });

  it("lit les 5 lignes-exemple (3 produits, 5 variantes)", () => {
    expect(parsed.length).toBe(5);
  });

  it("conserve la référence du produit telle quelle dans Excel", () => {
    expect(parsed[0].reference).toBe("TSH-001");
    expect(parsed[1].reference).toBe("TSH-002");
    expect(parsed[2].reference).toBe("TSH-002");
    expect(parsed[3].reference).toBe("TSH-002");
    expect(parsed[4].reference).toBe("MOC-001");
  });

  it("lit les champs fiche produit sur la 1ʳᵉ ligne", () => {
    const p1 = parsed[0];
    expect(p1.name).toBe("T-shirt Essentiel");
    expect(p1.category).toBe("T-shirt");
    expect(p1.composition).toBe("Coton:100");
  });

  it("lit les champs obligatoires renommés avec « * » (Description *, Catégorie *, Composition *, Pays fabrication *, Saison *)", () => {
    // L'astérisque dans le nom du header ne doit pas casser la lecture des valeurs
    const p1 = parsed[0];
    expect(p1.description).toBe("T-shirt col rond");
    expect(p1.category).toBe("T-shirt");
    expect(p1.composition).toBe("Coton:100");
    expect(p1.manufacturingCountry).toBe("Portugal");
    expect(p1.season).toBe("Été 2026");
  });

  it("lit les champs variante sur chaque ligne", () => {
    expect(parsed[0].color).toBe("Blanc");
    expect(parsed[0].saleType).toBe("UNIT");
    expect(parsed[0].size).toBe("M");
    expect(parsed[0].unitPrice).toBe(14.90);
    expect(parsed[0].stock).toBe(500);
  });

  it("laisse les champs fiche produit vides sur les variantes secondaires", () => {
    // Lignes 2 et 3 de TSH-002 — pas de nom mais bien une couleur/prix
    expect(parsed[2].name).toBe("");
    expect(parsed[3].name).toBe("");
    expect(parsed[2].color).toBe("Kaki");
    expect(parsed[3].color).toBe("Beige");
  });

  it("groupe 3 références distinctes", () => {
    const uniqueRefs = new Set(parsed.map((r) => r.reference));
    expect(uniqueRefs.size).toBe(3);
  });

  it("compatibilité ancien fichier (sans bandeau de section)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Produits");
    ws.getCell(1, 1).value = "Référence *";
    ws.getCell(1, 2).value = "Nom *";
    ws.getCell(1, 3).value = "Couleur *";
    ws.getCell(1, 4).value = "Type de vente *";
    ws.getCell(1, 5).value = "Taille *";
    ws.getCell(1, 6).value = "Prix unitaire *";
    ws.getCell(1, 7).value = "Stock *";
    ws.getCell(2, 1).value = "OLD-001";
    ws.getCell(2, 2).value = "Ancien produit";
    ws.getCell(2, 3).value = "Rouge";
    ws.getCell(2, 4).value = "UNIT";
    ws.getCell(2, 5).value = "M";
    ws.getCell(2, 6).value = 19.90;
    ws.getCell(2, 7).value = 100;
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const legacyParsed = parseExcel(buf);
    expect(legacyParsed.length).toBe(1);
    expect(legacyParsed[0].reference).toBe("OLD-001");
    expect(legacyParsed[0].name).toBe("Ancien produit");
  });
});
