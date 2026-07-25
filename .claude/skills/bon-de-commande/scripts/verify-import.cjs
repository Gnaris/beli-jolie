#!/usr/bin/env node
// Vérif rapide : lit les catégories/sous-cats/poids uniques dans un import-*.xlsx
const ExcelJS = require("exceljs");
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(process.argv[2]);
  const ws = wb.getWorksheet("Produits");
  const cats = new Map();
  const subs = new Map();
  const weights = new Map();
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cat = String(row.getCell(4).value || "").trim();
    const sub = String(row.getCell(5).value || "").trim();
    const w = row.getCell(28).value;
    if (cat) cats.set(cat, (cats.get(cat) || 0) + 1);
    if (sub) subs.set(sub, (subs.get(sub) || 0) + 1);
    if (w !== null && w !== undefined && String(w).trim() !== "") {
      const key = String(w);
      weights.set(key, (weights.get(key) || 0) + 1);
    }
  }
  console.log("Catégories :", Object.fromEntries(cats));
  console.log("Sous-cats  :", Object.fromEntries(subs));
  console.log("Poids      :", Object.fromEntries(weights));
})();
