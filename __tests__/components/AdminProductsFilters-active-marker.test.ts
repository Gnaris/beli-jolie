import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Deux indications visuelles ont été ajoutées au panneau de filtres admin
// (juin 2026) :
//   1. Une pastille emerald + libellé coloré pour repérer instantanément
//      les filtres actuellement appliqués (parmi la vingtaine de menus).
//   2. Une pastille uniforme (largeur fixe) sur le nom des marketplaces dans
//      la colonne « Marketplaces » — toutes les pastilles ont la même largeur
//      calée sur la plus longue (« Paris Fashion Shop »).
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/AdminProductsFilters.tsx",
  ),
  "utf8",
);

describe("AdminProductsFilters — repère visuel des filtres actifs", () => {
  it("FilterField accepte une prop active", () => {
    expect(SRC).toMatch(/active\?\s*:\s*boolean/);
  });

  it("affiche une pastille emerald quand active=true", () => {
    expect(SRC).toContain("bg-emerald-500");
    expect(SRC).toContain("text-emerald-700");
  });

  it("propage active={!!url…} sur chaque dropdown principal", () => {
    // On vérifie au moins les filtres centraux (statut, catégorie, prix)
    expect(SRC).toContain("active={!!urlCat}");
    expect(SRC).toContain("active={!!urlStatus}");
    expect(SRC).toContain("active={!!urlMinPrice}");
    expect(SRC).toContain("active={!!urlMaxPrice}");
  });

  it("propage active={!!url…} sur les filtres marketplace", () => {
    expect(SRC).toContain("active={!!urlPfsLink}");
    expect(SRC).toContain("active={!!urlAnkorsLink}");
    expect(SRC).toContain("active={!!urlEfashionLink}");
    expect(SRC).toContain("active={!!urlFaireLink}");
    expect(SRC).toContain("active={!!urlSyncRequired}");
  });
});

describe("AdminProductsFilters — pastilles marketplace de largeur uniforme", () => {
  it("définit un composant MarketplaceChip avec min-width fixe", () => {
    expect(SRC).toContain("function MarketplaceChip");
    // min-width = largeur de la plus longue marketplace (« Paris Fashion Shop »)
    expect(SRC).toMatch(/min-w-\[7\.5rem\]/);
  });

  it("utilise MarketplaceLabel pour tous les libellés marketplace", () => {
    // 4 dropdowns « Lien {marketplace} » + 5 « Dernier export {marketplace} »
    // + 1 « Synchronisation » = 10 instances minimum.
    const count = (SRC.match(/<MarketplaceLabel /g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(10);
  });
});
