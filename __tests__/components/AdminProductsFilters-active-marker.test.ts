import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Indication visuelle ajoutée au panneau de filtres admin (juin 2026) :
// pastille emerald + libellé coloré pour repérer instantanément les
// filtres actuellement appliqués (parmi la vingtaine de menus).
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
