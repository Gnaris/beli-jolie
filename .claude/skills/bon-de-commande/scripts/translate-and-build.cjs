#!/usr/bin/env node
/**
 * Pipeline complet : prend le JSON sorti de parse-po.cjs + tables de
 * correspondance (chinois → français), produit le JSON attendu par
 * build-import.cjs, puis appelle build-import.cjs.
 *
 * Usage :
 *   node translate-and-build.cjs <parsed.json> <sortie.xlsx>
 *
 * Les tables ci-dessous DOIVENT rester cohérentes avec references/mapping.md.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PARSED_PATH = process.argv[2];
const OUT_XLSX = process.argv[3];
const SKIP_REFS_PATH = process.argv[4]; // optionnel : JSON liste de refs à exclure
const CAT_OVERRIDES_PATH = process.argv[5]; // optionnel : { "G293": "Collier", … }

if (!PARSED_PATH || !OUT_XLSX) {
  console.error("Usage : node translate-and-build.cjs <parsed.json> <sortie.xlsx> [skip-refs.json] [cat-overrides.json]");
  process.exit(1);
}

const skipRefs = new Set(
  SKIP_REFS_PATH ? JSON.parse(fs.readFileSync(SKIP_REFS_PATH, "utf-8")) : []
);

// Surcharges de catégorie par référence : utilisées quand le bon n'a pas
// de colonne 品名 et que la cliente fournit la catégorie manuellement.
// Valeur attendue : nom français direct (ex : "Collier") ou chinois (ex : "项链").
const catOverrides = CAT_OVERRIDES_PATH
  ? JSON.parse(fs.readFileSync(CAT_OVERRIDES_PATH, "utf-8"))
  : {};

// ── Catégories chinoises → { category, sub_categories } ──
// Règle cliente (2026-06-12) : catégories au singulier SAUF "Boucles d'oreilles"
// qui reste au pluriel (cas particulier — c'est l'objet qui va par paire).
// "Bracelet de main" et "Chaîne de cheville" sont des sous-catégories de Bracelet.
const CATS = {
  "耳环":          { category: "Boucles d'oreilles", sub: "" },
  "耳钉":          { category: "Boucles d'oreilles", sub: "" },
  "耳骨夹":        { category: "Boucles d'oreilles", sub: "Clips" },
  "单只耳环":      { category: "Boucles d'oreilles", sub: "À l'unité" },
  "项链":          { category: "Collier",            sub: "" },
  "胸链":          { category: "Collier",            sub: "Collier de dos" },
  "戒指":          { category: "Bague",              sub: "" },
  "手链":          { category: "Bracelet",           sub: "" },
  "手镯":          { category: "Bracelet",           sub: "Jonc" },
  "光面手镯":      { category: "Bracelet",           sub: "Jonc" },
  "豹纹绳子手镯":  { category: "Bracelet",           sub: "Jonc" },
  "脚链":          { category: "Bracelet",           sub: "Chaîne de cheville" },
  "手背链":        { category: "Bracelet",           sub: "Bracelet de main" },
  "胸针":          { category: "Broche",             sub: "" },
};

// ── Couleurs chinoises → couleur Beli & Jolie ──
// Convention WF (Weifan, confirmée 2026-06-12) : préfixe "金-" = placage doré,
// préfixe "钢-"/"钢色-" = couleur acier. On garde la couleur de base (suffixe).
// Suffixe "如样" = "comme l'échantillon" → on ignore, on garde Doré/Argent.
const COLORS = {
  // Fournisseur A
  "金色":  "Doré",
  "钢色":  "Argent",
  "蓝色":  "Bleu",
  "白色":  "Blanc",
  "黑色":  "Noir",
  "粉色":  "Rose",
  "绿色":  "Vert",
  "紫色":  "Violet",
  "米色":  "Beige",
  "米白":  "Beige",
  "桔色":  "Orange",
  "橙色":  "Orange",
  "玫红":  "Fuchsia",
  "咖啡":  "Marron",
  "胡兰":  "Marine",
  "七彩":  "Multicolore",
  "金+白": "Blanc",
  "金+兰": "Bleu",
  // Fournisseur WF — couleurs simples avec placage doré
  "金-黑色":         "Noir",
  "金-白色":         "Blanc",
  "金-粉色":         "Rose",
  "金-绿色":         "Vert",
  "金-蓝色":         "Bleu",
  "金-橘黄":         "Orange",
  // Fournisseur WF — "如样" (comme l'échantillon) → métal seul
  "金色-如样":       "Doré",
  "金-如样":         "Doré",
  "钢色-如样":       "Argent",
  "钢-如样":         "Argent",
  // Fournisseur WF — avec pierre (锆=zircon, 钻=diamant)
  // Cas particulier : la couleur de la pierre devient la couleur principale
  "金色-白锆":       "Blanc",
  "金色-蓝锆":       "Bleu",
  "金-白钻":         "Doré",
  "钢-白钻":         "Argent",
  // Fournisseur WF — bicolores/tricolores : couleur dominante
  "金-白+粉":        "Rose",
  "金-白+蓝":        "Bleu",
  "金-梅红+紫+浅粉": "Multicolore",
  "金-绿+黄+粉":     "Rose",
  // Fournisseur E — préfixe "16K金" (placage or 16 carats) → couleur de base
  "16K金色":        "Doré",
  "16K金白色":      "Blanc",
  "16K金蓝色":      "Bleu",
  "16K金粉色":      "Rose",
  // Fournisseur N — k minuscule + variantes condensées (sans 色)
  "16k金色":        "Doré",
  "金":             "Doré",
  "金+粉":          "Rose",
  "金+混色":        "Multicolore",
  // Fournisseur M — variantes
  "白钢":           "Argent",
  // Fournisseur J — couleurs « échantillon » et « n° »
  "样色蓝":         "Bleu",
  "白色珍珠":       "Blanc",
  "样色":           "Écru",
  "1号红色":        "Rouge",
  "9号粉色":        "Rose",
  "12号蓝色":       "Bleu",
};

const parsed = JSON.parse(fs.readFileSync(PARSED_PATH, "utf-8"));

// Détection des inconnus restants (sécurité, ne devrait jamais arriver après confirmation)
const stillUnknownCats = new Set();
const stillUnknownColors = new Set();

const skipped = [];
const translated = parsed.products
  .filter((p) => {
    if (skipRefs.has(p.reference)) {
      skipped.push(p.reference);
      return false;
    }
    return true;
  })
  .map((p) => {
  // 1) override explicite par référence (catégorie passée par la cliente)
  let cat = null;
  const override = catOverrides[p.reference];
  if (override) {
    // L'override peut être un nom chinois (resolvé via CATS) ou un nom français direct
    cat = CATS[override] || { category: override, sub: "" };
  } else {
    cat = CATS[p.pinmingZh];
  }
  if (!cat) stillUnknownCats.add(p.pinmingZh || `(sans catégorie : ${p.reference})`);
  const variants = p.colors.map((c) => {
    const colorFR = COLORS[c.colorZh];
    if (!colorFR) stillUnknownColors.add(c.colorZh);
    return {
      color: colorFR || `(?) ${c.colorZh}`,
      sale_type: "UNIT",
      size: "Taille unique",
      unit_price: c.price,
      stock: c.qty,
    };
  });
  return {
    reference: p.reference,
    fullRef: p.fullRef,
    category: cat ? cat.category : `(?) ${p.pinmingZh}`,
    // Sous-catégories laissées vides volontairement : l'import ne fait pas
    // de quick-create fiable pour les sous-cats et la cliente peut les
    // affecter manuellement après import si besoin. Le mapping reste tracé
    // dans references/mapping.md pour réutilisation future.
    sub_categories: "",
    variants,
  };
});

// ── Fusion des références en doublon dans le bon ──
// Certains fournisseurs (WF) listent un même produit sur plusieurs lots/boîtes.
// On les fusionne : variants par couleur additionnent les stocks.
const byRef = new Map();
const fusionsCount = {};
for (const p of translated) {
  const existing = byRef.get(p.reference);
  if (!existing) {
    byRef.set(p.reference, p);
    continue;
  }
  fusionsCount[p.reference] = (fusionsCount[p.reference] || 1) + 1;
  for (const v of p.variants) {
    const same = existing.variants.find((x) => x.color === v.color);
    if (same) {
      same.stock = (Number(same.stock) || 0) + (Number(v.stock) || 0);
    } else {
      existing.variants.push(v);
    }
  }
}
const merged = [...byRef.values()];
const fusions = Object.entries(fusionsCount);
if (fusions.length) {
  console.log(`ℹ️  ${fusions.length} référence(s) en doublon fusionnée(s) :`);
  fusions.forEach(([ref, n]) => console.log(`   - ${ref} (${n}× → 1 produit, stocks additionnés)`));
}

if (skipped.length) {
  console.log(`ℹ️  ${skipped.length} produits déjà en BDD exclus : ${skipped.join(", ")}`);
}

if (stillUnknownCats.size || stillUnknownColors.size) {
  console.error("⚠️  Catégories inconnues restantes :", [...stillUnknownCats]);
  console.error("⚠️  Couleurs inconnues restantes :", [...stillUnknownColors]);
  console.error("→ Mettre à jour translate-and-build.cjs ET references/mapping.md.");
  process.exit(2);
}

const data = {
  supplier: parsed.supplier,
  defaults: {
    composition: "Acier inoxydable:100",
    pays_fabrication: "Chine",
    saison: "Toutes saisons",
    taille_unique_details: "0",
  },
  products: merged,
};

const tmpDataPath = path.join(
  process.env.TEMP || process.env.TMP || "/tmp",
  `bdc-data-${Date.now()}.json`
);
fs.writeFileSync(tmpDataPath, JSON.stringify(data, null, 2), "utf-8");

const buildScript = path.join(__dirname, "build-import.cjs");
const result = spawnSync("node", [buildScript, tmpDataPath, OUT_XLSX], {
  stdio: "inherit",
});
process.exit(result.status || 0);
