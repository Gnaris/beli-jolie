#!/usr/bin/env node
/**
 * Détecte et fusionne les variantes en doublon (même couleur + même type de
 * vente pour une même référence) dans les Excel d'import déjà générés.
 *
 * Cause typique : deux couleurs chinoises différentes (ex: 白色 + 金+白)
 * mappent à la même couleur française « Blanc » → l'écran d'import refuse.
 *
 * Comportement :
 *   - stock fusionné (somme)
 *   - prix conservé = max des doublons
 *   - la 1ʳᵉ occurrence de la variante est conservée, les suivantes supprimées
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

async function dedupeFile(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Produits") || wb.worksheets[0];
  if (!ws) return { file: filePath, error: "feuille introuvable" };

  const headerRow = ws.getRow(2);
  const headers = {};
  headerRow.eachCell((cell, colNumber) => {
    headers[String(cell.value || "").trim()] = colNumber;
  });
  const colRef = headers["Référence *"];
  const colColor = headers["Couleur *"];
  const colSale = headers["Type de vente *"];
  const colPrice = headers["Prix unitaire *"];
  const colStock = headers["Stock *"];

  // 1ère passe : recense les groupes par ref (couleur|type) → [rowIdx…]
  const groups = new Map(); // ref -> Map<key, rowIdx[]>
  const lastRow = ws.rowCount;
  for (let r = 5; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const ref = String(row.getCell(colRef).value || "").trim();
    const color = String(row.getCell(colColor).value || "").trim();
    const sale = String(row.getCell(colSale).value || "UNIT").trim() || "UNIT";
    if (!ref || !color) continue;
    if (!groups.has(ref)) groups.set(ref, new Map());
    const key = `${color}|${sale}`;
    const perRef = groups.get(ref);
    if (!perRef.has(key)) perRef.set(key, []);
    perRef.get(key).push(r);
  }

  // 2e passe : pour chaque doublon, fusionner stock/prix dans la 1ère ligne,
  // marquer les autres comme à supprimer
  const rowsToDelete = [];
  const collisions = [];
  for (const [ref, perRef] of groups) {
    for (const [key, rowIdxs] of perRef) {
      if (rowIdxs.length < 2) continue;
      const keeper = ws.getRow(rowIdxs[0]);
      let totalStock = Number(keeper.getCell(colStock).value) || 0;
      let maxPrice = Number(keeper.getCell(colPrice).value) || 0;
      for (let i = 1; i < rowIdxs.length; i++) {
        const dup = ws.getRow(rowIdxs[i]);
        totalStock += Number(dup.getCell(colStock).value) || 0;
        const dupPrice = Number(dup.getCell(colPrice).value) || 0;
        if (dupPrice > maxPrice) maxPrice = dupPrice;
        rowsToDelete.push(rowIdxs[i]);
      }
      keeper.getCell(colStock).value = totalStock;
      keeper.getCell(colPrice).value = maxPrice;
      collisions.push(`${ref} · ${key} (${rowIdxs.length} lignes → 1, stock=${totalStock}, prix=${maxPrice})`);
    }
  }

  // Suppression du bas vers le haut (sinon les index se décalent)
  rowsToDelete.sort((a, b) => b - a);
  for (const r of rowsToDelete) {
    ws.spliceRows(r, 1);
  }

  await wb.xlsx.writeFile(filePath);
  return { file: filePath, deleted: rowsToDelete.length, collisions };
}

(async () => {
  for (const f of FILES) {
    try {
      const res = await dedupeFile(f);
      if (res.error) {
        console.log(`  ✖ ${path.basename(f)} : ${res.error}`);
        continue;
      }
      if (res.deleted === 0) {
        console.log(`  ✓ ${path.basename(f)} : aucun doublon`);
      } else {
        console.log(`  ✔ ${path.basename(f)} : ${res.deleted} ligne(s) supprimée(s)`);
        for (const c of res.collisions) console.log(`      · ${c}`);
      }
    } catch (err) {
      console.log(`  ✖ ${path.basename(f)} : ${err.message}`);
    }
  }
})();
