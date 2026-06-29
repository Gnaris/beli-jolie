import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tous les badges marketplace de la liste produits admin doivent avoir la
// même largeur visuelle (calée sur le plus long libellé courant — « Paris
// Fashion Shop · Belicia »). La cliente lit la colonne « Marketplace »
// verticalement sans que les badges se décalent.
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/MarketplaceStatusButtons.tsx",
  ),
  "utf8",
);

describe("MarketplaceStatusButtons — badges marketplace de largeur uniforme", () => {
  it("applique min-w-[12rem] sur le bouton du StatusBadge", () => {
    // 12rem = 192 px : fits « Paris Fashion Shop · Belicia » au font-size
    // du badge (text-[11px] font-semibold). Les états plus longs (« Non
    // publié … » ou « Synchro nécessaire ») dépassent naturellement, c'est
    // volontaire.
    expect(SRC).toMatch(/min-w-\[12rem\]/);
  });

  it("centre le contenu du badge (justify-center)", () => {
    // Sans justify-center, le contenu reste collé à gauche et la largeur
    // uniforme génère un vide à droite. Centré, l'alignement est propre.
    expect(SRC).toMatch(/inline-flex items-center justify-center gap-1\.5/);
  });
});
