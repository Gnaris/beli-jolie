import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRODUCT_FORM = readFileSync(
  resolve(__dirname, "../../components/admin/products/ProductForm.tsx"),
  "utf8",
);

const CUSTOM_SELECT = readFileSync(
  resolve(__dirname, "../../components/ui/CustomSelect.tsx"),
  "utf8",
);

describe("Fiche produit — drapeau pour chaque pays de fabrication", () => {
  it("importe le helper countryFlagUrl", () => {
    expect(PRODUCT_FORM).toContain("countryFlagUrl");
  });

  it("attache un iconUrl au drapeau pour chaque pays du sélecteur", () => {
    // On isole le bloc CustomSelect du pays via son placeholder "— Aucun —".
    const idx = PRODUCT_FORM.indexOf('placeholder="— Aucun —"');
    expect(idx).toBeGreaterThan(-1);
    const start = PRODUCT_FORM.lastIndexOf("<CustomSelect", idx);
    const end = PRODUCT_FORM.indexOf("/>", idx);
    const block = PRODUCT_FORM.slice(start, end + 2);
    expect(block).toContain("iconUrl: c.isoCode ? countryFlagUrl(c.isoCode) : undefined");
  });

  it("CustomSelect expose bien un champ iconUrl dans SelectOption", () => {
    expect(CUSTOM_SELECT).toMatch(/iconUrl\?:\s*string/);
  });

  it("CustomSelect rend une <img> quand iconUrl est renseigné (option et trigger)", () => {
    // Deux occurrences attendues : dans l'option de la liste et dans le bouton résumé.
    const matches = CUSTOM_SELECT.match(/opt\.iconUrl\s*\?/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(CUSTOM_SELECT).toContain("selected?.iconUrl");
  });
});
