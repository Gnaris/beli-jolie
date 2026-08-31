#!/usr/bin/env node
/**
 * Parser de bon de commande Beli & Jolie.
 *
 * Usage :
 *   node parse-po.cjs <chemin-vers-bon-de-commande.xlsx>
 *
 * Sortie : JSON sur stdout avec la structure :
 *
 * {
 *   "supplier": "A",                // déduit des lettres de la première référence
 *   "fandan": [ { reference, pinming, colors:[...] }, ... ], // produits 返单 = à ignorer dans l'import
 *   "products": [
 *     {
 *        "fullRef": "A2493-448-280",
 *        "reference": "A2493",
 *        "pinmingZh": "耳骨夹",         // catégorie chinoise brute
 *        "colors": [
 *           { "colorZh": "金色", "qty": 184, "price": 4.8 },
 *           { "colorZh": "钢色", "qty": 70,  "price": 4.5 }
 *        ]
 *     }, ...
 *   ],
 *   "unknownCategories": ["耳骨夹", "脚链", ...], // 品名 chinois absents de la table de mapping
 *   "unknownColors":     ["白色", "胡兰", ...],   // 颜色 chinois absents de la table de mapping
 *   "issues": [ "Texte des incohérences détectées …" ]
 * }
 *
 * Ce parseur ne fait QUE lire et structurer. La traduction chinois → français
 * et la génération du fichier Excel final se font dans une étape séparée
 * (skill SKILL.md), pour laisser Claude poser des questions à la cliente
 * sur les valeurs inconnues avant de générer.
 */
const XLSX = require("xlsx");
const path = require("path");

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error("Usage : node parse-po.cjs <fichier.xlsx>");
  process.exit(1);
}

// ── Tables de mapping connues (sources de vérité : references/mapping.md) ──
const KNOWN_CATEGORIES = {
  "耳环": { category: "Boucles d'oreilles", sub: "" },
  "项链": { category: "Colliers",           sub: "" },
  "戒指": { category: "Bagues",             sub: "" },
  "手链": { category: "Bracelets",          sub: "" },
  "手镯": { category: "Bracelets",          sub: "" },
  "光面手镯": { category: "Bracelets",      sub: "" },
};

const KNOWN_COLORS = {
  "金色": "Doré",
  "钢色": "Argent",
  "蓝色": "Bleu",
};

function detectSupplier(reference) {
  // Lettres au début (A, ZC, AB, …) jusqu'au premier chiffre
  const m = String(reference || "").match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : "?";
}

// Mots-catégorie chinois reconnus (sert à extraire la cat depuis 说明 chez E
// qui mélange catégorie + description : ex « 戒指点钻 », « 耳环50大 »).
const KNOWN_CAT_TOKENS = [
  "光面手镯", "豹纹绳子手镯", "单只耳环",
  "耳骨夹", "手背链", "胸针", "胸链", "脚链",
  "耳钉", "耳扣", "耳环", "项链", "戒指", "手链", "手镯",
];

function cleanPinming(raw) {
  // Enlève espaces, sauts de ligne, supprime « 返单 »
  const s = String(raw || "").replace(/\s+/g, "").replace(/返单/g, "").trim();
  if (!s) return "";
  // Si la chaîne contient un mot-catégorie connu, on l'extrait (le 1er trouvé)
  for (const token of KNOWN_CAT_TOKENS) {
    if (s.includes(token)) return token;
  }
  return s;
}

function isFandan(raw) {
  return String(raw || "").includes("返单");
}

function extractReference(huohao) {
  // « A2493-448-280 » → « A2493 »
  const s = String(huohao || "").trim();
  const dash = s.indexOf("-");
  return dash > 0 ? s.slice(0, dash) : s;
}

// ⚠️ RÈGLE PRIX CRITIQUE (confirmée par la cliente 2026-06-12) :
// Le vrai prix unitaire est codé dans le DERNIER segment de la référence,
// divisé par 100. Exemple : « A2235-1118-520 » → 520 / 100 = 5,20 €.
// Le 价格 / 单价 du bon est un autre tarif (souvent prix conseillé / pack)
// et ne doit JAMAIS être utilisé pour le prix d'import.
// Fallback uniquement si le dernier segment n'est pas numérique.
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

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  // Retire tout caractère non-numérique sauf chiffres, point, virgule, tiret.
  // Couvre les préfixes monétaires (￥, €, $), espaces, etc.
  const cleaned = String(v)
    .replace(/[^\d.,\-]/g, "")
    .replace(/,/g, ".")
    .replace(/\.(?=.*\.)/g, ""); // si plusieurs points, ne garder que le dernier
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parsePO(sourcePath) {
  const wb = XLSX.readFile(sourcePath);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });

  // Les fournisseurs n'ont pas tous le même intitulé de colonne. On accepte
  // toutes les variantes courantes (fournisseur A : 颜色/价格 ; fournisseur WF :
  // 电镀色/单价 préfixés de l'anglais "plating Color/" et "Price/"). Ordre =
  // priorité : le premier alias qui matche gagne (ex : 客人条码 avant 编号 car
  // pour le fournisseur Z, 编号 est le n° interne du fournisseur et non la ref).
  const HEADER_ALIASES = {
    pinming: ["货名", "品名", "说明", "类型"],
    huohao:  ["客人条码", "货号", "条码", "编号"],
    yanse:   ["规格", "颜色", "颜色要求", "电镀色", "plating color/电镀色", "color/电镀色"],
    qty:     ["数量", "quantity/pcs/数量", "quantity/数量", "pcs/数量", "装箱数/pcs", "装箱数"],
    price:   ["价格", "单价", "price/单价", "单价/pcs"],
    total:   ["金额", "总价", "amount/总价", "amount/  总价"],
    box:     ["箱号", "装箱号"],
  };

  function matchHeader(s) {
    const norm = String(s).trim().toLowerCase().replace(/\s+/g, " ");
    for (const [key, list] of Object.entries(HEADER_ALIASES)) {
      const idx = list.findIndex((alias) => alias.toLowerCase() === norm);
      if (idx >= 0) return { key, priority: idx };
    }
    return null;
  }

  // Trouver l'en-tête : ligne où on a au moins pinming + huohao + yanse + qty + price
  let headerRowIdx = -1;
  let cols = { pinming: -1, huohao: -1, yanse: -1, qty: -1, price: -1, total: -1, box: -1 };
  let pinmingSecond = -1; // Fournisseur N : 2ᵉ col « 编号 » contient parfois la catégorie
  // On scanne jusqu'à 30 lignes pour gérer les bons avec long en-tête commercial (WF : 7 lignes)
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const r = rows[i] || [];
    const map = {};
    const priorities = {};
    r.forEach((v, j) => {
      if (v == null) return;
      const match = matchHeader(v);
      if (!match) return;
      // Le meilleur alias (priorité la plus haute = index le plus bas) gagne.
      const prev = priorities[match.key];
      if (prev == null || match.priority < prev) {
        map[match.key] = j;
        priorities[match.key] = match.priority;
      } else if (match.key === "huohao" && pinmingSecond < 0) {
        // Cas fournisseur N : deux colonnes 编号. La 2ᵉ contient parfois la cat.
        pinmingSecond = j;
      }
    });
    // 品名 (catégorie) et 颜色 (couleur) sont optionnels : certains fournisseurs
    // (ex : G n'a pas 品名, ZK n'a pas 颜色). Dans ces cas la cliente devra
    // fournir la valeur manquante au moment de la génération via overrides.
    if (
      map.huohao != null &&
      map.qty != null && map.price != null
    ) {
      headerRowIdx = i;
      cols = { ...cols, ...map };
      break;
    }
  }

  if (headerRowIdx < 0) {
    return {
      error: "En-tête introuvable. Cherché : 品名 / 货号 / 颜色 / 数量 / 价格 dans les 20 premières lignes.",
    };
  }

  // Suffixes ET préfixes-catégorie collés à la couleur.
  // Ex G : « 金色手链 » (couleur+cat) OU « 项链金色 » (cat+couleur) OU « 手链混色 » (cat en préfixe).
  const CAT_TOKENS_IN_COLOR = ["手链", "项链", "戒指", "耳环", "手镯", "耳钉", "耳扣", "胸针", "脚链", "手背链", "耳骨夹"];
  function splitColorCategory(colorRaw) {
    const s = String(colorRaw).trim();
    // Suffixe : « 金色手链 » → couleur=金色, cat=手链
    for (const token of CAT_TOKENS_IN_COLOR) {
      if (s.endsWith(token) && s.length > token.length) {
        return { color: s.slice(0, -token.length).trim(), embeddedCat: token };
      }
    }
    // Préfixe : « 项链金色 », « 手链混色 » → cat=项链, couleur=金色
    for (const token of CAT_TOKENS_IN_COLOR) {
      if (s.startsWith(token) && s.length > token.length) {
        return { color: s.slice(token.length).trim(), embeddedCat: token };
      }
    }
    return { color: s, embeddedCat: null };
  }

  // Parcourir les lignes de données
  const products = [];
  let cur = null;
  const KNOWN_CAT_TOKEN_SET = new Set(KNOWN_CAT_TOKENS);
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    let pinming = cols.pinming >= 0 ? r[cols.pinming] : null;
    // Fournisseur N : si le pinming principal est vide, tenter la 2ᵉ col « 编号 »
    // qui peut contenir 手链 / 项链 / etc.
    if ((pinming == null || String(pinming).trim() === "") && pinmingSecond > 0) {
      const alt = r[pinmingSecond];
      const altStr = alt == null ? "" : String(alt).trim();
      if (KNOWN_CAT_TOKEN_SET.has(altStr)) pinming = altStr;
    }
    const huohao = r[cols.huohao];
    const yanse = cols.yanse >= 0 ? r[cols.yanse] : null;
    const qty = toNumber(r[cols.qty]);
    const price = toNumber(r[cols.price]);

    // Lignes parasites à ignorer (commun à plusieurs fournisseurs) :
    // - réen-têtes répétés (huohao = "条码" ou "货号")
    // - bandeaux "X号箱" / "1号箱"
    // - notes "备注：" / "备注"
    // - totaux bas de page : "总合计"/"合计"/"Total" / "第X箱"
    const yanseStr = yanse == null ? "" : String(yanse).trim();
    const huohaoStr = huohao == null ? "" : String(huohao).trim();
    // Stop total/box-summary (ex N : "总计/数量/金额/元")
    if (/总合计|^合计$|^总金额|^总计|Total/i.test(yanseStr) || /^合计$|^总金额|^总计/.test(huohaoStr) || /第[一二三四五六七八九十]箱/.test(huohaoStr)) break;
    // Skip réen-têtes / box-banners / notes
    if (/^条码$|^货号$/.test(huohaoStr)) continue;
    if (/^[0-9一二三四五六七八九十]+号箱$/.test(huohaoStr)) continue;
    if (/^备注/.test(huohaoStr)) continue;

    const hasHuohao = huohaoStr.length > 0;
    const hasYanse = yanseStr.length > 0;
    // Pour le format G : la "couleur" peut contenir un suffixe/préfixe cat.
    // ("金色手链", "项链金色", "手链混色", "金色耳环\n咖啡树脂"…).
    // On isole la 1re ligne pour détecter la catégorie mais on garde la valeur
    // brute pour la traduction couleur (traite « 金色耳环\n咖啡树脂 » comme une
    // seule couleur exotique — c'est la cliente qui tranchera à la relecture).
    let yanseClean = yanseStr;
    let embeddedCat = null;
    if (hasYanse) {
      const firstLine = yanseStr.split(/\r?\n/)[0].trim();
      const split = splitColorCategory(firstLine);
      if (split.embeddedCat) {
        yanseClean = split.color;
        embeddedCat = split.embeddedCat;
      }
    }

    if (hasHuohao) {
      // 货号 / 条码 multiligne courant (ex G : "G293-224-590\n22222590") :
      // on garde la première ligne pour la référence visible (fullRef).
      // Cas fournisseur Z : « Z213AB-660-300 11111300 » (barcode collé après
      // un espace) → on ne garde que la partie avant le premier espace.
      const refLineRaw = String(huohao).split(/\r?\n/)[0].split(/\s+/)[0].trim();
      // Cas fournisseur M : le 货号 est RÉ-INSCRIT sur chaque ligne de couleur
      // au lieu d'être laissé vide. Si on retrouve le même 货号 que le produit
      // en cours, c'est une couleur additionnelle, pas un nouveau produit.
      if (cur && refLineRaw === cur.fullRef) {
        if (hasYanse) cur.colors.push({ colorZh: yanseClean, qty, price: cur.refPrice != null ? cur.refPrice : price });
        if (!cur.pinmingZh && embeddedCat) cur.pinmingZh = embeddedCat;
        continue;
      }
      // Prix unitaire RÉEL = dernier segment de la référence / 100.
      // Le prix du tableau (price) est un autre tarif et ne sert que de fallback
      // au cas où la ref n'encode rien de numérique en dernier segment.
      const refPrice = extractPriceFromRef(refLineRaw);
      cur = {
        fullRef: refLineRaw,
        reference: extractReference(refLineRaw),
        refPrice, // sert à toutes les variantes du produit
        pinmingRaw: pinming,
        pinmingZh: cleanPinming(pinming) || embeddedCat || "",
        fandan: isFandan(pinming),
        colors: [],
      };
      products.push(cur);
      if (hasYanse) cur.colors.push({ colorZh: yanseClean, qty, price: refPrice != null ? refPrice : price });
    } else if (cur && hasYanse) {
      // Ligne supplémentaire = nouvelle couleur du produit en cours
      cur.colors.push({ colorZh: yanseClean, qty, price: cur.refPrice != null ? cur.refPrice : price });
      // Si la catégorie n'est pas encore connue et que cette ligne la révèle, on la prend
      if (!cur.pinmingZh && embeddedCat) cur.pinmingZh = embeddedCat;
    }
  }

  // Séparer fandan / produits importables
  const fandan = products.filter((p) => p.fandan);
  const normals = products.filter((p) => !p.fandan);

  // Détecter les inconnus
  const unknownCategories = new Set();
  const unknownColors = new Set();
  const issues = [];

  normals.forEach((p) => {
    if (!KNOWN_CATEGORIES[p.pinmingZh]) unknownCategories.add(p.pinmingZh);
    p.colors.forEach((c) => {
      if (!KNOWN_COLORS[c.colorZh]) unknownColors.add(c.colorZh);
    });
    if (p.colors.length === 0) issues.push(`${p.reference} (${p.fullRef}) — aucune couleur déclarée`);
    p.colors.forEach((c) => {
      if (c.qty == null) issues.push(`${p.reference} (${p.fullRef}) — quantité manquante pour ${c.colorZh}`);
      if (c.price == null) issues.push(`${p.reference} (${p.fullRef}) — prix manquant pour ${c.colorZh}`);
    });
  });

  // Détecter le fournisseur (à partir de la première référence normale)
  const supplier = normals.length ? detectSupplier(normals[0].reference) : "?";

  return {
    supplier,
    sourcePath,
    sheetName: wb.SheetNames[0],
    counts: {
      total: products.length,
      importable: normals.length,
      fandan: fandan.length,
    },
    fandan: fandan.map((p) => ({
      reference: p.reference,
      fullRef: p.fullRef,
      pinmingZh: p.pinmingZh,
      colors: p.colors.map((c) => c.colorZh),
    })),
    products: normals,
    unknownCategories: [...unknownCategories],
    unknownColors: [...unknownColors],
    issues,
  };
}

try {
  const out = parsePO(SOURCE);
  process.stdout.write(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("Erreur de parsing :", e.message);
  process.exit(1);
}
