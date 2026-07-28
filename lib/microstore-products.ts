/**
 * Microstore (Dokkr) API — push produits (create + update).
 *
 * Un seul endpoint `POST /goods/import_v1` est utilisé pour créer ET mettre à
 * jour : Microstore reconnaît le produit via `item_ref` (= Product.reference)
 * et fait un upsert. On peut pousser 1 à N produits par appel — l'API attend un
 * tableau CSV-like sous la forme `[headers, ...rows]`.
 *
 * Limites Microstore (source : HAR client + `docs/microstore-*.md`) :
 *  - Pas d'upload photo via API : les images restent à charger à la main dans
 *    l'interface web Microstore après le premier push.
 *  - Pas de suppression via API : archiver/retirer un produit reste manuel.
 *  - Pas de refresh — inutile puisqu'on ne peut pas supprimer côté marketplace.
 *
 * Filtre appliqué : les variantes PACK sont exclues (Microstore ne référence
 * que les ventes à l'unité, cf. `withUnitVariantsOnly`).
 */

import { logger } from "@/lib/logger";
import {
  buildMicrostoreUrl,
  getMicrostoreSessionKey,
  isMicrostoreSessionExpiredError,
} from "@/lib/microstore-auth";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import type {
  ExportContext,
  ExportProduct,
  ExportVariant,
} from "@/lib/marketplace-excel/types";
import {
  formatCompositionPfs,
  pickTranslation,
  variantUnitPriceWithMarkup,
} from "@/lib/marketplace-excel/format-helpers";

/**
 * En-têtes de colonnes attendus par `POST /goods/import_v1`, dans l'ordre
 * strict du HAR de production. Ces libellés sont en anglais (l'export Excel
 * manuel utilise les équivalents français) — ne pas confondre.
 */
export const MICROSTORE_API_HEADERS = [
  "item_ref",
  "name",
  "category",
  "remark_package",
  "remark_material",
  "brand",
  "year",
  "season",
  "unit_number",
  "color",
  "stock",
  "stock_piece",
  "weight",
  "price",
  "product_country",
  "sale",
  "desc",
] as const;

/** Une ligne de données (types identiques au HAR : mixte string/number). */
export type MicrostoreApiRow = (string | number)[];

interface ColorBucket {
  colorName: string;
  variant: ExportVariant;
}

/**
 * Regroupe les variantes UNIT du produit par couleur unique. Une couleur = une
 * ligne poussée à Microstore. Les PACK sont ignorés.
 */
export function bucketProductByColor(p: ExportProduct): ColorBucket[] {
  const buckets = new Map<string, ColorBucket>();
  for (const v of p.variants) {
    if (v.saleType !== "UNIT") continue;
    for (const colorName of v.colorNames) {
      if (!buckets.has(colorName)) {
        buckets.set(colorName, { colorName, variant: v });
      }
    }
  }
  return [...buckets.values()];
}

/**
 * Construit les lignes API pour un produit. Une ligne par couleur unique en
 * UNIT — identique au générateur Excel (`generate-microstore.ts`) mais avec
 * les en-têtes anglais de l'API au lieu des libellés français.
 */
export function productToMicrostoreApiRows(
  p: ExportProduct,
  ctx: ExportContext,
  year: number = new Date().getFullYear(),
): MicrostoreApiRow[] {
  const markup = ctx.markups.microstore;
  const composition = formatCompositionPfs(p);
  const remarque = pickTranslation(p, "fr", "description");
  const categoryLabel = p.microstoreCategoryOverride || p.categoryName || "";
  const nameFr = pickTranslation(p, "fr", "name");
  const pays = p.manufacturingCountryName || "";

  return bucketProductByColor(p).map((b): MicrostoreApiRow => {
    const v = b.variant;
    const prix = variantUnitPriceWithMarkup(v, markup);
    const poidsGrammes = Math.round(Number(v.weight) * 1000);
    return [
      p.reference, // item_ref
      nameFr, // name
      categoryLabel, // category
      1, // remark_package (contenu colis — fixe 1)
      composition, // remark_material
      ctx.shopName, // brand
      year, // year (année du push)
      p.seasonName || "Toutes saisons", // season
      1, // unit_number (colisage — fixe 1)
      b.colorName, // color
      v.stock, // stock
      // stock_piece = stock réel côté Microstore (= stock × unit_number). L'API
      // `/goods/import_v1` utilise `stock_piece` comme quantité disponible
      // effective : envoyer 0 y écrase le stock à zéro, même si `stock` est
      // renseigné. Le générateur Excel manuel met 0 par convention parce que
      // l'import Excel côté Microstore recalcule côté serveur — pas l'API brute.
      // Aligné sur le HAR de production de la cliente qui envoyait la même
      // valeur dans `stock` et `stock_piece`.
      v.stock, // stock_piece
      poidsGrammes, // weight (grammes)
      prix, // price
      pays, // product_country
      "", // sale (remise — laissée vide)
      remarque, // desc
    ];
  });
}

export interface MicrostoreImportResult {
  success: boolean;
  /** Nombre de produits pris en compte (après filtre PACK et couleurs vides). */
  productsSent: number;
  /** Nombre total de lignes (1 par couleur) envoyées dans le payload. */
  rowsSent: number;
  /** Message d'erreur Microstore (`msg`) si `err != 0`. */
  error?: string;
  /** Code `err` brut renvoyé par Microstore (0 = succès). */
  errCode?: number;
}

/**
 * Attributs autorisés dans le payload — base copiée du HAR de production. Chaque
 * clé à `1` autorise Microstore à créer l'entité côté serveur si elle n'existe
 * pas encore (catégorie, marque, année, saison, couleur, composition matérielle,
 * contenu colis).
 *
 * `product_country` ajouté préventivement : le HAR de production ne l'incluait
 * pas, mais certains produits BJ ont un pays de fabrication modifié après un
 * premier push et l'API ne semble pas mettre à jour ce champ. Si Microstore
 * ignore la clé, aucun effet ; sinon ça débloque la propagation.
 */
const MICROSTORE_IMPORT_ATTRS = {
  color_not_exist: 1,
  color_exist: 1,
  remark_material: 1,
  remark_package: 1,
  cat_id: 1,
  brand_id: 1,
  year_id: 1,
  season_id: 1,
  product_country: 1,
} as const;

/**
 * Push d'une liste de produits vers Microstore via `POST /goods/import_v1`.
 *
 * @param products Produits déjà chargés en `ExportProduct` (via
 *                 `loadExportProducts()`).
 * @param ctx      Contexte export (marque = shopName tenant, markup Microstore).
 * @param opts.stockIncremental
 *   - `false` (défaut) : la valeur `stock` envoyée **remplace** le stock
 *     Microstore. Comportement standard des saves fiche + push stock silencieux.
 *   - `true` : Microstore **ajoute** la valeur au stock existant. Réservé aux
 *     corrections de delta manuelles, jamais utilisé en flux normal.
 * @param opts.shopId Identifiant boutique côté Microstore (défaut "1", comme
 *                    dans le HAR de production).
 */
export async function microstoreImportProducts(
  products: ExportProduct[],
  ctx: ExportContext,
  opts?: { stockIncremental?: boolean; shopId?: string },
): Promise<MicrostoreImportResult> {
  const validProducts = products.filter(
    (p) => bucketProductByColor(p).length > 0,
  );
  if (validProducts.length === 0) {
    return { success: true, productsSent: 0, rowsSent: 0 };
  }

  const sessionKey = await getMicrostoreSessionKey();
  if (!sessionKey) {
    throw new MicrostoreSessionExpiredError();
  }

  const rows: MicrostoreApiRow[] = [];
  for (const p of validProducts) {
    rows.push(...productToMicrostoreApiRows(p, ctx));
  }
  if (rows.length === 0) {
    return { success: true, productsSent: validProducts.length, rowsSent: 0 };
  }

  const payload = [[...MICROSTORE_API_HEADERS], ...rows];

  const url = await buildMicrostoreUrl("/goods/import_v1", {
    version: "1.64.16",
    needResponse: "1",
  });

  const form = new FormData();
  form.append("shop_id", opts?.shopId ?? "1");
  form.append("stock_incremental", opts?.stockIncremental ? "1" : "0");
  form.append("data", JSON.stringify(payload));
  form.append("attrs", JSON.stringify(MICROSTORE_IMPORT_ATTRS));

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      body: form,
      headers: {
        Accept: "application/json, text/plain, */*",
        Origin: "https://web.mc.app",
        Referer: "https://web.mc.app/",
      },
      cache: "no-store",
    });
  } catch (err) {
    logger.error("[Microstore] network error on import", { error: err });
    throw new Error("Impossible de contacter Microstore.");
  }

  if (!res.ok) {
    throw new Error(`Microstore a répondu HTTP ${res.status}.`);
  }

  const body = (await res.json().catch(() => null)) as
    | { err?: number; msg?: string; debug_msg?: string }
    | null;
  if (!body) throw new Error("Réponse Microstore invalide.");
  if (isMicrostoreSessionExpiredError(body.err)) {
    throw new MicrostoreSessionExpiredError();
  }
  if (typeof body.err === "number" && body.err !== 0) {
    return {
      success: false,
      productsSent: validProducts.length,
      rowsSent: rows.length,
      error: body.msg || body.debug_msg || `Erreur Microstore (${body.err})`,
      errCode: body.err,
    };
  }

  return {
    success: true,
    productsSent: validProducts.length,
    rowsSent: rows.length,
  };
}

/**
 * Raccourci « push un seul produit » (bouton fiche produit).
 */
export async function microstorePushProduct(
  product: ExportProduct,
  ctx: ExportContext,
): Promise<MicrostoreImportResult> {
  return microstoreImportProducts([product], ctx);
}

/**
 * Push silencieux du stock déclenché par une commande client (fire-and-forget).
 *
 * Contrat cliente : quand une commande consomme du stock, on répercute le
 * nouveau stock côté Microstore automatiquement, sans lever le badge « Synchro
 * nécessaire » ni notifier l'admin. Uniquement pour les produits :
 *  - déjà poussés au moins une fois (`microstoreLastPushedAt != null`) — sinon
 *    on ne les crée pas silencieusement, l'admin doit d'abord cliquer « Envoyer »;
 *  - avec Microstore activé (`microstoreEnabled`);
 *  - pas 100% PACK (Microstore ne référence que les UNIT).
 *
 * Cette fonction :
 *  - N'exige PAS d'être appelée depuis un contexte HTTP : elle prend `tenantId`
 *    explicitement et wrap le corps dans `tenantALS.run` pour propager la
 *    session Microstore du bon tenant (voir CLAUDE.md multi-tenant).
 *  - Ne throw jamais : toute erreur est loggée puis avalée pour ne pas faire
 *    échouer la commande.
 *  - Ne pose PAS `microstoreSyncRequired` sur un échec : le prochain save
 *    manuel remettra le flag à jour via `updateProduct`.
 */
export async function pushMicrostoreStockSilent(
  productIds: string[],
  tenantId: string,
): Promise<void> {
  if (productIds.length === 0) return;

  const { tenantALS } = await import("@/lib/tenant-als");
  await tenantALS.run(tenantId, async () => {
    try {
      const { prisma } = await import("@/lib/prisma");
      const eligible = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          microstoreEnabled: true,
          microstoreLastPushedAt: { not: null },
        },
        select: { id: true },
      });
      if (eligible.length === 0) return;

      const { loadExportContext, loadExportProducts } = await import(
        "@/lib/marketplace-excel/load-products"
      );
      const [ctx, exportProducts] = await Promise.all([
        loadExportContext(),
        loadExportProducts(eligible.map((p) => p.id)),
      ]);
      if (exportProducts.length === 0) return;

      const result = await microstoreImportProducts(exportProducts, ctx);
      if (!result.success) {
        logger.warn("[Microstore] silent stock push refused", {
          error: result.error,
          errCode: result.errCode,
          tenantId,
          productIds: eligible.map((p) => p.id),
        });
        return;
      }

      // Push OK : on met à jour microstoreLastPushedAt sur les produits
      // effectivement poussés (au moins 1 ligne UNIT). Pas de reset du flag
      // syncRequired ici : si le flag était posé, il l'était pour d'autres
      // changements (nom/prix/couleur) que le push complet vient de couvrir,
      // donc on peut le baisser aussi.
      const pushedIds = exportProducts
        .filter((p) => p.variants.some((v) => v.saleType === "UNIT" && v.colorNames.length > 0))
        .map((p) => p.id);
      if (pushedIds.length > 0) {
        await prisma.product.updateMany({
          where: { id: { in: pushedIds } },
          data: {
            microstoreLastPushedAt: new Date(),
            microstoreSyncRequired: false,
          },
        });
      }
    } catch (err) {
      logger.error("[Microstore] silent stock push failed", { error: err, tenantId });
    }
  });
}
