import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Quand un produit est dans le lot Shooting eFashion (`useEfashionShootingBatch`)
// mais pas encore commité, son badge eFashion doit passer en jaune vif pour
// signaler à la cliente qu'il est en attente de validation shooting. C'est un
// état distinct visuellement du orange « synchro nécessaire ».
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/MarketplaceStatusButtons.tsx",
  ),
  "utf8",
);

describe("MarketplaceStatusButtons — badge jaune « en attente shooting »", () => {
  it("expose une prop awaitingShooting sur StatusBadge", () => {
    expect(SRC).toMatch(/awaitingShooting\?: boolean/);
  });

  it("lit les produits en attente depuis useEfashionShootingBatch", () => {
    expect(SRC).toMatch(/items:\s*efashionShootingItems/);
    expect(SRC).toMatch(/efashionShootingItems\.find\(/);
  });

  it("passe awaitingShooting au badge eFashion (pas aux autres marketplaces)", () => {
    expect(SRC).toMatch(/awaitingShooting=\{efashionAwaitingShooting\}/);
    // Sécurité : la variable ne doit être passée qu'au badge eFashion.
    const occurrences = SRC.match(/awaitingShooting=\{efashionAwaitingShooting\}/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("applique un style jaune vif (yellow-500 border) prioritaire sur syncRequired", () => {
    // #EAB308 = yellow-500 (bordure + dot). #FEF08A = yellow-200 (fond).
    // Depuis la refonte carte, ces classes sont réparties dans getCardStateClasses
    // (bg + border sur la carte, text sur le header) — on vérifie leur présence
    // simultanée sans exiger qu'elles soient sur la même ligne.
    expect(SRC).toMatch(/bg-\[#FEF08A\] border-\[#EAB308\]/);
    expect(SRC).toMatch(/text-\[#713F12\]/);
    // La cascade de classes doit tester awaitingShooting AVANT state.syncRequired.
    const awaitingIdx = SRC.indexOf("awaitingShooting");
    const syncIdx = SRC.indexOf("state.syncRequired");
    expect(awaitingIdx).toBeGreaterThan(-1);
    expect(syncIdx).toBeGreaterThan(awaitingIdx);
  });

  it("affiche le libellé « en attente shooting »", () => {
    expect(SRC).toMatch(/"en attente shooting"/);
  });

  it("distingue PUBLISH vs REFRESH dans le libellé du badge", () => {
    // Un produit REFRESH (déjà lié à eFashion) doit être signalé comme
    // « en attente shooting (maj) » — la cliente sait ainsi que c'est un
    // renouvellement de shooting, pas une première publication.
    expect(SRC).toMatch(/en attente shooting \(maj\)/);
  });

  it("empêche le clic d'ouvrir la modale de publication quand awaiting shooting", () => {
    // Le badge jaune est purement informatif — cliquer dessus ne doit ni
    // rouvrir la modale de publish, ni relancer un resync, tant que le lot
    // shooting n'est pas commité.
    expect(SRC).toMatch(/if \(efashionAwaitingShooting\) return;/);
  });
});
