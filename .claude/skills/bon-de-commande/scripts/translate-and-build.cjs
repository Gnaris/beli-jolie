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
// Catégories alignées sur ce qui existe réellement en BDD prod beliandjolie.com
// (vérifié 2026-07-25). Les sous-catégories inexistantes en BDD sont laissées
// vides — la cliente les créera à la volée dans l'admin si besoin.
// Seules sous-cats existantes utilisées ici : "Collier de dos" (sous Collier).
const CATS = {
  "耳环":          { category: "Boucles d'oreilles", sub: "" },
  "耳钉":          { category: "Boucles d'oreilles", sub: "" },
  "耳针":          { category: "Boucles d'oreilles", sub: "" },
  "耳拍":          { category: "Boucles d'oreilles", sub: "" },
  "耳骨夹":        { category: "Boucles d'oreilles", sub: "" },
  "耳夹":          { category: "Boucles d'oreilles", sub: "" },
  "单只耳环":      { category: "Boucles d'oreilles", sub: "" },
  "项链":          { category: "Collier",            sub: "" },
  "项链刚":        { category: "Collier",            sub: "" },
  "胸链":          { category: "Collier",            sub: "Collier de dos" },
  "戒指":          { category: "Bague ajustable",    sub: "" },
  "手链":          { category: "Bracelet",           sub: "" },
  "手链刚":        { category: "Bracelet",           sub: "" },
  "手镯":          { category: "Bracelet",           sub: "" },
  "光面手镯":      { category: "Bracelet",           sub: "" },
  "豹纹绳子手镯":  { category: "Bracelet",           sub: "" },
  "脚链":          { category: "Chaîne de cheville", sub: "" },
  "手背链":        { category: "Bracelet",           sub: "" },
  "臂镯":          { category: "Bracelet",           sub: "" },
  "腰链":          { category: "Chaîne de taille",   sub: "" },
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
  "样咖":           "Marron",
  // Fournisseur J — préfixes "N#色" (n° d'échantillon devant la couleur) — confirmé 2026-07-24
  "11#绿色":        "Vert",
  "22#白色":        "Blanc",
  "16#粉色":        "Rose",
  // ── Ajouts 2026-07-24 ──
  // Fournisseur A — bicolores + rouges spécifiques
  "梅红":           "Fuchsia",
  "枣红":           "Bordeaux",
  "虎石":           "Marron",
  "金+红":          "Rouge",
  "金+彩":          "Multicolore",
  "金+绿":          "Vert",
  "金+宝蓝":        "Bleu",
  "钢+白":          "Blanc",
  "钢+黑":          "Noir",
  "白+绿":          "Vert",
  "白+粉":          "Rose",
  // "白+胡兰" est résolu dynamiquement dans le pipeline (Bleu par défaut,
  // Marine si le produit contient déjà une variante Bleu). Voir hook plus bas.
  // Fournisseur WF — extensions
  "金-紫色":        "Violet",
  "金-黄色":        "Jaune",
  "金-混彩":        "Multicolore",
  "金-深浅紫":      "Violet",
  "金-蓝+绿":       "Bleu",
  "金-如样色粉钻":  "Rose",
  "金-如样粉钻":    "Rose",
  // Fournisseur E — bicolores multi-nuances (règle : on garde la couleur de base)
  "16K金白色+米白色":     "Blanc",
  "16K金浅粉色+深粉色":   "Rose",
  "16K金天蓝色+湖蓝色":   "Bleu",
  // Fournisseur N — variantes zircons et bicolores condensés
  "16k":                "Doré",
  "16K金色+粉钻":       "Rose",
  "16K金色+白钻":       "Doré",
  "16K+白钻":           "Doré",
  "16K白钻":            "Doré",
  "16K金色+绿钻":       "Vert",
  "16K+彩钻":           "Multicolore",
  "16k金色彩钻":        "Multicolore",
  "钢+白钻":            "Argent",
  "金+白色":            "Blanc",
  "金白":               "Blanc",
  "金+粉色":            "Rose",
  "金+彩色":            "Multicolore",
  "金+混彩色":          "Multicolore",
  "金+大红+粉":         "Rouge",
  "金+深蓝+湖兰":       "Marine",
  "金+祖母绿+青柠":     "Vert",
  // Fournisseur G — préfixe "贝" (nacre/coquille) → couleur de base
  "蓝贝":               "Bleu",
  "粉贝":               "Rose",
  "白贝":               "Blanc",
  "黑贝":               "Noir",
  "绿贝":               "Vert",
  "咖贝":               "Marron",
  "粉贝\n金色":         "Rose",
  // Fournisseur ZC — plating
  "16K炉内真金":    "Doré",
  "14K炉内真金":    "Doré",
  // Fournisseur ZC — sous-couleurs abrégées (colonne 说明)
  "白":             "Blanc",
  "粉":             "Rose",
  "蓝":             "Bleu",
  "彩":             "Multicolore",
  "黄":             "Jaune",
  "绿":             "Vert",
};

const parsed = JSON.parse(fs.readFileSync(PARSED_PATH, "utf-8"));

// Détection des inconnus restants (sécurité, ne devrait jamais arriver après confirmation)
const stillUnknownCats = new Set();
const stillUnknownColors = new Set();

// ── Désambiguïsation pré-fusion : même référence mais fullRef différent ──
// Exemple N801 : deux entrées ["N801-111-550"] et ["N801-885-450"] avec des
// prix codés différents = 2 produits distincts. On renomme les suivants
// "N801(2)", "N801(3)"… pour éviter la fusion abusive.
const seenByRefFullRef = new Map();
const renamed = [];
for (const p of parsed.products) {
  const key = p.reference;
  const existing = seenByRefFullRef.get(key);
  if (!existing) {
    seenByRefFullRef.set(key, [p.fullRef]);
    continue;
  }
  if (existing.includes(p.fullRef)) continue; // même fullRef → sera fusionné par la logique aval
  existing.push(p.fullRef);
  const newRef = `${p.reference}(${existing.length})`;
  renamed.push({ from: p.reference, to: newRef, fullRef: p.fullRef });
  p.reference = newRef;
}
if (renamed.length) {
  console.log(`ℹ️  ${renamed.length} référence(s) renommée(s) (même code, produits distincts) :`);
  for (const r of renamed) console.log(`   - ${r.from} → ${r.to}  (fullRef ${r.fullRef})`);
}

function resolveOverride(ov) {
  if (!ov) return null;
  if (typeof ov === "string") return CATS[ov] || { category: ov, sub: "" };
  return { category: ov.category, sub: ov.sub || "" };
}

const skipped = [];
const junkFiltered = [];
const REF_SHAPE = /^[A-Za-z]+\d+[A-Za-z]?(\(\d+\))?$/; // ex A2493, WF39A, N801(2)
const translated = parsed.products
  .filter((p) => {
    // Filtre les "produits fantômes" (notes de conditionnement, en-têtes, etc.)
    // dont la référence ne ressemble pas à un code produit standard.
    if (!REF_SHAPE.test(p.reference)) {
      junkFiltered.push(p.reference);
      return false;
    }
    if (skipRefs.has(p.reference)) {
      skipped.push(p.reference);
      return false;
    }
    return true;
  })
  .map((p) => {
  // 1) override explicite par référence (catégorie passée par la cliente)
  const overrideResolved = resolveOverride(catOverrides[p.reference]);
  const cat = overrideResolved || CATS[p.pinmingZh];
  if (!cat) stillUnknownCats.add(p.pinmingZh || `(sans catégorie : ${p.reference})`);
  const variants = [];
  let hasBleu = false;
  // Première passe : résout les couleurs simples et détecte si Bleu est présent
  for (const c of p.colors) {
    let colorFR = COLORS[c.colorZh];
    if (c.colorZh === "白+胡兰") { colorFR = "__DEFER_BAIHULAN__"; }
    if (!colorFR) stillUnknownColors.add(c.colorZh);
    if (colorFR === "Bleu") hasBleu = true;
    variants.push({
      color: colorFR || `(?) ${c.colorZh}`,
      sale_type: "UNIT",
      size: "Taille unique",
      unit_price: c.price,
      stock: c.qty,
    });
  }
  // Deuxième passe : résout "白+胡兰" (Marine si Bleu déjà présent, sinon Bleu)
  for (const v of variants) {
    if (v.color === "__DEFER_BAIHULAN__") v.color = hasBleu ? "Marine" : "Bleu";
  }
  return {
    reference: p.reference,
    fullRef: p.fullRef,
    category: cat ? cat.category : `(?) ${p.pinmingZh}`,
    sub_categories: cat ? cat.sub || "" : "",
    variants,
  };
});

// ── Fusion intra-produit : deux couleurs chinoises qui mappent au MÊME
//    français (ex : 白色 + 金+白 → Blanc) doivent devenir une seule variante,
//    stocks additionnés, prix max conservé. Sinon l'écran d'import refuse le
//    fichier (« Variante en doublon : Blanc / UNIT »).
function dedupeVariants(variants) {
  const byKey = new Map();
  const collisions = [];
  for (const v of variants) {
    const key = `${v.color}|${v.sale_type || "UNIT"}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, v);
      continue;
    }
    collisions.push({ key, addedStock: Number(v.stock) || 0, addedPrice: Number(v.unit_price) || 0 });
    existing.stock = (Number(existing.stock) || 0) + (Number(v.stock) || 0);
    const existingPrice = Number(existing.unit_price) || 0;
    const newPrice = Number(v.unit_price) || 0;
    if (newPrice > existingPrice) existing.unit_price = v.unit_price;
  }
  return { list: [...byKey.values()], collisions };
}
const intraCollisionsLog = [];
for (const p of translated) {
  const { list, collisions } = dedupeVariants(p.variants);
  p.variants = list;
  if (collisions.length) {
    intraCollisionsLog.push({ ref: p.reference, collisions });
  }
}
if (intraCollisionsLog.length) {
  console.log(`ℹ️  ${intraCollisionsLog.length} référence(s) avec couleurs fusionnées (même couleur FR, chinois différents) :`);
  for (const c of intraCollisionsLog) {
    console.log(`   - ${c.ref} : ${c.collisions.map((x) => x.key).join(", ")}`);
  }
}

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
    const same = existing.variants.find((x) => x.color === v.color && (x.sale_type || "UNIT") === (v.sale_type || "UNIT"));
    if (same) {
      same.stock = (Number(same.stock) || 0) + (Number(v.stock) || 0);
      const existingPrice = Number(same.unit_price) || 0;
      const newPrice = Number(v.unit_price) || 0;
      if (newPrice > existingPrice) same.unit_price = v.unit_price;
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

// ── Génération auto des parures (règle confirmée 2026-07-24) ──
// Quand plusieurs refs partagent la même base (ex J226 + J226A + J226B),
// on crée une ref supplémentaire baseE représentant la parure complète :
//   - Catégorie : Parures de bijoux
//   - Couleurs : intersection des couleurs des pièces (dispo dans TOUTES)
//   - Stock : 1000 pour chaque couleur (règle cliente)
//   - Prix : max du prix de chaque pièce (souvent Doré), sommé sur toutes
//            les pièces → prix unique identique pour toutes les couleurs
function refBase(ref) {
  // "J226" → "J226", "J226A" → "J226", "N801(2)" → "N801(2)" (parens = variante,
  // ne fait pas partie du même groupe parure).
  const m = ref.match(/^([A-Za-z]+\d+)([A-Za-z]?)$/);
  return m ? m[1] : null;
}
const groups = new Map();
for (const p of merged) {
  const base = refBase(p.reference);
  if (!base) continue;
  if (!groups.has(base)) groups.set(base, []);
  groups.get(base).push(p);
}
const parures = [];
for (const [base, pieces] of groups) {
  if (pieces.length < 2) continue;
  const parureRef = `${base}E`;
  // Ne pas écraser une vraie ref existante
  if (merged.some((p) => p.reference === parureRef)) {
    console.log(`⚠️  Parure ${parureRef} ignorée : ref déjà présente dans le bon.`);
    continue;
  }
  // Intersection des couleurs
  const colorSets = pieces.map((p) => new Set(p.variants.map((v) => v.color)));
  const common = [...colorSets[0]].filter((c) => colorSets.every((s) => s.has(c)));
  if (!common.length) {
    console.log(`⚠️  Parure ${parureRef} ignorée : aucune couleur commune aux pièces.`);
    continue;
  }
  // Prix : somme des prix max de chaque pièce
  const price = pieces.reduce((sum, p) => {
    const maxP = Math.max(...p.variants.map((v) => Number(v.unit_price) || 0));
    return sum + maxP;
  }, 0);
  const parureVariants = common.map((color) => ({
    color,
    sale_type: "UNIT",
    size: "Taille unique",
    unit_price: Number(price.toFixed(2)),
    stock: 1000,
  }));
  parures.push({
    reference: parureRef,
    fullRef: parureRef,
    category: "Parure de bijoux",
    sub_categories: "",
    variants: parureVariants,
    _parureOf: pieces.map((p) => p.reference),
  });
}
if (parures.length) {
  console.log(`✨ ${parures.length} parure(s) générée(s) :`);
  for (const p of parures) {
    console.log(`   - ${p.reference} (à partir de ${p._parureOf.join(" + ")}) — ${p.variants.length} couleur(s) @ ${p.variants[0].unit_price}€`);
  }
  merged.push(...parures);
}

if (skipped.length) {
  console.log(`ℹ️  ${skipped.length} produits déjà en BDD exclus : ${skipped.join(", ")}`);
}
if (junkFiltered.length) {
  console.log(`ℹ️  ${junkFiltered.length} ligne(s) non-produit(s) filtrée(s) (notes de conditionnement, etc.)`);
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
