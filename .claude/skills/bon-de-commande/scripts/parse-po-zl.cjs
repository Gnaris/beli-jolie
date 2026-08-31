#!/usr/bin/env node
/**
 * Parseur dédié au fournisseur ZL (义乌市铭昇 贸易).
 *
 * Format particulier :
 *  - En-tête sur DEUX lignes (6 et 7) :
 *      ligne 6 : 品名 / (img) / 尺寸要求 / 电镀 / 数量 / 单位 / 单价 / 金额
 *      ligne 7 : 货号 / 图片 /       /      /      /       /      /      / 款号 / 条码
 *    → la vraie référence est dans la colonne 款号 (col 8), PAS 品名 (col 0
 *    qui est juste un numéro d'ordre « 02 », « 04 »…).
 *  - Colonne 电镀 (col 3) contient :
 *      soit UNE couleur seule (« 18K金 », « 钢色 ») avec sa qty sur la même
 *      ligne — les lignes suivantes sans ref sont d'autres couleurs du produit
 *      soit PLUSIEURS couleurs empilées en texte séparé par 「，」 avec qty
 *      collée (« 18K金，白色102个，虎眼石99，青金石98，深绿色各98个 »).
 *  - Unité (对 pair / 条 brin / 个 pièce) sert à inférer la catégorie :
 *      对 → 耳环 (Boucles d'oreilles)
 *      条 / 个 → laissé vide, cliente overrides
 *
 * Sortie JSON identique à parse-po.cjs (compatible translate-and-build.cjs).
 */
const XLSX = require("xlsx");

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error("Usage : node parse-po-zl.cjs <fichier.xlsx>");
  process.exit(1);
}

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^\d.,\-]/g, "").replace(/,/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractReference(kuanhao) {
  const s = String(kuanhao || "").trim();
  const dash = s.indexOf("-");
  return dash > 0 ? s.slice(0, dash) : s;
}

function extractPriceFromRef(kuanhao) {
  const s = String(kuanhao || "").trim();
  const parts = s.split("-");
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].replace(/[^\d.]/g, "");
  if (!last) return null;
  const n = parseFloat(last);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

function unitToCategory(unit) {
  switch (unit) {
    case "对": return "耳环";
    case "双": return "耳环";
    case "只": return "耳环";
    default:   return null;
  }
}

// Découpe une cellule 电镀 multi-couleurs séparées par 「，」 comme
// « 白色102个，虎眼石99，青金石98，深绿色各98个 ».
// Retourne [{ colorZh, qty }, ...] ou null si aucun couple couleur+qty détecté.
function parseInlineColors(text, unit) {
  if (!text) return null;
  const s = String(text).trim();
  if (!s.includes("，") && !s.includes(",")) return null;
  const parts = s.split(/[，,]/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    // « 白色102个 », « 虎眼石99 », « 深绿色各98个 » → couleur + qty
    // On retire le préfixe « 各 » (each) si présent, et l'unité chinoise en fin.
    const m = p.match(/^([^0-9]+?)(?:各)?(\d+)(?:[对条个只片双套])?$/);
    if (!m) continue;
    const color = m[1].trim();
    const qty = toNumber(m[2]);
    if (!color || qty == null) continue;
    out.push({ colorZh: color, qty });
  }
  return out.length ? out : null;
}

function parseZL(sourcePath) {
  const wb = XLSX.readFile(sourcePath);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });

  // Trouver la ligne d'en-tête contenant 款号 (col ≥ 6) — la vraie référence.
  let headerRowIdx = -1;
  let colRef = -1;
  let colColors = -1;
  let colQty = -1;
  let colUnit = -1;
  let colPrice = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i] || [];
    const kuanIdx = r.findIndex((v) => v != null && String(v).trim() === "款号");
    if (kuanIdx < 0) continue;
    headerRowIdx = i;
    colRef = kuanIdx;
    // Chercher les autres colonnes dans les lignes voisines (l'en-tête est éclaté sur 2 lignes).
    for (let j = Math.max(0, i - 2); j <= i + 1; j++) {
      const row = rows[j] || [];
      row.forEach((v, k) => {
        if (v == null) return;
        const s = String(v).trim();
        if (s === "电镀" && colColors < 0) colColors = k;
        else if (s === "数量" && colQty < 0) colQty = k;
        else if (s === "单位" && colUnit < 0) colUnit = k;
        else if (s === "单价" && colPrice < 0) colPrice = k;
      });
    }
    break;
  }
  if (headerRowIdx < 0 || colRef < 0 || colColors < 0 || colQty < 0) {
    return { error: "En-tête ZL introuvable (款号 + 电镀 + 数量 dans les 15 premières lignes)." };
  }

  const products = new Map();
  const unknownCategories = new Set();
  const unknownColors = new Set();
  const issues = [];
  let cur = null;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const refCell = r[colRef];
    const refStr = refCell == null ? "" : String(refCell).trim();
    const colorsCell = r[colColors];
    const qtyRaw = r[colQty];
    const unit = colUnit >= 0 ? (r[colUnit] == null ? null : String(r[colUnit]).trim()) : null;

    const qty = toNumber(qtyRaw);

    // Fin de tableau
    if (colorsCell != null && String(colorsCell).trim().startsWith("合计")) break;
    if (unit != null && String(unit).startsWith("合计")) break;

    if (refStr) {
      // Nouvelle référence
      const reference = extractReference(refStr);
      if (!/^[A-Za-z]+\d+[A-Za-z]?$/.test(reference)) continue;
      const refPrice = extractPriceFromRef(refStr);
      cur = {
        fullRef: refStr,
        reference,
        refPrice,
        pinmingRaw: null,
        pinmingZh: "",
        fandan: false,
        colors: [],
        _units: [],
      };
      products.set(reference, cur);
    }
    if (!cur) continue;

    // Extraire les couleurs de la cellule courante
    const inline = parseInlineColors(colorsCell, unit);
    if (inline) {
      // Multi-couleurs empilées : qty par couleur
      for (const c of inline) cur.colors.push({ colorZh: c.colorZh, qty: c.qty, price: cur.refPrice });
    } else if (colorsCell != null && String(colorsCell).trim()) {
      // Couleur unique = toute la cellule
      const color = String(colorsCell).trim();
      cur.colors.push({ colorZh: color, qty, price: cur.refPrice });
    }
    if (unit) cur._units.push(unit);
  }

  // Inférer catégorie via unité majoritaire
  for (const p of products.values()) {
    const counts = new Map();
    for (const u of p._units) counts.set(u, (counts.get(u) || 0) + 1);
    const [topUnit] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    const cat = unitToCategory(topUnit);
    if (cat) p.pinmingZh = cat;
    else unknownCategories.add(`(ZL ${p.reference} — unité ${topUnit || "?"})`);
    delete p._units;
    if (!p.colors.length) issues.push(`${p.reference} (${p.fullRef}) — aucune couleur détectée`);
  }

  const normals = [...products.values()];
  return {
    supplier: "ZL",
    sourcePath,
    sheetName: wb.SheetNames[0],
    counts: {
      total: normals.length,
      importable: normals.length,
      fandan: 0,
    },
    fandan: [],
    products: normals,
    unknownCategories: [...unknownCategories],
    unknownColors: [...unknownColors],
    issues,
  };
}

try {
  const out = parseZL(SOURCE);
  process.stdout.write(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("Erreur de parsing ZL :", e.message);
  process.exit(1);
}
