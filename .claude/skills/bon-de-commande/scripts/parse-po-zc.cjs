#!/usr/bin/env node
/**
 * Parseur dédié aux bons de commande du fournisseur ZC (Yachan 雅婵饰品).
 *
 * Format particulier confirmé 2026-06-18 :
 *  - en-tête ligne 4 : 序号 / 品名 / 图片 / 产品编号 / 客户编号 / 电镀颜色 /
 *    单位 / 出货数量 / 单价 / 金额 / 说明 / 箱号 / 箱规 / 重量
 *  - colonne 客户编号 = référence Beli & Jolie (ex « ZC72-660-300 »)
 *  - colonne 电镀颜色 = plating : 16K炉内真金 / 14K炉内真金 (Doré) ou 钢色 (Argent)
 *  - colonne 说明 = sous-couleurs avec quantités (« 白143，粉71，蓝50，彩73 »)
 *
 * Règle cliente (2026-06-18) :
 *  - Si 说明 contient des sous-couleurs → chaque sous-couleur devient une
 *    variante avec sa quantité chiffrée.
 *  - Sinon (vide ou « 不滴油 », « 白 » seul, etc.), 1 variante = couleur de
 *    plating, qty = 出货数量.
 *  - Les deux plating 14K et 16K fusionnent en « Doré » (géré au stade
 *    translate-and-build par la fusion par référence).
 *
 * Sortie JSON identique à parse-po.cjs (compatible translate-and-build.cjs).
 */
const XLSX = require("xlsx");

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error("Usage : node parse-po-zc.cjs <fichier.xlsx>");
  process.exit(1);
}

// Tokens couleurs reconnus dans 说明 (abréviations vues chez ZC + extensibles).
const ZC_SUBCOLOR_TOKENS = ["白", "粉", "蓝", "彩", "黄", "绿", "红", "紫", "黑", "金"];

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

// Parse une cellule 说明 et retourne soit :
//  - null si aucune sous-couleur reconnue (fallback sur plating à appeler)
//  - [{ colorZh, qty }, ...] si reconnu
// La qty est explicite (suivie en chiffres) ou null si juste « 白 » seul.
function parseSubColors(raw, fallbackQty) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // séparateurs : virgule chinoise (，), virgule normale (,), ponctuation enumérative (、), espace
  const parts = s.split(/[，,、\s]+/).filter(Boolean);
  const variants = [];
  for (const part of parts) {
    // chercher un token couleur en début
    let matched = false;
    for (const token of ZC_SUBCOLOR_TOKENS) {
      if (part.startsWith(token)) {
        const rest = part.slice(token.length).trim();
        const qty = rest ? toNumber(rest) : null;
        variants.push({ colorZh: token, qty });
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Token inconnu → on annule tout et on bascule sur le plating
      return null;
    }
  }
  if (!variants.length) return null;
  // Si tous les qty sont null (ex : « 白 » seul), on assigne la qty globale au seul token
  if (variants.every((v) => v.qty == null)) {
    if (variants.length === 1) variants[0].qty = fallbackQty;
    else {
      // Plusieurs tokens sans qty → on répartit la qty globale équitablement
      const per = fallbackQty != null ? Math.floor(fallbackQty / variants.length) : null;
      variants.forEach((v) => (v.qty = per));
    }
  }
  return variants;
}

function isFandan(raw) {
  return String(raw || "").includes("返单");
}

function detectSupplier(reference) {
  const m = String(reference || "").match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : "?";
}

function parseZC(sourcePath) {
  const wb = XLSX.readFile(sourcePath);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });

  // Trouver l'en-tête : ligne contenant 客户编号 + 出货数量 + 电镀颜色
  let headerRowIdx = -1;
  const cols = { pinming: -1, huohao: -1, plating: -1, qty: -1, price: -1, desc: -1 };
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i] || [];
    const map = {};
    r.forEach((v, j) => {
      if (v == null) return;
      const s = String(v).trim();
      if (s === "品名") map.pinming = j;
      else if (s === "客户编号") map.huohao = j;
      else if (s === "电镀颜色") map.plating = j;
      else if (s === "出货数量") map.qty = j;
      else if (s === "单价") map.price = j;
      else if (s === "说明") map.desc = j;
    });
    if (map.huohao != null && map.qty != null && map.plating != null) {
      headerRowIdx = i;
      Object.assign(cols, map);
      break;
    }
  }
  if (headerRowIdx < 0) {
    return { error: "En-tête ZC introuvable (品名 / 客户编号 / 电镀颜色 / 出货数量 dans les 15 premières lignes)." };
  }

  // Parcours des lignes de données
  // On regroupe par fullRef (客户编号) car deux lignes (gold/steel) peuvent
  // partager la même fullRef ; le ref produit BJ = ZC<n>, idem entre les deux lignes.
  const products = new Map(); // key = fullRef
  const fandanList = [];
  const issues = [];
  const unknownCategories = new Set();
  const unknownColorsSet = new Set();

  // Catégories ZC connues (référence pour signaler les inconnues)
  const KNOWN_CATS_ZC = new Set(["戒指", "项链", "手链", "手镯", "耳环", "耳钉", "耳骨夹", "耳夹", "脚链", "胸针"]);
  // Plating ZC connus
  const KNOWN_PLATING_ZC = new Set(["16K炉内真金", "14K炉内真金", "钢色"]);
  // Sous-couleurs ZC connues
  const KNOWN_SUBCOLORS_ZC = new Set(["白", "粉", "蓝", "彩", "黄", "绿"]);

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const pinming = cols.pinming >= 0 ? r[cols.pinming] : null;
    const huohao = r[cols.huohao];
    const plating = cols.plating >= 0 ? r[cols.plating] : null;
    const qty = toNumber(r[cols.qty]);
    const desc = cols.desc >= 0 ? r[cols.desc] : null;

    const huohaoStr = huohao == null ? "" : String(huohao).trim();
    const pinmingStr = pinming == null ? "" : String(pinming).trim();
    const platingStr = plating == null ? "" : String(plating).trim();

    // Stop / lignes à ignorer
    if (/^合计[:：]?$/.test(huohaoStr) || /^合计[:：]?$/.test(pinmingStr) || /^总合计|^总金额|^总计/.test(huohaoStr)) break;
    if (!huohaoStr) continue;

    if (isFandan(pinming)) {
      fandanList.push({ reference: extractReference(huohaoStr), fullRef: huohaoStr, pinmingZh: pinmingStr.replace(/[\s\r\n]+/g, "").replace(/返单/g, ""), colors: [] });
      continue;
    }

    if (!KNOWN_CATS_ZC.has(pinmingStr)) unknownCategories.add(pinmingStr || `(sans catégorie : ${huohaoStr})`);
    if (!KNOWN_PLATING_ZC.has(platingStr)) unknownColorsSet.add(platingStr);

    // Prix = dernier segment de la référence / 100 (règle cliente confirmée)
    const refPrice = extractPriceFromRef(huohaoStr);
    if (refPrice == null) issues.push(`${huohaoStr} — prix introuvable dans la référence`);
    if (qty == null) issues.push(`${huohaoStr} — quantité manquante`);

    // Parser les sous-couleurs
    const subColors = parseSubColors(desc, qty);
    let lineVariants;
    if (subColors && subColors.length) {
      lineVariants = subColors.map((sc) => ({
        colorZh: sc.colorZh,
        qty: sc.qty != null ? sc.qty : qty,
        price: refPrice,
      }));
      // Tracer les sous-couleurs nouvelles
      subColors.forEach((sc) => {
        if (!KNOWN_SUBCOLORS_ZC.has(sc.colorZh)) unknownColorsSet.add(sc.colorZh);
      });
    } else {
      // fallback = couleur de plating
      lineVariants = [{ colorZh: platingStr, qty, price: refPrice }];
    }

    // Agrégation par fullRef (même produit possiblement sur plusieurs lignes)
    let cur = products.get(huohaoStr);
    if (!cur) {
      cur = {
        fullRef: huohaoStr,
        reference: extractReference(huohaoStr),
        refPrice,
        pinmingRaw: pinming,
        pinmingZh: pinmingStr,
        fandan: false,
        colors: [],
      };
      products.set(huohaoStr, cur);
    }
    cur.colors.push(...lineVariants);
  }

  const normals = [...products.values()];
  const supplier = normals.length ? detectSupplier(normals[0].reference) : "?";

  return {
    supplier,
    sourcePath,
    sheetName: wb.SheetNames[0],
    counts: {
      total: normals.length + fandanList.length,
      importable: normals.length,
      fandan: fandanList.length,
    },
    fandan: fandanList,
    products: normals,
    unknownCategories: [...unknownCategories],
    unknownColors: [...unknownColorsSet],
    issues,
  };
}

try {
  const out = parseZC(SOURCE);
  process.stdout.write(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("Erreur de parsing ZC :", e.message);
  process.exit(1);
}
