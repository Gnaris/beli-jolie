import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Le modèle Excel d'import doit exposer une feuille « Valeurs autorisées »
// listant tous les noms valides en BDD (catégories, sous-catégories, tags,
// matières, couleurs, tailles, pays, saisons, codes SH) et brancher des
// listes déroulantes natives sur les colonnes mono-valeur (catégorie,
// couleur principale, couleur variante, pays, saison, code SH).
//
// Les colonnes multi-valeurs (sous-catégories, tags, composition, taille)
// gardent une saisie libre — Excel ne sait pas faire de multi-select dans
// une cellule — mais la feuille de référence les liste comme aide à
// l'orthographe.
//
// On vérifie au niveau du source pour rester rapide et indépendant
// d'ExcelJS (la génération réelle nécessite une session admin).
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../app/api/admin/products/import/template/route.ts",
  ),
  "utf8",
);

describe("Modèle Excel d'import — feuille « Valeurs autorisées » & dropdowns", () => {
  describe("Chargement des données de référence", () => {
    it("importe les helpers cached-data nécessaires (catégories, couleurs, tags, compositions, tailles, pays, saisons, codes SH)", () => {
      expect(SRC).toMatch(/import\s*\{[^}]*getCachedCategories[^}]*\}\s*from\s*"@\/lib\/cached-data"/s);
      for (const helper of [
        "getCachedCategories",
        "getCachedColors",
        "getCachedTags",
        "getCachedCompositions",
        "getCachedSizes",
        "getCachedManufacturingCountries",
        "getCachedSeasons",
        "getCachedHsCodes",
      ]) {
        expect(SRC).toContain(helper);
      }
    });

    it("appelle les helpers en parallèle via Promise.all", () => {
      expect(SRC).toMatch(/Promise\.all\s*\(\s*\[\s*[\s\S]*getCachedCategories\(\)/);
    });

    it("regroupe les sous-catégories par catégorie parente sur une ligne (jointes par ', ')", () => {
      // Chaque entrée de subCategoriesByCategory est alignée avec categoryNames :
      // une ligne dans la feuille « Valeurs autorisées » = une catégorie, et la
      // colonne B contient ses sous-catégories triées, jointes par ", ".
      expect(SRC).toMatch(/subCategoriesByCategory\s*=\s*categoriesData\.map/);
      expect(SRC).toMatch(/\.sort\(\([^)]*\)\s*=>\s*[a-z]+\.localeCompare\([a-z]+,\s*"fr"\)\)/);
      expect(SRC).toMatch(/\.join\(",\s*"\)/);
    });
  });

  describe("Feuille « Valeurs autorisées »", () => {
    it("définit le nom de la feuille de référence comme constante", () => {
      expect(SRC).toContain('REF_SHEET_NAME = "Valeurs autorisées"');
    });

    it("crée la feuille de référence avec addWorksheet(REF_SHEET_NAME)", () => {
      expect(SRC).toMatch(/wb\.addWorksheet\(REF_SHEET_NAME/);
    });

    it("liste les 10 colonnes attendues (catégories, sous-catégories, tags, matières, couleurs, tailles, pays, saisons, codes SH, description SH)", () => {
      for (const header of [
        "Catégories",
        "Sous-catégories",
        "Tags",
        "Matières (composition)",
        "Couleurs",
        "Tailles",
        "Pays de fabrication",
        "Saisons",
        "Codes SH",
        "Description code SH",
      ]) {
        expect(SRC).toContain(`"${header}"`);
      }
    });

    it("ajoute une légende rappelant que tags/composition/taille PACK acceptent plusieurs valeurs séparées par virgules", () => {
      // Sub-catégories ne fait PLUS partie des colonnes multi-valeurs :
      // validation stricte, valeur unique obligatoire dans la liste.
      expect(SRC).toMatch(/multi-valeurs\s*\(tags,\s*composition,\s*taille PACK\)/);
      expect(SRC).toMatch(/Sous-catégorie\s*\(filtrée par la catégorie choisie,\s*valeur unique obligatoirement dans la liste\)/);
    });

    it("place un bandeau hero en ligne 1 et un sous-titre en ligne 2 (headers décalés en ligne 3)", () => {
      expect(SRC).toContain("REF_HERO_ROW = 1");
      expect(SRC).toContain("REF_SUBTITLE_ROW = 2");
      expect(SRC).toContain("REF_HEADER_ROW = 3");
      expect(SRC).toContain("REF_DATA_START_ROW = 4");
    });

    it("fige les 3 premières lignes (hero + sous-titre + headers)", () => {
      expect(SRC).toMatch(/ySplit:\s*REF_HEADER_ROW/);
    });

    it("définit une palette d'accents par colonne (REF_PALETTES) avec 10 entrées", () => {
      expect(SRC).toMatch(/REF_PALETTES:\s*RefPalette\[\]/);
      // emerald (cat), violet (tags), amber (matières), rose (couleurs),
      // stone (tailles), sky (pays/saisons), slate (codes SH)
      for (const argb of ["047857", "6D28D9", "B45309", "BE123C", "57534E", "0369A1", "334155"]) {
        expect(SRC).toContain(argb);
      }
    });

    it("zèbre les lignes de données (zebraEven / zebraOdd par colonne)", () => {
      expect(SRC).toMatch(/idx\s*%\s*2\s*===\s*0\s*\?\s*palette\.zebraEven\s*:\s*palette\.zebraOdd/);
    });

    it("met la colonne A (Catégories) en gras coloré comme ancre visuelle", () => {
      expect(SRC).toMatch(/isAnchorCol\s*=\s*rc\.index\s*===\s*1/);
      expect(SRC).toMatch(/bold:\s*isAnchorCol/);
    });

    it("style la légende comme une carte ambrée (bordure medium + fond pastel)", () => {
      expect(SRC).toContain("refLegendBg");
      expect(SRC).toContain("refLegendBorder");
      expect(SRC).toMatch(/style:\s*"medium",\s*color:\s*\{\s*argb:\s*COLORS\.refLegendBorder/);
    });
  });

  describe("Listes déroulantes natives sur la feuille Produits", () => {
    it("définit un helper attachListValidation qui pose une data validation type=list", () => {
      expect(SRC).toContain("attachListValidation");
      expect(SRC).toMatch(/type:\s*"list"/);
    });

    it("référence la feuille « Valeurs autorisées » avec quotes (espace dans le nom)", () => {
      expect(SRC).toMatch(/sheetRef\s*=\s*`'\$\{REF_SHEET_NAME\}'`/);
    });

    it("branche un dropdown sur la colonne Catégorie (obligatoire, allowBlank: false)", () => {
      expect(SRC).toMatch(/attachListValidation\(findCol\("category"\),[^)]*false/);
    });

    it("branche un dropdown sur la colonne Couleur principale (facultative, allowBlank: true)", () => {
      expect(SRC).toMatch(/attachListValidation\(findCol\("primary_color"\),[^)]*true/);
    });

    it("branche un dropdown sur la colonne Pays fabrication", () => {
      expect(SRC).toMatch(/attachListValidation\(findCol\("pays_fabrication"\)/);
    });

    it("branche un dropdown sur la colonne Saison", () => {
      expect(SRC).toMatch(/attachListValidation\(findCol\("saison"\)/);
    });

    it("branche un dropdown sur la colonne Code SH (facultatif)", () => {
      expect(SRC).toMatch(/attachListValidation\(findCol\("hs_code"\),[^)]*true/);
    });

    it("branche un dropdown sur la colonne Couleur de la variante (obligatoire)", () => {
      expect(SRC).toMatch(/attachListValidation\(findCol\("color"\),[^)]*false/);
    });

    it("NE pose PAS de dropdown simple sur les colonnes multi-valeurs restantes (tags, composition, size)", () => {
      // Excel ne sait pas faire de multi-select dans une cellule.
      // Pour sub_categories, on utilise un dropdown DÉPENDANT (INDIRECT)
      // testé plus bas — la cellule reste en saisie libre via
      // `showErrorMessage: false`, mais propose les sous-catégories de la
      // catégorie choisie.
      for (const key of ["tags", "composition", "size"]) {
        expect(SRC).not.toMatch(new RegExp(`attachListValidation\\(findCol\\("${key}"\\)`));
      }
    });

    it("pose un dropdown DÉPENDANT sur sub_categories via INDIRECT + named ranges (feuille _lookup cachée)", () => {
      // Une feuille `_lookup` masquée stocke les sous-cats par catégorie
      // (1 colonne par catégorie), et chaque colonne est exposée en range
      // nommé `subcats_{nomSanitisé}`. La cellule sub_categories valide
      // contre INDIRECT("subcats_" & catégorie de la même ligne).
      expect(SRC).toMatch(/addWorksheet\("_lookup",\s*\{\s*state:\s*"hidden"/);
      expect(SRC).toMatch(/wb\.definedNames\.add\([^,]+,\s*`subcats_\$\{safeName\}`\)/);
      expect(SRC).toMatch(/INDIRECT\("subcats_"\s*&\s*SUBSTITUTE/);
      expect(SRC).toMatch(/findCol\("sub_categories"\)/);
    });

    it("applique une validation STRICTE sur sub_categories (une seule valeur, doit être dans la liste filtrée)", () => {
      // Plus de saisie libre : la valeur doit appartenir au range INDIRECT.
      // Une seule sous-cat par produit. Si la catégorie n'a pas de sous-cat,
      // INDIRECT retourne #REF! → toute saisie non vide est rejetée.
      expect(SRC).toMatch(/showErrorMessage:\s*true,\s*\n\s*errorTitle:\s*"Sous-catégorie invalide"/);
      expect(SRC).toMatch(/promptTitle:\s*"Sous-catégorie"/);
      // La promo "multi-valeur" pour sub_categories doit avoir disparu
      // (mais elle reste pour tags, qui est toujours multi-valeur).
      expect(SRC).not.toMatch(/sub_categories[\s\S]{0,400}multi-valeur autorisé/);
    });

    it("sanitise les noms de catégorie pour les named ranges (espace/apostrophe/tiret → _)", () => {
      // Les ranges Excel acceptent l'Unicode mais pas les espaces. La
      // sanitation côté JS et la chaîne SUBSTITUTE Excel doivent coïncider.
      expect(SRC).toMatch(/sanitizeRangeName/);
      expect(SRC).toMatch(/replace\(\/\[\\s'\\?-\]\/g,\s*"_"\)/);
      // Trois SUBSTITUTE imbriqués côté formule : space, apostrophe, tiret
      expect(SRC).toMatch(/SUBSTITUTE\(SUBSTITUTE\(SUBSTITUTE\([\s\S]*?" ","_"[\s\S]*?"'","_"[\s\S]*?"-","_"\)/);
    });

    it("ne crée pas la feuille _lookup si aucune catégorie n'a de sous-catégorie", () => {
      expect(SRC).toMatch(/categoriesWithSubs\s*=\s*categoriesData\.filter/);
      expect(SRC).toMatch(/if\s*\(categoriesWithSubs\.length\s*>\s*0\)/);
    });

    it("pose un dropdown sur Tags pointant vers la colonne C de « Valeurs autorisées »", () => {
      // Comme sub_categories : multi-valeur autorisé via showErrorMessage: false.
      expect(SRC).toMatch(/findCol\("tags"\)/);
      expect(SRC).toMatch(/tagsFormula\s*=\s*buildRangeFormula\("C",/);
      expect(SRC).toMatch(/promptTitle:\s*"Tags"/);
    });

    it("bloque la colonne Tags si 0 tag en BDD (textLength = 0, aucune saisie autorisée)", () => {
      expect(SRC).toMatch(/tagNames\.length\s*===\s*0/);
      expect(SRC).toMatch(/Aucun tag disponible/);
      expect(SRC).toMatch(/attachEmptyOnly\(\s*tagsCol/);
    });

    it("bloque la colonne Sous-catégories si aucune catégorie n'a de sous-cat en BDD", () => {
      // L'inverse de la branche `if (categoriesWithSubs.length > 0)` :
      // si 0 sous-cat partout, on force la colonne à rester vide.
      expect(SRC).toMatch(/Aucune sous-catégorie disponible/);
      expect(SRC).toMatch(/attachEmptyOnly\(\s*findCol\("sub_categories"\)/);
    });

    it("définit un helper attachEmptyOnly qui pose une validation textLength = 0", () => {
      expect(SRC).toMatch(/function\s+attachEmptyOnly/);
      expect(SRC).toMatch(/type:\s*"textLength"/);
      expect(SRC).toMatch(/operator:\s*"equal"/);
      expect(SRC).toMatch(/formulae:\s*\[0\]/);
    });

    it("affiche un message d'erreur clair quand la valeur n'existe pas", () => {
      expect(SRC).toMatch(/errorTitle:\s*"Valeur inconnue"/);
      expect(SRC).toMatch(/choisissez une valeur dans la liste/);
    });

    it("ne pose pas de validation quand la liste de référence est vide (BDD vierge)", () => {
      // buildRangeFormula renvoie null si count <= 0, attachListValidation
      // ne pose alors aucune validation pour éviter une plage Excel vide.
      expect(SRC).toMatch(/if\s*\(count\s*<=\s*0\)\s*return null/);
      expect(SRC).toMatch(/if\s*\(!formula\)\s*return/);
    });
  });
});
