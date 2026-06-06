/**
 * Excel generator for Ankorstore.
 *
 * Output : feuille « Vos produits », 45 colonnes, 1 ligne par variante.
 * La description n'est mise que sur la 1ère ligne d'un produit (les variantes
 * suivantes ont une cellule description vide).
 *
 * Pas de limite par fichier (Ankorstore accepte de gros catalogues).
 *
 * Images : URL publiques pointant vers le proxy `/api/marketplace-image?path=...`
 * de notre site (Ankorstore télécharge les fichiers). Pas de fichiers physiques
 * dans le ZIP final pour cette marketplace.
 *
 * Référence colonnes principales (modèle Ankorstore officiel) :
 *  1. SKU
 *  2. Nom du produit
 *  3. Description du produit (1ère ligne du produit seulement)
 *  4. Tailles des variantes
 *  5. Couleurs des variants
 *  6. Autres attributs de variante
 *  7. Image de la variante  (URL)
 *  8-12. Image 1..5  (URLs)
 * 13. Prix de gros/unité  (HT)
 * 14. Prix de détail/unité  (TTC)
 * 15. Taux de TVA %
 * 16. Remise sur le prix de gros %
 * 17. Nombre d'unités par paquet
 * 18. Stock
 * 19. Fabriqué en (code pays ISO)
 * 20. Code douanier (code SH)
 * 21. IAN (EAN-13)
 * 22-29. Dimensions / poids / volume
 * 30. Composition
 * 36-45. Booléens X (meilleure vente, bio, …)
 */

import ExcelJS from "exceljs";
import type { ExportProduct, ExportContext, ExportVariant } from "./types";
import { buildMarketplaceImageUrl } from "@/lib/marketplace-image";
import {
  applyMarketplaceMarkup,
  formatCompositionPfs,
  variantUnitPriceWithMarkup,
} from "./format-helpers";

const ANKORSTORE_HEADERS = [
  "SKU",
  "Nom du produit",
  "Description du produit",
  "Tailles des variantes",
  "Couleurs des variants",
  "Autres attributs de variante",
  "Image de la variante",
  "Image 1",
  "Image 2",
  "Image 3",
  "Image 4",
  "Image 5",
  "Prix de gros/unité",
  "Prix de détail/unité",
  "Taux de TVA %",
  "Remise sur le prix de gros %",
  "Nombre d'unités par paquet",
  "Stock",
  "Fabriqué en (code pays, par ex. FR)",
  "Code douanier (code SH)",
  "IAN (EAN-13)",
  "Unité de dimension",
  "Dimension : Longueur",
  "Dimension : Largeur",
  "Dimension : Hauteur",
  "Unité de poids",
  "Poids",
  "Unité de volume",
  "Volume",
  "Composition",
  "Liste INCI",
  "Matériau",
  "Liste des ingrédients",
  "Date limite de consommation recommandée",
  "Date de durabilité minimale",
  "Meilleure vente",
  "Contient de l'alcool",
  "Sans cruauté",
  "Écologique",
  "Doit être réfrigéré",
  "Produit congelé",
  "Fait main",
  "Biologique",
  "Végan",
  "Objectif zéro déchet",
] as const;

/**
 * Cellule de l'export Ankorstore : `null` = cellule véritablement vide en XLSX
 * (type=0 côté ExcelJS), à ne PAS confondre avec la chaîne vide "" qui crée
 * une cellule de type string avec une valeur vide — Ankorstore voit ça comme
 * un champ "rempli mais invalide" et déclenche des erreurs "should not be blank".
 */
type Row = (string | number | null)[];

/**
 * Build the SKU for an Ankorstore variant : `<REFERENCE>_<COULEUR EN MAJUSCULES>`.
 * Falls back to `<REFERENCE>_V<index>` if no color (should not happen in practice).
 */
export function ankorstoreSkuForVariant(
  reference: string,
  variant: ExportVariant,
  index: number,
): string {
  const colorPart = variant.colorNames
    .join(" ")
    .toLocaleUpperCase("fr-FR")
    .trim();
  if (colorPart) return `${reference}_${colorPart}`;
  return `${reference}_V${index + 1}`;
}

/** Build the Ankorstore product name : `<nom FR> - <référence>`. */
function ankorstoreProductName(p: ExportProduct): string {
  const fr = p.translations["fr"]?.name || p.name;
  return `${fr} - ${p.reference}`;
}

/**
 * Build a list of full image URLs for one variant. Uses the marketplace
 * image proxy (`/api/marketplace-image?path=...`) so Ankorstore receives
 * 500px-wide images even if the local source is smaller.
 *
 * Caps at 5 (the modèle has Image 1..5).
 *
 * Fallback : si la variante n'a aucune image propre (cas d'un PACK sans photos
 * dédiées), on retombe sur les images du **produit** en cherchant la première
 * variante qui en a. Évite de générer des lignes sans image dans l'Excel
 * Ankorstore quand le validateur a laissé passer le produit (au moins 1 image
 * existe quelque part).
 */
function variantImageUrls(
  variant: ExportVariant,
  baseUrl: string,
  productFallback: ExportVariant[],
): string[] {
  const source =
    variant.imagePaths.length > 0
      ? variant.imagePaths
      : (productFallback.find((v) => v.imagePaths.length > 0)?.imagePaths ?? []);
  return source.slice(0, 5).map((path) => buildMarketplaceImageUrl(path, baseUrl));
}

/** Build N rows (1 per variant) for one product. */
export function productToAnkorstoreRows(
  p: ExportProduct,
  ctx: ExportContext,
): Row[] {
  const composition = formatCompositionPfs(p);
  const productName = ankorstoreProductName(p);
  const description = p.translations["fr"]?.description || p.description || "";
  const countryIso = (p.manufacturingCountryIso || "").toUpperCase();
  const hsCode = p.hsCode || "";
  const tva = ctx.markups.ankorstoreVatRate;

  // Filtrage UNIT : les PACK ne partent pas vers Ankorstore.
  const unitVariants = p.variants.filter((v) => v.saleType === "UNIT");

  return unitVariants.map((v, i): Row => {
    const sku = ankorstoreSkuForVariant(p.reference, v, i);
    const tailles = v.sizes.map((s) => s.name).join(", ");
    const couleurs = v.colorNames.join(", ");
    // Fallback sur TOUTES les variantes du produit (UNIT + PACK) : les images
    // sont souvent attachées aux PACK et partagées par les UNIT du même produit.
    const images = variantImageUrls(v, ctx.publicBaseUrl, p.variants);
    const imageVariant = images[0] ?? null;
    const [img1 = null, img2 = null, img3 = null, img4 = null, img5 = null] = images;

    // Prix : applique le wholesale et le retail markups séparément sur le prix
    // unitaire (par pièce). Pour PACK, on calcule per-piece.
    const basePerPiece =
      v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0
        ? v.unitPrice / v.packQuantity
        : v.unitPrice;
    const prixGros = applyMarketplaceMarkup(basePerPiece, ctx.markups.ankorstoreWholesale);
    const prixDetail = applyMarketplaceMarkup(basePerPiece, ctx.markups.ankorstoreRetail);

    const unitesParPaquet =
      v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0
        ? v.packQuantity
        : 1;

    return [
      sku, // 1
      productName, // 2
      i === 0 ? description : null, // 3 — description seulement sur 1ère ligne (null pour les variantes suivantes, pas "" qui passerait pour "champ rempli mais vide")
      tailles, // 4
      couleurs, // 5
      null, // 6 — Autres attributs (non géré)
      imageVariant, // 7
      img1, // 8
      img2, // 9
      img3, // 10
      img4, // 11
      img5, // 12
      prixGros, // 13
      prixDetail, // 14
      tva, // 15
      null, // 16 — Remise (non gérée)
      unitesParPaquet, // 17
      v.stock, // 18
      countryIso || null, // 19
      hsCode || null, // 20
      null, // 21 — EAN-13
      // Dimensions/poids/volume — on ne renseigne que le poids (en kg).
      null, // 22 unité dim
      null, // 23 longueur
      null, // 24 largeur
      null, // 25 hauteur
      "kg", // 26 unité poids
      v.weight, // 27 poids
      null, // 28 unité volume
      null, // 29 volume
      composition || null, // 30
      null, // 31 INCI
      null, // 32 Matériau
      null, // 33 Ingrédients
      null, // 34 DLC
      null, // 35 DDM
      null, // 36 Meilleure vente
      null, // 37 alcool
      null, // 38 sans cruauté
      null, // 39 écologique
      null, // 40 réfrigéré
      null, // 41 congelé
      null, // 42 fait main
      null, // 43 bio
      null, // 44 végan
      null, // 45 zéro déchet
    ];
  });
}

export async function generateAnkorstoreExcelFiles(
  products: ExportProduct[],
  ctx: ExportContext,
): Promise<{ filename: string; buffer: Buffer }[]> {
  if (products.length === 0) return [];

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Vos produits");

  sheet.addRow([...ANKORSTORE_HEADERS]);
  sheet.getRow(1).font = { bold: true };

  for (const p of products) {
    for (const row of productToAnkorstoreRows(p, ctx)) {
      sheet.addRow(row);
    }
  }

  sheet.columns.forEach((col) => {
    col.width = 18;
  });

  const buf = await wb.xlsx.writeBuffer();
  return [
    {
      filename: "ankorstore.xlsx",
      buffer: Buffer.from(buf),
    },
  ];
}
