import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Symétrique à MarketplaceStatusButtons-block-toggle.test.ts pour la carte
// Microstore, qui a son propre composant (sync directe, sans queue).
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/MicrostoreStatusCard.tsx",
  ),
  "utf8",
);

describe("MicrostoreStatusCard — bouton bloquer/débloquer", () => {
  it("importe la server action setProductMarketplaceEnabled", () => {
    expect(SRC).toMatch(
      /from "@\/app\/actions\/admin\/product-marketplace-enabled"/,
    );
    expect(SRC).toMatch(/import\s*\{\s*setProductMarketplaceEnabled\s*\}/);
  });

  it("expose 2 icônes cadenas (ouvert / fermé)", () => {
    expect(SRC).toMatch(/LockOpen:\s*\(/);
    expect(SRC).toMatch(/\bLock:\s*\(/);
  });

  it("expose un handleToggleBlock qui appelle setProductMarketplaceEnabled avec « microstore »", () => {
    expect(SRC).toMatch(/async function handleToggleBlock\(\)/);
    expect(SRC).toMatch(
      /setProductMarketplaceEnabled\(\s*productId,\s*"microstore",\s*!microstoreEnabledForProduct/,
    );
  });

  it("demande une confirmation seulement au blocage (déblocage immédiat)", () => {
    // Confirmation s'ouvre uniquement si actuellement autorisé.
    expect(SRC).toMatch(
      /if\s*\(\s*microstoreEnabledForProduct\s*\)\s*\{[\s\S]*confirm\(/,
    );
    expect(SRC).toMatch(/title:\s*"Bloquer Microstore pour ce produit \?"/);
  });

  it("distingue le blocage produit-seul du blocage global (blockedForProductOnly)", () => {
    expect(SRC).toMatch(/blockedForProductOnly\s*=/);
    // Le cadenas reste affichable même si `disabled` est vrai — condition
    // canShowBlockToggle isole les cas où on peut basculer (pas maintenance,
    // pas expired, pas kill switch, config présente).
    expect(SRC).toMatch(/canShowBlockToggle\s*=/);
  });

  it("garde la barre d'actions visible en état bloqué pour ce produit uniquement", () => {
    // showActionsBar = !disabled || blockedForProductOnly
    expect(SRC).toMatch(/showActionsBar\s*=\s*!disabled\s*\|\|\s*blockedForProductOnly/);
    // Les autres actions (push/link/unlink) sont wrappées dans !blockedForProductOnly.
    expect(SRC).toMatch(/\{\s*!blockedForProductOnly\s*&&\s*\(/);
  });

  it("le blockToggle bascule via l'état microstoreEnabledForProduct (pas de unlink)", () => {
    // On ne veut pas délier la fiche Microstore existante en bloquant — juste
    // couper le flux automatique. L'appel a exactement 3 arguments (id, mp, next).
    expect(SRC).not.toMatch(/setProductMarketplaceEnabled\([^)]*unlink/);
  });

  it("libellé disabledReason mentionne explicitement le cadenas quand blocage produit-seul", () => {
    // Aide à guider la cliente vers le bon bouton depuis le tooltip.
    expect(SRC).toMatch(/Microstore bloquée pour ce produit — cliquez sur le cadenas/);
  });
});
