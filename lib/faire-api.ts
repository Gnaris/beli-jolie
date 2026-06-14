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

/**
 * Wrapper fetch avec retry simple sur 429/5xx (max 2 retries, backoff 500ms → 2s).
 * On reste très conservateur pour ne pas surcharger Faire — pas de chiffre
 * officiel sur les rate limits (voir docs/faire-api.md §15).
 *
 * Exporté car réutilisé par tous les modules d'écriture (publish/update/
 * delete/inventory) — un seul wrapper = un seul endroit où ajuster les
 * timings de backoff.
 */
export async function faireFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = await getFaireHeaders();
  const url = `${FAIRE_BASE_URL}${path}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    });
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt === 2) return res;
    const wait = 500 * Math.pow(2, attempt);
    logger.warn("[Faire] retry", { path, status: res.status, wait });
    await new Promise((r) => setTimeout(r, wait));
  }
  // unreachable mais TS l'exige
  return fetch(url, { ...init, headers });
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
