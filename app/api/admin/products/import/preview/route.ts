import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeColorName, findDuplicateVariantKeys } from "@/lib/import-processor";
import * as XLSX from "xlsx";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PreviewVariant {
  color: string;
  saleType: "UNIT" | "PACK";
  unitPrice: number;
  stock: number;
  packQuantity?: number;
  size?: string;
  colorFound: boolean;
  errors: string[];
}

export interface PreviewProduct {
  reference: string;
  name: string;
  description?: string;
  category?: string;
  subCategories?: string;
  tags?: string;
  composition?: string;
  manufacturingCountry?: string;
  season?: string;
  primaryColor?: string;
  hsCode?: string;
  sizeDetailsTu?: string;
  similarRefs?: string;
  isBestSeller?: boolean;
  dimensionLength?: number;
  dimensionWidth?: number;
  dimensionHeight?: number;
  dimensionDiameter?: number;
  dimensionCircumference?: number;
  variants: PreviewVariant[];
  categoryFound: boolean;
  subCategoriesFound: boolean;
  compositionsFound: boolean;
  referenceExists: boolean;
  totalErrors: number;
  productErrors: string[];  // erreurs au niveau produit (champs manquants, entités introuvables)
  /** Statut visuel global du produit dans la preview. */
  previewStatus: "ok" | "warning" | "error";
}

export interface MissingEntity {
  type: "category" | "color" | "subcategory" | "composition" | "country" | "season";
  name: string;
  usedBy: number; // how many products reference this entity
  parentCategoryName?: string; // for subcategories: name of the category that uses it
}

export interface PreviewResult {
  products: PreviewProduct[];
  totalProducts: number;
  totalVariants: number;
  readyToImport: number;
  withErrors: number;
  alreadyExist: number;
  missingEntities: MissingEntity[];
  totalInFile?: number;
  maxProducts?: number;
}

// ─────────────────────────────────────────────
// Row normalizer (same as import route)
// ─────────────────────────────────────────────

/** Bool tolérant (true/1/oui...) — voir lib/import-processor.ts pour la version "source de vérité". */
function boolish(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === "") return undefined;
  if (["true", "1", "oui", "yes", "vrai", "x"].includes(s)) return true;
  if (["false", "0", "non", "no", "faux"].includes(s)) return false;
  return undefined;
}
function normalizeRow(raw: Record<string, unknown>, index: number) {
  const str = (v: unknown) => (v != null ? String(v).trim() : "");
  const num = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isNaN(n) ? undefined : n; };
  const int = (v: unknown) => { const n = parseInt(String(v ?? "")); return isNaN(n) ? undefined : n; };
  // Support French headers from template (e.g. "Référence *", "Nom *") + English keys
  const saleTypeRaw = str(raw["sale_type"] ?? raw["sale_type *"] ?? raw["saleType"] ?? raw["type_vente"] ?? raw["Type de vente *"] ?? "UNIT").toUpperCase();
  return {
    _rowIndex: index + 2,
    reference: str(raw["reference"] ?? raw["reference *"] ?? raw["ref"] ?? raw["référence"] ?? raw["Référence *"]),
    name: str(raw["name"] ?? raw["name *"] ?? raw["nom"] ?? raw["name_fr"] ?? raw["Nom *"]),
    description: str(raw["description"] ?? raw["description *"] ?? raw["description_fr"] ?? raw["Description"] ?? raw["Description *"]) || undefined,
    category: str(raw["category"] ?? raw["category *"] ?? raw["categorie"] ?? raw["catégorie"] ?? raw["Catégorie"] ?? raw["Catégorie *"]) || undefined,
    subCategories: str(raw["sub_categories"] ?? raw["sous_categories"] ?? raw["subCategories"] ?? raw["Sous-catégories"]) || undefined,
    color: str(raw["color"] ?? raw["color *"] ?? raw["couleur"] ?? raw["Couleur *"]),
    saleType: saleTypeRaw === "PACK" ? "PACK" as const : "UNIT" as const,
    unitPrice: num(raw["unit_price"] ?? raw["unit_price *"] ?? raw["prix"] ?? raw["price"] ?? raw["Prix unitaire *"]) ?? 0,
    packQuantity: int(raw["pack_qty"] ?? raw["pack_quantity"] ?? raw["quantite_pack"] ?? raw["Qté pack"]),
    stock: int(raw["stock"] ?? raw["stock *"] ?? raw["quantite"] ?? raw["qty"] ?? raw["Stock *"]) ?? 0,
    tags: str(raw["tags"] ?? raw["Tags"]) || undefined,
    similarRefs: str(raw["similar_refs"] ?? raw["produits_similaires"] ?? raw["similarRefs"] ?? raw["Réf. similaires"]) || undefined,
    composition: str(raw["composition"] ?? raw["composition *"] ?? raw["Composition"] ?? raw["Composition *"]) || undefined,
    dimensionLength: num(raw["dimension_length"] ?? raw["longueur"] ?? raw["Longueur (cm)"]),
    dimensionWidth: num(raw["dimension_width"] ?? raw["largeur"] ?? raw["Largeur (cm)"]),
    dimensionHeight: num(raw["dimension_height"] ?? raw["hauteur"] ?? raw["Hauteur (cm)"]),
    dimensionDiameter: num(raw["dimension_diameter"] ?? raw["diametre"] ?? raw["diamètre"] ?? raw["Diamètre (cm)"]),
    dimensionCircumference: num(raw["dimension_circumference"] ?? raw["circonference"] ?? raw["circonférence"] ?? raw["Circonférence (cm)"]),
    size: str(raw["size"] ?? raw["size *"] ?? raw["taille"] ?? raw["Taille"] ?? raw["Taille *"]) || undefined,
    manufacturingCountry: str(raw["manufacturing_country"] ?? raw["pays_fabrication"] ?? raw["pays_fabrication *"] ?? raw["pays"] ?? raw["Pays fabrication"] ?? raw["Pays fabrication *"]) || undefined,
    season: str(raw["season"] ?? raw["season *"] ?? raw["saison"] ?? raw["saison *"] ?? raw["collection"] ?? raw["Saison"] ?? raw["Saison *"]) || undefined,
    hsCode: str(raw["hs_code"] ?? raw["code_sh"] ?? raw["hsCode"] ?? raw["Code SH"]) || undefined,
    primaryColor: str(raw["primary_color"] ?? raw["couleur_principale"] ?? raw["primaryColor"] ?? raw["Couleur principale"]) || undefined,
    sizeDetailsTu: str(raw["taille_unique_details"] ?? raw["detail_taille_unique"] ?? raw["sizeDetailsTu"] ?? raw["Détail taille unique *"] ?? raw["Détail taille unique"]) || undefined,
    isBestSeller: boolish(raw["best_seller"] ?? raw["isBestSeller"] ?? raw["bestseller"] ?? raw["Best Seller"]),
  };
}

function parseExcel(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  // Use "Produits" sheet if it exists, fallback to first sheet
  const ws = wb.Sheets["Produits"] ?? wb.Sheets[wb.SheetNames[0]];

  // Structure du template (depuis juin 2026) :
  //   Ligne 1 : bandeaux de section fusionnés (« Fiche produit », « Variante »)
  //   Ligne 2 : headers
  //   Ligne 3 : exemples « (ex : ...) »
  //   Ligne 4+ : données
  // Détection : si A1 = bandeau de section → range: 1 (lit headers depuis ligne 2),
  // sinon ancien format (headers ligne 1).
  const cellA1 = ws["A1"];
  const a1Text = cellA1 && typeof cellA1.v === "string" ? cellA1.v : "";
  const isNewFormat = /fiche produit|variante/i.test(a1Text);
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    range: isNewFormat ? 1 : 0,
  });

  // Filtrer : ligne « Obligatoire / Facultatif », ligne d'exemples « (ex : ...) »,
  // anciennes descriptions de header, et lignes complètement vides.
  const filtered = data.filter((row) => {
    const ref = String(row["reference"] ?? row["reference *"] ?? row["ref"] ?? row["référence"] ?? row["Référence *"] ?? "").trim();
    const refLow = ref.toLowerCase();
    if (refLow === "obligatoire" || refLow === "facultatif") return false;
    if (refLow.startsWith("(ex")) return false;
    if (refLow.startsWith("référence unique") || refLow.startsWith("reference unique")) return false;
    const saleType = String(row["sale_type"] ?? row["sale_type *"] ?? row["saleType"] ?? row["Type de vente *"] ?? "").trim().toUpperCase();
    if (saleType && saleType !== "UNIT" && saleType !== "PACK" && saleType.length > 10) return false;
    const color = String(row["color"] ?? row["color *"] ?? row["couleur"] ?? row["Couleur *"] ?? "").trim();
    const colorLow = color.toLowerCase();
    if (colorLow === "obligatoire" || colorLow === "facultatif") return false;
    if (colorLow.startsWith("(ex")) return false;
    if (!ref && !color) return false;
    return true;
  });

  return filtered.map((row, i) => normalizeRow(row, i));
}

// ─────────────────────────────────────────────
// POST — preview only, no DB writes
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // 10 MB

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const maxProductsRaw = formData.get("maxProducts") as string | null;
    const maxProducts = maxProductsRaw ? parseInt(maxProductsRaw) : 0;
    if (!file) return NextResponse.json({ error: "Aucun fichier." }, { status: 400 });
    if (file.size > MAX_IMPORT_SIZE) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 10 Mo)." }, { status: 400 });
    }

    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".xlsx") && !filename.endsWith(".xls")) {
      return NextResponse.json({ error: "Format non supporté (.xlsx ou .xls uniquement)." }, { status: 400 });
    }
    const buffer = await file.arrayBuffer();
    const rows = parseExcel(buffer);

    if (rows.length === 0) return NextResponse.json({ error: "Fichier vide." }, { status: 400 });

    // Propagate reference from previous row when empty (Excel users often only fill
    // the reference on the first row of a multi-variant product)
    let lastRef = "";
    for (const row of rows) {
      if (row.reference) {
        lastRef = row.reference;
      } else if (lastRef) {
        row.reference = lastRef;
      }
    }

    // Pre-load DB data for validation
    // Split multi-colors "Bleu/Rose/Vert" into individual color names
    const colorNames = [...new Set(
      rows.flatMap((r) => r.color ? r.color.split("/").map((c) => c.trim()).filter(Boolean) : [])
    )];
    const categoryNames = [...new Set(rows.filter((r) => r.category).map((r) => r.category!))];
    const references = [...new Set(rows.map((r) => r.reference).filter(Boolean))];
    const compositionMaterials = [
      ...new Set(
        rows.flatMap((r) =>
          r.composition ? r.composition.split(",").map((c) => c.split(":")[0].trim()).filter(Boolean) : []
        )
      ),
    ];
    const subCatNames = [
      ...new Set(
        rows.flatMap((r) =>
          r.subCategories ? r.subCategories.split(",").map((s) => s.trim()).filter(Boolean) : []
        )
      ),
    ];

    const countryNames = [...new Set(rows.filter((r) => r.manufacturingCountry).map((r) => r.manufacturingCountry!))];
    const seasonNames = [...new Set(rows.filter((r) => r.season).map((r) => r.season!))];
    const hsCodes = [...new Set(rows.filter((r) => r.hsCode).map((r) => r.hsCode!.trim()))];

    const [dbColors, dbCategories, dbCompositions, dbSubCategories, existingProducts, dbCountries, dbSeasons, dbHsCodes] = await Promise.all([
      prisma.color.findMany({ where: { name: { in: colorNames } }, select: { name: true, id: true } }),
      prisma.category.findMany({ where: { name: { in: categoryNames } }, select: { name: true, id: true } }),
      prisma.composition.findMany({ where: { name: { in: compositionMaterials } }, select: { name: true, id: true } }),
      prisma.subCategory.findMany({ select: { name: true, id: true } }),
      prisma.product.findMany({ where: { reference: { in: references } }, select: { reference: true } }),
      prisma.manufacturingCountry.findMany({ where: { name: { in: countryNames } }, select: { name: true, id: true } }),
      prisma.season.findMany({ where: { name: { in: seasonNames } }, select: { name: true, id: true } }),
      hsCodes.length > 0
        ? prisma.hsCode.findMany({ where: { code: { in: hsCodes } }, select: { code: true, id: true } })
        : Promise.resolve([] as { code: string; id: string }[]),
    ]);

    const colorSet = new Set(dbColors.map((c) => normalizeColorName(c.name)));
    const categorySet = new Set(dbCategories.map((c) => c.name.toLowerCase()));
    const compositionSet = new Set(dbCompositions.map((c) => c.name.toLowerCase()));
    const subCatSet = new Set(dbSubCategories.map((s) => s.name.toLowerCase()));
    const countrySet = new Set(dbCountries.map((c) => c.name.toLowerCase()));
    const seasonSet = new Set(dbSeasons.map((s) => s.name.toLowerCase()));
    const hsCodeSet = new Set(dbHsCodes.map((h) => h.code.trim()));
    const existingRefSet = new Set(existingProducts.map((p) => p.reference.toUpperCase()));

    // Track missing entities with usage counts
    const missingMap = new Map<string, MissingEntity>();
    const addMissing = (type: MissingEntity["type"], name: string, parentCategoryName?: string) => {
      const key = `${type}:${name.toLowerCase()}`;
      if (missingMap.has(key)) {
        missingMap.get(key)!.usedBy++;
      } else {
        missingMap.set(key, { type, name, usedBy: 1, ...(parentCategoryName ? { parentCategoryName } : {}) });
      }
    };

    // Group rows by reference
    const grouped = new Map<string, ReturnType<typeof normalizeRow>[]>();
    for (const row of rows) {
      if (!row.reference) continue;
      const ref = row.reference.toUpperCase();
      if (!grouped.has(ref)) grouped.set(ref, []);
      grouped.get(ref)!.push(row);
    }

    // Inherit product-level fields from the group: find the first row that has each
    // field and propagate to all rows (field can be on any row, not just the first)
    const productFields = ["name", "description", "category", "tags", "composition", "subCategories", "manufacturingCountry", "season", "dimensionLength", "dimensionWidth", "dimensionHeight", "dimensionDiameter", "dimensionCircumference", "hsCode", "primaryColor", "sizeDetailsTu", "isBestSeller"] as const;
    for (const [, groupRows] of grouped) {
      for (const field of productFields) {
        const source = groupRows.find((r) => r[field as keyof typeof r]);
        if (!source) continue;
        for (const row of groupRows) {
          if (!row[field as keyof typeof row] && source[field as keyof typeof source]) {
            (row as Record<string, unknown>)[field] = source[field as keyof typeof source];
          }
        }
      }
    }

    const products: PreviewProduct[] = [];
    let readyToImport = 0;
    let withErrors = 0;
    let alreadyExist = 0;

    // Apply maxProducts limit — only preview first N products
    let entries = [...grouped.entries()];
    const totalBeforeLimit = entries.length;
    if (maxProducts > 0 && entries.length > maxProducts) {
      entries = entries.slice(0, maxProducts);
    }

    for (const [ref, groupRows] of entries) {
      const firstRow = groupRows[0];
      const referenceExists = existingRefSet.has(ref);

      const categoryFound = !firstRow.category || categorySet.has((firstRow.category ?? "").toLowerCase());
      if (firstRow.category && !categoryFound) addMissing("category", firstRow.category);

      // Validate compositions
      let compositionsFound = true;
      if (firstRow.composition) {
        for (const part of firstRow.composition.split(",")) {
          const material = part.split(":")[0].trim();
          if (material && !compositionSet.has(material.toLowerCase())) {
            compositionsFound = false;
            addMissing("composition", material);
          }
        }
      }

      // Validate sub-categories
      let subCategoriesFound = true;
      if (firstRow.subCategories) {
        for (const scName of firstRow.subCategories.split(",").map((s) => s.trim()).filter(Boolean)) {
          if (!subCatSet.has(scName.toLowerCase())) {
            subCategoriesFound = false;
            addMissing("subcategory", scName, firstRow.category);
          }
        }
      }

      // Validate manufacturing country
      let countryFound = true;
      if (firstRow.manufacturingCountry) {
        if (!countrySet.has(firstRow.manufacturingCountry.toLowerCase())) {
          countryFound = false;
          addMissing("country", firstRow.manufacturingCountry);
        }
      }

      // Validate season
      let seasonFound = true;
      if (firstRow.season) {
        if (!seasonSet.has(firstRow.season.toLowerCase())) {
          seasonFound = false;
          addMissing("season", firstRow.season);
        }
      }

      // Validate HS code
      let hsCodeFound = true;
      if (firstRow.hsCode) {
        if (!hsCodeSet.has(firstRow.hsCode.trim())) {
          hsCodeFound = false;
        }
      }

      // Validate primary color : doit être présente parmi les couleurs des variantes
      let primaryColorValid = true;
      if (firstRow.primaryColor) {
        const wanted = normalizeColorName(firstRow.primaryColor.trim());
        const matchInGroup = groupRows.some((r) => normalizeColorName(r.color || "") === wanted);
        if (!matchInGroup) primaryColorValid = false;
      }

      // Le détail taille unique est désormais obligatoire pour tous les produits
      // (rappel système pour décrire le format/la taille à l'œil nu).
      const tailleUniqueDetailsMissing = !firstRow.sizeDetailsTu?.trim();

      const variants: PreviewVariant[] = groupRows.map((row) => {
        const errors: string[] = [];
        const colorName = row.color ? row.color.trim() : "";
        const colorFound = colorName.length > 0 && colorSet.has(normalizeColorName(colorName));

        if (!row.color) errors.push("Couleur manquante.");
        else if (!colorFound) {
          errors.push(`Couleur introuvable : ${colorName}`);
          addMissing("color", colorName);
        }
        if (!row.unitPrice || row.unitPrice <= 0) errors.push("Prix invalide.");
        if (row.stock == null || row.stock < 0) errors.push("Stock invalide.");
        if (!row.size) errors.push("Taille obligatoire.");
        if (row.saleType === "PACK" && row.size) {
          const parts = row.size.split(",").map((p: string) => p.trim()).filter(Boolean);
          const totalQty = parts.reduce((sum: number, part: string) => {
            const [, qtyStr] = part.split(":").map((s: string) => s.trim());
            return sum + (qtyStr ? parseInt(qtyStr) || 1 : 1);
          }, 0);
          if (totalQty < 1) errors.push("Quantité totale du pack invalide.");
        }
        // « Qté pack » obligatoire pour un PACK (source de vérité pour le
        // nombre de pièces par paquet — voir lib/import-processor.ts).
        if (row.saleType === "PACK" && (row.packQuantity == null || row.packQuantity <= 0)) {
          errors.push("Qté pack obligatoire pour un PACK (nombre de pièces dans un paquet).");
        }

        return {
          color: row.color,
          saleType: row.saleType,
          unitPrice: row.unitPrice,
          stock: row.stock,
          packQuantity: row.packQuantity,
          size: row.size,
          colorFound,
          errors,
        };
      });

      const productErrors: string[] = [];
      // Champs obligatoires (au niveau produit)
      if (!firstRow.reference) productErrors.push("Référence manquante.");
      if (!firstRow.name) productErrors.push("Nom manquant.");
      if (!firstRow.description) productErrors.push("Description manquante.");
      if (!firstRow.category) productErrors.push("Catégorie manquante.");
      if (!firstRow.composition) productErrors.push("Composition manquante.");
      if (!firstRow.manufacturingCountry) productErrors.push("Pays de fabrication manquant.");
      if (!firstRow.season) productErrors.push("Saison manquante.");
      if (groupRows.length === 0) productErrors.push("Au moins une variante requise.");
      // Entités liées (doivent exister en base)
      if (firstRow.category && !categoryFound) productErrors.push(`Catégorie "${firstRow.category}" introuvable.`);
      if (!compositionsFound) productErrors.push("Composition(s) introuvable(s).");
      if (!subCategoriesFound) productErrors.push("Sous-catégorie(s) introuvable(s).");
      if (!countryFound) productErrors.push(`Pays "${firstRow.manufacturingCountry}" introuvable.`);
      if (!seasonFound) productErrors.push(`Saison "${firstRow.season}" introuvable.`);
      if (!hsCodeFound) productErrors.push(`Code SH "${firstRow.hsCode}" introuvable (créez-le dans Administration > Codes SH).`);
      if (!primaryColorValid) productErrors.push(`Couleur principale "${firstRow.primaryColor}" introuvable parmi les variantes.`);
      if (tailleUniqueDetailsMissing) productErrors.push(`Détail taille unique manquant.`);
      if (referenceExists) productErrors.push(`La référence "${ref}" existe déjà.`);
      const duplicateVariants = findDuplicateVariantKeys(groupRows);
      if (duplicateVariants.length > 0) {
        productErrors.push(
          `Variante en doublon : ${duplicateVariants.join(", ")}. Chaque combinaison couleur × type de vente doit apparaître une seule fois pour cette référence.`,
        );
      }

      const variantErrors = variants.flatMap((v) => v.errors);
      const totalErrors = productErrors.length + variantErrors.length;

      let previewStatus: "ok" | "warning" | "error" = "ok";
      if (referenceExists) { previewStatus = "error"; alreadyExist++; }
      else if (totalErrors > 0) { previewStatus = "warning"; withErrors++; }
      else readyToImport++;

      products.push({
        reference: ref || "(vide)",
        name: firstRow.name,
        description: firstRow.description,
        category: firstRow.category,
        subCategories: firstRow.subCategories,
        tags: firstRow.tags,
        composition: firstRow.composition,
        manufacturingCountry: firstRow.manufacturingCountry,
        season: firstRow.season,
        primaryColor: firstRow.primaryColor,
        hsCode: firstRow.hsCode,
        sizeDetailsTu: firstRow.sizeDetailsTu,
        similarRefs: firstRow.similarRefs,
        isBestSeller: firstRow.isBestSeller,
        dimensionLength: firstRow.dimensionLength,
        dimensionWidth: firstRow.dimensionWidth,
        dimensionHeight: firstRow.dimensionHeight,
        dimensionDiameter: firstRow.dimensionDiameter,
        dimensionCircumference: firstRow.dimensionCircumference,
        variants,
        categoryFound,
        subCategoriesFound,
        compositionsFound,
        referenceExists,
        totalErrors,
        productErrors,
        previewStatus,
      });
    }

    const result: PreviewResult = {
      products,
      totalProducts: products.length,
      totalVariants: entries.reduce((sum, [, rows]) => sum + rows.length, 0),
      readyToImport,
      withErrors,
      alreadyExist,
      missingEntities: [...missingMap.values()],
      totalInFile: totalBeforeLimit,
      maxProducts: maxProducts > 0 ? maxProducts : undefined,
    };

    return NextResponse.json(result);
  } catch (err) {
    logger.error("[import/preview]", { error: err });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 500 });
  }
}
