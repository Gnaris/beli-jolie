import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Sur la liste produits admin, les badges marketplace (PFS / Ankorstore /
// eFashion / Faire) sont rendus inline par 4 helpers locaux (MarketplaceBadge,
// AnkorstoreBadge, EfashionBadge, FaireBadge) — pas par le composant partagé
// StatusBadge. Chaque badge a 4 états visibles (publishing, syncRequired,
// published/linked, non-publié).
//
// Depuis la refonte responsive validée le 2026-07-13 : les badges desktop
// affichent juste le libellé (PFS/EF/ANKOR/Faire) — plus de sous-libellé
// "en ligne / à sync / hors ligne". La couleur du fond suffit à indiquer
// l'état. Pour que la cliente puisse scanner la colonne verticalement, tous
// les badges doivent avoir la même dimension : w-[62px] h-[36px].

const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/AdminProductsTable.tsx",
  ),
  "utf8",
);

describe("AdminProductsTable — badges marketplace de largeur uniforme (62×36)", () => {
  // Compte toutes les occurrences de la paire w-[62px] h-[36px] côte à côte.
  const badgeSize = (SRC.match(/w-\[62px\] h-\[36px\]/g) ?? []).length;

  it("applique w-[62px] h-[36px] sur les 19 emplacements attendus (4 MP × 4 états + 2 fallbacks + Microstore)", () => {
    // 4 badges × 4 états (publishing, sync, published, not-published) = 16
    // + 2 fallbacks (EF/Faire quand marketplace non-configurée) = 2
    // + 1 badge Microstore = 1
    // → 19 emplacements
    expect(badgeSize).toBe(19);
  });

  it("les 4 badges 'published' partagent le même fond vert #F0FDF4", () => {
    const published = (SRC.match(/w-\[62px\] h-\[36px\] rounded-md text-\[11[.5]*px\] font-semibold bg-\[#F0FDF4\]/g) ?? []).length;
    expect(published).toBe(4);
  });

  it("les 4 badges 'syncRequired' partagent le même fond orange #FFF7ED", () => {
    const sync = (SRC.match(/w-\[62px\] h-\[36px\] rounded-md text-\[11[.5]*px\] font-semibold bg-\[#FFF7ED\]/g) ?? []).length;
    expect(sync).toBe(4);
  });

  it("les 4 badges 'publishing' partagent le même style loading (indigo ou rose)", () => {
    const indigo = (SRC.match(/w-\[62px\] h-\[36px\] rounded-md text-\[10px\] font-semibold bg-\[#EEF2FF\]/g) ?? []).length;
    const rose   = (SRC.match(/w-\[62px\] h-\[36px\] rounded-md text-\[10px\] font-semibold bg-\[#FCE7F3\]/g) ?? []).length;
    expect(indigo + rose).toBe(4);
  });

  it("les badges 'not published' avec action utilisent le rouge #FEF2F2 (≥ 4 emplacements)", () => {
    // 4 badges cliquables (state = onActionClick défini) — variantes dans le ternaire className
    // + éventuellement d'autres surfaces d'action rouge (bandeaux publication échouée).
    const notPub = (SRC.match(/bg-\[#FEF2F2\] text-\[#DC2626\]/g) ?? []).length;
    expect(notPub).toBeGreaterThanOrEqual(4);
  });
});

describe("AdminProductsTable — badges desktop ne contiennent PLUS le sous-libellé", () => {
  it("aucun badge published ne contient formatRelativeDate en sous-libellé", () => {
    // Après la refonte, la date passe dans le tooltip (title=...) uniquement.
    // Le sous-libellé <span className="text-[8.5px]"> a été retiré.
    const subLabel = (SRC.match(/text-\[8\.5px\] opacity-70 font-medium tabular-nums/g) ?? []).length;
    expect(subLabel).toBe(0);
  });

  it("aucun badge syncRequired ne contient le texte '· Synchro' visible", () => {
    // Le texte "PFS · Synchro" / "Faire · Synchro" a été retiré du contenu.
    // L'état syncRequired est signalé uniquement par la couleur orange + la pastille pulsante.
    expect(SRC).not.toMatch(/PFS · Synchro/);
    expect(SRC).not.toMatch(/EF · Synchro/);
    expect(SRC).not.toMatch(/ANKOR · Synchro/);
    expect(SRC).not.toMatch(/Faire · Synchro/);
  });

  it("garde la date de dernier export dans le tooltip (title=…dernier export…)", () => {
    // La date de sync n'est pas perdue : elle est déplacée dans le title.
    const tooltips = (SRC.match(/dernier export \$\{formatRelativeDate\(lastExportedAt\)\}/g) ?? []).length;
    expect(tooltips).toBe(4);
  });
});
