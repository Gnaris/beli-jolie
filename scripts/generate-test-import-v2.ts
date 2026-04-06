import ExcelJS from "exceljs";
import path from "path";

const products = [
  { ref: "TEST-001", name: "Collier Test Import", desc: "Collier pour test import", cat: "Colliers", tags: "test,import", comp: "Acier inoxydable:100", country: "France", season: "Été 2026", colors: [
    { color: "Doré", type: "UNIT", price: 14.90, stock: 100, size: "Unique" },
    { color: "Argenté", type: "UNIT", price: 14.90, stock: 80, size: "Unique" },
  ]},
  { ref: "TEST-002", name: "Bracelet Test Import", desc: "Bracelet pour test import", cat: "Bracelets", tags: "test,import", comp: "Cuir:90,Zinc:10", country: "Italie", season: "Hiver 2025", colors: [
    { color: "Noir", type: "UNIT", price: 8.50, stock: 200, size: "S" },
    { color: "Noir", type: "UNIT", price: 8.50, stock: 150, size: "M" },
    { color: "Noir", type: "UNIT", price: 8.50, stock: 100, size: "L" },
    { color: "Marron", type: "UNIT", price: 8.50, stock: 180, size: "M" },
  ]},
  { ref: "TEST-003", name: "T-Shirt Test Import", desc: "T-shirt pour test import", cat: "T-shirts", tags: "test,basique", comp: "Coton:100", country: "Turquie", season: "Printemps 2026", colors: [
    { color: "Blanc", type: "UNIT", price: 12.00, stock: 200, size: "S" },
    { color: "Blanc", type: "UNIT", price: 12.00, stock: 200, size: "M" },
    { color: "Blanc", type: "UNIT", price: 12.00, stock: 200, size: "L" },
    { color: "Blanc", type: "UNIT", price: 12.00, stock: 100, size: "XL" },
    { color: "Noir", type: "UNIT", price: 12.00, stock: 200, size: "S" },
    { color: "Noir", type: "UNIT", price: 12.00, stock: 200, size: "M" },
  ]},
];

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Produits");

  const headers = [
    "reference", "name", "description", "category", "tags",
    "composition", "color", "sale_type", "unit_price", "stock",
    "pack_qty", "taille", "pays_fabrication", "saison",
  ];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
  });

  for (const p of products) {
    for (let i = 0; i < p.colors.length; i++) {
      const c = p.colors[i];
      ws.addRow([
        i === 0 ? p.ref : "",
        i === 0 ? p.name : "",
        i === 0 ? p.desc : "",
        i === 0 ? p.cat : "",
        i === 0 ? p.tags : "",
        i === 0 ? p.comp : "",
        c.color,
        c.type,
        c.price,
        c.stock,
        "",
        c.size,
        i === 0 ? p.country : "",
        i === 0 ? p.season : "",
      ]);
    }
  }

  const outPath = path.resolve(process.cwd(), "test-import-v2.xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log(`Excel generated: ${outPath}`);
  console.log(`${products.length} products, ${products.reduce((s, p) => s + p.colors.length, 0)} variants`);
}

main().catch(console.error);
