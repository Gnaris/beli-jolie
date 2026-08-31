#!/usr/bin/env node
/**
 * Parseur dédié au fournisseur J (YI WU U.N.K 优妮珂饰品厂).
 *
 * Format particulier :
 *  - En-tête ligne 3 : 编号 / 箱号 / 图片 / 客人条码 / 打数 / 单位 / 总数量 /
 *    单价 / 总金额 / 箱规
 *  - Colonne 编号 = code interne fournisseur (à IGNORER, ce n'est pas la ref)
 *  - Colonne 客人条码 = CELLULE MULTI-LIGNES contenant :
 *      ligne 0 : référence complète (« J230-1128-550 »)
 *      ligne N : « <n>.<couleur>：<qty><unité> » (séparateur 全角 ： U+FF1A)
 *      ex : « 1.样色：118对 » « 2.粉色+紫色：94对 »
 *  - Unité (对 pair / 条 brin / 个 pièce) sert à inférer la catégorie :
 *      对 → Boucles d'oreilles
 *      条 → (ambigu bracelet/collier — laissé vide, override cliente)
 *      个 → (ambigu bague/autre — laissé vide, override cliente)
 *
 * Sortie JSON identique à parse-po.cjs (compatible translate-and-build.cjs).
 */
const XLSX = require("xlsx");

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error("Usage : node parse-po-j.cjs <fichier.xlsx>");
  process.exit(1);
}

const FULLWIDTH_COLON = "："; // ：
const COLOR_LINE = new RegExp(`^\\s*\\d+\\.\\s*([^${FULLWIDTH_COLON}:]+)[${FULLWIDTH_COLON}:]\\s*(\\d+(?:\\.\\d+)?)\\s*([对条个只片双套])?`);

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^\d.,\-]/g, "").replace(/,/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractReference(huohao) {
  const s = String(huohao || "").trim();
  const dash = s.indexOf("-");
  return dash > 0 ? s.slice(0, dash) : s;
}

function extractPriceFromRef(huohao) {
  const s = String(huohao || "").trim();
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
    case "对": return "耳环";        // pair → BO
    case "双": return "耳环";        // pair (variant) → BO
    case "只": return "耳环";        // single earring → BO (mono)
    default: return null;             // ambigu
  }
}

function parseJ(sourcePath) {
  const wb = XLSX.readFile(sourcePath);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });

  // Trouver l'en-tête : ligne contenant 客人条码 + 打数 + 总数量
  let headerRowIdx = -1;
  let cols = { huohao: -1, qty: -1, price: -1 };
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i] || [];
    const map = {};
    r.forEach((v, j) => {
      if (v == null) return;
      const s = String(v).trim();
      if (s === "客人条码") map.huohao = j;
      else if (s === "总数量") map.qty = j;
      else if (s === "单价") map.price = j;
    });
    if (map.huohao != null && map.qty != null) {
      headerRowIdx = i;
      cols = { ...cols, ...map };
      break;
    }
  }
  if (headerRowIdx < 0) {
    return { error: "En-tête J introuvable (客人条码 / 总数量 dans les 15 premières lignes)." };
  }

  const products = new Map(); // clé = reference (car un produit peut être sur plusieurs lignes / boîtes)
  const unknownCategories = new Set();
  const unknownColors = new Set(); // laissé vide ici, la traduction se fait ailleurs
  const issues = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const cell = r[cols.huohao];
    if (cell == null) continue;
    const raw = String(cell).trim();
    if (!raw) continue;

    const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const fullRef = lines[0];
    const reference = extractReference(fullRef);
    if (!/^[A-Za-z]+\d+[A-Za-z]?$/.test(reference)) continue; // pas un vrai code produit
    const refPrice = extractPriceFromRef(fullRef);

    // Récupérer / créer le produit
    let prod = products.get(reference);
    if (!prod) {
      prod = {
        fullRef,
        reference,
        refPrice,
        pinmingRaw: null,
        pinmingZh: "",
        fandan: false,
        colors: [],
        _units: [],
      };
      products.set(reference, prod);
    }

    for (const line of lines.slice(1)) {
      const m = line.match(COLOR_LINE);
      if (!m) continue;
      const color = m[1].trim();
      const qty = toNumber(m[2]);
      const unit = m[3] || null;
      prod.colors.push({ colorZh: color, qty, price: refPrice });
      if (unit) prod._units.push(unit);
    }
  }

  // Inférer catégorie depuis l'unité majoritaire
  for (const p of products.values()) {
    if (p.pinmingZh) continue;
    const counts = new Map();
    for (const u of p._units) counts.set(u, (counts.get(u) || 0) + 1);
    const [topUnit] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    const cat = unitToCategory(topUnit);
    if (cat) {
      p.pinmingZh = cat;
    } else {
      unknownCategories.add(`(J ${p.reference} — unité ${topUnit || "?"})`);
    }
    delete p._units;
    if (!p.colors.length) issues.push(`${p.reference} (${p.fullRef}) — aucune couleur détectée`);
  }

  const normals = [...products.values()];

  return {
    supplier: "J",
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
  const out = parseJ(SOURCE);
  process.stdout.write(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("Erreur de parsing J :", e.message);
  process.exit(1);
}
