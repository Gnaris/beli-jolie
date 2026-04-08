# Ankorstore Product Mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable admin to map BJ products to Ankorstore products via auto-matching by reference + manual review UI.

**Architecture:** Prisma schema gets Ankorstore IDs on Product/ProductColor. OAuth2 credentials stored encrypted in SiteConfig (same as PFS). API client fetches Ankorstore catalog, matching engine extracts references from SKU/name/description, admin UI shows results with manual override.

**Tech Stack:** Next.js 16, Prisma 5.22, TypeScript, Tailwind v4, Server Actions, JSON:API

---

## File Structure

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | Add `ankorsProductId`, `ankorsMatchedAt` on Product; `ankorsVariantId` on ProductColor |
| `lib/encryption.ts` | Add `ankors_client_secret` to SENSITIVE_KEYS |
| `lib/cached-data.ts` | Add `getCachedAnkorstoreCredentials()` and `getCachedAnkorstoreEnabled()` |
| `lib/ankorstore-auth.ts` | OAuth2 token management (client_credentials grant) |
| `lib/ankorstore-api.ts` | Read-only API client (fetch products, variants) |
| `lib/ankorstore-match.ts` | Reference extraction + matching logic |
| `app/actions/admin/ankorstore.ts` | Server actions (credentials, matching, manual association) |
| `app/(admin)/admin/ankorstore/page.tsx` | Server component page |
| `components/admin/ankorstore/AnkorstoreMappingClient.tsx` | Client component — config + dashboard + tabs |
| `components/admin/settings/MarketplaceConfig.tsx` | Add Ankorstore credentials section |
| `app/(admin)/admin/parametres/page.tsx` | Load Ankorstore config in MarketplacesTab |
| `app/(admin)/layout.tsx` | Add Ankorstore nav link |

---

### Task 1: Prisma Schema — Add Ankorstore fields

**Files:**
- Modify: `prisma/schema.prisma:303` (Product model)
- Modify: `prisma/schema.prisma:437` (ProductColor model)

- [ ] **Step 1: Add fields to Product model**

In `prisma/schema.prisma`, after `pfsSyncedAt` (line 306), add:

```prisma
  ankorsProductId        String?               @unique // UUID produit Ankorstore
  ankorsMatchedAt        DateTime?             // Date du matching
```

- [ ] **Step 2: Add field to ProductColor model**

In `prisma/schema.prisma`, after `sku` (line 437), add:

```prisma
  ankorsVariantId     String?                @unique // UUID variante Ankorstore
```

- [ ] **Step 3: Push schema and regenerate client**

```bash
npx prisma db push --accept-data-loss
npx prisma generate
```

Expected: Schema changes applied, all new fields are nullable so no data loss. `--accept-data-loss` needed for new unique constraints on nullable columns.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add Ankorstore product/variant ID fields"
```

---

### Task 2: Encryption — Register Ankorstore secret key

**Files:**
- Modify: `lib/encryption.ts:16-26`

- [ ] **Step 1: Add ankors_client_secret to SENSITIVE_KEYS**

In `lib/encryption.ts`, add `"ankors_client_secret"` to the `SENSITIVE_KEYS` set:

```typescript
export const SENSITIVE_KEYS = new Set([
  "stripe_secret_key",
  "stripe_webhook_secret",
  "stripe_publishable_key",
  "easy_express_api_key",
  "gmail_app_password",
  "deepl_api_key",
  "pfs_email",
  "pfs_password",
  "stripe_connect_account_id",
  "ankors_client_secret",
]);
```

- [ ] **Step 2: Commit**

```bash
git add lib/encryption.ts
git commit -m "feat(encryption): add ankors_client_secret to sensitive keys"
```

---

### Task 3: Cached Data — Ankorstore credential helpers

**Files:**
- Modify: `lib/cached-data.ts` (after PFS credentials section, ~line 208)

- [ ] **Step 1: Add getCachedAnkorstoreEnabled**

After the `getCachedPfsCredentials` block (~line 208), add:

```typescript
// ─── Ankorstore enabled check ──────────────────────────────────────────────
export const getCachedAnkorstoreEnabled = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["ankors_client_id", "ankors_enabled"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map(r => [r.key, r.value]));
    const hasClientId = map.has("ankors_client_id");
    const enabled = map.get("ankors_enabled");
    return hasClientId && enabled === "true";
  },
  ["ankors-enabled"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── Ankorstore credentials (from SiteConfig) ─────────────────────────────
export const getCachedAnkorstoreCredentials = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
    });
    const map = new Map(rows.map(r => [r.key, decryptIfSensitive(r.key, r.value)]));
    return {
      clientId: map.get("ankors_client_id") ?? null,
      clientSecret: map.get("ankors_client_secret") ?? null,
    };
  },
  ["ankors-credentials"],
  { revalidate: 300, tags: ["site-config"] }
);
```

- [ ] **Step 2: Commit**

```bash
git add lib/cached-data.ts
git commit -m "feat(cache): add Ankorstore credential and enabled cache helpers"
```

---

### Task 4: Auth — Ankorstore OAuth2 token management

**Files:**
- Create: `lib/ankorstore-auth.ts`

- [ ] **Step 1: Create the auth module**

```typescript
/**
 * Ankorstore OAuth2 Authentication
 *
 * Manages Bearer token with in-memory cache.
 * Auto-refreshes 5 minutes before expiration.
 * Credentials read from admin settings (SiteConfig).
 */

import { getCachedAnkorstoreCredentials } from "@/lib/cached-data";
import { logger } from "@/lib/logger";

const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";
const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix ms
}

let cachedToken: TokenCache | null = null;

/**
 * Get a valid Ankorstore Bearer token.
 * Returns cached token if still valid (with 5-min buffer), otherwise re-authenticates.
 */
export async function getAnkorstoreToken(): Promise<string> {
  const bufferMs = 5 * 60 * 1000;
  if (cachedToken && cachedToken.expiresAt - bufferMs > Date.now()) {
    return cachedToken.accessToken;
  }

  const creds = await getCachedAnkorstoreCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error("Identifiants Ankorstore manquants — configurer dans Parametres > Marketplaces");
  }

  const res = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: "*",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ankorstore auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Ankorstore auth response missing access_token");
  }

  const expiresIn = (data.expires_in ?? 3600) * 1000;
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn,
  };

  logger.info("[Ankorstore] Token obtained, expires in %ds", data.expires_in ?? 3600);
  return cachedToken.accessToken;
}

/** Invalidate the cached token (e.g., after a 401 response). */
export function invalidateAnkorstoreToken(): void {
  cachedToken = null;
}

/** Get standard headers for Ankorstore API requests. */
export async function getAnkorstoreHeaders(): Promise<Record<string, string>> {
  const token = await getAnkorstoreToken();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
  };
}

/**
 * Validate credentials without caching the token.
 * Used by the settings UI "Test connection" button.
 */
export async function testAnkorstoreCredentials(
  clientId: string,
  clientSecret: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(ANKORSTORE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "*",
      }),
    });
    if (!res.ok) return { valid: false, error: `Erreur d'authentification (${res.status})` };
    const data = await res.json();
    if (!data.access_token) return { valid: false, error: "Reponse invalide (pas de token)." };
    return { valid: true };
  } catch {
    return { valid: false, error: "Impossible de contacter Ankorstore." };
  }
}

export { ANKORSTORE_BASE_URL };
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-auth.ts
git commit -m "feat: add Ankorstore OAuth2 auth module"
```

---

### Task 5: API Client — Fetch Ankorstore catalog

**Files:**
- Create: `lib/ankorstore-api.ts`

- [ ] **Step 1: Create the API client**

```typescript
/**
 * Ankorstore API Client (read-only)
 *
 * JSON:API format. Cursor-based pagination.
 * Rate limit: 600 req/min.
 */

import { getAnkorstoreHeaders, invalidateAnkorstoreToken, ANKORSTORE_BASE_URL } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnkorstoreVariant {
  id: string;
  sku: string | null;
  name: string | null;
  ian: string | null;
  retailPrice: number | null;
  wholesalePrice: number | null;
  availableQuantity: number | null;
  images: { order: number; url: string }[];
}

export interface AnkorstoreProduct {
  id: string;
  name: string;
  description: string | null;
  images: { order: number; url: string }[];
  active: boolean;
  archived: boolean;
  variants: AnkorstoreVariant[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function ankorstoreFetch(path: string, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const headers = await getAnkorstoreHeaders();
    const res = await fetch(`${ANKORSTORE_BASE_URL}${path}`, { headers });

    if (res.status === 401 && attempt === 1) {
      invalidateAnkorstoreToken();
      continue;
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
      logger.warn("[Ankorstore] Rate limited, waiting %ds", retryAfter);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (res.status >= 500 && attempt < retries) {
      const wait = Math.min(1000 * 2 ** (attempt - 1), 10000);
      logger.warn("[Ankorstore] Server error %d, retry in %dms", res.status, wait);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    return res;
  }

  throw new Error("Ankorstore API: max retries exceeded");
}

function parseProduct(data: Record<string, unknown>, includedMap: Map<string, Record<string, unknown>>): AnkorstoreProduct {
  const attrs = data.attributes as Record<string, unknown>;
  const rels = (data.relationships ?? {}) as Record<string, unknown>;

  // Resolve included variants
  const variantRefs = ((rels.productVariant as Record<string, unknown>)?.data ?? []) as { id: string; type: string }[];
  const variants: AnkorstoreVariant[] = variantRefs
    .map(ref => {
      const included = includedMap.get(`${ref.type}:${ref.id}`);
      if (!included) return null;
      const va = included.attributes as Record<string, unknown>;
      return {
        id: ref.id,
        sku: (va.sku as string) ?? null,
        name: (va.name as string) ?? null,
        ian: (va.ian as string) ?? null,
        retailPrice: (va.retailPrice as number) ?? null,
        wholesalePrice: (va.wholesalePrice as number) ?? null,
        availableQuantity: (va.availableQuantity as number) ?? null,
        images: (va.images as { order: number; url: string }[]) ?? [],
      };
    })
    .filter((v): v is AnkorstoreVariant => v !== null);

  return {
    id: data.id as string,
    name: (attrs.name as string) ?? "",
    description: (attrs.description as string) ?? null,
    images: (attrs.images as { order: number; url: string }[]) ?? [],
    active: (attrs.active as boolean) ?? false,
    archived: (attrs.archived as boolean) ?? false,
    variants,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch ALL Ankorstore products with their variants.
 * Uses cursor-based pagination (page[limit]=50).
 * Calls onProgress with (fetched, total) for UI feedback.
 */
export async function ankorstoreFetchAllProducts(
  onProgress?: (fetched: number, estimated: number) => void
): Promise<AnkorstoreProduct[]> {
  const products: AnkorstoreProduct[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    page++;
    let path = "/products?include=productVariant&page[limit]=50";
    if (cursor) path += `&page[after]=${cursor}`;

    const res = await ankorstoreFetch(path);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ankorstore fetch products failed (${res.status}): ${text}`);
    }

    const json = await res.json();
    const dataArray = (json.data ?? []) as Record<string, unknown>[];
    const included = (json.included ?? []) as Record<string, unknown>[];

    // Build lookup map for included resources
    const includedMap = new Map<string, Record<string, unknown>>();
    for (const item of included) {
      includedMap.set(`${item.type}:${item.id}`, item);
    }

    for (const item of dataArray) {
      products.push(parseProduct(item, includedMap));
    }

    const meta = json.meta?.page as { hasMore?: boolean; to?: string } | undefined;
    onProgress?.(products.length, products.length + (meta?.hasMore ? 50 : 0));

    if (!meta?.hasMore || !meta.to) break;
    cursor = meta.to;

    if (page % 50 === 0) {
      logger.info("[Ankorstore] Fetched %d products so far...", products.length);
    }
  }

  logger.info("[Ankorstore] Fetched %d products total", products.length);
  return products;
}

/** Fetch a single Ankorstore product by ID with variants. */
export async function ankorstoreFetchProduct(productId: string): Promise<AnkorstoreProduct | null> {
  const res = await ankorstoreFetch(`/products/${productId}?include=productVariant`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ankorstore fetch product failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const included = (json.included ?? []) as Record<string, unknown>[];
  const includedMap = new Map<string, Record<string, unknown>>();
  for (const item of included) {
    includedMap.set(`${item.type}:${item.id}`, item);
  }

  return parseProduct(json.data as Record<string, unknown>, includedMap);
}

/** Search Ankorstore variants by SKU or name. */
export async function ankorstoreSearchVariants(
  filter: { sku?: string; skuOrName?: string }
): Promise<AnkorstoreVariant[]> {
  const params = new URLSearchParams();
  if (filter.sku) params.set("filter[sku]", filter.sku);
  if (filter.skuOrName) params.set("filter[skuOrName]", filter.skuOrName);

  const res = await ankorstoreFetch(`/product-variants?${params}`);
  if (!res.ok) return [];

  const json = await res.json();
  return ((json.data ?? []) as Record<string, unknown>[]).map(item => {
    const attrs = item.attributes as Record<string, unknown>;
    return {
      id: item.id as string,
      sku: (attrs.sku as string) ?? null,
      name: (attrs.name as string) ?? null,
      ian: (attrs.ian as string) ?? null,
      retailPrice: (attrs.retailPrice as number) ?? null,
      wholesalePrice: (attrs.wholesalePrice as number) ?? null,
      availableQuantity: (attrs.availableQuantity as number) ?? null,
      images: (attrs.images as { order: number; url: string }[]) ?? [],
    };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-api.ts
git commit -m "feat: add Ankorstore read-only API client"
```

---

### Task 6: Matching Engine — Extract references and match products

**Files:**
- Create: `lib/ankorstore-match.ts`

- [ ] **Step 1: Create the matching module**

```typescript
/**
 * Ankorstore ↔ BJ Product Matching Engine
 *
 * Extracts product references from Ankorstore SKUs, names, and descriptions,
 * then matches against BJ Product.reference.
 */

import type { AnkorstoreProduct, AnkorstoreVariant } from "@/lib/ankorstore-api";
import { logger } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchStatus = "matched" | "ambiguous" | "unmatched";

export interface VariantMatchPair {
  ankorstoreVariantId: string;
  ankorstoreVariantSku: string | null;
  ankorstoreVariantName: string | null;
  productColorId: string | null; // null = not matched
}

export interface MatchResult {
  ankorstoreProductId: string;
  ankorstoreProductName: string;
  ankorstoreImageUrl: string | null;
  ankorstoreVariants: { id: string; sku: string | null; name: string | null }[];
  extractedReference: string | null;
  status: MatchStatus;
  bjProductId: string | null;
  bjProductName: string | null;
  bjReference: string | null;
  variantMatches: VariantMatchPair[];
}

export interface MatchReport {
  matched: number;
  ambiguous: number;
  unmatched: number;
  results: MatchResult[];
}

interface BjProduct {
  id: string;
  name: string;
  reference: string;
  colors: { id: string; colorName: string | null }[];
}

// ─── Reference extraction ─────────────────────────────────────────────────────

/**
 * Extract a BJ product reference from an Ankorstore product using cascade:
 * 1. First variant SKU: format "{reference}_{couleur}" → first segment
 * 2. Product name: format "{titre} - {reference}" → last segment after " - "
 * 3. Description: regex "Référence : {reference}" or "Reference : {reference}"
 */
export function extractReference(product: AnkorstoreProduct): string | null {
  // Strategy 1: SKU of first variant
  for (const v of product.variants) {
    if (v.sku) {
      const firstUnderscore = v.sku.indexOf("_");
      if (firstUnderscore > 0) {
        return v.sku.substring(0, firstUnderscore).trim();
      }
      // SKU without underscore — might be the reference itself
      return v.sku.trim();
    }
  }

  // Strategy 2: Product name "{titre} - {reference}"
  if (product.name) {
    const dashIdx = product.name.lastIndexOf(" - ");
    if (dashIdx > 0) {
      const candidate = product.name.substring(dashIdx + 3).trim();
      if (candidate.length > 0 && candidate.length <= 50) {
        return candidate;
      }
    }
  }

  // Strategy 3: Description "Référence : {reference}"
  if (product.description) {
    const match = product.description.match(/[Rr][ée]f[ée]rence\s*:\s*([^\n\r<]+)/);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

// ─── Color name normalization ─────────────────────────────────────────────────

function normalizeForCompare(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

// ─── Variant matching ─────────────────────────────────────────────────────────

function matchVariants(
  ankorstoreVariants: AnkorstoreVariant[],
  bjColors: { id: string; colorName: string | null }[],
  reference: string
): VariantMatchPair[] {
  return ankorstoreVariants.map(av => {
    let matchedColorId: string | null = null;

    if (av.sku) {
      // Extract color part from SKU: "{reference}_{couleur}"
      const prefix = reference + "_";
      const skuUpper = av.sku.toUpperCase();
      const refUpper = prefix.toUpperCase();

      if (skuUpper.startsWith(refUpper)) {
        const colorPart = normalizeForCompare(av.sku.substring(prefix.length));

        for (const bjColor of bjColors) {
          if (bjColor.colorName && normalizeForCompare(bjColor.colorName) === colorPart) {
            matchedColorId = bjColor.id;
            break;
          }
        }
      }
    }

    return {
      ankorstoreVariantId: av.id,
      ankorstoreVariantSku: av.sku,
      ankorstoreVariantName: av.name,
      productColorId: matchedColorId,
    };
  });
}

// ─── Main matching function ───────────────────────────────────────────────────

/**
 * Run auto-matching between Ankorstore products and BJ products.
 *
 * @param ankorstoreProducts - Full Ankorstore catalog
 * @param bjProducts - BJ products with their color variants
 */
export function runAutoMatch(
  ankorstoreProducts: AnkorstoreProduct[],
  bjProducts: BjProduct[]
): MatchReport {
  // Build reference lookup: reference (uppercase) → BjProduct[]
  const refMap = new Map<string, BjProduct[]>();
  for (const p of bjProducts) {
    const key = p.reference.trim().toUpperCase();
    const existing = refMap.get(key);
    if (existing) {
      existing.push(p);
    } else {
      refMap.set(key, [p]);
    }
  }

  const results: MatchResult[] = [];
  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const ap of ankorstoreProducts) {
    const ref = extractReference(ap);
    const firstImage = ap.images.sort((a, b) => a.order - b.order)[0]?.url ?? null;

    if (!ref) {
      unmatched++;
      results.push({
        ankorstoreProductId: ap.id,
        ankorstoreProductName: ap.name,
        ankorstoreImageUrl: firstImage,
        ankorstoreVariants: ap.variants.map(v => ({ id: v.id, sku: v.sku, name: v.name })),
        extractedReference: null,
        status: "unmatched",
        bjProductId: null,
        bjProductName: null,
        bjReference: null,
        variantMatches: ap.variants.map(v => ({
          ankorstoreVariantId: v.id,
          ankorstoreVariantSku: v.sku,
          ankorstoreVariantName: v.name,
          productColorId: null,
        })),
      });
      continue;
    }

    const refKey = ref.trim().toUpperCase();
    const candidates = refMap.get(refKey);

    if (!candidates || candidates.length === 0) {
      unmatched++;
      results.push({
        ankorstoreProductId: ap.id,
        ankorstoreProductName: ap.name,
        ankorstoreImageUrl: firstImage,
        ankorstoreVariants: ap.variants.map(v => ({ id: v.id, sku: v.sku, name: v.name })),
        extractedReference: ref,
        status: "unmatched",
        bjProductId: null,
        bjProductName: null,
        bjReference: null,
        variantMatches: ap.variants.map(v => ({
          ankorstoreVariantId: v.id,
          ankorstoreVariantSku: v.sku,
          ankorstoreVariantName: v.name,
          productColorId: null,
        })),
      });
    } else if (candidates.length === 1) {
      matched++;
      const bj = candidates[0];
      results.push({
        ankorstoreProductId: ap.id,
        ankorstoreProductName: ap.name,
        ankorstoreImageUrl: firstImage,
        ankorstoreVariants: ap.variants.map(v => ({ id: v.id, sku: v.sku, name: v.name })),
        extractedReference: ref,
        status: "matched",
        bjProductId: bj.id,
        bjProductName: bj.name,
        bjReference: bj.reference,
        variantMatches: matchVariants(ap.variants, bj.colors, ref),
      });
    } else {
      ambiguous++;
      results.push({
        ankorstoreProductId: ap.id,
        ankorstoreProductName: ap.name,
        ankorstoreImageUrl: firstImage,
        ankorstoreVariants: ap.variants.map(v => ({ id: v.id, sku: v.sku, name: v.name })),
        extractedReference: ref,
        status: "ambiguous",
        bjProductId: null,
        bjProductName: null,
        bjReference: null,
        variantMatches: ap.variants.map(v => ({
          ankorstoreVariantId: v.id,
          ankorstoreVariantSku: v.sku,
          ankorstoreVariantName: v.name,
          productColorId: null,
        })),
      });
    }
  }

  logger.info("[Ankorstore Match] %d matched, %d ambiguous, %d unmatched", matched, ambiguous, unmatched);
  return { matched, ambiguous, unmatched, results };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-match.ts
git commit -m "feat: add Ankorstore reference extraction and matching engine"
```

---

### Task 7: Server Actions — Ankorstore credentials and matching

**Files:**
- Create: `app/actions/admin/ankorstore.ts`
- Modify: `app/actions/admin/site-config.ts` (~line 308)

- [ ] **Step 1: Add credential actions to site-config.ts**

In `app/actions/admin/site-config.ts`, after the `validatePfsCredentials` function (~line 308), add:

```typescript
// ─── Ankorstore Configuration ─────────────────────────────────────────────────

export async function updateAnkorstoreCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { clientId, clientSecret } = config;

    const upsertOrDelete = (key: string, value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return prisma.siteConfig.deleteMany({ where: { key } });
      const stored = encryptIfSensitive(key, trimmed);
      return prisma.siteConfig.upsert({
        where: { key },
        update: { value: stored },
        create: { key, value: stored },
      });
    };

    await Promise.all([
      upsertOrDelete("ankors_client_id", clientId),
      upsertOrDelete("ankors_client_secret", clientSecret),
    ]);

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function toggleAnkorstoreEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.upsert({
      where: { key: "ankors_enabled" },
      update: { value: enabled ? "true" : "false" },
      create: { key: "ankors_enabled", value: enabled ? "true" : "false" },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function validateAnkorstoreCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<{ valid: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { testAnkorstoreCredentials } = await import("@/lib/ankorstore-auth");
    return await testAnkorstoreCredentials(config.clientId.trim(), config.clientSecret.trim());
  } catch {
    return { valid: false, error: "Impossible de contacter Ankorstore." };
  }
}
```

- [ ] **Step 2: Create the matching/association server actions**

Create `app/actions/admin/ankorstore.ts`:

```typescript
"use server";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ankorstoreFetchAllProducts } from "@/lib/ankorstore-api";
import { runAutoMatch, type MatchReport } from "@/lib/ankorstore-match";
import { revalidatePath } from "next/cache";

/**
 * Run auto-matching: fetch all Ankorstore products, match against BJ by reference.
 * Saves matched products to DB. Returns full report.
 */
export async function runAnkorstoreAutoMatch(): Promise<{
  success: boolean;
  report?: MatchReport;
  error?: string;
}> {
  try {
    await requireAdmin();

    // 1. Fetch Ankorstore catalog
    logger.info("[Ankorstore] Starting auto-match...");
    const ankorstoreProducts = await ankorstoreFetchAllProducts();

    // 2. Fetch BJ products with color variant names
    const bjProducts = await prisma.product.findMany({
      select: {
        id: true,
        name: true,
        reference: true,
        colors: {
          select: {
            id: true,
            color: { select: { name: true } },
            subColors: {
              orderBy: { position: "asc" },
              select: { color: { select: { name: true } } },
            },
          },
        },
      },
    });

    // Map to format expected by matching engine
    const bjForMatch = bjProducts.map(p => ({
      id: p.id,
      name: p.name,
      reference: p.reference,
      colors: p.colors.map(c => ({
        id: c.id,
        colorName: [c.color?.name, ...c.subColors.map(sc => sc.color.name)]
          .filter(Boolean)
          .join("/") || null,
      })),
    }));

    // 3. Run matching
    const report = runAutoMatch(ankorstoreProducts, bjForMatch);

    // 4. Persist matched results to DB
    const matchedResults = report.results.filter(r => r.status === "matched" && r.bjProductId);

    for (const result of matchedResults) {
      // Update Product with Ankorstore ID
      await prisma.product.update({
        where: { id: result.bjProductId! },
        data: {
          ankorsProductId: result.ankorstoreProductId,
          ankorsMatchedAt: new Date(),
        },
      });

      // Update matched variants
      for (const vm of result.variantMatches) {
        if (vm.productColorId) {
          await prisma.productColor.update({
            where: { id: vm.productColorId },
            data: { ankorsVariantId: vm.ankorstoreVariantId },
          });
        }
      }
    }

    logger.info(
      "[Ankorstore] Auto-match complete: %d matched, %d ambiguous, %d unmatched. %d saved to DB.",
      report.matched, report.ambiguous, report.unmatched, matchedResults.length
    );

    revalidatePath("/admin/ankorstore");
    return { success: true, report };
  } catch (e) {
    logger.error("[Ankorstore] Auto-match failed:", e);
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/** Manually associate a BJ product with an Ankorstore product. */
export async function confirmAnkorstoreMatch(
  ankorstoreProductId: string,
  bjProductId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.product.update({
      where: { id: bjProductId },
      data: {
        ankorsProductId: ankorstoreProductId,
        ankorsMatchedAt: new Date(),
      },
    });
    revalidatePath("/admin/ankorstore");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/** Remove the association between a BJ product and Ankorstore. */
export async function removeAnkorstoreMatch(
  bjProductId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    // Clear product association
    await prisma.product.update({
      where: { id: bjProductId },
      data: { ankorsProductId: null, ankorsMatchedAt: null },
    });

    // Clear variant associations
    await prisma.productColor.updateMany({
      where: { productId: bjProductId },
      data: { ankorsVariantId: null },
    });

    revalidatePath("/admin/ankorstore");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/** Manually associate a BJ variant with an Ankorstore variant. */
export async function confirmAnkorstoreVariantMatch(
  ankorstoreVariantId: string,
  productColorId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.productColor.update({
      where: { id: productColorId },
      data: { ankorsVariantId: ankorstoreVariantId },
    });
    revalidatePath("/admin/ankorstore");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/** Search BJ products by reference or name (for manual mapping UI). */
export async function searchBjProducts(
  query: string
): Promise<{ id: string; name: string; reference: string }[]> {
  try {
    await requireAdmin();
    if (!query.trim()) return [];

    return prisma.product.findMany({
      where: {
        OR: [
          { reference: { contains: query.trim() } },
          { name: { contains: query.trim() } },
        ],
      },
      select: { id: true, name: true, reference: true },
      take: 20,
    });
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/actions/admin/ankorstore.ts app/actions/admin/site-config.ts
git commit -m "feat: add Ankorstore server actions (credentials, auto-match, manual mapping)"
```

---

### Task 8: Settings UI — Add Ankorstore credentials to MarketplaceConfig

**Files:**
- Modify: `components/admin/settings/MarketplaceConfig.tsx`
- Modify: `app/(admin)/admin/parametres/page.tsx:314-332`

- [ ] **Step 1: Update MarketplaceConfig props and add Ankorstore section**

Replace the entire `components/admin/settings/MarketplaceConfig.tsx` with the updated version that includes both PFS and Ankorstore sections. The Ankorstore section mirrors the PFS section but uses `client_id` / `client_secret` fields:

Add to the `Props` interface:

```typescript
interface Props {
  hasPfsConfig: boolean;
  pfsEnabled: boolean;
  hasAnkorsConfig: boolean;
  ankorsEnabled: boolean;
}
```

Add Ankorstore state, handlers, and JSX after the PFS section. The Ankorstore section should:
- Import `updateAnkorstoreCredentials`, `validateAnkorstoreCredentials`, `toggleAnkorstoreEnabled` from `site-config.ts`
- Have `ankorsClientId` and `ankorsClientSecret` state
- Have `ankorsStatus`, `ankorsEnabled`, `ankorsEditing` state (same pattern as PFS)
- Render the same UI pattern: status dot, toggle, masked credentials / edit form, test + save buttons

Add after the PFS `</div>` closing tag (line 215), before the outer `</div>`:

```tsx
      {/* ── Ankorstore ── */}
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="font-heading text-sm font-semibold text-text-primary">Ankorstore</h4>
            <span
              className={`w-2 h-2 rounded-full ${
                ankorsStatus === "valid" ? "bg-[#22C55E]" :
                ankorsStatus === "invalid" ? "bg-[#EF4444]" :
                ankorsStatus === "checking" ? "bg-[#F59E0B] animate-pulse" :
                "bg-[#D1D1D1]"
              }`}
            />
            <span className="font-body text-xs text-text-secondary">
              {ankorsStatus === "valid" && "Connecte"}
              {ankorsStatus === "invalid" && "Invalide"}
              {ankorsStatus === "checking" && "Verification..."}
              {ankorsStatus === "none" && "Non configure"}
            </span>
          </div>

          {hasAnkorsConfig && (
            <button
              type="button"
              role="switch"
              aria-checked={ankorsEnabledState}
              aria-label="Activer Ankorstore"
              disabled={isPendingAnkors}
              onClick={handleAnkorsToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 focus:ring-offset-2 disabled:opacity-50 ${
                ankorsEnabledState ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  ankorsEnabledState ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          )}
        </div>

        {!ankorsEditing && hasAnkorsConfig ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
              ••••••••••••••••
            </div>
            <button
              type="button"
              onClick={() => setAnkorsEditing(true)}
              className="text-sm font-body text-text-secondary hover:text-text-primary underline"
            >
              Modifier
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <input
                type="text"
                value={ankorsClientId}
                onChange={(e) => {
                  setAnkorsClientId(e.target.value);
                  if (ankorsStatus === "valid" || ankorsStatus === "invalid") setAnkorsStatus("none");
                }}
                placeholder="Client ID"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingAnkors}
                autoComplete="off"
              />
              <input
                type="password"
                value={ankorsClientSecret}
                onChange={(e) => {
                  setAnkorsClientSecret(e.target.value);
                  if (ankorsStatus === "valid" || ankorsStatus === "invalid") setAnkorsStatus("none");
                }}
                placeholder="Client Secret"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingAnkors}
                autoComplete="off"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAnkorsValidate}
                disabled={isPendingAnkors || !ankorsClientId.trim() || !ankorsClientSecret.trim()}
                className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
              >
                {isValidatingAnkors ? "Verification..." : "Tester la connexion"}
              </button>
              <button
                type="button"
                onClick={handleAnkorsSave}
                disabled={isPendingAnkors || !ankorsClientId.trim() || !ankorsClientSecret.trim() || ankorsStatus !== "valid"}
                className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {isSavingAnkors ? "Enregistrement..." : "Sauvegarder"}
              </button>
              {hasAnkorsConfig && (
                <button
                  type="button"
                  onClick={() => { setAnkorsEditing(false); setAnkorsClientId(""); setAnkorsClientSecret(""); setAnkorsStatus("valid"); }}
                  disabled={isPendingAnkors}
                  className="h-9 px-3 text-sm font-body text-text-secondary hover:text-text-primary"
                >
                  Annuler
                </button>
              )}
            </div>
          </>
        )}
      </div>
```

The state and handlers to add at the top of the component (after PFS state declarations):

```typescript
  // ── Ankorstore state ──
  const [ankorsClientId, setAnkorsClientId] = useState("");
  const [ankorsClientSecret, setAnkorsClientSecret] = useState("");
  const [ankorsStatus, setAnkorsStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasAnkorsConfig ? "valid" : "none"
  );
  const [ankorsEnabledState, setAnkorsEnabledState] = useState(ankorsEnabled);
  const [ankorsEditing, setAnkorsEditing] = useState(!hasAnkorsConfig);
  const [isSavingAnkors, startSavingAnkors] = useTransition();
  const [isValidatingAnkors, startValidatingAnkors] = useTransition();
  const [isTogglingAnkors, startTogglingAnkors] = useTransition();

  const isPendingAnkors = isSavingAnkors || isValidatingAnkors || isTogglingAnkors;
```

The handlers (mirror PFS handlers):

```typescript
  function handleAnkorsValidate() {
    if (!ankorsClientId.trim() || !ankorsClientSecret.trim()) return;
    showLoading();
    startValidatingAnkors(async () => {
      try {
        setAnkorsStatus("checking");
        const result = await validateAnkorstoreCredentials({
          clientId: ankorsClientId.trim(),
          clientSecret: ankorsClientSecret.trim(),
        });
        if (result.valid) {
          setAnkorsStatus("valid");
          toast.success("Connexion reussie", "Identifiants Ankorstore valides.");
        } else {
          setAnkorsStatus("invalid");
          toast.error("Connexion echouee", result.error ?? "Identifiants invalides.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleAnkorsSave() {
    showLoading();
    startSavingAnkors(async () => {
      try {
        const result = await updateAnkorstoreCredentials({
          clientId: ankorsClientId.trim(),
          clientSecret: ankorsClientSecret.trim(),
        });
        if (result.success) {
          toast.success("Enregistre", "Identifiants Ankorstore sauvegardes.");
          setAnkorsEditing(false);
          setAnkorsClientId("");
          setAnkorsClientSecret("");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleAnkorsToggle() {
    const newValue = !ankorsEnabledState;
    startTogglingAnkors(async () => {
      const result = await toggleAnkorstoreEnabled(newValue);
      if (result.success) {
        setAnkorsEnabledState(newValue);
        toast.success(
          newValue ? "Ankorstore active" : "Ankorstore desactive",
          newValue
            ? "L'integration Ankorstore est maintenant active."
            : "L'integration Ankorstore est desactivee."
        );
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }
```

Add the new imports at the top:

```typescript
import {
  updateAnkorstoreCredentials,
  validateAnkorstoreCredentials,
  toggleAnkorstoreEnabled,
} from "@/app/actions/admin/site-config";
```

- [ ] **Step 2: Update MarketplacesTab in page.tsx to pass Ankorstore config**

In `app/(admin)/admin/parametres/page.tsx`, update the `MarketplacesTab` function (~line 314):

```typescript
async function MarketplacesTab() {
  const [pfsConfig, pfsEnabledRow, ankorsConfig, ankorsEnabledRow] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "pfs_email" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "pfs_enabled" }, select: { value: true } }),
    prisma.siteConfig.findUnique({ where: { key: "ankors_client_id" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "ankors_enabled" }, select: { value: true } }),
  ]);

  return (
    <div className="max-w-xl">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Marketplaces</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Identifiants de connexion aux plateformes B2B.</p>
        <MarketplaceConfig
          hasPfsConfig={!!pfsConfig}
          pfsEnabled={pfsEnabledRow?.value === "true"}
          hasAnkorsConfig={!!ankorsConfig}
          ankorsEnabled={ankorsEnabledRow?.value === "true"}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/admin/settings/MarketplaceConfig.tsx app/(admin)/admin/parametres/page.tsx
git commit -m "feat(settings): add Ankorstore credentials section to Marketplaces tab"
```

---

### Task 9: Admin Page — Ankorstore mapping dashboard

**Files:**
- Create: `app/(admin)/admin/ankorstore/page.tsx`
- Create: `components/admin/ankorstore/AnkorstoreMappingClient.tsx`

- [ ] **Step 1: Create the server page**

Create `app/(admin)/admin/ankorstore/page.tsx`:

```typescript
import { prisma } from "@/lib/prisma";
import AnkorstoreMappingClient from "@/components/admin/ankorstore/AnkorstoreMappingClient";

export const metadata = { title: "Ankorstore" };

export default async function AnkorstorePage() {
  const [ankorsConfig, ankorsEnabledRow, matchedCount, totalProducts] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "ankors_client_id" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "ankors_enabled" }, select: { value: true } }),
    prisma.product.count({ where: { ankorsProductId: { not: null } } }),
    prisma.product.count(),
  ]);

  const isConfigured = !!ankorsConfig;
  const isEnabled = ankorsEnabledRow?.value === "true";

  // Fetch matched products for initial display
  const matchedProducts = isConfigured
    ? await prisma.product.findMany({
        where: { ankorsProductId: { not: null } },
        select: {
          id: true,
          name: true,
          reference: true,
          ankorsProductId: true,
          ankorsMatchedAt: true,
          colors: {
            select: {
              id: true,
              ankorsVariantId: true,
              color: { select: { name: true } },
            },
          },
        },
        orderBy: { ankorsMatchedAt: "desc" },
        take: 50,
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-text-primary">Ankorstore</h1>
        <p className="text-sm text-text-secondary font-body mt-1">
          Mapping des produits entre votre catalogue et Ankorstore.
        </p>
      </div>

      <AnkorstoreMappingClient
        isConfigured={isConfigured}
        isEnabled={isEnabled}
        matchedCount={matchedCount}
        totalProducts={totalProducts}
        initialMatches={matchedProducts}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create the client component**

Create `components/admin/ankorstore/AnkorstoreMappingClient.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import {
  runAnkorstoreAutoMatch,
  removeAnkorstoreMatch,
  confirmAnkorstoreMatch,
  searchBjProducts,
} from "@/app/actions/admin/ankorstore";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import type { MatchReport, MatchResult } from "@/lib/ankorstore-match";

interface MatchedProduct {
  id: string;
  name: string;
  reference: string;
  ankorsProductId: string | null;
  ankorsMatchedAt: Date | null;
  colors: {
    id: string;
    ankorsVariantId: string | null;
    color: { name: string } | null;
  }[];
}

interface Props {
  isConfigured: boolean;
  isEnabled: boolean;
  matchedCount: number;
  totalProducts: number;
  initialMatches: MatchedProduct[];
}

type Tab = "matched" | "review" | "unmatched";

export default function AnkorstoreMappingClient({
  isConfigured,
  isEnabled,
  matchedCount: initialMatchedCount,
  totalProducts,
  initialMatches,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("matched");
  const [matchedCount, setMatchedCount] = useState(initialMatchedCount);
  const [matches, setMatches] = useState(initialMatches);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [isRunning, startRunning] = useTransition();
  const [isRemoving, startRemoving] = useTransition();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; reference: string }[]>([]);
  const [isSearching, startSearching] = useTransition();
  const [associatingId, setAssociatingId] = useState<string | null>(null);

  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  if (!isConfigured || !isEnabled) {
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm text-center">
        <p className="text-sm text-text-secondary font-body">
          {!isConfigured
            ? "Ankorstore n'est pas configure. Ajoutez vos identifiants dans Parametres > Marketplaces."
            : "Ankorstore est desactive. Activez-le dans Parametres > Marketplaces."}
        </p>
      </div>
    );
  }

  function handleRunAutoMatch() {
    showLoading();
    startRunning(async () => {
      try {
        const result = await runAnkorstoreAutoMatch();
        if (result.success && result.report) {
          setReport(result.report);
          setMatchedCount(result.report.matched);
          toast.success(
            "Matching termine",
            `${result.report.matched} matches, ${result.report.ambiguous} ambigus, ${result.report.unmatched} non matches.`
          );
          if (result.report.matched > 0) setActiveTab("matched");
        } else {
          toast.error("Erreur", result.error ?? "Le matching a echoue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleRemoveMatch(bjProductId: string) {
    startRemoving(async () => {
      const result = await removeAnkorstoreMatch(bjProductId);
      if (result.success) {
        setMatches(prev => prev.filter(m => m.id !== bjProductId));
        setMatchedCount(prev => prev - 1);
        toast.success("Dissociation reussie", "Le produit a ete dissocie.");
      } else {
        toast.error("Erreur", result.error ?? "Erreur lors de la dissociation.");
      }
    });
  }

  function handleSearch(query: string) {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    startSearching(async () => {
      const results = await searchBjProducts(query);
      setSearchResults(results);
    });
  }

  async function handleManualAssociate(ankorstoreProductId: string, bjProductId: string) {
    setAssociatingId(ankorstoreProductId);
    const result = await confirmAnkorstoreMatch(ankorstoreProductId, bjProductId);
    setAssociatingId(null);
    if (result.success) {
      toast.success("Association reussie", "Produit associe.");
      // Move from review/unmatched to matched in report
      if (report) {
        setReport(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            results: prev.results.map(r =>
              r.ankorstoreProductId === ankorstoreProductId
                ? { ...r, status: "matched" as const, bjProductId }
                : r
            ),
          };
        });
      }
      setMatchedCount(prev => prev + 1);
    } else {
      toast.error("Erreur", result.error ?? "Erreur lors de l'association.");
    }
  }

  const reviewResults = report?.results.filter(r => r.status === "ambiguous") ?? [];
  const unmatchedResults = report?.results.filter(r => r.status === "unmatched") ?? [];

  const tabs: { key: Tab; label: string; count: number; badgeClass: string }[] = [
    { key: "matched", label: "Matches", count: matchedCount, badgeClass: "badge badge-success" },
    { key: "review", label: "A revoir", count: reviewResults.length, badgeClass: "badge badge-warning" },
    { key: "unmatched", label: "Non matches", count: unmatchedResults.length, badgeClass: "badge badge-error" },
  ];

  return (
    <div className="space-y-4">
      {/* Stats + Action */}
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-2xl font-heading font-bold text-text-primary">{matchedCount}</div>
              <div className="text-xs text-text-secondary font-body">produits matches</div>
            </div>
            <div>
              <div className="text-2xl font-heading font-bold text-text-primary">{totalProducts}</div>
              <div className="text-xs text-text-secondary font-body">produits BJ</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRunAutoMatch}
            disabled={isRunning}
            className="h-10 px-5 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {isRunning ? "Matching en cours..." : "Lancer le matching automatique"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-body font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-text-primary text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-2 ${tab.badgeClass}`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
        {activeTab === "matched" && (
          <MatchedTab
            matches={matches}
            onRemove={handleRemoveMatch}
            isRemoving={isRemoving}
          />
        )}
        {activeTab === "review" && (
          <ReviewTab
            results={reviewResults}
            searchQuery={searchQuery}
            searchResults={searchResults}
            onSearch={handleSearch}
            isSearching={isSearching}
            onAssociate={handleManualAssociate}
            associatingId={associatingId}
          />
        )}
        {activeTab === "unmatched" && (
          <ReviewTab
            results={unmatchedResults}
            searchQuery={searchQuery}
            searchResults={searchResults}
            onSearch={handleSearch}
            isSearching={isSearching}
            onAssociate={handleManualAssociate}
            associatingId={associatingId}
          />
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MatchedTab({
  matches,
  onRemove,
  isRemoving,
}: {
  matches: MatchedProduct[];
  onRemove: (id: string) => void;
  isRemoving: boolean;
}) {
  if (matches.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-text-secondary font-body">
        Aucun produit matche. Lancez le matching automatique pour commencer.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {matches.map(m => (
        <div key={m.id} className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-body text-sm font-medium text-text-primary truncate">{m.name}</div>
            <div className="font-body text-xs text-text-secondary">
              Ref: {m.reference} | Variantes: {m.colors.filter(c => c.ankorsVariantId).length}/{m.colors.length}
              {m.ankorsMatchedAt && (
                <> | {new Date(m.ankorsMatchedAt).toLocaleDateString("fr-FR")}</>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRemove(m.id)}
            disabled={isRemoving}
            className="text-xs font-body text-text-secondary hover:text-red-600 transition-colors disabled:opacity-50"
          >
            Dissocier
          </button>
        </div>
      ))}
    </div>
  );
}

function ReviewTab({
  results,
  searchQuery,
  searchResults,
  onSearch,
  isSearching,
  onAssociate,
  associatingId,
}: {
  results: MatchResult[];
  searchQuery: string;
  searchResults: { id: string; name: string; reference: string }[];
  onSearch: (q: string) => void;
  isSearching: boolean;
  onAssociate: (ankorstoreId: string, bjId: string) => void;
  associatingId: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (results.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-text-secondary font-body">
        Aucun produit dans cette categorie.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {results.map(r => (
        <div key={r.ankorstoreProductId} className="px-4 py-3">
          <div className="flex items-start gap-3">
            {r.ankorstoreImageUrl && (
              <img
                src={r.ankorstoreImageUrl}
                alt=""
                className="w-10 h-10 rounded-lg object-cover shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-body text-sm font-medium text-text-primary truncate">
                {r.ankorstoreProductName}
              </div>
              <div className="font-body text-xs text-text-secondary">
                {r.extractedReference ? `Ref extraite: ${r.extractedReference}` : "Pas de reference detectee"}
                {r.ankorstoreVariants.length > 0 && (
                  <> | {r.ankorstoreVariants.length} variante{r.ankorstoreVariants.length > 1 ? "s" : ""}</>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setExpandedId(expandedId === r.ankorstoreProductId ? null : r.ankorstoreProductId)}
              className="text-xs font-body text-text-secondary hover:text-text-primary underline shrink-0"
            >
              {expandedId === r.ankorstoreProductId ? "Fermer" : "Associer"}
            </button>
          </div>

          {expandedId === r.ankorstoreProductId && (
            <div className="mt-3 pl-13 space-y-2">
              <input
                type="text"
                value={searchQuery}
                onChange={e => onSearch(e.target.value)}
                placeholder="Rechercher un produit BJ (reference ou nom)..."
                className="w-full h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              />
              {isSearching && (
                <div className="text-xs text-text-secondary font-body">Recherche...</div>
              )}
              {searchResults.length > 0 && (
                <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                  {searchResults.map(sr => (
                    <button
                      key={sr.id}
                      type="button"
                      onClick={() => onAssociate(r.ankorstoreProductId, sr.id)}
                      disabled={associatingId === r.ankorstoreProductId}
                      className="w-full text-left px-3 py-2 hover:bg-bg-secondary transition-colors disabled:opacity-50"
                    >
                      <div className="font-body text-sm text-text-primary">{sr.name}</div>
                      <div className="font-body text-xs text-text-secondary">Ref: {sr.reference}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/admin/ankorstore/page.tsx components/admin/ankorstore/AnkorstoreMappingClient.tsx
git commit -m "feat: add Ankorstore mapping admin page with auto-match and manual review"
```

---

### Task 10: Admin Sidebar — Add Ankorstore navigation link

**Files:**
- Modify: `app/(admin)/layout.tsx:203-337`

- [ ] **Step 1: Add Ankorstore to admin nav**

In `app/(admin)/layout.tsx`, add a new "Marketplaces" section to `ADMIN_NAV_SECTIONS_BASE` after the "Catalogue" section (~line 249, before the "Ventes" section). Insert:

```typescript
  {
    title: "Marketplaces",
    items: [
      {
        label: "Ankorstore",
        href: "/admin/ankorstore",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
          </svg>
        ),
      },
    ],
  },
```

- [ ] **Step 2: Commit**

```bash
git add "app/(admin)/layout.tsx"
git commit -m "feat(nav): add Ankorstore link to admin sidebar"
```

---

### Task 11: Final Integration — Test and verify

- [ ] **Step 1: Run Prisma generate to ensure schema compiles**

```bash
npx prisma generate
```

Expected: Success, no errors.

- [ ] **Step 2: Run TypeScript type check**

```bash
npx next build
```

Expected: Build succeeds. Fix any type errors if present.

- [ ] **Step 3: Verify the settings page renders**

Start dev server with `npm run dev`, navigate to `/admin/parametres`, click "Marketplaces" tab. Verify both PFS and Ankorstore credential sections render.

- [ ] **Step 4: Verify the Ankorstore page renders**

Navigate to `/admin/ankorstore`. Without credentials configured, should show "Ankorstore n'est pas configure" message.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve integration issues from Ankorstore mapping feature"
```
