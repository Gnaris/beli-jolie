import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Depuis la refonte 2026-07-28 : les badges marketplace de la fiche produit
// (`/admin/produits/[id]/modifier`) sont rendus en carte à 2 rangées via
// `MarketplaceCard` — nom + pastille en haut, boutons d'action (Synchroniser,
// Lier, Délier) en bas séparés par un filet fin. La contrainte de largeur
// uniforme n'a plus lieu d'être ici (composant plus utilisé dans la liste).
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/MarketplaceStatusButtons.tsx",
  ),
  "utf8",
);

describe("MarketplaceStatusButtons — carte marketplace à 2 rangées", () => {
  it("centre le contenu du header du badge (justify-center)", () => {
    // Le header reste centré verticalement pour aligner le logo rond avec le
    // nom et la pastille d'état.
    expect(SRC).toMatch(/inline-flex items-center justify-center gap-1\.5/);
  });

  it("wrap en carte rounded-2xl à largeur fixe avec les actions en dernière rangée", () => {
    // La carte externe :
    //   - rounded-2xl (bloc arrondi, plus large que l'ancienne pastille)
    //   - flex-col items-stretch (rangées empilées : header + sous-libellé + actions)
    //   - w-44 (largeur fixe partagée par toutes les cartes, pour que la ligne
    //     de badges reste alignée quel que soit l'état).
    expect(SRC).toMatch(/inline-flex flex-col items-stretch rounded-2xl border pt-1 pb-1\.5 px-2\.5 w-44/);
    // Filet de séparation entre le header et les icônes d'action.
    expect(SRC).toMatch(/pt-1 mt-0\.5 border-t/);
  });

  it("affiche le sous-libellé (« synchro nécessaire », marque PFS…) sur une 2ᵉ ligne sous le nom", () => {
    // Le texte long ne déborde plus horizontalement : il passe sous le nom
    // en plus petit (text-[10px]) mais gras.
    expect(SRC).toMatch(/secondaryLabel/);
    expect(SRC).toMatch(/text-\[10px\] font-bold leading-tight/);
  });

  it("les boutons d'action passent en w-6 h-6 fond blanc (au lieu de w-7 h-7 tone-teinté)", () => {
    // Boutons plus petits + fond blanc pour trancher visuellement avec la
    // teinte d'état de la carte (verte, orange, grise…).
    expect(SRC).toMatch(/w-6 h-6 rounded-full border/);
    expect(SRC).toMatch(/success: "bg-white text-\[#15803D\]/);
    expect(SRC).toMatch(/danger: "bg-white text-\[#DC2626\]/);
  });
});
