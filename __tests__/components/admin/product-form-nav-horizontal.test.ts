import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * Nav sections fiche produit en barre horizontale (validée cliente 2026-08-21).
 * L'ancienne sidebar verticale 240 px a été remplacée par une barre en ligne
 * au-dessus du formulaire pour élargir la zone de contenu.
 */

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const NAV = read("components/admin/products/ProductFormNav.tsx");
const FORM = read("components/admin/products/ProductForm.tsx");

describe("ProductFormNav — orientation horizontale", () => {
  it("le conteneur nav wrappe sur plusieurs lignes plutôt que de tronquer", () => {
    expect(NAV).toContain("flex-wrap");
    // Ne contient plus la structure sidebar (space-y-0.5, max-h-[calc])
    expect(NAV).not.toContain("space-y-0.5");
    expect(NAV).not.toContain("max-h-[calc");
    // Ne recourt plus au scroll horizontal (wrap remplace overflow-x-auto)
    expect(NAV).not.toContain("overflow-x-auto");
  });

  it("chaque section est rendue comme une pastille (rounded-full)", () => {
    expect(NAV).toContain("rounded-full");
  });

  it("une fine barre verticale sépare chaque section", () => {
    expect(NAV).toContain('data-testid="nav-section-separator"');
    expect(NAV).toContain("w-px");
    expect(NAV).toContain("bg-border");
  });

  it("la barre est visible dès md (tablette+), le picker prend le relais en dessous", () => {
    expect(NAV).toContain("hidden md:block");
  });

  it("ProductForm n'utilise plus la grille sidebar+contenu (240 px)", () => {
    expect(FORM).not.toContain("grid-cols-[240px");
  });
});
