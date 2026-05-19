/**
 * Analyse l'export CSV des brouillons Ankorstore (téléchargé depuis leur
 * dashboard) et croise avec notre BDD locale.
 *
 * Usage :
 *   npx tsx scripts/ankorstore-drafts-csv-analyze.ts <path-to-csv>
 *
 * Sortie console + Excel sur le Bureau.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";

type Row = {
  sku: string;
  productName: string;
  source: string;
  errors: string;
};

function parseCsv(content: string): Row[] {
  const rows: Row[] = [];
  let i = 0;
  const len = content.length;
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;

  function pushField() {
    fields.push(current);
    current = "";
  }
  function pushRow() {
    if (fields.length === 0 && current === "") return;
    pushField();
    if (fields.length >= 4) {
      rows.push({
        sku: fields[0].trim(),
        productName: fields[1].trim(),
        source: fields[2].trim(),
        errors: fields[3].trim(),
      });
    }
    fields = [];
  }

  while (i < len) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  pushRow();

  // strip header
  if (rows.length > 0 && rows[0].sku.toLowerCase() === "sku") rows.shift();
  return rows;
}

// Extrait la référence produit depuis un SKU type "A405_Doré_UNIT_1_abcdef12"
// → "A405". Tombe sur la chaîne entière si pas de "_".
function extractRef(sku: string): string {
  if (!sku) return "";
  const idx = sku.indexOf("_");
  if (idx > 0) return sku.slice(0, idx).trim();
  return sku.trim();
}

function classifyError(err: string): string {
  const lower = err.toLowerCase();
  if (lower.includes("duplicate")) return "SKU dupliqué entre variantes";
  if (lower.includes("should not be blank") && lower.includes("prix"))
    return "Prix manquant (gros ou détail)";
  if (lower.includes("should not be blank") && lower.includes("sku"))
    return "SKU manquant sur une variante";
  if (lower.includes("variant sku is required")) return "SKU manquant sur une variante";
  if (lower.includes("image")) return "Problème d'image";
  if (lower.includes("ean") || lower.includes("ian") || lower.includes("gtin"))
    return "Code-barres invalide";
  if (lower.includes("must be valid")) return "Valeur invalide";
  return "Autre / à analyser";
}

function suggestFix(category: string): string {
  switch (category) {
    case "SKU dupliqué entre variantes":
      return "Deux variantes du même produit partagent le même SKU. Il faut régénérer le SKU côté nous (republier remplace).";
    case "Prix manquant (gros ou détail)":
      return "Le prix de gros ou le prix de détail est vide pour cette variante. Vérifiez la fiche produit.";
    case "SKU manquant sur une variante":
      return "Une variante n'a pas de SKU. Republier en générera un automatiquement.";
    case "Problème d'image":
      return "Image trop petite ou inaccessible. Le proxy upscale en place devrait régler ça au prochain publish.";
    case "Code-barres invalide":
      return "Code-barres au mauvais format (doit faire 13 caractères). Vider ou corriger.";
    case "Valeur invalide":
      return "Un champ n'a pas le bon format. À analyser au cas par cas.";
    default:
      return "À analyser manuellement.";
  }
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    throw new Error("Usage : npx tsx scripts/ankorstore-drafts-csv-analyze.ts <csv-path>");
  }
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Fichier introuvable : ${csvPath}`);
  }

  console.log(`[Drafts CSV Analyze] Lecture : ${csvPath}\n`);
  const content = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCsv(content);
  console.log(`Lignes d'erreurs : ${rows.length}`);

  // 1) Regrouper par référence produit
  const byRef = new Map<
    string,
    {
      ref: string;
      productNames: Set<string>;
      skus: Set<string>;
      errorTexts: Set<string>;
      categories: Map<string, number>;
    }
  >();

  for (const r of rows) {
    const ref = extractRef(r.sku) || "(SKU vide)";
    let bucket = byRef.get(ref);
    if (!bucket) {
      bucket = {
        ref,
        productNames: new Set(),
        skus: new Set(),
        errorTexts: new Set(),
        categories: new Map(),
      };
      byRef.set(ref, bucket);
    }
    bucket.productNames.add(r.productName);
    if (r.sku) bucket.skus.add(r.sku);
    bucket.errorTexts.add(r.errors);
    const cat = classifyError(r.errors);
    bucket.categories.set(cat, (bucket.categories.get(cat) ?? 0) + 1);
  }

  console.log(`Produits uniques (par réf SKU) : ${byRef.size}`);

  // 2) Récap global par catégorie d'erreur
  const globalCats = new Map<string, number>();
  for (const r of rows) {
    const cat = classifyError(r.errors);
    globalCats.set(cat, (globalCats.get(cat) ?? 0) + 1);
  }
  const catList = Array.from(globalCats.entries()).sort((a, b) => b[1] - a[1]);

  console.log("\n=== Récap par type d'erreur ===");
  for (const [cat, n] of catList) {
    console.log(`  ${n.toString().padStart(4)} × ${cat}`);
  }

  // 3) Croise avec notre BDD : pour chaque ref, trouver le produit local
  const refsArray = Array.from(byRef.keys()).filter((r) => r !== "(SKU vide)");
  const localProducts = await prisma.product.findMany({
    where: { reference: { in: refsArray } },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      ankorsProductId: true,
    },
  });
  const localByRef = new Map(localProducts.map((p) => [p.reference, p]));

  console.log(`\n=== Cross-référence BDD locale ===`);
  console.log(`Refs présentes en BDD     : ${localProducts.length}`);
  console.log(`Refs ABSENTES en BDD      : ${refsArray.length - localProducts.length}`);

  const localStatusCount = new Map<string, number>();
  let withAnkorsId = 0;
  let withoutAnkorsId = 0;
  for (const p of localProducts) {
    localStatusCount.set(p.status, (localStatusCount.get(p.status) ?? 0) + 1);
    if (p.ankorsProductId) withAnkorsId++;
    else withoutAnkorsId++;
  }
  console.log(`Par statut local :`);
  for (const [s, n] of localStatusCount) console.log(`    ${s.padEnd(10)} : ${n}`);
  console.log(`  Liés à un produit AS (refresh attendu)   : ${withAnkorsId}`);
  console.log(`  Non liés (publish attendu)               : ${withoutAnkorsId}`);

  // 4) Génère l'Excel
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Beli & Jolie";
  workbook.created = new Date();

  // Feuille 1 : récap
  const recap = workbook.addWorksheet("Récap");
  recap.columns = [
    { header: "Type d'erreur", key: "cat", width: 50 },
    { header: "Occurrences", key: "n", width: 14 },
  ];
  recap.getRow(1).font = { bold: true };
  for (const [cat, n] of catList) recap.addRow({ cat, n });

  // Feuille 2 : 1 ligne par produit
  const detail = workbook.addWorksheet("Produits en brouillon");
  detail.columns = [
    { header: "Référence SKU", key: "ref", width: 18 },
    { header: "Nom (Ankorstore)", key: "asName", width: 40 },
    { header: "Existe en BDD ?", key: "inDb", width: 16 },
    { header: "Statut local", key: "localStatus", width: 12 },
    { header: "Lié à AS ?", key: "linked", width: 12 },
    { header: "Action conseillée", key: "action", width: 18 },
    { header: "Nb lignes erreur", key: "nLines", width: 16 },
    { header: "Types d'erreurs", key: "cats", width: 60 },
    { header: "SKUs concernés", key: "skus", width: 40 },
    { header: "Suggestion", key: "suggestion", width: 60 },
  ];
  detail.getRow(1).font = { bold: true };
  detail.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };

  const sortedRefs = Array.from(byRef.values()).sort((a, b) =>
    a.ref.localeCompare(b.ref),
  );
  for (const b of sortedRefs) {
    const local = localByRef.get(b.ref);
    const inDb = !!local;
    const linked = !!local?.ankorsProductId;
    let action: string;
    if (!inDb) action = "Brouillon orphelin";
    else if (linked) action = "REFRESH";
    else action = "PUBLISH";

    const cats = Array.from(b.categories.entries())
      .map(([c, n]) => `${c} (${n})`)
      .join(" / ");
    const topCat = Array.from(b.categories.entries()).sort((a, c) => c[1] - a[1])[0]?.[0] ?? "?";

    detail.addRow({
      ref: b.ref,
      asName: Array.from(b.productNames).join(" / ").slice(0, 100),
      inDb: inDb ? "oui" : "NON",
      localStatus: local?.status ?? "",
      linked: linked ? "oui" : "non",
      action,
      nLines: Array.from(b.categories.values()).reduce((a, c) => a + c, 0),
      cats,
      skus: Array.from(b.skus).slice(0, 5).join(", ") + (b.skus.size > 5 ? "…" : ""),
      suggestion: suggestFix(topCat),
    });
  }
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detail.columns.length },
  };

  const outDir = path.dirname(csvPath);
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `ankorstore-drafts-analysis-${stamp}.xlsx`);
  await workbook.xlsx.writeFile(outPath);

  console.log(`\n✓ Fichier analyse : ${outPath}`);
}

main()
  .catch((err) => {
    console.error("Échec :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
