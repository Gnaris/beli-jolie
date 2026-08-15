/**
 * Faire API — lectures (list / get produit / get commandes).
 *
 * Endpoints validés en réel le 2026-06-12 sur compte brand vide (voir
 * docs/faire-api.md §4, §5, §11).
 *
 * Limites strictes côté Faire :
 * - `/products?limit=N`  → 10 ≤ N ≤ 250
 * - `/orders?limit=N`    → 10 ≤ N ≤ 50
 * Hors plage = HTTP 400 explicite.
 */

import { FAIRE_BASE_URL, getFaireHeaders } from "@/lib/faire-auth";
import { logger } from "@/lib/logger";

const MIN_PRODUCT_LIMIT = 10;
const MAX_PRODUCT_LIMIT = 250;
const MIN_ORDER_LIMIT = 10;
const MAX_ORDER_LIMIT = 50;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

const MAX_FAIRE_ATTEMPTS = 5;
const FAIRE_MAX_RETRY_DELAY_MS = 300_000;

/**
 * Calcule le délai avant le prochain essai pour une réponse HTTP à rejouer.
 *
 * Sur **429** (rate-limit Cloudflare 1015 côté Faire) : le blocage dure 30–60s
 * en pratique. On respecte `Retry-After` si présent (secondes OU date HTTP),
 * sinon on applique un backoff long : 30s / 60s / 90s / 120s. Cap à 5 min.
 *
 * Sur **5xx** : backoff court exponentiel 500ms → 8s.
 */
export function computeFaireRetryDelayMs(response: Response, attempt: number): number {
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, FAIRE_MAX_RETRY_DELAY_MS);
      }
      const dateMs = Date.parse(retryAfter);
      if (!Number.isNaN(dateMs)) {
        return Math.max(0, Math.min(dateMs - Date.now(), FAIRE_MAX_RETRY_DELAY_MS));
      }
    }
    return Math.min((attempt + 1) * 30_000, 120_000);
  }
  return 500 * Math.pow(2, attempt);
}

/**
 * Wrapper fetch avec retry sur 429/5xx **ET** sur erreurs réseau.
 *
 * - 5 tentatives max (1 essai + 4 retries).
 * - **429** : backoff long (30–120s ou `Retry-After`) pour laisser Cloudflare
 *   1015 se relâcher. L'ancien backoff 500ms→2s laissait 14/20 jobs FAIRE en
 *   échec lors d'un refresh en masse (incident 2026-08-15).
 * - **5xx** : backoff court exponentiel 500ms → 8s.
 * - **Erreur réseau** (undici `TypeError: fetch failed` — ECONNRESET,
 *   socket hang up, DNS ponctuel) : backoff court 500ms → 8s. La cause bas
 *   niveau (`err.cause.code`) est propagée dans le message final quand tous
 *   les retries ont échoué (incidents 2026-08-02 sur issyma JG41 / JG53).
 *
 * Exporté car réutilisé par tous les modules d'écriture (publish/update/
 * delete/inventory) — un seul wrapper = un seul endroit où ajuster les
 * timings de backoff.
 */
export async function faireFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = await getFaireHeaders();
  const url = `${FAIRE_BASE_URL}${path}`;
  const mergedInit = {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  } satisfies RequestInit;

  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt < MAX_FAIRE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, mergedInit);
      if (res.status !== 429 && res.status < 500) return res;
      if (attempt === MAX_FAIRE_ATTEMPTS - 1) return res;
      const wait = computeFaireRetryDelayMs(res, attempt);
      logger.warn("[Faire] retry", { path, status: res.status, attempt, wait });
      await new Promise((r) => setTimeout(r, wait));
    } catch (err) {
      // Erreur réseau (undici : TypeError: fetch failed). Extraire la cause
      // bas niveau (code: 'UND_ERR_SOCKET' / 'ECONNRESET' / 'EAI_AGAIN' / …).
      lastNetworkError = err;
      const causeObj = (err as { cause?: unknown }).cause;
      const causeCode = causeObj instanceof Error
        ? (causeObj as Error & { code?: string }).code ?? causeObj.name
        : undefined;
      if (attempt === MAX_FAIRE_ATTEMPTS - 1) {
        logger.error("[Faire] fetch network error (retries épuisés)", {
          path,
          attempt,
          message: err instanceof Error ? err.message : String(err),
          cause: causeCode,
        });
        // Re-throw en enrichissant le message pour que l'UI ne voie plus
        // « fetch failed » brut mais bien la cause réseau.
        if (err instanceof Error && causeCode) {
          err.message = `${err.message} (${causeCode})`;
        }
        throw err;
      }
      const wait = 500 * Math.pow(2, attempt);
      logger.warn("[Faire] retry (network)", { path, attempt, cause: causeCode, wait });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  // Boucle épuisée sans retour ni throw : impossible en pratique, mais TS
  // exige un chemin de sortie.
  if (lastNetworkError !== null) throw lastNetworkError;
  return fetch(url, mergedInit);
}

export interface FaireProductListResponse {
  page: number;
  limit: number;
  products: FaireProduct[];
}

export interface FaireProduct {
  id: string;
  brand_id?: string;
  name: string;
  short_description?: string;
  description?: string;
  wholesale_price_cents?: number;
  retail_price_cents?: number;
  sale_state?: "FOR_SALE" | "SALES_PAUSED";
  lifecycle_state?: "DRAFT" | "PUBLISHED" | "RETIRED";
  taxonomy_type?: { id: string; name?: string };
  variants?: FaireVariant[];
  created_at?: string;
  updated_at?: string;
}

export interface FaireVariant {
  id?: string;
  sku: string;
  name?: string;
  wholesale_price_cents?: number;
  retail_price_cents?: number;
  available_quantity?: number;
  active?: boolean;
  options?: { name: string; value: string }[];
  images?: { url: string }[];
  /** Bloc mesurements moderne (poids en grammes, dimensions en cm). */
  measurements?: {
    weight?: number;
    mass_unit?: "GRAMS" | "KILOGRAMS";
    length?: number;
    width?: number;
    height?: number;
    distance_unit?: "CENTIMETERS" | "INCHES";
  };
  /** Prix moderne par région (geo_constraint). Remplace wholesale/retail_price_cents dépréciés.
   *  ⚠️ Shape plat côté GET (`ExternalProductVariantV2.Price`) — à ne pas confondre
   *  avec le shape imbriqué `prices[].prices[]` utilisé côté PATCH `product-prices/by-*`. */
  prices?: Array<{
    geo_constraint?: { country_group?: string; country?: string };
    wholesale_price?: { amount_minor?: number; currency?: string };
    retail_price?: { amount_minor?: number; currency?: string };
  }>;
  lifecycle_state?: string;
}

/**
 * Liste paginée des produits de notre catalogue Faire.
 * `page` 1-based ; `limit` clampé à [10, 250].
 */
export async function faireListProducts(
  page = 1,
  limit = 50
): Promise<FaireProductListResponse> {
  const safeLimit = clamp(limit, MIN_PRODUCT_LIMIT, MAX_PRODUCT_LIMIT);
  const safePage = Math.max(1, Math.floor(page));
  const res = await faireFetch(`/products?page=${safePage}&limit=${safeLimit}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Faire] listProducts failed", {
      status: res.status,
      body: text.slice(0, 300),
    });
    throw new Error(`Faire listProducts HTTP ${res.status}`);
  }
  return (await res.json()) as FaireProductListResponse;
}

/**
 * Récupère un produit Faire par son ID ("p_xxx").
 * Retourne null si 404.
 */
export async function faireGetProduct(id: string): Promise<FaireProduct | null> {
  const res = await faireFetch(`/products/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Faire] getProduct failed", {
      id,
      status: res.status,
      body: text.slice(0, 300),
    });
    throw new Error(`Faire getProduct HTTP ${res.status}`);
  }
  return (await res.json()) as FaireProduct;
}

export interface FaireOrderListResponse {
  page: number;
  limit: number;
  orders: FaireOrder[];
}

export interface FaireOrder {
  id: string;
  display_id?: string;
  state?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Liste paginée des commandes Faire.
 * `limit` clampé à [10, 50] (limite stricte Faire — voir docs §11).
 */
export async function faireListOrders(
  page = 1,
  limit = 50,
  updatedAtMin?: string
): Promise<FaireOrderListResponse> {
  const safeLimit = clamp(limit, MIN_ORDER_LIMIT, MAX_ORDER_LIMIT);
  const safePage = Math.max(1, Math.floor(page));
  let path = `/orders?page=${safePage}&limit=${safeLimit}`;
  if (updatedAtMin) path += `&updated_at_min=${encodeURIComponent(updatedAtMin)}`;
  const res = await faireFetch(path);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Faire] listOrders failed", {
      status: res.status,
      body: text.slice(0, 300),
    });
    throw new Error(`Faire listOrders HTTP ${res.status}`);
  }
  return (await res.json()) as FaireOrderListResponse;
}

/**
 * Ping léger — vérifie que la clé API fonctionne en faisant un GET /products
 * avec le limit minimum. Retourne `{ ok, count }` pour usage UI (bouton
 * "Tester la connexion").
 */
export async function fairePing(): Promise<{ ok: boolean; productCount?: number; error?: string }> {
  try {
    const data = await faireListProducts(1, MIN_PRODUCT_LIMIT);
    return { ok: true, productCount: data.products.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}
