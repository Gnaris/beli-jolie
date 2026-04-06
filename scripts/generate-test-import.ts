import ExcelJS from "exceljs";
import path from "path";

const products = [
  // ── COLLIERS ──
  { ref: "COL-101", name: "Collier Serpent Doré", desc: "Collier chaîne serpent plaqué or", cat: "Colliers", tags: "tendance,premium", comp: "Acier inoxydable:80,Or:20", country: "France", season: "Été 2026", colors: [
    { color: "Doré", type: "UNIT", price: 14.90, stock: 300, size: "Unique" },
    { color: "Doré", type: "PACK", price: 12.50, stock: 80, packQty: 12, size: "Unique" },
    { color: "Argenté", type: "UNIT", price: 14.90, stock: 250, size: "Unique" },
    { color: "Doré/Argenté", type: "UNIT", price: 16.50, stock: 180, size: "Unique" },
  ]},
  { ref: "COL-102", name: "Collier Perles Nacrées", desc: "Collier ras de cou perles d'eau douce", cat: "Colliers", tags: "élégant,soirée", comp: "Perle:70,Acier inoxydable:30", country: "Italie", season: "Printemps 2026", colors: [
    { color: "Blanc", type: "UNIT", price: 19.90, stock: 200, size: "Unique" },
    { color: "Or Rose", type: "UNIT", price: 21.00, stock: 150, size: "Unique" },
    { color: "Blanc/Or Rose", type: "UNIT", price: 22.50, stock: 100, size: "Unique" },
  ]},

  // ── BRACELETS ──
  { ref: "BRA-201", name: "Bracelet Tressé Cuir", desc: "Bracelet en cuir tressé avec fermoir magnétique", cat: "Bracelets", tags: "homme,cuir", comp: "Cuir:90,Zinc:10", country: "Italie", season: "Hiver 2025", colors: [
    { color: "Noir", type: "UNIT", price: 8.50, stock: 500, size: "M" },
    { color: "Marron", type: "UNIT", price: 8.50, stock: 400, size: "M" },
    { color: "Noir", type: "PACK", price: 7.00, stock: 100, packQty: 10, size: "M" },
    { color: "Marron", type: "PACK", price: 7.00, stock: 80, packQty: 10, size: "M" },
  ]},
  { ref: "BRA-202", name: "Bracelet Jonc Tricolore", desc: "Jonc rigide trois couleurs empilables", cat: "Bracelets", tags: "fantaisie,ajustable", comp: "Acier inoxydable:100", country: "France", season: "Printemps 2026", colors: [
    { color: "Doré", type: "UNIT", price: 6.50, stock: 600, size: "Unique" },
    { color: "Argenté", type: "UNIT", price: 6.50, stock: 500, size: "Unique" },
    { color: "Doré/Argenté/Or Rose", type: "UNIT", price: 8.90, stock: 350, size: "Unique" },
    { color: "Doré/Argenté/Or Rose", type: "PACK", price: 7.50, stock: 70, packQty: 12, size: "Unique" },
  ]},

  // ── BAGUES ──
  { ref: "BAG-301", name: "Bague Papillon Ajustable", desc: "Bague ouverte motif papillon", cat: "Bagues", tags: "ajustable,fantaisie", comp: "Laiton:70,Cristal:30", country: "France", season: "Été 2026", colors: [
    { color: "Doré", type: "UNIT", price: 4.50, stock: 800, size: "Unique" },
    { color: "Argenté", type: "UNIT", price: 4.50, stock: 700, size: "Unique" },
    { color: "Or Rose", type: "UNIT", price: 5.00, stock: 500, size: "Unique" },
    { color: "Doré/Argenté", type: "UNIT", price: 5.50, stock: 400, size: "Unique" },
  ]},

  // ── BOUCLES D'OREILLES ──
  { ref: "BO-401", name: "Boucles d'Oreilles Étoile", desc: "Boucles pendantes étoile strass", cat: "Boucles d'oreilles", tags: "femme,soirée", comp: "Laiton:60,Cristal:40", country: "Italie", season: "Été 2026", colors: [
    { color: "Or Rose", type: "UNIT", price: 6.90, stock: 600, size: "Unique" },
    { color: "Argenté", type: "UNIT", price: 6.90, stock: 450, size: "Unique" },
    { color: "Noir/Doré", type: "UNIT", price: 7.90, stock: 300, size: "Unique" },
  ]},

  // ── T-SHIRTS ──
  { ref: "TS-501", name: "T-Shirt Oversize Coton", desc: "T-shirt coupe oversize 100% coton bio", cat: "T-shirts", tags: "basique,streetwear", comp: "Coton:100", country: "Turquie", season: "Été 2026", colors: [
    { color: "Blanc", type: "UNIT", price: 12.00, stock: 200, size: "S" },
    { color: "Blanc", type: "UNIT", price: 12.00, stock: 200, size: "M" },
    { color: "Blanc", type: "UNIT", price: 12.00, stock: 200, size: "L" },
    { color: "Blanc", type: "UNIT", price: 12.00, stock: 100, size: "XL" },
    { color: "Noir", type: "UNIT", price: 12.00, stock: 200, size: "S" },
    { color: "Noir", type: "UNIT", price: 12.00, stock: 200, size: "M" },
    { color: "Noir", type: "UNIT", price: 12.00, stock: 200, size: "L" },
    { color: "Beige", type: "UNIT", price: 12.00, stock: 150, size: "M" },
    { color: "Blanc", type: "PACK", price: 10.00, stock: 50, packQty: 6, size: "M" },
    { color: "Noir", type: "PACK", price: 10.00, stock: 50, packQty: 6, size: "M" },
  ]},
  { ref: "TS-502", name: "T-Shirt Rayé Marin", desc: "T-shirt rayures horizontales coton épais", cat: "T-shirts", tags: "classique,marin", comp: "Coton:95,Élasthanne:5", country: "Turquie", season: "Printemps 2026", colors: [
    { color: "Bleu/Blanc", type: "UNIT", price: 14.50, stock: 180, size: "M" },
    { color: "Rouge/Blanc", type: "UNIT", price: 14.50, stock: 150, size: "M" },
    { color: "Noir/Blanc", type: "UNIT", price: 14.50, stock: 130, size: "L" },
  ]},

  // ── CHEMISES ──
  { ref: "CHM-601", name: "Chemise Lin Décontractée", desc: "Chemise manches longues en lin lavé", cat: "Chemises", tags: "été,casual", comp: "Lin:85,Coton:15", country: "Italie", season: "Été 2026", colors: [
    { color: "Bleu Ciel", type: "UNIT", price: 24.90, stock: 120, size: "M" },
    { color: "Blanc", type: "UNIT", price: 24.90, stock: 100, size: "L" },
    { color: "Kaki", type: "UNIT", price: 24.90, stock: 80, size: "M" },
  ]},

  // ── PULLS ──
  { ref: "PUL-701", name: "Pull Col Roulé Mérinos", desc: "Pull col roulé en laine mérinos extra fine", cat: "Pulls", tags: "hiver,premium", comp: "Laine:80,Polyamide:20", country: "Italie", season: "Hiver 2025", colors: [
    { color: "Gris", type: "UNIT", price: 35.00, stock: 90, size: "M" },
    { color: "Noir", type: "UNIT", price: 35.00, stock: 90, size: "L" },
    { color: "Bordeaux", type: "UNIT", price: 35.00, stock: 60, size: "M" },
  ]},

  // ── VESTES ──
  { ref: "VST-801", name: "Veste Bomber Satin", desc: "Bomber jacket en satin avec doublure", cat: "Vestes", tags: "streetwear,automne", comp: "Polyester:100", country: "Turquie", season: "Hiver 2025", colors: [
    { color: "Noir", type: "UNIT", price: 42.00, stock: 70, size: "M" },
    { color: "Kaki", type: "UNIT", price: 42.00, stock: 55, size: "L" },
    { color: "Noir/Rouge", type: "UNIT", price: 45.00, stock: 40, size: "M" },
  ]},

  // ── ROBES ──
  { ref: "ROB-901", name: "Robe Midi Fleurie", desc: "Robe midi imprimé floral avec ceinture", cat: "Robes", tags: "femme,printemps", comp: "Viscose:100", country: "France", season: "Printemps 2026", colors: [
    { color: "Rose", type: "UNIT", price: 28.50, stock: 110, size: "S" },
    { color: "Rose", type: "UNIT", price: 28.50, stock: 110, size: "M" },
    { color: "Bleu Marine", type: "UNIT", price: 28.50, stock: 85, size: "M" },
    { color: "Rose/Blanc", type: "UNIT", price: 29.00, stock: 70, size: "S" },
    { color: "Bleu Marine/Blanc", type: "UNIT", price: 29.00, stock: 60, size: "M" },
  ]},

  // ── JEANS ──
  { ref: "JN-1001", name: "Jean Slim Stretch", desc: "Jean coupe slim avec élasthanne", cat: "Jeans", tags: "basique,denim", comp: "Coton:98,Élasthanne:2", country: "Turquie", season: "Été 2026", colors: [
    { color: "Bleu", type: "UNIT", price: 22.00, stock: 180, size: "S" },
    { color: "Bleu", type: "UNIT", price: 22.00, stock: 180, size: "M" },
    { color: "Bleu", type: "UNIT", price: 22.00, stock: 180, size: "L" },
    { color: "Noir", type: "UNIT", price: 22.00, stock: 160, size: "M" },
    { color: "Gris", type: "UNIT", price: 22.00, stock: 100, size: "M" },
    { color: "Bleu", type: "PACK", price: 18.50, stock: 40, packQty: 6, size: "M" },
  ]},

  // ── PANTALONS ──
  { ref: "PT-1101", name: "Pantalon Cargo Coton", desc: "Cargo poches latérales coton épais", cat: "Pantalons", tags: "streetwear,outdoor", comp: "Coton:100", country: "Turquie", season: "Hiver 2025", colors: [
    { color: "Kaki", type: "UNIT", price: 26.00, stock: 130, size: "M" },
    { color: "Noir", type: "UNIT", price: 26.00, stock: 120, size: "L" },
    { color: "Beige", type: "UNIT", price: 26.00, stock: 90, size: "M" },
  ]},
  { ref: "PT-1102", name: "Pantalon Palazzo Fluide", desc: "Pantalon large fluide taille haute", cat: "Pantalons", tags: "femme,élégant", comp: "Polyester:80,Viscose:20", country: "France", season: "Printemps 2026", colors: [
    { color: "Noir", type: "UNIT", price: 21.00, stock: 90, size: "S" },
    { color: "Noir", type: "UNIT", price: 21.00, stock: 90, size: "M" },
    { color: "Blanc", type: "UNIT", price: 21.00, stock: 75, size: "M" },
  ]},

  // ── JOGGINGS ──
  { ref: "JOG-1201", name: "Jogging Molleton Chiné", desc: "Pantalon jogging molleton brossé", cat: "Joggings", tags: "sport,confort", comp: "Coton:70,Polyester:30", country: "Turquie", season: "Hiver 2025", colors: [
    { color: "Gris", type: "UNIT", price: 18.00, stock: 200, size: "M" },
    { color: "Gris", type: "UNIT", price: 18.00, stock: 200, size: "L" },
    { color: "Noir", type: "UNIT", price: 18.00, stock: 200, size: "M" },
    { color: "Noir", type: "UNIT", price: 18.00, stock: 200, size: "L" },
    { color: "Gris", type: "PACK", price: 15.00, stock: 60, packQty: 8, size: "M" },
    { color: "Noir", type: "PACK", price: 15.00, stock: 60, packQty: 8, size: "M" },
  ]},

  // ── SNEAKERS ──
  { ref: "SNK-1301", name: "Sneakers Cuir Blanc", desc: "Baskets basses cuir grainé semelle gomme", cat: "Sneakers", tags: "basique,premium", comp: "Cuir:80,Caoutchouc:20", country: "Italie", season: "Été 2026", colors: [
    { color: "Blanc", type: "UNIT", price: 39.90, stock: 100, size: "M" },
    { color: "Blanc/Noir", type: "UNIT", price: 39.90, stock: 80, size: "M" },
    { color: "Blanc", type: "PACK", price: 34.00, stock: 20, packQty: 6, size: "M" },
  ]},

  // ── BOTTINES ──
  { ref: "BOT-1401", name: "Bottines Chelsea Daim", desc: "Chelsea boots daim avec élastique latéral", cat: "Bottines", tags: "homme,automne", comp: "Daim:85,Caoutchouc:15", country: "Italie", season: "Hiver 2025", colors: [
    { color: "Marron", type: "UNIT", price: 48.00, stock: 65, size: "M" },
    { color: "Noir", type: "UNIT", price: 48.00, stock: 55, size: "L" },
  ]},

  // ── SANDALES ──
  { ref: "SAN-1501", name: "Sandales Tressées Cuir", desc: "Sandales plates cuir tressé artisanal", cat: "Sandales", tags: "femme,été", comp: "Cuir:90,Liège:10", country: "Italie", season: "Été 2026", colors: [
    { color: "Camel", type: "UNIT", price: 32.00, stock: 85, size: "S" },
    { color: "Noir", type: "UNIT", price: 32.00, stock: 70, size: "M" },
    { color: "Doré", type: "UNIT", price: 34.00, stock: 50, size: "S" },
    { color: "Camel/Doré", type: "UNIT", price: 35.00, stock: 40, size: "M" },
  ]},

  // ── MOCASSINS ──
  { ref: "MOC-1601", name: "Mocassins Suède Souple", desc: "Mocassins souples en suède avec semelle flexible", cat: "Mocassins", tags: "confort,casual", comp: "Suède:80,Caoutchouc:20", country: "France", season: "Printemps 2026", colors: [
    { color: "Bleu Marine", type: "UNIT", price: 36.00, stock: 90, size: "M" },
    { color: "Beige", type: "UNIT", price: 36.00, stock: 75, size: "L" },
    { color: "Bordeaux", type: "UNIT", price: 36.00, stock: 50, size: "M" },
  ]},
];

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Produits");

  // Headers
  const headers = [
    "reference", "name", "description", "category", "tags",
    "composition", "color", "sale_type", "unit_price", "stock", "pack_qty",
    "taille", "pays_fabrication", "saison",
  ];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    cell.border = { bottom: { style: "thin" } };
  });

  // Column widths
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 50;
  ws.getColumn(4).width = 20;
  ws.getColumn(5).width = 22;
  ws.getColumn(6).width = 40;
  ws.getColumn(7).width = 22;
  ws.getColumn(8).width = 10;
  ws.getColumn(9).width = 10;
  ws.getColumn(10).width = 8;
  ws.getColumn(11).width = 10;
  ws.getColumn(12).width = 10;
  ws.getColumn(13).width = 18;
  ws.getColumn(14).width = 18;

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
        c.packQty ?? "",
        c.size,
        i === 0 ? p.country : "",
        i === 0 ? p.season : "",
      ]);
    }
  }

  const outPath = path.resolve(process.cwd(), "test-import-20-produits.xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log(`Excel généré : ${outPath}`);
  console.log(`${products.length} produits, ${products.reduce((s, p) => s + p.colors.length, 0)} variantes`);
  const cats = [...new Set(products.map(p => p.cat))];
  console.log(`Catégories (${cats.length}) : ${cats.join(", ")}`);
  const countries = [...new Set(products.map(p => p.country))];
  console.log(`Pays (${countries.length}) : ${countries.join(", ")}`);
  const seasons = [...new Set(products.map(p => p.season))];
  console.log(`Saisons (${seasons.length}) : ${seasons.join(", ")}`);
}

main().catch(console.error);
