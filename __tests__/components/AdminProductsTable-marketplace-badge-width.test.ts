import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Sur la liste produits admin, les badges marketplace (PFS / Ankorstore /
// eFashion / Faire) sont rendus inline par 4 helpers locaux (MarketplaceBadge,
// AnkorstoreBadge, EfashionBadge, FaireBadge) — pas par le composant partagé
// StatusBadge. Chaque badge a 4-5 états (publishing, sync, published,
// non-publié avec actions, non-publié défaut).
//
// Pour que la cliente puisse scanner la colonne Marketplace verticalement,
// chaque badge doit avoir au moins min-w-[7.5rem] (120 px) — taille calée
// sur le plus long libellé courant (« Ankorstore · Synchro »).
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/AdminProductsTable.tsx",
  ),
  "utf8",
);

describe("AdminProductsTable — badges marketplace de largeur uniforme", () => {
  // Compte les classNames de badge marketplace qui contiennent min-w-[7.5rem].
  // 4 marketplaces × 5 états ≈ 20 instances, plus 4 wrappers Publier+Lier.
  const allBadges = (SRC.match(/inline-flex items-center justify-center gap-1[^"]*min-w-\[7\.5rem\]/g) ?? []).length;

  it("applique min-w-[7.5rem] sur les états publishing (4 marketplaces)", () => {
    // 3 indigo (PFS/Ankorstore/eFashion) + 1 rose (Faire)
    const publishing =
      (SRC.match(/min-w-\[7\.5rem\] rounded text-\[10px\] font-semibold bg-\[#EEF2FF\]/g) ?? []).length +
      (SRC.match(/min-w-\[7\.5rem\] rounded text-\[10px\] font-semibold bg-\[#FCE7F3\]/g) ?? []).length;
    expect(publishing).toBe(4);
  });

  it("applique min-w-[7.5rem] sur les états syncRequired (4 marketplaces)", () => {
    const sync = (SRC.match(/min-w-\[7\.5rem\] rounded text-\[10px\] font-semibold bg-\[#FFF7ED\]/g) ?? []).length;
    expect(sync).toBe(4);
  });

  it("applique min-w-[7.5rem] sur les états published (4 marketplaces)", () => {
    const published = (SRC.match(/min-w-\[7\.5rem\] rounded text-\[10px\] font-semibold bg-\[#F0FDF4\]/g) ?? []).length;
    expect(published).toBe(4);
  });

  it("applique min-w-[7.5rem] sur les états Non publié par défaut (4 marketplaces)", () => {
    const def = (SRC.match(/min-w-\[7\.5rem\] rounded text-\[10px\] font-semibold bg-bg-secondary/g) ?? []).length;
    expect(def).toBe(4);
  });

  it("applique min-w-[7.5rem] sur le wrapper Publier+Lier (4 marketplaces)", () => {
    const wrapper = (SRC.match(/<span className="inline-flex items-center justify-center gap-1 min-w-\[7\.5rem\]">/g) ?? []).length;
    expect(wrapper).toBe(4);
  });

  it("totalise au moins 20 emplacements aligné min-w-[7.5rem]", () => {
    expect(allBadges).toBeGreaterThanOrEqual(20);
  });
});
