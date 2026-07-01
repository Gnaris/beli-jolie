import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * Refonte Ardoise du formulaire produit (variante B "Cockpit à onglets"
 * validée par la cliente le 2026-07-01) :
 *   - En-tête enrichi : toggle Best-seller + KPI row.
 *   - Layout onglets contrôlés (activeSection) + picker modal mobile.
 *   - Remise déplacée de "Mots-clés" vers "Variantes".
 *   - Similaires + Contenu de l'ensemble fusionnés en "Produits associés".
 *   - Composition avec sliders custom + total coloré.
 */

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const CONTEXT = read("components/admin/products/ProductFormHeaderContext.tsx");
const BESTSELLER = read("components/admin/products/BestSellerToggle.tsx");
const KPI_ROW = read("components/admin/products/KpiRow.tsx");
const PICKER = read("components/admin/products/ProductFormSectionPicker.tsx");
const WRAPPER = read("components/admin/products/ProductEditWrapper.tsx");
const NAV = read("components/admin/products/ProductFormNav.tsx");
const FORM = read("components/admin/products/ProductForm.tsx");

describe("Refonte Ardoise fiche produit — en-tête enrichi", () => {
  it("le contexte header porte isBestSeller et kpi (bloc étendu)", () => {
    expect(CONTEXT).toMatch(/isBestSeller\s*:\s*boolean/);
    expect(CONTEXT).toMatch(/kpi\s*:\s*ProductFormKpi/);
    expect(CONTEXT).toContain("BestSellerToggleCallbacks");
    expect(CONTEXT).toContain("registerBestSellerToggle");
  });

  it("BestSellerToggle consomme le contexte + affiche une étoile", () => {
    expect(BESTSELLER).toContain("useProductFormHeader");
    expect(BESTSELLER).toContain("bestSellerToggle");
    // Étoile SVG
    expect(BESTSELLER).toMatch(/M9\.049 2\.927/);
    // Style doré quand actif
    expect(BESTSELLER).toContain("#F59E0B");
  });

  it("KpiRow affiche les 4 tuiles clés", () => {
    expect(KPI_ROW).toContain("useProductFormHeader");
    expect(KPI_ROW).toContain("Prix");
    expect(KPI_ROW).toContain("Stock total");
    expect(KPI_ROW).toContain("Marketplaces");
    expect(KPI_ROW).toContain("Statut");
    // Barre de complétude
    expect(KPI_ROW).toContain("completeness");
  });

  it("ProductEditWrapper intègre KpiRow + BestSellerToggle", () => {
    expect(WRAPPER).toContain("import { BestSellerToggle }");
    expect(WRAPPER).toContain("import { KpiRow }");
    expect(WRAPPER).toContain("<KpiRow />");
    expect(WRAPPER).toContain("<BestSellerToggle />");
  });

  it("ProductForm publie isBestSeller + kpi via updateHeader", () => {
    expect(FORM).toContain("updateHeader({ isBestSeller })");
    expect(FORM).toContain("updateHeader({ kpi: headerKpi })");
    expect(FORM).toContain("registerBestSellerToggle");
  });
});

describe("Refonte Ardoise fiche produit — layout onglets", () => {
  it("ProductFormNav est contrôlé via activeSection / onSectionChange", () => {
    expect(NAV).toContain("activeSection?: ProductFormSectionKey");
    expect(NAV).toContain("onSectionChange?:");
    // Le scroll spy interne (IntersectionObserver) est retiré au profit du contrôle
    expect(NAV).not.toContain("IntersectionObserver");
  });

  it("ProductForm gère activeSection et le passe à la nav", () => {
    expect(FORM).toContain("const [activeSection,");
    expect(FORM).toContain("setActiveSection");
    expect(FORM).toContain("activeSection={activeSection}");
    expect(FORM).toContain("onSectionChange={setActiveSection}");
  });

  it("chaque section est cachée quand elle n'est pas active", () => {
    expect(FORM).toContain('id="section-overview" hidden={activeSection !== "overview"}');
    expect(FORM).toContain('id="section-info" hidden={activeSection !== "info"}');
    expect(FORM).toContain('id="section-details" hidden={activeSection !== "details"}');
    expect(FORM).toContain('id="section-variants" hidden={activeSection !== "variants"}');
    expect(FORM).toContain('id="section-links" hidden={activeSection !== "links"}');
  });

  it("le picker mobile existe et est masqué sur desktop (xl:hidden)", () => {
    expect(PICKER).toContain("xl:hidden");
    expect(PICKER).toContain("Section actuelle");
    expect(PICKER).toContain("onSectionChange");
    // Utilisé dans ProductForm
    expect(FORM).toContain("<ProductFormSectionPicker");
  });
});

describe("Refonte Ardoise fiche produit — remise déplacée + associés fusionnés", () => {
  it("la remise n'est plus dans TagsDropdown", () => {
    // Le composant TagsDropdown reçoit toujours discountPercent en prop
    // (pour rétro-compat de l'API, on ne casse rien), mais l'ancien bloc
    // "Remise produit" a été retiré de son rendu.
    const tagsDropdown = FORM.substring(
      FORM.indexOf("function TagsDropdown"),
      FORM.indexOf("export default function ProductForm"),
    );
    expect(tagsDropdown).not.toContain("Remise produit");
    expect(tagsDropdown).not.toContain("Best Seller");
  });

  it("un nouveau bloc Remise apparaît dans la section Variantes", () => {
    expect(FORM).toContain("Remise appliquée (%)");
    expect(FORM).toContain("S'applique à toutes les variantes");
    expect(FORM).toContain("Prix client");
  });

  it("Produits similaires + Contenu de l'ensemble fusionnés dans une seule section", () => {
    expect(FORM).toContain("Produits associés");
    expect(FORM).toContain("Suggestions similaires");
    expect(FORM).toContain("Contenu de l&apos;ensemble");
    // La nav reflète le renommage
    expect(NAV).toContain('label: "Produits associés"');
  });
});

describe("Refonte Ardoise fiche produit — composition avec sliders", () => {
  it("chaque matériau utilise un input range (slider) + input pourcentage", () => {
    // Extrait de la section Composition
    const compStart = FORM.indexOf("BLOC COMPOSITION");
    const compEnd = FORM.indexOf("Variantes couleur", compStart);
    const comp = FORM.substring(compStart, compEnd);
    expect(comp).toMatch(/type="range"/);
    // Le "Total composition" est mis en avant
    expect(comp).toContain("Total composition");
  });
});
