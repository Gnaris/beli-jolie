/**
 * Ankorstore API Write Client — minimal delete-only variant.
 *
 * Product create/update on Ankorstore now happens via manual Excel upload
 * (see lib/marketplace-excel). This module only supports DELETE for the
 * "remove product from marketplace" flow.
 *
 * Fire-and-forget: the operation is started on Ankorstore's side but we no
 * longer wait for the callback webhook — the admin must verify deletion on
 * the Ankorstore dashboard.
 */

import { getAnkorstoreHeaders, ANKORSTORE_BASE_URL } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

export async function ankorstoreDeleteProduct(
  externalId: string,
  variantSkus: string[],
): Promise<{ success: boolean; opId?: string; error?: string }> {
  const headers = await getAnkorstoreHeaders();
  const jsonHeaders = { ...headers, "Content-Type": "application/vnd.api+json" };

  try {
    logger.info("[Ankorstore] Deleting product", { externalId, variantSkus });

    const createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        data: {
          type: "catalog-integration-operation",
          attributes: {
            source: "other",
            operationType: "delete",
          },
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Create delete operation failed (${createRes.status}): ${err.slice(0, 300)}`);
    }

    const opId = (await createRes.json()).data?.id as string;
    if (!opId) throw new Error("No operation ID returned");

    const addRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/products`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        products: [{
          id: externalId,
          type: "catalog-integration-product",
          attributes: {
            external_id: externalId,
            ...(variantSkus.length > 0
              ? { variants: variantSkus.map((sku) => ({ sku })) }
              : {}),
          },
        }],
      }),
    });

    if (!addRes.ok) {
      const err = await addRes.text();
      throw new Error(`Add product to delete failed (${addRes.status}): ${err.slice(0, 300)}`);
    }

    const startRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({
        data: { type: "catalog-integration-operation", id: opId, attributes: { status: "started" } },
      }),
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      throw new Error(`Start delete operation failed (${startRes.status}): ${err.slice(0, 300)}`);
    }

    logger.info("[Ankorstore] Delete operation started", { opId, externalId });
    return { success: true, opId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Delete failed", { externalId, error: message });
    return { success: false, error: message };
  }
}
