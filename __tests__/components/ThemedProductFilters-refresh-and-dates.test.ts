import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Panneau de filtres de /admin/produits (juillet 2026) :
// - Nouveau filtre « Jamais rafraîchi » (enum refresh : never | recent | refreshed)
//   remplace l'ancien bool « Nouveautés » qui envoyait refresh=1, ignoré par
//   buildAdminProductsWhere.
// - Popover « Plus » renommé « Dates » avec libellés explicites
//   « Créé après le » / « Créé avant le » pour les bornes dateFrom / dateTo.

const THEMED = readFileSync(
  resolve(__dirname, "../../components/admin/products/ThemedProductFilters.tsx"),
  "utf8",
);
const HEADER = readFileSync(
  resolve(__dirname, "../../components/admin/products/CompactFiltersHeader.tsx"),
  "utf8",
);

describe("ThemedProductFilters — filtre Rafraîchissement", () => {
  it("expose les 3 états enum du backend (never / recent / refreshed)", () => {
    expect(THEMED).toContain('v: "never"');
    expect(THEMED).toContain('v: "recent"');
    expect(THEMED).toContain('v: "refreshed"');
  });

  it("affiche le libellé « Jamais rafraîchi »", () => {
    expect(THEMED).toContain("Jamais rafraîchi");
  });

  it("ne conserve plus le bool cassé « Nouveautés (30 derniers j) »", () => {
    // L'ancien BoolBtn envoyait refresh=1, valeur ignorée par
    // buildAdminProductsWhere — on doit être passé sur un CustomSelect.
    expect(THEMED).not.toContain('BoolBtn urlKey="refresh"');
  });
});

describe("ThemedProductFilters — popover Dates", () => {
  it("renomme le thème « ⋯ Plus » en « 📅 Dates » pour la découvrabilité", () => {
    expect(THEMED).toContain('emoji: "📅", label: "Dates"');
  });

  it("affiche des libellés explicites « Créé après le » / « Créé avant le »", () => {
    expect(THEMED).toContain("Créé après le");
    expect(THEMED).toContain("Créé avant le");
  });

  it("branche les inputs sur dateFrom / dateTo côté URL", () => {
    expect(THEMED).toContain("setParam({ dateFrom: e.target.value })");
    expect(THEMED).toContain("setParam({ dateTo: e.target.value })");
  });
});

describe("CompactFiltersHeader — pill Rafraîchissement", () => {
  it("affiche le bon libellé selon la valeur enum de refresh", () => {
    expect(HEADER).toContain('never: "Jamais rafraîchi"');
    expect(HEADER).toContain('recent: "Rafraîchi récemment (30 j)"');
    expect(HEADER).toContain('refreshed: "Déjà rafraîchi"');
  });

  it("ne compare plus refresh === \"1\" (bug pill sur l'ancien bool)", () => {
    expect(HEADER).not.toContain('if (refresh === "1")');
  });
});
