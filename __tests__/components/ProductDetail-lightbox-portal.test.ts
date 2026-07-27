import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Régression : la lightbox de la fiche produit doit être portée dans
// document.body via createPortal, sinon elle reste piégée dans le contexte
// d'empilement `relative z-10` du layout produit et le header fixe (z-50)
// recouvre le haut de l'image.
describe("ProductDetail — lightbox portal", () => {
  const source = readFileSync(
    join(process.cwd(), "components/produits/ProductDetail.tsx"),
    "utf8",
  );

  it("importe createPortal depuis react-dom", () => {
    expect(source).toMatch(/import\s*\{\s*createPortal\s*\}\s*from\s*["']react-dom["']/);
  });

  it("porte la lightbox vers document.body", () => {
    const lightboxStart = source.indexOf("{/* Lightbox");
    expect(lightboxStart).toBeGreaterThan(-1);
    const lightboxBlock = source.slice(lightboxStart, lightboxStart + 2000);
    expect(lightboxBlock).toMatch(/createPortal\(/);
    expect(lightboxBlock).toMatch(/document\.body/);
  });
});
