import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * Fiche produit — modales de création raccourcies alignées sur les vraies
 * modales hors fiche.
 *
 * Contexte : la cliente ne veut plus voir la petite QuickCreateModal quand
 * elle clique « + » à côté d'une catégorie / couleur / composition / saison
 * / pays. Elle veut la même modale riche que celle qui s'ouvre depuis
 * `/admin/produits?tab=couleurs` (ColorEditorModal, etc.).
 *
 * QuickCreateModal reste utilisée uniquement pour les sous-catégories et les
 * mots-clés — pas d'équivalent canonique aujourd'hui.
 */

const root = resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const FORM = read("components/admin/products/ProductForm.tsx");

describe("Fiche produit — modales canoniques", () => {
  it("importe les 5 modales canoniques (catégorie, couleur, composition, saison, pays)", () => {
    expect(FORM).toContain('from "@/components/admin/categories/CategoryEditorModal"');
    expect(FORM).toContain('from "@/components/admin/couleurs/ColorEditorModal"');
    expect(FORM).toContain('from "@/components/admin/compositions/CompositionEditorModal"');
    expect(FORM).toContain('from "@/components/admin/seasons/SeasonEditorModal"');
    expect(FORM).toContain('from "@/components/admin/manufacturing-countries/CountryEditModal"');
  });

  it("rend chaque modale canonique liée au bon modalType", () => {
    expect(FORM).toMatch(/<CategoryEditorModal[^>]*open=\{modalType === "category"\}/);
    expect(FORM).toMatch(/<ColorEditorModal[^>]*open=\{modalType === "color"\}/);
    expect(FORM).toMatch(/<CompositionEditorModal[^>]*open=\{modalType === "composition"\}/);
    expect(FORM).toMatch(/<SeasonEditorModal[^>]*open=\{modalType === "season"\}/);
    expect(FORM).toMatch(/<CountryEditModal[^>]*open=\{modalType === "country"\}/);
  });

  it("branche chaque modale canonique sur handleModalCreated", () => {
    // Comptage : au moins 5 onCreated={handleModalCreated} pour les 5 canoniques
    const matches = FORM.match(/onCreated=\{handleModalCreated\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  it("garde QuickCreateModal uniquement pour subcategory et tag", () => {
    // Le type passé n'accepte plus que subcategory / tag
    expect(FORM).toContain('modalType === "subcategory" || modalType === "tag" ? modalType : "subcategory"');
    // Et n'ouvre plus la QuickCreateModal pour les 5 autres cas
    expect(FORM).toMatch(/<QuickCreateModal[\s\S]*?open=\{modalType === "subcategory" \|\| modalType === "tag"\}/);
  });

  it("handleModalCreated propage patternImage sur la création couleur", () => {
    // Vérifie que si le ColorEditorModal renvoie un motif, on l'ajoute au state local
    expect(FORM).toMatch(/patternImage: item\.patternImage \?\? null/);
  });

  it("le déclencheur « + » de chaque champ reste bien en place", () => {
    expect(FORM).toContain('setModalType("category")');
    expect(FORM).toContain('setModalType("subcategory")');
    expect(FORM).toContain('setModalType("country")');
    expect(FORM).toContain('setModalType("season")');
    expect(FORM).toContain('setModalType("tag")');
    expect(FORM).toContain('setModalType("composition")');
  });
});
