/**
 * Orderchamp Delete / Unpublish / Publish — 3 mutations autour du cycle de vie.
 *
 * Distinction :
 *  - `productUnpublish(id)` : SOFT — cache le produit aux acheteuses mais
 *    conserve l'ID Orderchamp et toute la fiche. À utiliser quand un produit
 *    BJ passe OFFLINE (retour possible en ONLINE via `productPublish`).
 *  - `productDelete(id)` : HARD — supprime définitivement. À utiliser quand
 *    un produit BJ est ARCHIVÉ ou supprimé.
 *  - `productPublish(id)` : remet en ligne un produit dépublié (récupère
 *    l'ID Orderchamp existant, pas de duplication).
 */

import {
  orderchampGraphQL,
  extractUserErrors,
  formatUserErrors,
  OrderchampGraphQLError,
} from "@/lib/orderchamp-client";
import {
  PRODUCT_DELETE_MUTATION,
  PRODUCT_UNPUBLISH_MUTATION,
  PRODUCT_PUBLISH_MUTATION,
} from "@/lib/orderchamp-queries";
import { logger } from "@/lib/logger";

export interface OrderchampDeleteResult {
  success: boolean;
  /** ID supprimé (retourné par Orderchamp). Null si erreur. */
  deletedProductId?: string | null;
  error?: string;
}

/**
 * Suppression franche (hard delete). L'ID n'est plus utilisable après.
 * Si le produit n'existe déjà plus, `success: true` avec `deletedProductId: null`.
 */
export async function orderchampHardDeleteProduct(
  orderchampProductId: string,
): Promise<OrderchampDeleteResult> {
  try {
    const data = await orderchampGraphQL<{
      productDelete: {
        deletedProductId: string | null;
        userErrors: Array<Record<string, unknown>>;
      } | null;
    }>(
      PRODUCT_DELETE_MUTATION,
      { input: { id: orderchampProductId } },
      "productDelete",
    );
    const payload = data.productDelete;
    if (!payload) {
      return { success: true, deletedProductId: null };
    }
    const errs = extractUserErrors(payload);
    if (errs.length > 0) {
      const msg = formatUserErrors(errs) ?? "Erreur suppression Orderchamp";
      return { success: false, error: msg };
    }
    return { success: true, deletedProductId: payload.deletedProductId };
  } catch (err) {
    if (err instanceof OrderchampGraphQLError) {
      // « Product not found » = déjà supprimé côté OC → idempotent
      const notFound = err.errors.some((e) => /not found/i.test(e.message));
      if (notFound) {
        logger.warn("[Orderchamp Delete] produit déjà absent", { orderchampProductId });
        return { success: true, deletedProductId: null };
      }
    }
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[Orderchamp Delete] échec", { orderchampProductId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Dépublie un produit (garde l'ID, cache aux acheteuses).
 * Utilisé quand un produit BJ passe OFFLINE.
 */
export async function orderchampUnpublishProduct(
  orderchampProductId: string,
): Promise<OrderchampDeleteResult> {
  try {
    const data = await orderchampGraphQL<{
      productUnpublish: {
        product: { id: string } | null;
        userErrors: Array<Record<string, unknown>>;
      };
    }>(
      PRODUCT_UNPUBLISH_MUTATION,
      { input: { id: orderchampProductId } },
      "productUnpublish",
    );
    const errs = extractUserErrors(data.productUnpublish);
    if (errs.length > 0) {
      const msg = formatUserErrors(errs) ?? "Erreur unpublish Orderchamp";
      return { success: false, error: msg };
    }
    return { success: true, deletedProductId: data.productUnpublish.product?.id ?? orderchampProductId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[Orderchamp Unpublish] échec", { orderchampProductId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Remet en ligne un produit dépublié. Utilisé quand un produit BJ repasse ONLINE.
 */
export async function orderchampRepublishProductVisibility(
  orderchampProductId: string,
): Promise<OrderchampDeleteResult> {
  try {
    const data = await orderchampGraphQL<{
      productPublish: {
        product: { id: string } | null;
        userErrors: Array<Record<string, unknown>>;
      };
    }>(
      PRODUCT_PUBLISH_MUTATION,
      { input: { id: orderchampProductId } },
      "productPublish",
    );
    const errs = extractUserErrors(data.productPublish);
    if (errs.length > 0) {
      const msg = formatUserErrors(errs) ?? "Erreur publish Orderchamp";
      return { success: false, error: msg };
    }
    return { success: true, deletedProductId: data.productPublish.product?.id ?? orderchampProductId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[Orderchamp Publish] échec", { orderchampProductId, error: message });
    return { success: false, error: message };
  }
}
