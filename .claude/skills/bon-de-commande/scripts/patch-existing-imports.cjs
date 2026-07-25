#!/usr/bin/env node
/**
 * Patch les fichiers import-*.xlsx déjà générés pour :
 *   - renommer la catégorie "Bague" en "Bague ajustable"
 *   - renommer la catégorie "Parures de bijoux" en "Parure de bijoux"
 *   - renommer la catégorie "Bracelet bras" en "Bracelet"
 *   - déplacer les lignes catégorie=Bracelet + sous-cat=Chaîne de cheville
 *     vers catégorie=Chaîne de cheville, sous-cat vide
 *   - vider les sous-catégories inexistantes en BDD :
 *     Clips, Puce d'oreille, Jonc, Bracelet de main, À l'unité
 *   - conserver "Collier de dos" comme sous-cat de Collier
 *   - remplir la colonne "Poids (kg) *" quand elle est vide, selon la catégorie
 *     du produit (défauts confirmés cliente 2026-07-25, option A)
 *
 * Structure Excel : 4 lignes d'en-tête, données à partir de la ligne 5.
 * Sur une ligne "sub-variante" (2ᵉ variante d'un même produit), la référence
 * est répétée mais toutes les autres colonnes produit sont vides — on reporte
 * donc le poids depuis la catégorie du 1ᵉʳ produit du groupe (mémorisée par ref).
 */
const ExcelJS = require("exceljs");
const path = require("path");

const FILES = [
  "C:/Users/Admin/Downloads/import-A.xlsx",
  "C:/Users/Admin/Downloads/import-E.xlsx",
  "C:/Users/Admin/Downloads/import-G.xlsx",
  "C:/Users/Admin/Downloads/import-J.xlsx",
  "C:/Users/Admin/Downloads/import-N.xlsx",
  "C:/Users/Admin/Downloads/import-WF.xlsx",
  "C:/Users/Admin/Downloads/import-ZC.xlsx",
];

const CAT_RENAME = {
  "Bague": "Bague ajustable",
  "Parures de bijoux": "Parure de bijoux",
  "Bracelet bras": "Bracelet",
};

// Sous-cats à vider (n'existent pas en BDD)
const SUBCAT_TO_CLEAR = new Set([
  "Clips",
  "Puce d'oreille",
  "Jonc",
  "Bracelet de main",
  "À l'unité",
]);

// Poids par défaut par catégorie (post-renommage)
const DEFAULT_WEIGHT_KG = {
  "Bague ajustable":    0.005,
  "Boucles d'oreilles": 0.010,
  "Bracelet":           0.015,
  "Collier":            0.020,
  "Chaîne de cheville": 0.015,
  "Chaîne de taille":   0.030,
  "Chaîne de corps":    0.030,
  "Pendentif":          0.005,
  "Broche":             0.015,
  "Parure de bijoux":   0.050,
  "Piercing":           0.005,
  "Lunettes":           0.030,
  "Porte-clé":          0.020,
};
const DEFAULT_FALLBACK_KG = 0.020;

function weightFor(cat) {
  if (!cat) return DEFAULT_FALLBACK_KG;
  return DEFAULT_WEIGHT_KG[cat] || DEFAULT_FALLBACK_KG;
}

async function patchFile(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Produits") || wb.worksheets[0];
  if (!ws) {
    console.error(`  ✖ Feuille introuvable dans ${filePath}`);
    return;
  }

  // Détecte les colonnes via la ligne 2 (headers)
  const headerRow = ws.getRow(2);
  const headers = {};
  headerRow.eachCell((cell, colNumber) => {
    const val = String(cell.value || "").trim();
    headers[val] = colNumber;
  });
  const colRef = headers["Référence *"];
  const colCat = headers["Catégorie *"];
  const colSub = headers["Sous-catégories"];
  const colWeight = headers["Poids (kg) *"];

  if (!colRef || !colCat || !colWeight) {
    console.error(`  ✖ Colonnes manquantes dans ${filePath} (ref=${colRef} cat=${colCat} weight=${colWeight})`);
    return;
  }

  // Table ref → catégorie (mémorisée depuis la 1ère ligne d'un produit,
  // pour remplir le poids des lignes sous-variantes qui n'ont pas la cat)
  const catByRef = new Map();

  let renamedCats = 0;
  let clearedSubs = 0;
  let movedToChaineCheville = 0;
  let filledWeights = 0;

  const lastRow = ws.rowCount;
  for (let rowIdx = 5; rowIdx <= lastRow; rowIdx++) {
    const row = ws.getRow(rowIdx);
    const refCell = row.getCell(colRef);
    const catCell = row.getCell(colCat);
    const subCell = colSub ? row.getCell(colSub) : null;
    const weightCell = row.getCell(colWeight);

    const refVal = String(refCell.value || "").trim();
    if (!refVal) continue;

    let catVal = String(catCell.value || "").trim();
    let subVal = subCell ? String(subCell.value || "").trim() : "";

    // Cas 1 : ligne principale (catégorie remplie)
    if (catVal) {
      // Renommage direct
      if (CAT_RENAME[catVal]) {
        catCell.value = CAT_RENAME[catVal];
        catVal = CAT_RENAME[catVal];
        renamedCats++;
      }
      // Déplacement Bracelet + Chaîne de cheville → catégorie principale
      if (catVal === "Bracelet" && subVal === "Chaîne de cheville") {
        catCell.value = "Chaîne de cheville";
        subCell.value = "";
        catVal = "Chaîne de cheville";
        subVal = "";
        movedToChaineCheville++;
      }
      // Vider sous-catégories invalides (sauf "Collier de dos" qui reste)
      if (subVal && SUBCAT_TO_CLEAR.has(subVal)) {
        subCell.value = "";
        subVal = "";
        clearedSubs++;
      }
      // Mémorise la catégorie pour cette ref
      catByRef.set(refVal, catVal);
    }

    // Poids : si vide, remplir depuis la catégorie du produit
    const currentWeight = weightCell.value;
    const isEmptyWeight =
      currentWeight === null ||
      currentWeight === undefined ||
      String(currentWeight).trim() === "";
    if (isEmptyWeight) {
      const catForRef = catByRef.get(refVal);
      const w = weightFor(catForRef);
      weightCell.value = w;
      weightCell.numFmt = "0.000";
      // Alignement centré comme dans le template
      weightCell.alignment = { ...(weightCell.alignment || {}), horizontal: "center", vertical: "middle" };
      // Police lisible (pas italique/gris si c'était l'état "vide" du template)
      const currentFont = weightCell.font || {};
      weightCell.font = { ...currentFont, italic: false, color: { argb: "1F2937" } };
      filledWeights++;
    }
  }

  await wb.xlsx.writeFile(filePath);
  console.log(
    `  ✔ ${path.basename(filePath)}  ` +
    `renommages=${renamedCats}  sous-cats vidées=${clearedSubs}  ` +
    `→Chaîne de cheville=${movedToChaineCheville}  poids remplis=${filledWeights}`
  );
}

(async () => {
  for (const f of FILES) {
    try {
      await patchFile(f);
    } catch (err) {
      console.error(`  ✖ Échec ${f} :`, err.message);
    }
  }
})();
