/**
 * Ankorstore API Client (write operations) — MODE CALLBACK-ONLY
 *
 * Wraps the catalog-integration write workflow. Every async operation kicks off
 * the work on Ankorstore and returns the operationId — the result is delivered
 * later via a webhook callback to `/api/webhooks/ankorstore`.
 *
 * No polling, no waiting for terminal status here. Finalization (looking up
 * `ankorstoreProductId`, mapping variants, saving snapshot) happens in
 * `lib/ankorstore-finalize.ts` driven by the webhook handler.
 *
 * The only synchronous calls left are the direct variant patches
 * (`/product-variants/{id}/stock` and `/prices`), which are not catalog
 * operations — their HTTP response IS the result.
 *
 * Validated against the real API on 2026-05-11. See docs/ankorstore-api.md.
 */

import {
  getAnkorstoreHeaders,
  invalidateAnkorstoreToken,
  ANKORSTORE_BASE_URL,
} from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Callback URL builder
// ─────────────────────────────────────────────

/**
 * Build the public webhook URL we send to Ankorstore as `callbackUrl`.
 *
 * The secret query parameter is the only auth Ankorstore has when calling us
 * back — without it, anyone could POST fake operation results to our webhook.
 *
 * In dev (localhost), Ankorstore can't reach this URL, so callbacks never fire.
 * All Ankorstore testing must happen against the production host.
 *
 * Le paramètre `nonce` (aléatoire à chaque appel) rend le body de la requête
 * POST /catalog/integrations/operations unique. Sans ça, deux créations
 * d'opération concurrentes avec un payload identique (même operationType,
 * même source, même callbackUrl) reçoivent le MÊME operationId d'Ankorstore
 * — leur serveur déduplique les requêtes identiques dans une courte fenêtre.
 * Résultat : deux produits différents essaient d'ajouter leurs articles à la
 * même opération, et le second reçoit « Products cannot be added to Operation
 * with status [started] ». Bug constaté 2026-07-07.
 * Le webhook ne lit que `secret` — le nonce est ignoré côté serveur.
 */
export function buildAnkorstoreCallbackUrl(): string {
  const base = (process.env.NEXTAUTH_URL ?? "https://beliandjolie.com").replace(/\/$/, "");
  const secret = process.env.ANKORSTORE_WEBHOOK_SECRET ?? "";
  const nonce = generateNonce();
  return `${base}/api/webhooks/ankorstore?secret=${encodeURIComponent(secret)}&nonce=${nonce}`;
}

function generateNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface AnkorstoreCatalogProductInput {
  externalId: string;
  name: string;
  description: string;
  mainImage?: string;
  images?: { order: number; url: string }[];
  currency: "EUR";
  vatRate: number;
  unitMultiplier: number;
  wholesalePrice: number; // EUR (not cents)
  retailPrice: number;    // EUR
  countryCode: string;    // ISO
  /**
   * Code SH / HS code (douanier). 6 à 10 chiffres typiquement. Optionnel —
   * envoyé seulement quand renseigné côté produit.
   */
  hsCode?: string;
  /**
   * Liste des tags. **Envoyer un tableau vide (`[]`) retire activement
   * tous les tags** sur un produit déjà publié. Ne PAS confondre avec
   * « champ absent » qui veut dire « pas de changement ».
   */
  tags?: string[];
  variants: {
    sku: string;
    ian?: string | null;
    stockQuantity: number;
    isAlwaysInStock: boolean;
    wholesalePrice: number;          // EUR — required per variant
    retailPrice: number;             // EUR — required per variant
    originalWholesalePrice: number;  // EUR — required per variant (not documented in spec)
    options: { name: "color" | "size" | "material" | "style"; value: string }[];
    images?: { order: number; url: string }[];
  }[];
  shapeProperties?: {
    /**
     * Poids du produit. `unit_code` n'est PAS envoyé : Ankorstore applique
     * "kg" par défaut côté plateforme, et le préciser produit un affichage
     * dupliqué de l'unité dans leur backoffice.
     */
    weight?: { amount: number };
    /**
     * Dimensions du produit. `unit_code: "cm"` reste explicite (la valeur
     * par défaut côté Ankorstore n'est pas documentée).
     */
    dimensions?: {
      unitCode: "cm";
      width?: number;
      height?: number;
      length?: number;
    };
  };
}

// ─────────────────────────────────────────────
// Internal fetch helper
// ─────────────────────────────────────────────

/** Non-retryable error (4xx except 429) */
class AnkorstoreNonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkorstoreNonRetryableError";
  }
}

async function ankorstoreFetchJson<T>(
  path: string,
  init?: RequestInit,
  attempt = 0
): Promise<T> {
  const headers = await getAnkorstoreHeaders();
  const url = `${ANKORSTORE_BASE_URL}${path}`;

  const makeRequest = async (currentAttempt: number): Promise<T> => {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body !== undefined ? { "Content-Type": "application/vnd.api+json" } : {}),
        ...headers,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    // 401 — token expired, invalidate and retry once
    if (res.status === 401 && currentAttempt === 0) {
      await invalidateAnkorstoreToken();
      const freshHeaders = await getAnkorstoreHeaders();
      logger.warn("[Ankorstore] Retry", { status: 401, attempt: 1, path });
      const retryRes = await fetch(url, {
        ...init,
        headers: {
          ...(init?.body !== undefined ? { "Content-Type": "application/vnd.api+json" } : {}),
          ...freshHeaders,
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
      if (!retryRes.ok) {
        const text = await retryRes.text().catch(() => "");
        logger.error("[Ankorstore] API error after 401 retry", {
          status: retryRes.status,
          path,
          method: init?.method ?? "GET",
          body: text.slice(0, 500),
        });
        throw new AnkorstoreNonRetryableError(
          `Ankorstore API ${retryRes.status}: ${text.slice(0, 500)}`
        );
      }
      if (retryRes.status === 204) return undefined as unknown as T;
      return retryRes.json() as Promise<T>;
    }

    if (res.ok) {
      if (res.status === 204) return undefined as unknown as T;
      const text = await res.text();
      if (!text) return undefined as unknown as T;
      return JSON.parse(text) as T;
    }

    // 429 — rate limited
    if (res.status === 429) {
      const maxRetries = 3;
      if (currentAttempt >= maxRetries) {
        const text = await res.text().catch(() => "");
        logger.error("[Ankorstore] Rate limit exceeded after retries", {
          path,
          method: init?.method ?? "GET",
          body: text.slice(0, 500),
        });
        throw new AnkorstoreNonRetryableError(
          `Ankorstore API 429: rate limit exceeded after ${maxRetries} attempts`
        );
      }
      const retryAfterSec = Number(res.headers.get("Retry-After") ?? "5");
      const delayMs = (isNaN(retryAfterSec) ? 5 : retryAfterSec) * 1000;
      logger.warn("[Ankorstore] Retry", { status: 429, attempt: currentAttempt + 1, path });
      await new Promise((r) => setTimeout(r, delayMs));
      return makeRequest(currentAttempt + 1);
    }

    // 5xx — exponential backoff: 1s, 4s, 16s
    if (res.status >= 500) {
      const maxRetries = 3;
      if (currentAttempt >= maxRetries) {
        const text = await res.text().catch(() => "");
        logger.error("[Ankorstore] Server error after retries", {
          status: res.status,
          path,
          method: init?.method ?? "GET",
          body: text.slice(0, 500),
        });
        throw new Error(
          `Ankorstore API ${res.status} after ${maxRetries} retries: ${text.slice(0, 500)}`
        );
      }
      const delayMs = Math.pow(4, currentAttempt) * 1000;
      logger.warn("[Ankorstore] Retry", { status: res.status, attempt: currentAttempt + 1, path });
      await new Promise((r) => setTimeout(r, delayMs));
      return makeRequest(currentAttempt + 1);
    }

    // Other 4xx — never retry
    const text = await res.text().catch(() => "");
    logger.error("[Ankorstore] Client error (non-retryable)", {
      status: res.status,
      path,
      method: init?.method ?? "GET",
      body: text.slice(0, 500),
    });
    throw new AnkorstoreNonRetryableError(
      `Ankorstore API ${res.status}: ${text.slice(0, 500)}`
    );
  };

  return makeRequest(attempt);
}

// ─────────────────────────────────────────────
// Payload builders (snake_case for the products array)
// ─────────────────────────────────────────────

function buildProductPayloadAttributes(p: AnkorstoreCatalogProductInput): Record<string, unknown> {
  return {
    external_id: p.externalId,
    name: p.name,
    description: p.description,
    ...(p.mainImage ? { main_image: p.mainImage } : {}),
    ...(p.images ? { images: p.images } : {}),
    currency: p.currency,
    vat_rate: p.vatRate,
    unit_multiplier: p.unitMultiplier,
    wholesale_price: p.wholesalePrice,
    retail_price: p.retailPrice,
    made_in_country: p.countryCode,
    ...(p.hsCode ? { hs_code: p.hsCode } : {}),
    ...(p.tags !== undefined ? { tags: p.tags } : {}),
    ...(p.shapeProperties
      ? {
          shape_properties: {
            ...(p.shapeProperties.weight
              ? { weight: { amount: p.shapeProperties.weight.amount } }
              : {}),
            ...(p.shapeProperties.dimensions
              ? {
                  dimensions: {
                    unit_code: p.shapeProperties.dimensions.unitCode,
                    ...(p.shapeProperties.dimensions.width != null
                      ? { width: p.shapeProperties.dimensions.width }
                      : {}),
                    ...(p.shapeProperties.dimensions.height != null
                      ? { height: p.shapeProperties.dimensions.height }
                      : {}),
                    ...(p.shapeProperties.dimensions.length != null
                      ? { length: p.shapeProperties.dimensions.length }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    variants: p.variants.map((v) => ({
      sku: v.sku,
      ...(v.ian != null ? { ian: v.ian } : {}),
      stock_quantity: v.stockQuantity,
      is_always_in_stock: v.isAlwaysInStock,
      wholesale_price: v.wholesalePrice,
      retail_price: v.retailPrice,
      original_wholesale_price: v.originalWholesalePrice,
      options: v.options,
      ...(v.images ? { images: v.images } : {}),
    })),
  };
}

// ─────────────────────────────────────────────
// Catalog Integration kickoff — create / import / update
// ─────────────────────────────────────────────

/**
 * Create a catalog-integration operation (`import` or `update`).
 *
 * The created operation is in status `created` — it must be moved to `started`
 * via {@link ankorstoreStartOperation} after products are added.
 *
 * `delete` uses a different endpoint — see {@link ankorstoreKickoffDelete}.
 *
 * Pour `type: "update"`, on N'envoie PAS `updateFields` — la doc Ankorstore
 * dit qu'omettre ce champ avec `source: "other"` met à jour TOUS les champs
 * présents dans le payload (cf. docs/ankorstore-api.md:296). C'est plus
 * robuste que de tenter de lister les noms : le spec officiel ne reconnaît
 * que `["stock", "prices"]` mais l'API tolère d'autres valeurs sans qu'on
 * sache exactement lesquelles (`main_image` notamment était silencieusement
 * ignoré, ce qui empêchait la photo principale de suivre la couleur
 * principale au changement). En omettant updateFields, Ankorstore applique
 * tout ce qu'on lui envoie — et comme on n'envoie pas `tags`, les tags
 * existants ne sont pas touchés.
 */

// Suivi des operationIds récents pour détecter la dédup d'Ankor : leur backend
// renvoie parfois le MÊME operationId pour deux create successifs (fenêtre
// observée en prod ≥ 5 s, 2026-07-31), ce qui casse le kickoff suivant avec un
// 403 « [started]/[pending] → [started] ». Cap à 32 entrées LRU-like — mémoire
// process, safe multi-tenant car les opIds sont uniques globalement.
const recentAnkorstoreOperationIds = new Set<string>();

function trackAnkorstoreOperationId(id: string): void {
  recentAnkorstoreOperationIds.add(id);
  if (recentAnkorstoreOperationIds.size > 32) {
    const first = recentAnkorstoreOperationIds.values().next().value;
    if (first) recentAnkorstoreOperationIds.delete(first);
  }
}

/**
 * Test-only : vide la mémoire de dédup pour éviter les fuites entre tests.
 */
export function __resetAnkorstoreRecentOperationIds(): void {
  recentAnkorstoreOperationIds.clear();
}

export async function ankorstoreCreateCatalogOperation(
  type: "import" | "update"
): Promise<{ operationId: string }> {
  const backoffs = [3000, 6000, 10000, 15000]; // ~34 s cumulés max
  for (let attempt = 0; ; attempt++) {
    const attributes: Record<string, unknown> = {
      operationType: type,
      source: "other",
      callbackUrl: buildAnkorstoreCallbackUrl(),
    };
    const resp = await ankorstoreFetchJson<{ data: { id: string } }>(
      `/catalog/integrations/operations`,
      {
        method: "POST",
        body: JSON.stringify({
          data: { type: "catalog-integration-operation", attributes },
        }),
      }
    );
    const operationId = resp.data.id;

    // Collision détectée = Ankor a renvoyé un opId qu'on a déjà vu récemment.
    // On attend et on retente : chaque nouveau POST relance le compteur de
    // dédup côté Ankor, donc au 2ᵉ ou 3ᵉ essai on obtient généralement un
    // opId neuf.
    if (recentAnkorstoreOperationIds.has(operationId) && attempt < backoffs.length) {
      logger.warn("[Ankorstore] Create renvoie un operationId déjà vu (dédup Ankor) — retry", {
        operationId,
        attempt: attempt + 1,
        delayMs: backoffs[attempt],
      });
      await new Promise((r) => setTimeout(r, backoffs[attempt]));
      continue;
    }

    trackAnkorstoreOperationId(operationId);
    return { operationId };
  }
}

/**
 * Add products to a catalog-integration operation.
 *
 * Wrapper is `{ products: [...] }` (NOT `{ data: [...] }` — silently ignored).
 * Attributes inside the products array are snake_case.
 */
export async function ankorstoreAddProductsToOperation(
  operationId: string,
  products: AnkorstoreCatalogProductInput[]
): Promise<{ totalProductsCount: number }> {
  const payloadProducts = products.map((p) => ({
    id: p.externalId,
    type: "catalog-integration-product",
    attributes: buildProductPayloadAttributes(p),
  }));

  const resp = await ankorstoreFetchJson<{ meta?: { totalProductsCount?: number } }>(
    `/catalog/integrations/operations/${encodeURIComponent(operationId)}/products`,
    {
      method: "POST",
      body: JSON.stringify({ products: payloadProducts }),
    }
  );

  const totalProductsCount = resp?.meta?.totalProductsCount ?? 0;
  if (totalProductsCount !== products.length) {
    logger.warn("[Ankorstore] addProducts mismatch", {
      operationId,
      sent: products.length,
      acknowledged: totalProductsCount,
    });
  }
  return { totalProductsCount };
}

/**
 * Start (trigger) a catalog-integration operation. Required after adding
 * products to a `created` operation.
 *
 * Retry sur le 403 « cannot be updated from [pending] to [started] » : Ankor
 * met parfois quelques centaines de ms à faire passer l'op de `pending` à
 * `created` côté leur backend, surtout quand on enchaîne plusieurs kickoffs
 * rapidement (constaté en prod 2026-07-31 après passage à 5 en parallèle).
 * Backoffs : 500 ms, 1 s, 2 s, 4 s (max ~7,5 s d'attente cumulée).
 */
export async function ankorstoreStartOperation(operationId: string): Promise<void> {
  const path = `/catalog/integrations/operations/${encodeURIComponent(operationId)}`;
  const body = JSON.stringify({
    data: {
      type: "catalog-integration-operation",
      id: operationId,
      attributes: { status: "started" },
    },
  });

  const backoffs = [500, 1000, 2000, 4000];
  for (let attempt = 0; ; attempt++) {
    try {
      await ankorstoreFetchJson<unknown>(path, { method: "PATCH", body });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const pendingRace = /cannot be updated from \[pending\]/i.test(msg);
      if (!pendingRace || attempt >= backoffs.length) {
        throw err;
      }
      logger.warn("[Ankorstore] Start operation encore en [pending] — retry après backoff", {
        operationId,
        attempt: attempt + 1,
        delayMs: backoffs[attempt],
      });
      await new Promise((r) => setTimeout(r, backoffs[attempt]));
    }
  }
}

/**
 * Kick off a deletion operation via the dedicated endpoint. Returns the
 * operationId — the result arrives via webhook.
 *
 * The variant SKU list is REQUIRED (empty list = silent no-op).
 */
export async function ankorstoreKickoffDelete(
  externalId: string,
  variantSkus: string[]
): Promise<{ operationId: string }> {
  if (!externalId) {
    throw new Error("[Ankorstore Delete] externalId is required");
  }
  if (!variantSkus || variantSkus.length === 0) {
    throw new Error(
      "[Ankorstore Delete] At least one SKU is required — empty variant list is a silent no-op"
    );
  }

  const resp = await ankorstoreFetchJson<{ data: { id: string } }>(
    `/catalog/integrations/operations/delete`,
    {
      method: "POST",
      body: JSON.stringify({
        source: "other",
        callbackUrl: buildAnkorstoreCallbackUrl(),
        products: [
          {
            type: "catalog-integration-product",
            attributes: {
              external_id: externalId,
              variants: variantSkus.map((sku) => ({ sku })),
            },
          },
        ],
      }),
    }
  );

  return { operationId: resp.data.id };
}

// ─────────────────────────────────────────────
// Webhook-side helpers (called from /api/webhooks/ankorstore)
// ─────────────────────────────────────────────

/**
 * Resolve the `ankorstoreProductId` of a freshly created product by querying
 * a known SKU. The catalog-integration callback does NOT carry it, and
 * indexing can lag a few seconds → retry with backoff.
 */
export async function ankorstoreLookupProductIdBySku(
  sku: string,
  opts?: { maxAttempts?: number; initialDelayMs?: number; pollDelayMs?: number }
): Promise<string | null> {
  const maxAttempts = opts?.maxAttempts ?? 6;
  const initialDelayMs = opts?.initialDelayMs ?? 3_000;
  const pollDelayMs = opts?.pollDelayMs ?? 5_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 1 ? initialDelayMs : pollDelayMs));

    const resp = await ankorstoreFetchJson<{
      data: {
        id: string;
        relationships?: { product?: { data?: { id?: string } } };
      }[];
    }>(`/product-variants?filter[sku]=${encodeURIComponent(sku)}&include=product&page[limit]=1`);

    const productId = resp.data?.[0]?.relationships?.product?.data?.id;
    if (productId) return productId;
  }

  return null;
}

/**
 * Read the per-product results of a completed operation. Used by the webhook
 * handler when the callback's `data.attributes.status` is terminal but we
 * need the issues / failureReason details for each product.
 */
export async function ankorstoreFetchOperationResults(operationId: string): Promise<
  {
    externalProductId: string;
    status: "success" | "failure";
    failureReason: string | null;
    issues: unknown[];
  }[]
> {
  const resp = await ankorstoreFetchJson<{
    data: {
      attributes: {
        externalProductId?: string;
        status: string;
        failureReason?: string | null;
        issues?: unknown[];
      };
    }[];
  }>(`/catalog/integrations/operations/${encodeURIComponent(operationId)}/results`);

  return (resp.data ?? []).map((i) => ({
    externalProductId: i.attributes.externalProductId ?? "",
    status: i.attributes.status === "success" ? "success" : "failure",
    failureReason: i.attributes.failureReason ?? null,
    issues: i.attributes.issues ?? [],
  }));
}

// ─────────────────────────────────────────────
// Variant patches (single — direct, no operation)
// ─────────────────────────────────────────────

/** Patch stock of a single variant. Synchronous: HTTP response is the result. */
export async function ankorstorePatchVariantStock(
  variantId: string,
  body: { stockQuantity?: number; isAlwaysInStock?: boolean }
): Promise<void> {
  await ankorstoreFetchJson<unknown>(
    `/product-variants/${encodeURIComponent(variantId)}/stock`,
    {
      method: "PATCH",
      body: JSON.stringify({
        data: {
          type: "product-variants",
          id: variantId,
          attributes: body,
        },
      }),
    }
  );
}

/** Patch wholesale + retail prices of a single variant (both required, in cents). */
export async function ankorstorePatchVariantPrices(
  variantId: string,
  body: { wholesalePriceCents: number; retailPriceCents: number }
): Promise<void> {
  await ankorstoreFetchJson<unknown>(
    `/product-variants/${encodeURIComponent(variantId)}/prices`,
    {
      method: "PATCH",
      body: JSON.stringify({
        data: {
          type: "product-variants",
          id: variantId,
          attributes: {
            wholesalePrice: body.wholesalePriceCents,
            retailPrice: body.retailPriceCents,
          },
        },
      }),
    }
  );
}

// ─────────────────────────────────────────────
// Batch variant update (atomic operations, max 50)
// ─────────────────────────────────────────────

const BATCH_SIZE = 50;

/** Batch update variant attributes via JSON:API atomic operations. */
export async function ankorstoreBatchUpdateVariants(
  updates: { variantId: string; attributes: Record<string, unknown> }[]
): Promise<void> {
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const atomicOps = chunk.map(({ variantId, attributes }) => ({
      op: "update",
      data: {
        type: "product-variants",
        id: variantId,
        attributes,
      },
    }));

    await ankorstoreFetchJson<unknown>(`/operations`, {
      method: "POST",
      body: JSON.stringify({ "atomic:operations": atomicOps }),
    });
  }
}
