import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Bouton « bloquer / débloquer » ajouté dans chaque badge marketplace de la
// fiche produit. Remplace l'ancien onglet « Configuration Marketplace ». Le
// bouton reste visible même quand le badge est grisé pour cause de blocage,
// afin de pouvoir débloquer en 1 clic sans quitter la fiche produit.
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/MarketplaceStatusButtons.tsx",
  ),
  "utf8",
);

describe("MarketplaceStatusButtons — bouton bloquer/débloquer", () => {
  it("importe la server action setProductMarketplaceEnabled", () => {
    expect(SRC).toMatch(
      /from "@\/app\/actions\/admin\/product-marketplace-enabled"/,
    );
    expect(SRC).toMatch(/import\s*\{\s*setProductMarketplaceEnabled\s*\}/);
  });

  it("expose 2 icônes cadenas (ouvert = non bloqué, fermé = bloqué)", () => {
    expect(SRC).toMatch(/LockOpen:\s*\(/);
    expect(SRC).toMatch(/\bLock:\s*\(/);
  });

  it("MarketplaceCard accepte une prop blockToggle avec blocked/onToggle/busy", () => {
    expect(SRC).toMatch(/blockToggle\?:\s*\{[^}]*blocked:\s*boolean/);
    expect(SRC).toMatch(/blockToggle\?:\s*\{[^}]*onToggle:\s*\(\)\s*=>\s*void/);
    expect(SRC).toMatch(/blockToggle\?:\s*\{[^}]*busy:\s*boolean/);
  });

  it("garde la barre d'actions visible quand le badge est bloqué uniquement pour ce produit", () => {
    // blockedForProductOnly = seule raison "product" → on affiche juste le
    // cadenas fermé pour permettre de débloquer d'un clic.
    expect(SRC).toMatch(/blockedForProductOnly/);
    expect(SRC).toMatch(/disabledForProduct\s*&&\s*disabledReason\s*===\s*"product"/);
    // Les autres actions (refresh/link/unlink) sont cachées.
    expect(SRC).toMatch(/!blockedForProductOnly\s*&&\s*actions/);
  });

  it("demande une confirmation seulement au blocage (le déblocage est immédiat)", () => {
    // La confirmation ne s'ouvre que si currentlyEnabled = true (blocage).
    expect(SRC).toMatch(/if\s*\(\s*currentlyEnabled\s*\)\s*\{[\s\S]*confirm\(/);
    // Le titre de la confirmation mentionne explicitement « Bloquer ».
    expect(SRC).toMatch(/title:\s*`Bloquer \$\{marketplaceLabel\} pour ce produit \?`/);
  });

  it("appelle setProductMarketplaceEnabled avec !currentlyEnabled (bascule)", () => {
    expect(SRC).toMatch(
      /setProductMarketplaceEnabled\(\s*productId,\s*marketplace,\s*!currentlyEnabled/,
    );
  });

  it("chaque marketplace (PFS/Ankor/eFa/Faire/OC) passe un blockToggle conditionnel", () => {
    // 5 occurrences attendues (une par MarketplaceCard).
    const occurrences = SRC.match(/blockToggle=\{/g) ?? [];
    expect(occurrences.length).toBe(5);
  });

  it("le blockToggle est undefined quand la marketplace est HS globalement (maintenance / kill switch / non configurée)", () => {
    // Ex PFS : hasPfsConfig && !pfsMaintenance && pfsEnabled → sinon undefined
    expect(SRC).toMatch(
      /hasPfsConfig\s*&&\s*!pfsMaintenance\s*&&\s*pfsEnabled[\s\S]*?:\s*undefined/,
    );
  });

  it("un seul busy en même temps via blockBusyKey (évite double clic sur 2 badges)", () => {
    expect(SRC).toMatch(/blockBusyKey.*MarketplaceKey\s*\|\s*null/);
    expect(SRC).toMatch(/setBlockBusyKey\(marketplace\)/);
    expect(SRC).toMatch(/setBlockBusyKey\(null\)/);
  });

  it("le handler ne délie jamais la fiche marketplace (opts.unlink absent)", () => {
    // On veut un « bouton pause » — la fiche marketplace reste liée côté site.
    // L'appel doit être setProductMarketplaceEnabled(productId, mp, next) SANS
    // 4ᵉ argument opts.
    expect(SRC).not.toMatch(/setProductMarketplaceEnabled\([^)]*unlink/);
  });
});
