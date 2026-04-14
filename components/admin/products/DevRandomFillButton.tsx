"use client";

import { useState } from "react";
import type { VariantState, ColorImageState, AvailableColor, AvailableSize } from "./ColorVariantManager";
import { uid as genUid, imageGroupKeyFromVariant } from "./ColorVariantManager";
import type { AvailableComposition } from "./ProductForm";
import {
  createColorQuick,
  createCategoryQuick,
  createSubCategoryQuick,
  createCompositionQuick,
  createTagQuick,
  createManufacturingCountryQuick,
  createSeasonQuick,
} from "@/app/actions/admin/quick-create";
import { createSize, toggleSizePfsMapping } from "@/app/actions/admin/sizes";

// ─────────────────────────────────────────────
// Dictionaries for random generation
// ─────────────────────────────────────────────
const ADJECTIVES = [
  "Élégant", "Moderne", "Classique", "Vintage", "Artisanal", "Premium",
  "Luxueux", "Raffiné", "Naturel", "Authentique", "Délicat", "Robuste",
  "Souple", "Brillant", "Mat", "Texturé", "Léger", "Épais", "Fin",
];
const NOUNS = [
  "Sac", "Écharpe", "Bracelet", "Collier", "Bague", "Ceinture",
  "Pochette", "Pendentif", "Broche", "Foulard", "Portefeuille",
  "Chapeau", "Gant", "Panier", "Coussin", "Vase", "Bougie", "Plateau",
  "Bol", "Tasse", "Carafe", "Nappe", "Serviette", "Tablier",
];
const MATERIALS_LABEL = [
  "en Cuir", "en Lin", "en Coton", "en Soie", "en Laine", "en Velours",
  "en Céramique", "en Bois", "en Verre", "en Bambou", "en Raphia",
];

const COLOR_DEFS: { name: string; hex: string }[] = [
  { name: "Rouge Carmin", hex: "#DC143C" },
  { name: "Bleu Nuit", hex: "#191970" },
  { name: "Vert Émeraude", hex: "#50C878" },
  { name: "Jaune Safran", hex: "#F4C430" },
  { name: "Rose Poudré", hex: "#E8B4B8" },
  { name: "Noir Ébène", hex: "#1B1B1B" },
  { name: "Blanc Ivoire", hex: "#FFFFF0" },
  { name: "Gris Perle", hex: "#C0C0C0" },
  { name: "Orange Mandarine", hex: "#FF8C00" },
  { name: "Violet Aubergine", hex: "#6A0DAD" },
  { name: "Bleu Ciel", hex: "#87CEEB" },
  { name: "Marron Châtaigne", hex: "#954535" },
  { name: "Beige Sable", hex: "#F5DEB3" },
  { name: "Turquoise", hex: "#40E0D0" },
  { name: "Bordeaux", hex: "#722F37" },
  { name: "Corail", hex: "#FF7F50" },
  { name: "Kaki", hex: "#BDB76B" },
  { name: "Lavande", hex: "#E6E6FA" },
  { name: "Doré", hex: "#FFD700" },
  { name: "Argenté", hex: "#C0C0C0" },
];

const PFS_COLOR_REFS = [
  "REDCRIMSON", "DARKBLUE", "EMERALDGREEN", "SAFFRON", "POWDERPINK",
  "EBONYBLACK", "IVORYWHITE", "PEARLGREY", "MANDARIN", "AUBERGINE",
  "SKYBLUE", "CHESTNUT", "SANDBEIGE", "TURQUOISE", "BURGUNDY",
  "CORAL", "KHAKI", "LAVENDER", "GOLDEN", "SILVER",
];

const CATEGORY_DEFS = [
  { name: "Maroquinerie", pfsGender: "WOMAN", pfsCatId: "CAT_MAROQUINERIE", pfsFamilyId: "FAM_ACCESSOIRES" },
  { name: "Accessoires Mode", pfsGender: "WOMAN", pfsCatId: "CAT_ACCESSOIRES", pfsFamilyId: "FAM_ACCESSOIRES" },
  { name: "Décoration Intérieure", pfsGender: null, pfsCatId: "CAT_DECO", pfsFamilyId: "FAM_MAISON" },
  { name: "Art de la Table", pfsGender: null, pfsCatId: "CAT_TABLE", pfsFamilyId: "FAM_MAISON" },
  { name: "Textile Maison", pfsGender: null, pfsCatId: "CAT_TEXTILE", pfsFamilyId: "FAM_MAISON" },
  { name: "Cosmétique Naturelle", pfsGender: "WOMAN", pfsCatId: "CAT_COSMETIQUE", pfsFamilyId: "FAM_BEAUTE" },
  { name: "Papeterie", pfsGender: null, pfsCatId: "CAT_PAPETERIE", pfsFamilyId: "FAM_BUREAU" },
  { name: "Enfant", pfsGender: "KID", pfsCatId: "CAT_ENFANT", pfsFamilyId: "FAM_ENFANT" },
];

const SUBCATEGORY_DEFS: Record<string, string[]> = {
  "Maroquinerie": ["Sacs à main", "Portefeuilles", "Ceintures", "Pochettes"],
  "Accessoires Mode": ["Écharpes", "Bijoux", "Chapeaux", "Gants"],
  "Décoration Intérieure": ["Bougies", "Vases", "Cadres", "Coussins"],
  "Art de la Table": ["Assiettes", "Tasses", "Plateaux", "Carafes"],
  "Textile Maison": ["Nappes", "Serviettes", "Torchons", "Plaids"],
  "Cosmétique Naturelle": ["Savons", "Crèmes", "Huiles", "Bougies parfumées"],
  "Papeterie": ["Carnets", "Stylos", "Enveloppes", "Marque-pages"],
  "Enfant": ["Jouets", "Peluches", "Doudous", "Déco chambre"],
};

// Compositions grouped by category for realism
const COMPOSITION_BY_CATEGORY: Record<string, { name: string; pfsRef: string }[]> = {
  "Maroquinerie": [
    { name: "Cuir véritable", pfsRef: "CUIR" },
    { name: "Cuir synthétique", pfsRef: "POLYESTER" },
    { name: "Coton doublure", pfsRef: "COTON" },
  ],
  "Accessoires Mode": [
    { name: "Soie sauvage", pfsRef: "SOIE" },
    { name: "Laine mérinos", pfsRef: "LAINE" },
    { name: "Coton biologique", pfsRef: "COTON" },
    { name: "Polyester recyclé", pfsRef: "POLYESTER" },
  ],
  "Décoration Intérieure": [
    { name: "Céramique artisanale", pfsRef: "CERAMIQUE" },
    { name: "Bois d'olivier", pfsRef: "BOIS" },
    { name: "Verre soufflé", pfsRef: "VERRE" },
  ],
  "Art de la Table": [
    { name: "Céramique émaillée", pfsRef: "CERAMIQUE" },
    { name: "Verre trempé", pfsRef: "VERRE" },
    { name: "Bois de hêtre", pfsRef: "BOIS" },
  ],
  "Textile Maison": [
    { name: "Lin naturel", pfsRef: "LIN" },
    { name: "Coton biologique", pfsRef: "COTON" },
    { name: "Laine mérinos", pfsRef: "LAINE" },
  ],
  "Cosmétique Naturelle": [
    { name: "Cire d'abeille", pfsRef: "CIRE" },
    { name: "Beurre de karité", pfsRef: "KARITE" },
    { name: "Huile d'argan", pfsRef: "ARGAN" },
  ],
  "Papeterie": [
    { name: "Papier recyclé", pfsRef: "PAPIER" },
    { name: "Cuir recyclé", pfsRef: "CUIR" },
    { name: "Bambou", pfsRef: "BAMBOU" },
  ],
  "Enfant": [
    { name: "Coton biologique", pfsRef: "COTON" },
    { name: "Polyester recyclé", pfsRef: "POLYESTER" },
    { name: "Bois naturel", pfsRef: "BOIS" },
  ],
};

const COUNTRY_DEFS: { name: string; isoCode: string; pfsRef: string }[] = [
  { name: "France", isoCode: "FR", pfsRef: "FR" },
  { name: "Italie", isoCode: "IT", pfsRef: "IT" },
  { name: "Portugal", isoCode: "PT", pfsRef: "PT" },
  { name: "Maroc", isoCode: "MA", pfsRef: "MA" },
  { name: "Inde", isoCode: "IN", pfsRef: "IN" },
  { name: "Turquie", isoCode: "TR", pfsRef: "TR" },
];

const SEASON_DEFS: { name: string; pfsRef: string }[] = [
  { name: "Printemps-Été 2025", pfsRef: "PE2025" },
  { name: "Automne-Hiver 2025", pfsRef: "AH2025" },
  { name: "Printemps-Été 2026", pfsRef: "PE2026" },
  { name: "Automne-Hiver 2026", pfsRef: "AH2026" },
];

const TAG_NAMES = [
  "Fait main", "Éco-responsable", "Édition limitée", "Nouveauté",
  "Best-seller", "Cadeau idéal", "Vegan", "Artisanat local",
  "Collection capsule", "Pièce unique",
];

const SIZE_DEFS: { name: string; pfsRef: string }[] = [
  { name: "XS", pfsRef: "XS" },
  { name: "S", pfsRef: "S" },
  { name: "M", pfsRef: "M" },
  { name: "L", pfsRef: "L" },
  { name: "XL", pfsRef: "XL" },
  { name: "XXL", pfsRef: "XXL" },
  { name: "Unique", pfsRef: "TU" },
  { name: "30cm", pfsRef: "30" },
  { name: "40cm", pfsRef: "40" },
  { name: "50cm", pfsRef: "50" },
  { name: "Petit", pfsRef: "P" },
  { name: "Moyen", pfsRef: "M" },
  { name: "Grand", pfsRef: "G" },
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}
function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min: number, max: number, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function generateRandomImageBlob(hex: string, label: string): Promise<Blob> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 800, 800);
    grad.addColorStop(0, hex || "#9CA3AF");
    grad.addColorStop(1, adjustBrightness(hex || "#9CA3AF", -40));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 800);
    for (let i = 0; i < rand(3, 8); i++) {
      ctx.fillStyle = `rgba(255,255,255,${randFloat(0.05, 0.2)})`;
      ctx.beginPath();
      ctx.arc(rand(100, 700), rand(100, 700), rand(40, 200), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 400, 380);
    ctx.font = "24px sans-serif";
    ctx.fillText("TEST", 400, 430);
    canvas.toBlob((blob) => resolve(blob!), "image/png");
  });
}

function adjustBrightness(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xFF) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xFF) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

async function uploadImage(blob: Blob, filename: string): Promise<string | null> {
  const fd = new FormData();
  fd.append("image", new File([blob], filename, { type: "image/png" }));
  try {
    const res = await fetch("/api/admin/products/images", { method: "POST", body: fd });
    if (!res.ok) return null;
    const json = await res.json();
    return json.path ?? null;
  } catch { return null; }
}

// Safely create, ignoring "already exists" errors
async function safeCreate<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof Error && e.message.includes("existe déjà")) return null;
    throw e;
  }
}

// ─────────────────────────────────────────────
// Props & Component
// ─────────────────────────────────────────────
interface DevRandomFillProps {
  onFill: (data: {
    reference: string;
    name: string;
    description: string;
    categoryId: string;
    subCategoryIds: string[];
    variants: VariantState[];
    colorImages: ColorImageState[];
    compositions: { compositionId: string; percentage: string }[];
    tagNames: string[];
    isBestSeller: boolean;
    dimLength: string;
    dimWidth: string;
    dimHeight: string;
    dimDiameter: string;
    dimCircumference: string;
    manufacturingCountryId: string;
    seasonId: string;
    // Newly created entities to add to local lists
    newColors: AvailableColor[];
    newCategory: { id: string; name: string; subCategories: { id: string; name: string }[] } | null;
    newCompositions: AvailableComposition[];
    newSizes: AvailableSize[];
    newCountry: { id: string; name: string } | null;
    newSeason: { id: string; name: string } | null;
    newTags: { id: string; name: string }[];
  }) => void;
}

export default function DevRandomFillButton({ onFill }: DevRandomFillProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");

  if (process.env.NODE_ENV === "production") return null;

  async function handleRandomFill() {
    setLoading(true);
    try {
      // Product reference needs uniqueness — use a short timestamp-based ID
      const refId = Date.now().toString(36).slice(-4).toUpperCase();

      // ══════════════════════════════════════════
      // PHASE 0: Fetch real PFS attributes for valid mapping
      // ══════════════════════════════════════════
      setProgress("Récupération des attributs PFS...");
      type PfsAttrs = {
        colors: { reference: string; value: string }[];
        categories: { id: string; family: { id: string } | null; labels: Record<string, string>; gender: string | null }[];
        compositions: { reference: string; labels: Record<string, string> }[];
        countries: { reference: string; labels: Record<string, string> }[];
        collections: { reference: string; labels: Record<string, string> }[];
        sizes: { reference: string }[];
        pfsDisabled?: boolean;
      };
      let pfs: PfsAttrs = { colors: [], categories: [], compositions: [], countries: [], collections: [], sizes: [] };
      try {
        const res = await fetch("/api/admin/pfs-sync/attributes");
        if (res.ok) pfs = await res.json();
      } catch { /* PFS unavailable — use empty arrays, mapping will be skipped */ }

      const hasPfs = !pfs.pfsDisabled && pfs.categories.length > 0;

      // Pick a PFS category — prefer one with complete mappings, fallback to any
      const completePfsCats = pfs.categories.filter(c => c.id && c.family?.id && c.gender);
      const pfsCat = completePfsCats.length > 0 ? pick(completePfsCats) : (hasPfs ? pick(pfs.categories) : null);
      const pfsColorRefs = hasPfs ? pickN(pfs.colors, Math.min(20, pfs.colors.length)) : [];
      const pfsCompRefs = hasPfs ? pickN(pfs.compositions, Math.min(4, pfs.compositions.length)) : [];
      const pfsCountryRef = hasPfs && pfs.countries.length > 0 ? pick(pfs.countries).reference : null;
      const pfsSeasonRef = hasPfs && pfs.collections.length > 0 ? pick(pfs.collections).reference : null;
      const pfsSizeRefs = hasPfs ? pickN(pfs.sizes, Math.min(6, pfs.sizes.length)) : [];

      // ══════════════════════════════════════════
      // PHASE 1: All entity creation in parallel
      // ══════════════════════════════════════════
      setProgress("Création des entités (parallèle)...");

      const catDef = pick(CATEGORY_DEFS);
      const catName = catDef.name;
      const numColors = rand(12, 15);
      const colorDefs = pickN(COLOR_DEFS, numColors);
      const catCompositions = COMPOSITION_BY_CATEGORY[catDef.name] || COMPOSITION_BY_CATEGORY["Accessoires Mode"]!;
      const numComps = rand(2, Math.min(3, catCompositions.length));
      const compDefs = pickN(catCompositions, numComps);
      const countryDef = pick(COUNTRY_DEFS);
      const seasonDef = pick(SEASON_DEFS);
      const numTags = rand(2, 5);
      const tagDefs = pickN(TAG_NAMES, numTags);

      const [createdCat, colorsResults, compsResults, createdCountry, createdSeason, tagsResults] = await Promise.all([
        // Category — use real PFS category ID, family ID, gender
        safeCreate(() => createCategoryQuick(
          { fr: catName },
          pfsCat?.id ?? null,
          pfsCat?.gender ?? catDef.pfsGender,
          pfsCat?.family?.id ?? null,
        )),
        // Colors — map each to a real PFS color ref
        Promise.all(colorDefs.map((def, i) => {
          const realPfsRef = pfsColorRefs[i % pfsColorRefs.length]?.reference ?? null;
          return safeCreate(() => createColorQuick({ fr: def.name }, def.hex, null, realPfsRef));
        })),
        // Compositions — map to real PFS composition refs
        Promise.all(compDefs.map((def, i) => {
          const realRef = pfsCompRefs[i % pfsCompRefs.length]?.reference ?? null;
          return safeCreate(() => createCompositionQuick({ fr: def.name }, realRef));
        })),
        // Country — use real PFS country ref
        safeCreate(() => createManufacturingCountryQuick(
          { fr: countryDef.name }, countryDef.isoCode, pfsCountryRef
        )),
        // Season — use real PFS collection ref
        safeCreate(() => createSeasonQuick({ fr: seasonDef.name }, pfsSeasonRef)),
        // Tags
        Promise.all(tagDefs.map(tn =>
          safeCreate(() => createTagQuick({ fr: tn }))
        )),
      ]);

      if (!createdCat) {
        setProgress("Erreur: impossible de créer la catégorie");
        setTimeout(() => setProgress(""), 3000);
        setLoading(false);
        return;
      }

      const createdColors: AvailableColor[] = colorsResults
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map(r => ({ id: r.id, name: r.name, hex: r.hex, patternImage: r.patternImage, pfsColorRef: r.pfsColorRef }));
      const createdComps: AvailableComposition[] = compsResults.filter((r): r is NonNullable<typeof r> => r !== null);
      const createdTags = tagsResults.filter((r): r is NonNullable<typeof r> => r !== null);

      if (createdColors.length < 5) {
        setProgress("Erreur: pas assez de couleurs créées");
        setTimeout(() => setProgress(""), 3000);
        setLoading(false);
        return;
      }

      // ══════════════════════════════════════════
      // PHASE 2: Subcategories + Sizes (need category ID) — in parallel
      // ══════════════════════════════════════════
      setProgress("Sous-catégories + tailles (parallèle)...");

      const subCatNames = SUBCATEGORY_DEFS[catDef.name] || ["Type A", "Type B", "Type C"];
      const numSizes = rand(3, Math.min(6, pfsSizeRefs.length || 6));
      const sizeDefs = pickN(SIZE_DEFS, numSizes);

      const [subCatResults, sizeResults] = await Promise.all([
        // Subcategories in parallel
        Promise.all(
          pickN(subCatNames, rand(2, subCatNames.length)).map(scName =>
            safeCreate(() => createSubCategoryQuick({ fr: scName }, createdCat.id))
          )
        ),
        // Sizes in parallel — use real PFS size refs
        Promise.all(sizeDefs.map(async (sd, i) => {
          const result = await safeCreate(() => createSize(sd.name, [createdCat.id]));
          if (result) {
            const realSizeRef = pfsSizeRefs[i % pfsSizeRefs.length]?.reference;
            if (realSizeRef) {
              await safeCreate(() => toggleSizePfsMapping(result.id, realSizeRef));
            }
            return { id: result.id, name: result.name, categoryIds: [createdCat.id] } as AvailableSize;
          }
          return null;
        })),
      ]);

      const createdSubCats = subCatResults.filter((r): r is NonNullable<typeof r> => r !== null);
      createdCat.subCategories = createdSubCats;
      const createdSizes = sizeResults.filter((r): r is NonNullable<typeof r> => r !== null);

      // ══════════════════════════════════════════
      // 8. BUILD PRODUCT DATA
      // ══════════════════════════════════════════
      setProgress("Construction du produit...");
      const ref = `TEST${refId}${rand(10, 99)}`;
      const productName = `${pick(ADJECTIVES)} ${pick(NOUNS)} ${pick(MATERIALS_LABEL)}`;
      const description = `${productName} — produit de test généré automatiquement. ` +
        `Fabriqué avec soin. Réf: ${ref}. Catégorie: ${catName}.`;

      // Compositions (total = 100%)
      const compositions: { compositionId: string; percentage: string }[] = [];
      let remaining = 100;
      for (let i = 0; i < createdComps.length; i++) {
        const isLast = i === createdComps.length - 1;
        const pct = isLast ? remaining : rand(10, Math.max(10, remaining - (createdComps.length - i - 1) * 10));
        compositions.push({ compositionId: createdComps[i].id, percentage: String(pct) });
        remaining -= pct;
      }

      // Dimensions
      const hasDims = Math.random() > 0.3;

      // ══════════════════════════════════════════
      // 9. GENERATE VARIANTS (10-14, mix UNIT+PACK)
      // Uses the same duplicate key as ColorVariantManager:
      //   UNIT::colorId::subColorIds::sizeId:qty,...
      //   PACK::packQty::firstLineColorIds::sizeId:qty,...
      // ══════════════════════════════════════════
      setProgress("Génération des variantes...");
      const targetVariants = rand(10, 14);
      const variants: VariantState[] = [];
      const usedDupKeys = new Set<string>();
      const shuffledColors = [...createdColors].sort(() => Math.random() - 0.5);
      let colorIdx = 0;
      function nextColor(): AvailableColor {
        const c = shuffledColors[colorIdx % shuffledColors.length];
        colorIdx++;
        return c;
      }

      // Build duplicate key matching ColorVariantManager.buildVariantDuplicateKey
      function dupKey(v: VariantState): string {
        const sizeKey = [...v.sizeEntries]
          .sort((a, b) => a.sizeId.localeCompare(b.sizeId))
          .map(s => `${s.sizeId}:${s.quantity}`)
          .join(",");
        if (v.saleType === "UNIT") {
          const subColorKey = v.subColors.map(sc => sc.colorId).sort().join(",");
          return `UNIT::${v.colorId}::${subColorKey}::${sizeKey}`;
        }
        const lineKey = (v.packColorLines[0]?.colors ?? []).map(c => c.colorId).sort().join("+");
        return `PACK::${v.packQuantity}::${lineKey}::${sizeKey}`;
      }

      let attempts = 0;
      while (variants.length < targetVariants && attempts < targetVariants * 3) {
        attempts++;
        const isPack = Math.random() > 0.5 && variants.length > 2;
        const isMultiColor = Math.random() > 0.4;

        if (isPack) {
          const packQty = rand(2, 6);
          const packColorLines: VariantState["packColorLines"] = [];
          {
            const lineNumColors = isMultiColor ? rand(2, 3) : 1;
            const lineColors = [];
            for (let c = 0; c < lineNumColors; c++) {
              const col = nextColor();
              lineColors.push({ colorId: col.id, colorName: col.name, colorHex: col.hex || "#9CA3AF" });
            }
            packColorLines.push({ tempId: genUid(), colors: lineColors });
          } // single line block
          // Each pack gets at least 1 size with quantity
          const numSizes = rand(1, Math.min(4, createdSizes.length));
          const selectedSizes = pickN(createdSizes, numSizes);
          const sizeEntries = selectedSizes.map(s => ({
            tempId: genUid(), sizeId: s.id, sizeName: s.name, quantity: String(rand(1, packQty)),
          }));

          // Multi-color packs: use individual color refs to build an override
          const packPfsRef = packColorLines[0]?.colors
            .map(c => createdColors.find(cc => cc.id === c.colorId)?.pfsColorRef || "UNKNOWN")
            .join("-") || "";

          const candidate: VariantState = {
            tempId: genUid(),
            colorId: "", colorName: "", colorHex: "#9CA3AF",
            subColors: [], packColorLines, sizeEntries,
            unitPrice: String(randFloat(5, 80)),
            weight: String(randFloat(0.1, 5, 1)),
            stock: String(rand(0, 200)),
            isPrimary: variants.length === 0,
            saleType: "PACK",
            packQuantity: String(packQty),
            pfsColorRef: isMultiColor ? packPfsRef : "", sku: "",
          };

          const dk = dupKey(candidate);
          if (usedDupKeys.has(dk)) continue;
          usedDupKeys.add(dk);
          variants.push(candidate);
        } else {
          const mainColor = nextColor();
          let subColors: VariantState["subColors"] = [];
          if (isMultiColor && createdColors.length > 2) {
            const numSub = rand(1, 2);
            const subs = createdColors.filter(c => c.id !== mainColor.id);
            subColors = pickN(subs, numSub).map(c => ({
              colorId: c.id, colorName: c.name, colorHex: c.hex || "#9CA3AF",
            }));
          }

          // UNIT: always 1 size
          const pickedSize = pick(createdSizes);
          const sizeEntries = [{
            tempId: genUid(), sizeId: pickedSize.id, sizeName: pickedSize.name, quantity: "1",
          }];

          // Multi-color units: use individual color refs to build an override
          const unitPfsRef = subColors.length > 0
            ? [mainColor.pfsColorRef, ...subColors.map(sc => createdColors.find(cc => cc.id === sc.colorId)?.pfsColorRef || "UNKNOWN")].filter(Boolean).join("-")
            : "";

          const candidate: VariantState = {
            tempId: genUid(),
            colorId: mainColor.id, colorName: mainColor.name, colorHex: mainColor.hex || "#9CA3AF",
            subColors, packColorLines: [], sizeEntries,
            unitPrice: String(randFloat(5, 150)),
            weight: String(randFloat(0.1, 3, 1)),
            stock: String(rand(0, 500)),
            isPrimary: variants.length === 0,
            saleType: "UNIT",
            packQuantity: "",
            pfsColorRef: unitPfsRef, sku: "",
          };

          const dk = dupKey(candidate);
          if (usedDupKeys.has(dk)) continue;
          usedDupKeys.add(dk);
          variants.push(candidate);
        }
      }

      if (variants.length > 0 && !variants.some(v => v.isPrimary)) {
        variants[0].isPrimary = true;
      }

      // ══════════════════════════════════════════
      // 10. GENERATE & UPLOAD IMAGES
      // Uses imageGroupKeyFromVariant() — the exact same function
      // the form uses to sync colorImages ↔ variants.
      // ══════════════════════════════════════════
      setProgress("Upload des images...");
      const colorImages: ColorImageState[] = [];
      const processedGKs = new Set<string>();

      // Collect unique color groups using the real groupKey function
      const colorGroups: { gk: string; colorId: string; colorName: string; colorHex: string }[] = [];
      for (const v of variants) {
        const gk = imageGroupKeyFromVariant(v);
        if (processedGKs.has(gk)) continue;
        processedGKs.add(gk);

        // Derive display info
        let colorId: string;
        let colorName: string;
        let colorHex: string;
        if (v.saleType === "PACK") {
          const fl = v.packColorLines[0]?.colors ?? [];
          colorId = fl[0]?.colorId ?? "";
          colorName = fl.map(c => c.colorName).join(" + ") || "Pack";
          colorHex = fl[0]?.colorHex ?? "#9CA3AF";
        } else {
          colorId = v.colorId;
          colorName = [v.colorName, ...v.subColors.map(sc => sc.colorName)].join(" + ");
          colorHex = v.colorHex;
        }
        colorGroups.push({ gk, colorId, colorName, colorHex });
      }

      // Upload all image groups in parallel (batch of 4 concurrent groups)
      async function uploadGroupImages(group: typeof colorGroups[number]): Promise<ColorImageState> {
        const { gk, colorId, colorName, colorHex } = group;
        const numImages = rand(2, 4);

        // Generate all blobs in parallel
        const blobs = await Promise.all(
          Array.from({ length: numImages }, (_, img) =>
            generateRandomImageBlob(colorHex, `${colorName.slice(0, 20)} #${img + 1}`)
          )
        );

        // Upload all images for this group in parallel
        const results = await Promise.all(
          blobs.map(async (blob, img) => {
            const preview = URL.createObjectURL(blob);
            let path: string | null = null;
            for (let retry = 0; retry < 3 && !path; retry++) {
              path = await uploadImage(blob, `test_${genUid()}.png`);
            }
            return path ? { preview, path, order: img } : null;
          })
        );

        const successful = results.filter((r): r is NonNullable<typeof r> => r !== null);

        // Fallback if all failed
        if (successful.length === 0) {
          const blob = await generateRandomImageBlob(colorHex, `${colorName.slice(0, 20)} fb`);
          const preview = URL.createObjectURL(blob);
          let path: string | null = null;
          for (let retry = 0; retry < 3 && !path; retry++) {
            path = await uploadImage(blob, `test_${genUid()}.png`);
          }
          if (path) successful.push({ preview, path, order: 0 });
        }

        return {
          groupKey: gk, colorId, colorName, colorHex,
          imagePreviews: successful.map(s => s.preview),
          uploadedPaths: successful.map(s => s.path),
          orders: successful.map(s => s.order),
          uploading: false,
        };
      }

      // Process groups in batches of 4
      const BATCH_SIZE = 4;
      for (let b = 0; b < colorGroups.length; b += BATCH_SIZE) {
        const batch = colorGroups.slice(b, b + BATCH_SIZE);
        setProgress(`Images: ${b + 1}-${Math.min(b + BATCH_SIZE, colorGroups.length)}/${colorGroups.length}...`);
        const batchResults = await Promise.all(batch.map(uploadGroupImages));
        colorImages.push(...batchResults);
      }

      // ══════════════════════════════════════════
      // 11. FILL THE FORM
      // ══════════════════════════════════════════
      setProgress("Application...");

      onFill({
        reference: ref,
        name: productName,
        description,
        categoryId: createdCat.id,
        subCategoryIds: pickN(createdSubCats, rand(1, createdSubCats.length)).map(sc => sc.id),
        variants,
        colorImages,
        compositions,
        tagNames: createdTags.map(t => t.name),
        isBestSeller: Math.random() > 0.7,
        dimLength: hasDims ? String(rand(5, 50)) : "",
        dimWidth: hasDims ? String(rand(5, 40)) : "",
        dimHeight: hasDims ? String(rand(2, 30)) : "",
        dimDiameter: "",
        dimCircumference: "",
        manufacturingCountryId: createdCountry?.id ?? "",
        seasonId: createdSeason?.id ?? "",
        // New entities for local lists
        newColors: createdColors,
        newCategory: createdCat,
        newCompositions: createdComps,
        newSizes: createdSizes,
        newCountry: createdCountry,
        newSeason: createdSeason,
        newTags: createdTags,
      });

      setProgress("");
    } catch (err) {
      console.error("Random fill error:", err);
      setProgress(`Erreur: ${err instanceof Error ? err.message : "inconnue"}`);
      setTimeout(() => setProgress(""), 5000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={handleRandomFill}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-all disabled:opacity-70 disabled:cursor-wait"
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="max-w-[280px] truncate">{progress}</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            Remplissage aléatoire (DEV)
          </>
        )}
      </button>
    </div>
  );
}
