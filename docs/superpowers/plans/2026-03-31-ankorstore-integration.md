# Ankorstore Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bidirectional product sync between the BJ platform and Ankorstore marketplace (import AK→BJ + reverse sync BJ→AK), following the same patterns as the existing PFS integration.

**Architecture:** Copy-adapt PFS pattern — separate `lib/ankorstore-*.ts` files, new Prisma models, new admin pages at `/admin/ankorstore/`. No shared marketplace abstraction. OAuth2 auth (not email/password). JSON:API format (not REST). Cursor pagination (not page numbers).

**Tech Stack:** Next.js 16, Prisma 5.22, TypeScript, Tailwind v4, NextAuth v4. Ankorstore API v1 (JSON:API, OAuth2 client_credentials).

**Reference docs:**
- `docs/ankorstore-system.md` — Full API documentation with tested endpoints
- `docs/superpowers/specs/2026-03-31-ankorstore-integration-design.md` — Design spec

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | Modify | Add AK fields to Product/ProductColor, new models |
| `lib/encryption.ts` | Modify | Add `ankorstore_client_secret` to SENSITIVE_KEYS |
| `lib/ankorstore-auth.ts` | Create | OAuth2 token cache + base fetch helper |
| `lib/ankorstore-api.ts` | Create | Read API (list products, get variant) |
| `lib/ankorstore-api-write.ts` | Create | Write API (PATCH stock, PATCH prices) |
| `lib/cached-data.ts` | Modify | Add AK credential/enabled cache functions |
| `lib/ankorstore-sync.ts` | Create | Import pipeline (AK → BJ) |
| `lib/ankorstore-reverse-sync.ts` | Create | Reverse sync (BJ → AK) fire-and-forget |
| `lib/ankorstore-analyze.ts` | Create | Pre-sync dry-run analysis (SSE) |
| `app/api/admin/ankorstore-sync/route.ts` | Create | POST start sync, GET status |
| `app/api/admin/ankorstore-sync/cancel/route.ts` | Create | POST cancel |
| `app/api/admin/ankorstore-sync/analyze/route.ts` | Create | POST SSE analysis |
| `app/api/admin/ankorstore-sync/count/route.ts` | Create | GET product counts |
| `app/api/admin/ankorstore-sync/mapping-data/route.ts` | Create | GET mapping data |
| `app/actions/admin/ankorstore-sync.ts` | Create | Server actions (mapping, config) |
| `app/actions/admin/site-config.ts` | Modify | Add AK credential actions |
| `app/(admin)/admin/ankorstore/page.tsx` | Create | Dashboard page (server) |
| `app/(admin)/admin/ankorstore/AnkorstoreSyncClient.tsx` | Create | Dashboard client component |
| `app/(admin)/admin/ankorstore/mapping/page.tsx` | Create | Mapping page |
| `app/(admin)/admin/ankorstore/historique/page.tsx` | Create | Sync history page |
| `app/(admin)/layout.tsx` | Modify | Add Ankorstore nav item |
| `components/admin/settings/MarketplaceConfig.tsx` | Modify | Add AK config section |

---

## Task 1: Prisma Schema — Add Ankorstore Models & Fields

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add AK fields to Product model**

In `prisma/schema.prisma`, after the eFashion fields (line ~306), add:

```prisma
  // ── Ankorstore sync ──
  akProductId            String?               @unique
  akSyncStatus           String? // null | "pending" | "synced" | "failed"
  akSyncError            String?               @db.Text
  akSyncedAt             DateTime?
```

- [ ] **Step 2: Add AK field to ProductColor model**

In the `ProductColor` model, after `efashionColorId` (line ~434), add:

```prisma
  akVariantId            String?               @unique // Ankorstore variant UUID
```

- [ ] **Step 3: Add AnkorstoreSyncJob model**

After the `EfashionStagedProduct` model, add:

```prisma
// ─────────────────────────────────────────────
// Ankorstore Sync
// ─────────────────────────────────────────────

model AnkorstoreSyncJob {
  id                String        @id @default(cuid())
  status            PfsSyncStatus @default(PENDING)
  totalProducts     Int           @default(0)
  processedProducts Int           @default(0)
  createdProducts   Int           @default(0)
  updatedProducts   Int           @default(0)
  skippedProducts   Int           @default(0)
  errorProducts     Int           @default(0)
  lastCursor        String? // for resume — last cursor position
  errorMessage      String?       @db.Text
  errorDetails      Json? // per-product errors
  logs              Json? // detailed sync logs for frontend display
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  adminId           String
  admin             User          @relation(fields: [adminId], references: [id])

  @@index([status])
  @@index([createdAt])
}

// Ankorstore productTypeId → BJ entity mapping
model AnkorstoreMapping {
  id         String   @id @default(cuid())
  type       String // "productType"
  akValue    String // Ankorstore value (e.g., "6716")
  akName     String // Display name (e.g., "Colliers")
  bjEntityId String // BJ entity id (Category.id)
  bjName     String // BJ entity name
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([type, akValue])
  @@index([type])
}
```

- [ ] **Step 4: Add the User relation for AnkorstoreSyncJob**

In the `User` model, add a relation field:

```prisma
  ankorstoreSyncJobs  AnkorstoreSyncJob[]
```

- [ ] **Step 5: Push schema and regenerate client**

```bash
npx prisma db push && npx prisma generate
```

Expected: Schema push succeeds, Prisma client regenerated.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(ankorstore): add Prisma models for Ankorstore sync"
```

---

## Task 2: Encryption & Cached Data — Add AK Config Support

**Files:**
- Modify: `lib/encryption.ts`
- Modify: `lib/cached-data.ts`

- [ ] **Step 1: Add AK secret to SENSITIVE_KEYS**

In `lib/encryption.ts`, add to the `SENSITIVE_KEYS` Set:

```typescript
  "ankorstore_client_secret",
```

- [ ] **Step 2: Add AK cache functions to cached-data.ts**

In `lib/cached-data.ts`, add these functions (follow the same pattern as `getCachedPfsEnabled` and `getCachedPfsCredentials`):

```typescript
export const getCachedAnkorstoreEnabled = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["ankorstore_client_id", "ankorstore_enabled"] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const hasClientId = map.has("ankorstore_client_id");
    const enabled = map.get("ankorstore_enabled");
    return hasClientId && enabled === "true";
  },
  ["ankorstore-enabled"],
  { revalidate: 300, tags: ["site-config"] },
);

export const getCachedAnkorstoreCredentials = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["ankorstore_client_id", "ankorstore_client_secret"] } },
    });
    const map = new Map(
      rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]),
    );
    return {
      clientId: map.get("ankorstore_client_id") ?? null,
      clientSecret: map.get("ankorstore_client_secret") ?? null,
    };
  },
  ["ankorstore-credentials"],
  { revalidate: 300, tags: ["site-config"] },
);
```

- [ ] **Step 3: Commit**

```bash
git add lib/encryption.ts lib/cached-data.ts
git commit -m "feat(ankorstore): add encryption key and cached data functions"
```

---

## Task 3: Authentication — OAuth2 Token Cache

**Files:**
- Create: `lib/ankorstore-auth.ts`

- [ ] **Step 1: Create the auth module**

```typescript
import { getCachedAnkorstoreCredentials } from "@/lib/cached-data";
import { logger } from "@/lib/logger";

export const AK_BASE_URL = "https://www.ankorstore.com/api/v1";
const TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const REFRESH_BUFFER_MS = 10 * 60 * 1000; // 10 min before expiry

interface TokenCache {
  accessToken: string;
  expiresAt: Date;
}

let cachedToken: TokenCache | null = null;

export async function getAnkorstoreToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return cachedToken.accessToken;
  }

  const creds = await getCachedAnkorstoreCredentials();
  const clientId = creds.clientId || process.env.ANKORSTORE_CLIENT_ID;
  const clientSecret = creds.clientSecret || process.env.ANKORSTORE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Identifiants Ankorstore manquants — configurer dans Paramètres > Marketplaces");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "*",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ankorstore OAuth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };

  logger.info("[Ankorstore] Token acquired", {
    expiresIn: data.expires_in,
    expiresAt: cachedToken.expiresAt.toISOString(),
  });

  return cachedToken.accessToken;
}

export function invalidateAnkorstoreToken(): void {
  cachedToken = null;
}

/**
 * Base fetch helper with auth, retry on 401, and rate limit handling.
 */
export async function akFetch(
  path: string,
  options: RequestInit = {},
  retries = 3,
): Promise<Response> {
  const token = await getAnkorstoreToken();
  const url = path.startsWith("http") ? path : `${AK_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
    ...(options.headers as Record<string, string> || {}),
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/vnd.api+json";
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers });

      // 401 — token expired, retry with fresh token
      if (res.status === 401 && attempt === 0) {
        invalidateAnkorstoreToken();
        const newToken = await getAnkorstoreToken();
        headers.Authorization = `Bearer ${newToken}`;
        continue;
      }

      // 429 — rate limited
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
        logger.warn("[Ankorstore] Rate limited", { retryAfter, attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      // 5xx — server error, retry with backoff
      if (res.status >= 500 && attempt < retries) {
        const backoff = Math.min(2000 * Math.pow(2, attempt), 30000);
        logger.warn("[Ankorstore] Server error, retrying", { status: res.status, backoff, attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        const backoff = Math.min(2000 * Math.pow(2, attempt), 30000);
        logger.warn("[Ankorstore] Network error, retrying", { error: lastError.message, backoff });
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  throw lastError || new Error("Ankorstore fetch failed after retries");
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-auth.ts
git commit -m "feat(ankorstore): OAuth2 token cache and base fetch helper"
```

---

## Task 4: Read API Client

**Files:**
- Create: `lib/ankorstore-api.ts`

- [ ] **Step 1: Create the read API module**

```typescript
import { akFetch } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

// ── Types ──

export interface AkProduct {
  id: string;
  name: string;
  description: string;
  productTypeId: number;
  wholesalePrice: number; // centimes
  retailPrice: number; // centimes
  active: boolean;
  archived: boolean;
  outOfStock: boolean;
  images: { order: number; url: string }[];
  tags: string[];
  variantIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AkVariant {
  id: string;
  name: string;
  sku: string;
  wholesalePrice: number; // centimes
  retailPrice: number; // centimes
  isAlwaysInStock: boolean;
  stockQuantity: number | null;
  availableQuantity: number | null;
  images: { order: number; url: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface AkListResponse {
  products: AkProduct[];
  variants: AkVariant[];
  nextCursor: string | null;
}

// ── Helpers ──

function parseProduct(raw: Record<string, unknown>): AkProduct {
  const attrs = raw.attributes as Record<string, unknown>;
  const rels = raw.relationships as Record<string, { data: { id: string }[] }>;
  return {
    id: raw.id as string,
    name: attrs.name as string,
    description: (attrs.description as string) || "",
    productTypeId: attrs.productTypeId as number,
    wholesalePrice: attrs.wholesalePrice as number,
    retailPrice: attrs.retailPrice as number,
    active: attrs.active as boolean,
    archived: attrs.archived as boolean,
    outOfStock: attrs.outOfStock as boolean,
    images: (attrs.images as { order: number; url: string }[]) || [],
    tags: (attrs.tags as string[]) || [],
    variantIds: (rels?.productVariants?.data || []).map((v) => v.id),
    createdAt: attrs.createdAt as string,
    updatedAt: attrs.updatedAt as string,
  };
}

function parseVariant(raw: Record<string, unknown>): AkVariant {
  const attrs = raw.attributes as Record<string, unknown>;
  return {
    id: raw.id as string,
    name: attrs.name as string,
    sku: attrs.sku as string,
    wholesalePrice: attrs.wholesalePrice as number,
    retailPrice: attrs.retailPrice as number,
    isAlwaysInStock: attrs.isAlwaysInStock as boolean,
    stockQuantity: attrs.stockQuantity as number | null,
    availableQuantity: attrs.availableQuantity as number | null,
    images: (attrs.images as { order: number; url: string }[]) || [],
    createdAt: attrs.createdAt as string,
    updatedAt: attrs.updatedAt as string,
  };
}

// ── API Functions ──

const PAGE_SIZE = 50; // max allowed by Ankorstore

/**
 * List products with variants (cursor-based pagination).
 */
export async function akListProducts(cursor?: string): Promise<AkListResponse> {
  let url = `/products?include=productVariants&page%5Blimit%5D=${PAGE_SIZE}`;
  if (cursor) {
    url += `&page%5Bafter%5D=${encodeURIComponent(cursor)}`;
  }

  const res = await akFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`akListProducts failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const products = ((json.data || []) as Record<string, unknown>[]).map(parseProduct);
  const variants = ((json.included || []) as Record<string, unknown>[])
    .filter((r) => (r.type as string) === "productVariants")
    .map(parseVariant);

  const hasMore = json.meta?.page?.hasMore === true;
  const nextCursor = hasMore ? (json.meta?.page?.to as string) : null;

  return { products, variants, nextCursor };
}

/**
 * Get a single product with variants.
 */
export async function akGetProduct(id: string): Promise<{ product: AkProduct; variants: AkVariant[] }> {
  const res = await akFetch(`/products/${id}?include=productVariants`);
  if (!res.ok) {
    throw new Error(`akGetProduct failed (${res.status})`);
  }

  const json = await res.json();
  const product = parseProduct(json.data);
  const variants = ((json.included || []) as Record<string, unknown>[])
    .filter((r) => (r.type as string) === "productVariants")
    .map(parseVariant);

  return { product, variants };
}

/**
 * Get a single variant.
 */
export async function akGetVariant(id: string): Promise<AkVariant> {
  const res = await akFetch(`/product-variants/${id}`);
  if (!res.ok) {
    throw new Error(`akGetVariant failed (${res.status})`);
  }

  const json = await res.json();
  return parseVariant(json.data);
}

/**
 * Count total products (paginate to count).
 * For display purposes — uses a single page to estimate.
 */
export async function akCountProducts(): Promise<{ count: number; hasMore: boolean }> {
  const res = await akFetch(`/products?page%5Blimit%5D=${PAGE_SIZE}`);
  if (!res.ok) return { count: 0, hasMore: false };

  const json = await res.json();
  const count = ((json.data || []) as unknown[]).length;
  const hasMore = json.meta?.page?.hasMore === true;
  return { count, hasMore };
}

// ── SKU Helpers ──

/**
 * Extract product reference from Ankorstore SKU.
 * SKU format: `{REFERENCE}_{COLOR}` (e.g., `COLLIERDOS09_DORÉ`)
 */
export function extractReferenceFromSku(sku: string): string {
  const idx = sku.indexOf("_");
  return idx > 0 ? sku.substring(0, idx).trim() : sku.trim();
}

/**
 * Extract color name from Ankorstore SKU.
 */
export function extractColorFromSku(sku: string): string {
  const idx = sku.indexOf("_");
  return idx > 0 ? sku.substring(idx + 1).trim() : "";
}

/**
 * Convert Ankorstore price (centimes) to BJ price (euros Decimal).
 */
export function akPriceToBj(centimes: number): number {
  return centimes / 100;
}

/**
 * Convert BJ price (euros) to Ankorstore price (centimes).
 */
export function bjPriceToAk(euros: number): number {
  return Math.round(euros * 100);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-api.ts
git commit -m "feat(ankorstore): read API client with product/variant parsing"
```

---

## Task 5: Write API Client

**Files:**
- Create: `lib/ankorstore-api-write.ts`

- [ ] **Step 1: Create the write API module**

```typescript
import { akFetch } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";
import type { AkVariant } from "@/lib/ankorstore-api";

/**
 * Update variant stock on Ankorstore.
 * Note: Cannot set stockQuantity when isAlwaysInStock=true.
 */
export async function akUpdateStock(
  variantId: string,
  opts: { isAlwaysInStock?: boolean; stockQuantity?: number },
): Promise<AkVariant> {
  const attributes: Record<string, unknown> = {};
  if (opts.isAlwaysInStock !== undefined) attributes.isAlwaysInStock = opts.isAlwaysInStock;
  if (opts.stockQuantity !== undefined) attributes.stockQuantity = opts.stockQuantity;

  const res = await akFetch(`/product-variants/${variantId}/stock`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "product-variant-stock",
        attributes,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Ankorstore] Stock update failed", { variantId, status: res.status, body: text });
    throw new Error(`akUpdateStock failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const attrs = json.data.attributes;
  return {
    id: json.data.id,
    name: attrs.name,
    sku: attrs.sku,
    wholesalePrice: attrs.wholesalePrice,
    retailPrice: attrs.retailPrice,
    isAlwaysInStock: attrs.isAlwaysInStock,
    stockQuantity: attrs.stockQuantity,
    availableQuantity: attrs.availableQuantity,
    images: attrs.images || [],
    createdAt: attrs.createdAt,
    updatedAt: attrs.updatedAt,
  };
}

/**
 * Update variant wholesale & retail prices on Ankorstore.
 * Prices in centimes.
 */
export async function akUpdatePrices(
  variantId: string,
  opts: { wholesalePrice: number; retailPrice: number },
): Promise<AkVariant> {
  const res = await akFetch(`/product-variants/${variantId}/prices`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "product-variant-price",
        attributes: {
          wholesalePrice: opts.wholesalePrice,
          retailPrice: opts.retailPrice,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Ankorstore] Price update failed", { variantId, status: res.status, body: text });
    throw new Error(`akUpdatePrices failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const attrs = json.data.attributes;
  return {
    id: json.data.id,
    name: attrs.name,
    sku: attrs.sku,
    wholesalePrice: attrs.wholesalePrice,
    retailPrice: attrs.retailPrice,
    isAlwaysInStock: attrs.isAlwaysInStock,
    stockQuantity: attrs.stockQuantity,
    availableQuantity: attrs.availableQuantity,
    images: attrs.images || [],
    createdAt: attrs.createdAt,
    updatedAt: attrs.updatedAt,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-api-write.ts
git commit -m "feat(ankorstore): write API client for stock and price updates"
```

---

## Task 6: Import Sync Pipeline (AK → BJ)

**Files:**
- Create: `lib/ankorstore-sync.ts`

- [ ] **Step 1: Create the main sync module**

This is the largest file. It follows the PFS sync pattern with these adaptations:
- Cursor pagination instead of page numbers
- No Playwright for images (direct HTTP download)
- SKU-based reference extraction
- productTypeId mapping via AnkorstoreMapping

```typescript
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  akListProducts,
  extractReferenceFromSku,
  extractColorFromSku,
  akPriceToBj,
  type AkProduct,
  type AkVariant,
} from "@/lib/ankorstore-api";
import { processProductImage } from "@/lib/image-processor";
import { uploadToR2 } from "@/lib/r2";

// ── Constants ──

const PRODUCT_CONCURRENCY = 10;
const IMAGE_CONCURRENCY = 15;
const MAX_LOGS = 500;

// ── Types ──

export interface AnkorstoreSyncOptions {
  limit?: number; // max products to sync (0 = unlimited)
}

interface SyncResult {
  action: "created" | "updated" | "skipped" | "error";
  reference: string;
  error?: string;
}

// ── In-memory caches (reset per sync) ──

const colorCache = new Map<string, string>(); // color name → Color.id
const categoryCache = new Map<string, string>(); // productTypeId → Category.id

// ── Log helpers ──

const productLogs: string[] = [];
const imageLogs: string[] = [];

const ts = () =>
  new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function addLog(msg: string) {
  productLogs.push(`[${ts()}] ${msg}`);
  if (productLogs.length > MAX_LOGS) productLogs.splice(0, productLogs.length - MAX_LOGS);
}

function addImageLog(msg: string) {
  imageLogs.push(`[${ts()}] ${msg}`);
  if (imageLogs.length > MAX_LOGS) imageLogs.splice(0, imageLogs.length - MAX_LOGS);
}

// ── Main entry point ──

export async function runAnkorstoreSync(
  jobId: string,
  options?: AnkorstoreSyncOptions,
): Promise<void> {
  const limit = options?.limit || 0;

  // Reset caches
  colorCache.clear();
  categoryCache.clear();
  productLogs.length = 0;
  imageLogs.length = 0;

  // Load mappings into cache
  const mappings = await prisma.ankorstoreMapping.findMany();
  for (const m of mappings) {
    if (m.type === "productType") categoryCache.set(m.akValue, m.bjEntityId);
  }

  // Mark job as running
  await prisma.ankorstoreSyncJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  let cursor: string | undefined;
  let totalProcessed = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const errorDetails: Record<string, { error: string }> = {};

  // Resume from last cursor if available
  const job = await prisma.ankorstoreSyncJob.findUnique({ where: { id: jobId } });
  if (job?.lastCursor) {
    cursor = job.lastCursor;
    addLog(`Reprise depuis le curseur ${cursor}`);
  }

  try {
    addLog("Démarrage de la synchronisation Ankorstore...");

    while (true) {
      // Check cancellation
      const currentJob = await prisma.ankorstoreSyncJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (currentJob?.status === "CANCELLED") {
        addLog("Synchronisation annulée par l'admin.");
        break;
      }

      // Fetch page
      const { products, variants, nextCursor } = await akListProducts(cursor);
      if (products.length === 0) break;

      addLog(`Page chargée : ${products.length} produits`);

      // Build variant lookup by product
      const variantsByProduct = new Map<string, AkVariant[]>();
      for (const product of products) {
        const productVariants = product.variantIds
          .map((vid) => variants.find((v) => v.id === vid))
          .filter((v): v is AkVariant => !!v);
        variantsByProduct.set(product.id, productVariants);
      }

      // Process products in parallel batches
      const batches: AkProduct[][] = [];
      for (let i = 0; i < products.length; i += PRODUCT_CONCURRENCY) {
        batches.push(products.slice(i, i + PRODUCT_CONCURRENCY));
      }

      for (const batch of batches) {
        const results = await Promise.allSettled(
          batch.map((product) =>
            syncSingleProduct(product, variantsByProduct.get(product.id) || []),
          ),
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            const r = result.value;
            totalProcessed++;
            if (r.action === "created") totalCreated++;
            else if (r.action === "updated") totalUpdated++;
            else if (r.action === "skipped") totalSkipped++;
            else if (r.action === "error") {
              totalErrors++;
              errorDetails[r.reference] = { error: r.error || "Unknown" };
            }
          } else {
            totalProcessed++;
            totalErrors++;
          }
        }
      }

      // Update job progress
      await prisma.ankorstoreSyncJob.update({
        where: { id: jobId },
        data: {
          processedProducts: totalProcessed,
          createdProducts: totalCreated,
          updatedProducts: totalUpdated,
          skippedProducts: totalSkipped,
          errorProducts: totalErrors,
          lastCursor: cursor || null,
          errorDetails: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
          logs: { productLogs: productLogs.slice(-200), imageLogs: imageLogs.slice(-200) },
        },
      });

      // Check limit
      if (limit > 0 && totalProcessed >= limit) {
        addLog(`Limite atteinte : ${totalProcessed}/${limit}`);
        break;
      }

      // Next page
      if (!nextCursor) break;
      cursor = nextCursor;
    }

    // Mark completed
    addLog(`Synchronisation terminée : ${totalCreated} créés, ${totalUpdated} mis à jour, ${totalSkipped} ignorés, ${totalErrors} erreurs`);
    await prisma.ankorstoreSyncJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        processedProducts: totalProcessed,
        createdProducts: totalCreated,
        updatedProducts: totalUpdated,
        skippedProducts: totalSkipped,
        errorProducts: totalErrors,
        logs: { productLogs, imageLogs },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Sync fatal error", { jobId, error: message });
    addLog(`ERREUR FATALE : ${message}`);
    await prisma.ankorstoreSyncJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: message.substring(0, 5000),
        logs: { productLogs, imageLogs },
      },
    });
  }
}

// ── Single product sync ──

async function syncSingleProduct(
  akProduct: AkProduct,
  akVariants: AkVariant[],
): Promise<SyncResult> {
  // Extract reference from first variant SKU
  const firstSku = akVariants[0]?.sku;
  if (!firstSku) {
    return { action: "skipped", reference: akProduct.name, error: "No variants" };
  }

  const reference = extractReferenceFromSku(firstSku);

  try {
    // Check if product exists in BJ
    const existing = await prisma.product.findUnique({
      where: { reference },
      include: { colors: true },
    });

    if (existing) {
      // Update existing product
      await updateExistingProduct(existing, akProduct, akVariants);
      addLog(`✓ Mis à jour : ${reference}`);
      return { action: "updated", reference };
    }

    // Create new product
    await createNewProduct(reference, akProduct, akVariants);
    addLog(`+ Créé : ${reference}`);
    return { action: "created", reference };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog(`✗ Erreur ${reference} : ${message}`);
    return { action: "error", reference, error: message };
  }
}

// ── Create new product ──

async function createNewProduct(
  reference: string,
  akProduct: AkProduct,
  akVariants: AkVariant[],
): Promise<void> {
  // Map productTypeId to BJ category
  const categoryId = categoryCache.get(String(akProduct.productTypeId));
  if (!categoryId) {
    throw new Error(`ProductType ${akProduct.productTypeId} non mappé — configurer dans Mapping`);
  }

  // Create product
  const product = await prisma.product.create({
    data: {
      reference,
      name: akProduct.name,
      description: akProduct.description,
      categoryId,
      status: akProduct.active ? "ONLINE" : "OFFLINE",
      akProductId: akProduct.id,
      akSyncStatus: "synced",
      akSyncedAt: new Date(),
    },
  });

  // Create variants (ProductColor per AK variant)
  for (let i = 0; i < akVariants.length; i++) {
    const akVariant = akVariants[i];
    const colorName = extractColorFromSku(akVariant.sku);

    // Find or create color
    const colorId = await findOrCreateColor(colorName);

    const productColor = await prisma.productColor.create({
      data: {
        productId: product.id,
        colorId,
        unitPrice: akPriceToBj(akVariant.wholesalePrice),
        weight: 0.1, // Default weight — AK doesn't provide it
        stock: akVariant.stockQuantity ?? 0,
        isPrimary: i === 0,
        saleType: "UNIT",
        akVariantId: akVariant.id,
      },
    });

    // Download and process images
    await downloadVariantImages(productColor.id, product.id, akVariant.images, reference);
  }
}

// ── Update existing product ──

async function updateExistingProduct(
  existing: { id: string; colors: { id: string; akVariantId: string | null; unitPrice: unknown; stock: number }[] },
  akProduct: AkProduct,
  akVariants: AkVariant[],
): Promise<void> {
  // Update product-level fields
  await prisma.product.update({
    where: { id: existing.id },
    data: {
      akProductId: akProduct.id,
      akSyncStatus: "synced",
      akSyncedAt: new Date(),
      akSyncError: null,
    },
  });

  // Update variant-level fields (match by akVariantId)
  for (const akVariant of akVariants) {
    const bjColor = existing.colors.find((c) => c.akVariantId === akVariant.id);
    if (bjColor) {
      await prisma.productColor.update({
        where: { id: bjColor.id },
        data: {
          unitPrice: akPriceToBj(akVariant.wholesalePrice),
          stock: akVariant.stockQuantity ?? bjColor.stock,
        },
      });
    }
  }
}

// ── Image download ──

let activeImageDownloads = 0;

async function downloadVariantImages(
  productColorId: string,
  productId: string,
  images: { order: number; url: string }[],
  reference: string,
): Promise<void> {
  for (const img of images) {
    // Wait for slot
    while (activeImageDownloads >= IMAGE_CONCURRENCY) {
      await new Promise((r) => setTimeout(r, 100));
    }

    activeImageDownloads++;
    try {
      // Strip query params to get full-size image
      const cleanUrl = img.url.split("?")[0];
      addImageLog(`Téléchargement : ${reference} image ${img.order}`);

      const res = await fetch(cleanUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        addImageLog(`✗ Échec téléchargement ${reference} image ${img.order} (${res.status})`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1024) {
        addImageLog(`✗ Image trop petite ${reference} image ${img.order} (${buffer.length}B)`);
        continue;
      }

      // Process to WebP 3 sizes
      const processed = await processProductImage(buffer, reference);

      // Upload to R2
      for (const file of processed) {
        await uploadToR2(file.key, file.buffer, file.contentType);
      }

      // Save to DB
      const dbPath = processed.find((f) => f.size === "large")?.key || processed[0].key;
      await prisma.productColorImage.create({
        data: {
          productColorId,
          productId,
          path: `/${dbPath}`,
          position: img.order - 1,
        },
      });

      addImageLog(`✓ Image ${reference} ${img.order} uploadée`);
    } catch (err) {
      addImageLog(`✗ Erreur image ${reference} ${img.order}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      activeImageDownloads--;
    }
  }
}

// ── Color helper ──

async function findOrCreateColor(name: string): Promise<string | null> {
  if (!name) return null;

  const normalized = name.toUpperCase().trim();
  if (colorCache.has(normalized)) return colorCache.get(normalized)!;

  // Try exact match
  const existing = await prisma.color.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });

  if (existing) {
    colorCache.set(normalized, existing.id);
    return existing.id;
  }

  // Create new color
  const created = await prisma.color.create({
    data: { name: name.trim(), hex: "#808080" },
  });

  colorCache.set(normalized, created.id);
  return created.id;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-sync.ts
git commit -m "feat(ankorstore): import sync pipeline (AK → BJ)"
```

---

## Task 7: Reverse Sync (BJ → AK)

**Files:**
- Create: `lib/ankorstore-reverse-sync.ts`

- [ ] **Step 1: Create the reverse sync module**

```typescript
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { akGetVariant, bjPriceToAk } from "@/lib/ankorstore-api";
import { akUpdateStock, akUpdatePrices } from "@/lib/ankorstore-api-write";

/**
 * Fire-and-forget trigger — call after product save in BJ.
 */
export function triggerAnkorstoreSync(productId: string): void {
  syncProductToAnkorstore(productId).catch((err) => {
    logger.error("[Ankorstore Reverse] Fatal error", {
      productId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function syncProductToAnkorstore(productId: string): Promise<void> {
  // Mark as pending
  await prisma.product.update({
    where: { id: productId },
    data: { akSyncStatus: "pending", akSyncError: null },
  });

  try {
    // Load product with colors that have akVariantId
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        colors: {
          where: { akVariantId: { not: null } },
          select: {
            id: true,
            akVariantId: true,
            unitPrice: true,
            stock: true,
          },
        },
      },
    });

    if (!product || !product.akProductId) {
      logger.info("[Ankorstore Reverse] Product not linked to Ankorstore", { productId });
      await prisma.product.update({
        where: { id: productId },
        data: { akSyncStatus: null },
      });
      return;
    }

    if (product.colors.length === 0) {
      logger.info("[Ankorstore Reverse] No linked variants", { productId });
      await prisma.product.update({
        where: { id: productId },
        data: { akSyncStatus: "synced", akSyncedAt: new Date() },
      });
      return;
    }

    let changesApplied = 0;

    for (const bjColor of product.colors) {
      const akVariantId = bjColor.akVariantId!;

      try {
        // Fetch current AK state
        const akVariant = await akGetVariant(akVariantId);

        // Compare stock
        const bjStock = bjColor.stock;
        const akStock = akVariant.stockQuantity;

        if (!akVariant.isAlwaysInStock && akStock !== bjStock) {
          await akUpdateStock(akVariantId, { stockQuantity: bjStock });
          changesApplied++;
          logger.info("[Ankorstore Reverse] Stock updated", {
            variantId: akVariantId,
            from: akStock,
            to: bjStock,
          });
        }

        // Compare price
        const bjPriceCentimes = bjPriceToAk(Number(bjColor.unitPrice));
        if (akVariant.wholesalePrice !== bjPriceCentimes) {
          // Maintain the same ratio for retail price
          const ratio = akVariant.retailPrice / akVariant.wholesalePrice;
          const newRetailPrice = Math.round(bjPriceCentimes * ratio);

          await akUpdatePrices(akVariantId, {
            wholesalePrice: bjPriceCentimes,
            retailPrice: newRetailPrice,
          });
          changesApplied++;
          logger.info("[Ankorstore Reverse] Price updated", {
            variantId: akVariantId,
            from: akVariant.wholesalePrice,
            to: bjPriceCentimes,
          });
        }
      } catch (err) {
        logger.warn("[Ankorstore Reverse] Variant sync failed", {
          variantId: akVariantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Mark synced
    await prisma.product.update({
      where: { id: productId },
      data: {
        akSyncStatus: "synced",
        akSyncError: null,
        akSyncedAt: new Date(),
      },
    });

    logger.info("[Ankorstore Reverse] Sync complete", {
      productId,
      changesApplied,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.product.update({
      where: { id: productId },
      data: {
        akSyncStatus: "failed",
        akSyncError: message.substring(0, 5000),
      },
    });
    throw err;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-reverse-sync.ts
git commit -m "feat(ankorstore): reverse sync BJ → AK (fire-and-forget)"
```

---

## Task 8: Analysis Module (Pre-sync Dry Run)

**Files:**
- Create: `lib/ankorstore-analyze.ts`

- [ ] **Step 1: Create the analysis module**

```typescript
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { akListProducts, extractReferenceFromSku } from "@/lib/ankorstore-api";

export interface AkAnalysisResult {
  totalProducts: number;
  newProducts: number;
  existingProducts: number;
  unmappedProductTypes: { id: number; count: number }[];
  allProductTypes: { id: number; count: number }[];
}

/**
 * Analyze Ankorstore catalog to detect unmapped entities.
 * Paginates through all products and reports what's missing.
 */
export async function runAnkorstoreAnalyze(options?: {
  limit?: number;
  onProgress?: (msg: string) => void;
}): Promise<AkAnalysisResult> {
  const limit = options?.limit || 0;
  const onProgress = options?.onProgress || (() => {});

  // Load existing mappings
  const mappings = await prisma.ankorstoreMapping.findMany({
    where: { type: "productType" },
  });
  const mappedTypes = new Set(mappings.map((m) => m.akValue));

  // Load existing product references
  const existingRefs = new Set(
    (await prisma.product.findMany({ select: { reference: true } })).map((p) => p.reference),
  );

  const productTypeCounts = new Map<number, number>();
  let totalProducts = 0;
  let newProducts = 0;
  let existingProducts = 0;
  let cursor: string | undefined;

  onProgress("Analyse du catalogue Ankorstore...");

  while (true) {
    const { products, variants, nextCursor } = await akListProducts(cursor);
    if (products.length === 0) break;

    for (const product of products) {
      totalProducts++;

      // Count productTypes
      const typeId = product.productTypeId;
      productTypeCounts.set(typeId, (productTypeCounts.get(typeId) || 0) + 1);

      // Check if product exists in BJ
      const firstVariant = variants.find((v) => product.variantIds.includes(v.id));
      if (firstVariant) {
        const ref = extractReferenceFromSku(firstVariant.sku);
        if (existingRefs.has(ref)) {
          existingProducts++;
        } else {
          newProducts++;
        }
      }
    }

    onProgress(`Analysé : ${totalProducts} produits (${newProducts} nouveaux)`);

    if (limit > 0 && totalProducts >= limit) break;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  // Build results
  const allProductTypes = Array.from(productTypeCounts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);

  const unmappedProductTypes = allProductTypes.filter(
    (pt) => !mappedTypes.has(String(pt.id)),
  );

  onProgress(
    `Analyse terminée : ${totalProducts} produits, ${unmappedProductTypes.length} types non mappés`,
  );

  return {
    totalProducts,
    newProducts,
    existingProducts,
    unmappedProductTypes,
    allProductTypes,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-analyze.ts
git commit -m "feat(ankorstore): pre-sync analysis module"
```

---

## Task 9: API Routes

**Files:**
- Create: `app/api/admin/ankorstore-sync/route.ts`
- Create: `app/api/admin/ankorstore-sync/cancel/route.ts`
- Create: `app/api/admin/ankorstore-sync/analyze/route.ts`
- Create: `app/api/admin/ankorstore-sync/count/route.ts`
- Create: `app/api/admin/ankorstore-sync/mapping-data/route.ts`

- [ ] **Step 1: Create main sync route**

`app/api/admin/ankorstore-sync/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runAnkorstoreSync } from "@/lib/ankorstore-sync";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    let limit = 0;
    try {
      const body = await req.json();
      limit = typeof body.limit === "number" ? body.limit : 0;
    } catch {
      // No body
    }

    // Check if already running
    const running = await prisma.ankorstoreSyncJob.findFirst({
      where: { status: "RUNNING" },
      select: { id: true },
    });
    if (running) {
      return NextResponse.json(
        { error: "Une synchronisation Ankorstore est déjà en cours.", jobId: running.id },
        { status: 409 },
      );
    }

    // Create job
    const job = await prisma.ankorstoreSyncJob.create({
      data: { adminId: session.user.id },
    });

    // Fire-and-forget
    runAnkorstoreSync(job.id, { limit: limit > 0 ? limit : undefined }).catch(() => {});

    return NextResponse.json({ jobId: job.id, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const job = await prisma.ankorstoreSyncJob.findFirst({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ job });
}
```

- [ ] **Step 2: Create cancel route**

`app/api/admin/ankorstore-sync/cancel/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const running = await prisma.ankorstoreSyncJob.findFirst({
    where: { status: "RUNNING" },
  });

  if (!running) {
    return NextResponse.json({ error: "Aucune synchronisation en cours" }, { status: 404 });
  }

  await prisma.ankorstoreSyncJob.update({
    where: { id: running.id },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Create analyze route (SSE)**

`app/api/admin/ankorstore-sync/analyze/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runAnkorstoreAnalyze } from "@/lib/ankorstore-analyze";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401 });
  }

  let limit = 0;
  try {
    const body = await req.json();
    limit = typeof body.limit === "number" ? body.limit : 0;
  } catch {
    // No body
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await runAnkorstoreAnalyze({
          limit: limit > 0 ? limit : undefined,
          onProgress: (msg) => send({ type: "progress", message: msg }),
        });

        send({ type: "result", ...result });
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Create count route**

`app/api/admin/ankorstore-sync/count/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { akCountProducts } from "@/lib/ankorstore-api";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const [akCount, bjCount] = await Promise.all([
      akCountProducts().catch(() => ({ count: 0, hasMore: false })),
      prisma.product.count({ where: { akProductId: { not: null } } }),
    ]);

    return NextResponse.json({
      akCount: akCount.count,
      akHasMore: akCount.hasMore,
      bjSyncedCount: bjCount,
    });
  } catch {
    return NextResponse.json({ akCount: 0, akHasMore: false, bjSyncedCount: 0 });
  }
}
```

- [ ] **Step 5: Create mapping-data route**

`app/api/admin/ankorstore-sync/mapping-data/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const [mappings, categories] = await Promise.all([
    prisma.ankorstoreMapping.findMany({ orderBy: { akName: "asc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return NextResponse.json({ mappings, categories });
}
```

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/ankorstore-sync/
git commit -m "feat(ankorstore): API routes for sync, cancel, analyze, count, mapping"
```

---

## Task 10: Server Actions (Config + Mapping)

**Files:**
- Create: `app/actions/admin/ankorstore-sync.ts`
- Modify: `app/actions/admin/site-config.ts`

- [ ] **Step 1: Create ankorstore server actions**

`app/actions/admin/ankorstore-sync.ts`:

```typescript
"use server";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import { getAnkorstoreToken } from "@/lib/ankorstore-auth";
import { encryptIfSensitive } from "@/lib/encryption";

export async function saveAnkorstoreMapping(data: {
  akValue: string;
  akName: string;
  bjEntityId: string;
  bjName: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.ankorstoreMapping.upsert({
      where: { type_akValue: { type: "productType", akValue: data.akValue } },
      create: {
        type: "productType",
        akValue: data.akValue,
        akName: data.akName,
        bjEntityId: data.bjEntityId,
        bjName: data.bjName,
      },
      update: {
        bjEntityId: data.bjEntityId,
        bjName: data.bjName,
      },
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur interne" };
  }
}

export async function deleteAnkorstoreMapping(
  akValue: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.ankorstoreMapping.delete({
      where: { type_akValue: { type: "productType", akValue } },
    });
    return { success: true };
  } catch {
    return { success: false, error: "Mapping introuvable" };
  }
}

export async function validateAnkorstoreCredentials(data: {
  clientId: string;
  clientSecret: string;
}): Promise<{ valid: boolean; error?: string }> {
  await requireAdmin();

  try {
    const res = await fetch("https://www.ankorstore.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: data.clientId,
        client_secret: data.clientSecret,
        scope: "*",
      }),
    });

    if (res.ok) {
      return { valid: true };
    }

    const text = await res.text().catch(() => "");
    return { valid: false, error: `Erreur ${res.status}: ${text}` };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Erreur réseau" };
  }
}

export async function updateAnkorstoreCredentials(data: {
  clientId: string;
  clientSecret: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.$transaction([
      prisma.siteConfig.upsert({
        where: { key: "ankorstore_client_id" },
        create: { key: "ankorstore_client_id", value: data.clientId },
        update: { value: data.clientId },
      }),
      prisma.siteConfig.upsert({
        where: { key: "ankorstore_client_secret" },
        create: {
          key: "ankorstore_client_secret",
          value: encryptIfSensitive("ankorstore_client_secret", data.clientSecret),
        },
        update: {
          value: encryptIfSensitive("ankorstore_client_secret", data.clientSecret),
        },
      }),
    ]);

    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur interne" };
  }
}

export async function toggleAnkorstoreEnabled(
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.siteConfig.upsert({
      where: { key: "ankorstore_enabled" },
      create: { key: "ankorstore_enabled", value: enabled ? "true" : "false" },
      update: { value: enabled ? "true" : "false" },
    });

    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur interne" };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/actions/admin/ankorstore-sync.ts
git commit -m "feat(ankorstore): server actions for config, mapping, credentials"
```

---

## Task 11: Admin Layout — Add Navigation

**Files:**
- Modify: `app/(admin)/layout.tsx`

- [ ] **Step 1: Add Ankorstore nav item to ADMIN_NAV_SECTIONS**

In the `ADMIN_NAV_SECTIONS` array, find the `"Importation"` section that contains the PFS item. Add a new item after it:

```typescript
{
  label: "Ankorstore",
  href: "/admin/ankorstore",
  icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
    </svg>
  ),
},
```

- [ ] **Step 2: Commit**

```bash
git add app/(admin)/layout.tsx
git commit -m "feat(ankorstore): add nav item in admin sidebar"
```

---

## Task 12: Admin Dashboard Page

**Files:**
- Create: `app/(admin)/admin/ankorstore/page.tsx`
- Create: `app/(admin)/admin/ankorstore/AnkorstoreSyncClient.tsx`

- [ ] **Step 1: Create server page**

`app/(admin)/admin/ankorstore/page.tsx`:

```typescript
import { getCachedAnkorstoreEnabled } from "@/lib/cached-data";
import Link from "next/link";
import AnkorstoreSyncClient from "./AnkorstoreSyncClient";

export default async function AnkorstorePage() {
  const enabled = await getCachedAnkorstoreEnabled();

  if (!enabled) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <h1 className="page-title">Ankorstore</h1>
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center space-y-4">
          <div className="text-4xl">🔗</div>
          <h2 className="text-lg font-semibold text-text-primary">Ankorstore non configuré</h2>
          <p className="text-text-secondary text-sm max-w-md mx-auto">
            Configurez vos identifiants API Ankorstore (Client ID et Client Secret) pour activer la synchronisation.
          </p>
          <Link
            href="/admin/parametres?tab=marketplaces"
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg hover:opacity-90 transition"
          >
            Configurer Ankorstore
          </Link>
        </div>
      </div>
    );
  }

  return <AnkorstoreSyncClient />;
}
```

- [ ] **Step 2: Create client component**

`app/(admin)/admin/ankorstore/AnkorstoreSyncClient.tsx`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface SyncJob {
  id: string;
  status: string;
  totalProducts: number;
  processedProducts: number;
  createdProducts: number;
  updatedProducts: number;
  skippedProducts: number;
  errorProducts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AnalysisResult {
  totalProducts: number;
  newProducts: number;
  existingProducts: number;
  unmappedProductTypes: { id: number; count: number }[];
}

export default function AnkorstoreSyncClient() {
  const [job, setJob] = useState<SyncJob | null>(null);
  const [counts, setCounts] = useState<{ akCount: number; akHasMore: boolean; bjSyncedCount: number } | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [limit, setLimit] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  // Fetch counts and latest job
  const fetchData = useCallback(async () => {
    try {
      const [countRes, jobRes] = await Promise.all([
        fetch("/api/admin/ankorstore-sync/count"),
        fetch("/api/admin/ankorstore-sync"),
      ]);
      const countData = await countRes.json();
      const jobData = await jobRes.json();
      setCounts(countData);
      if (jobData.job) setJob(jobData.job);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll job status when running
  useEffect(() => {
    if (!job || job.status !== "RUNNING") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/admin/ankorstore-sync");
        const data = await res.json();
        if (data.job) {
          setJob(data.job);
          if (data.job.logs?.productLogs) setLogs(data.job.logs.productLogs);
          if (data.job.status !== "RUNNING") {
            setSyncing(false);
          }
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [job?.status]);

  // Start analysis
  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch("/api/admin/ankorstore-sync/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: limit > 0 ? limit : undefined }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.type === "result") {
            setAnalysis(data);
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setAnalyzing(false);
    }
  }

  // Start sync
  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/ankorstore-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: limit > 0 ? limit : undefined }),
      });
      const data = await res.json();
      if (data.jobId) {
        setJob({ ...job!, id: data.jobId, status: "RUNNING", processedProducts: 0 } as SyncJob);
      }
    } catch {
      setSyncing(false);
    }
  }

  // Cancel sync
  async function handleCancel() {
    await fetch("/api/admin/ankorstore-sync/cancel", { method: "POST" });
    fetchData();
  }

  const isRunning = job?.status === "RUNNING";

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Ankorstore</h1>
        <Link
          href="/admin/ankorstore/mapping"
          className="text-sm text-brand hover:underline"
        >
          Mapping catégories →
        </Link>
      </div>

      {/* Counts */}
      {counts && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="text-2xl font-bold text-text-primary">
              {counts.akCount}{counts.akHasMore ? "+" : ""}
            </div>
            <div className="text-sm text-text-secondary">Produits Ankorstore</div>
          </div>
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="text-2xl font-bold text-text-primary">{counts.bjSyncedCount}</div>
            <div className="text-sm text-text-secondary">Synchronisés en BDD</div>
          </div>
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="text-2xl font-bold text-text-primary">
              {counts.akCount > 0 ? Math.round((counts.bjSyncedCount / counts.akCount) * 100) : 0}%
            </div>
            <div className="text-sm text-text-secondary">Couverture</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-text-secondary">Limite :</label>
            <input
              type="number"
              value={limit || ""}
              onChange={(e) => setLimit(Number(e.target.value) || 0)}
              placeholder="Illimité"
              className="w-28 px-3 py-1.5 border border-border rounded-lg text-sm bg-bg-primary text-text-primary"
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzing || isRunning}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-bg-secondary transition disabled:opacity-50"
          >
            {analyzing ? "Analyse..." : "Analyser"}
          </button>

          <button
            onClick={isRunning ? handleCancel : handleSync}
            disabled={analyzing || syncing}
            className={`px-4 py-2 text-sm text-white rounded-lg transition disabled:opacity-50 ${
              isRunning ? "bg-red-500 hover:bg-red-600" : "bg-brand hover:opacity-90"
            }`}
          >
            {isRunning ? "Annuler" : syncing ? "Démarrage..." : "Lancer la sync"}
          </button>
        </div>

        {/* Analysis results */}
        {analysis && (
          <div className="p-4 bg-bg-secondary rounded-lg text-sm space-y-2">
            <div>Produits AK : <strong>{analysis.totalProducts}</strong></div>
            <div>Nouveaux : <strong>{analysis.newProducts}</strong></div>
            <div>Déjà existants : <strong>{analysis.existingProducts}</strong></div>
            {analysis.unmappedProductTypes.length > 0 && (
              <div className="text-amber-600">
                ⚠ {analysis.unmappedProductTypes.length} types non mappés —{" "}
                <Link href="/admin/ankorstore/mapping" className="underline">
                  Configurer le mapping
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Job status */}
      {job && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-text-primary">Dernière synchronisation</h2>
            <span className={`badge ${
              job.status === "COMPLETED" ? "badge-success" :
              job.status === "RUNNING" ? "badge-info" :
              job.status === "FAILED" ? "badge-error" :
              job.status === "CANCELLED" ? "badge-warning" : "badge-neutral"
            }`}>
              {job.status}
            </span>
          </div>

          {isRunning && job.totalProducts > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm text-text-secondary">
                <span>{job.processedProducts} / {job.totalProducts}</span>
                <span>{Math.round((job.processedProducts / job.totalProducts) * 100)}%</span>
              </div>
              <div className="w-full bg-bg-secondary rounded-full h-2">
                <div
                  className="bg-brand h-2 rounded-full transition-all"
                  style={{ width: `${(job.processedProducts / job.totalProducts) * 100}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div><span className="text-text-secondary">Créés :</span> <strong>{job.createdProducts}</strong></div>
            <div><span className="text-text-secondary">Mis à jour :</span> <strong>{job.updatedProducts}</strong></div>
            <div><span className="text-text-secondary">Ignorés :</span> <strong>{job.skippedProducts}</strong></div>
            <div><span className="text-text-secondary">Erreurs :</span> <strong className="text-red-500">{job.errorProducts}</strong></div>
            <div><span className="text-text-secondary">Date :</span> {new Date(job.createdAt).toLocaleDateString("fr-FR")}</div>
          </div>

          {job.errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {job.errorMessage}
            </div>
          )}

          {/* Logs */}
          {logs.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-text-secondary hover:text-text-primary">
                Logs ({logs.length})
              </summary>
              <pre className="mt-2 p-3 bg-bg-secondary rounded-lg overflow-auto max-h-60 text-xs font-mono">
                {logs.join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* History link */}
      <div className="text-center">
        <Link href="/admin/ankorstore/historique" className="text-sm text-brand hover:underline">
          Voir l&apos;historique complet →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/admin/ankorstore/
git commit -m "feat(ankorstore): admin dashboard page with sync controls"
```

---

## Task 13: Mapping Page

**Files:**
- Create: `app/(admin)/admin/ankorstore/mapping/page.tsx`

- [ ] **Step 1: Create mapping page**

`app/(admin)/admin/ankorstore/mapping/page.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { saveAnkorstoreMapping, deleteAnkorstoreMapping } from "@/app/actions/admin/ankorstore-sync";
import CustomSelect from "@/components/ui/CustomSelect";

interface Mapping {
  id: string;
  type: string;
  akValue: string;
  akName: string;
  bjEntityId: string;
  bjName: string;
}

interface Category {
  id: string;
  name: string;
}

export default function AnkorstoreMappingPage() {
  const toast = useToast();
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/ankorstore-sync/mapping-data")
      .then((r) => r.json())
      .then((data) => {
        setMappings(data.mappings || []);
        setCategories(data.categories || []);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(akValue: string, akName: string, categoryId: string) {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const result = await saveAnkorstoreMapping({
      akValue,
      akName,
      bjEntityId: categoryId,
      bjName: category.name,
    });

    if (result.success) {
      toast.success("Mapping sauvegardé");
      // Refresh
      const res = await fetch("/api/admin/ankorstore-sync/mapping-data");
      const data = await res.json();
      setMappings(data.mappings || []);
    } else {
      toast.error("Erreur", result.error);
    }
  }

  async function handleDelete(akValue: string) {
    const result = await deleteAnkorstoreMapping(akValue);
    if (result.success) {
      setMappings((prev) => prev.filter((m) => m.akValue !== akValue));
      toast.success("Mapping supprimé");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <h1 className="page-title">Mapping Ankorstore</h1>
        <div className="text-text-secondary">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="page-title">Mapping Ankorstore — Catégories</h1>
      <p className="text-sm text-text-secondary">
        Associez chaque type de produit Ankorstore (productTypeId) à une catégorie de votre catalogue.
      </p>

      <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary">
              <th className="text-left p-4 font-medium text-text-secondary">Type AK (ID)</th>
              <th className="text-left p-4 font-medium text-text-secondary">Nom AK</th>
              <th className="text-left p-4 font-medium text-text-secondary">Catégorie BJ</th>
              <th className="text-right p-4 font-medium text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.akValue} className="border-b border-border">
                <td className="p-4 font-mono text-xs">{m.akValue}</td>
                <td className="p-4">{m.akName}</td>
                <td className="p-4">
                  <CustomSelect
                    value={m.bjEntityId}
                    onChange={(val) => handleSave(m.akValue, m.akName, val)}
                    options={categories.map((c) => ({ value: c.id, label: c.name }))}
                    placeholder="Sélectionner..."
                  />
                </td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => handleDelete(m.akValue)}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
            {mappings.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-text-secondary">
                  Aucun mapping configuré. Lancez une analyse pour détecter les types de produits.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(admin)/admin/ankorstore/mapping/
git commit -m "feat(ankorstore): category mapping admin page"
```

---

## Task 14: History Page

**Files:**
- Create: `app/(admin)/admin/ankorstore/historique/page.tsx`

- [ ] **Step 1: Create history page**

`app/(admin)/admin/ankorstore/historique/page.tsx`:

```typescript
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function AnkorstoreHistoriquePage() {
  const jobs = await prisma.ankorstoreSyncJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { admin: { select: { firstName: true, lastName: true } } },
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Historique Ankorstore</h1>
        <Link href="/admin/ankorstore" className="text-sm text-brand hover:underline">
          ← Retour
        </Link>
      </div>

      <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary">
              <th className="text-left p-4 font-medium text-text-secondary">Date</th>
              <th className="text-left p-4 font-medium text-text-secondary">Status</th>
              <th className="text-left p-4 font-medium text-text-secondary">Admin</th>
              <th className="text-right p-4 font-medium text-text-secondary">Créés</th>
              <th className="text-right p-4 font-medium text-text-secondary">Mis à jour</th>
              <th className="text-right p-4 font-medium text-text-secondary">Erreurs</th>
              <th className="text-right p-4 font-medium text-text-secondary">Total</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-border hover:bg-bg-secondary/50">
                <td className="p-4">
                  {new Date(job.createdAt).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="p-4">
                  <span className={`badge ${
                    job.status === "COMPLETED" ? "badge-success" :
                    job.status === "RUNNING" ? "badge-info" :
                    job.status === "FAILED" ? "badge-error" :
                    job.status === "CANCELLED" ? "badge-warning" : "badge-neutral"
                  }`}>
                    {job.status}
                  </span>
                </td>
                <td className="p-4">{job.admin.firstName} {job.admin.lastName}</td>
                <td className="p-4 text-right font-mono">{job.createdProducts}</td>
                <td className="p-4 text-right font-mono">{job.updatedProducts}</td>
                <td className="p-4 text-right font-mono text-red-500">{job.errorProducts}</td>
                <td className="p-4 text-right font-mono">{job.processedProducts}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-text-secondary">
                  Aucune synchronisation effectuée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(admin)/admin/ankorstore/historique/
git commit -m "feat(ankorstore): sync history admin page"
```

---

## Task 15: Marketplace Config — Add Ankorstore Section

**Files:**
- Modify: `components/admin/settings/MarketplaceConfig.tsx`

- [ ] **Step 1: Add Ankorstore state and handlers**

Add to the component props interface:

```typescript
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
```

Add Ankorstore state management (same pattern as PFS):

```typescript
// Ankorstore state
const [akClientId, setAkClientId] = useState("");
const [akClientSecret, setAkClientSecret] = useState("");
const [akStatus, setAkStatus] = useState<"none" | "valid" | "invalid" | "checking">(
  hasAnkorstoreConfig ? "valid" : "none"
);
const [akEnabled, setAkEnabled] = useState(initialAnkorstoreEnabled);
const [akEditing, setAkEditing] = useState(!hasAnkorstoreConfig);
const [isSavingAk, startSavingAk] = useTransition();
const [isValidatingAk, startValidatingAk] = useTransition();
const [isTogglingAk, startTogglingAk] = useTransition();
```

Add the validate/save/toggle handlers following the PFS pattern but calling:
- `validateAnkorstoreCredentials({ clientId, clientSecret })`
- `updateAnkorstoreCredentials({ clientId, clientSecret })`
- `toggleAnkorstoreEnabled(boolean)`

Import these from `@/app/actions/admin/ankorstore-sync`.

- [ ] **Step 2: Add Ankorstore JSX section**

After the PFS section in the return JSX, add an Ankorstore section with:
- Title "Ankorstore"
- Client ID input field
- Client Secret input field (password type)
- "Tester" button → calls validate
- "Enregistrer" button → calls save
- Enable/disable toggle

Follow the exact same JSX structure as the PFS section.

- [ ] **Step 3: Update MarketplacesTab in parametres/page.tsx**

Add the Ankorstore config queries and pass them to the component:

```typescript
const [ankorstoreConfig, ankorstoreEnabledRow] = await Promise.all([
  prisma.siteConfig.findUnique({ where: { key: "ankorstore_client_id" }, select: { key: true } }),
  prisma.siteConfig.findUnique({ where: { key: "ankorstore_enabled" }, select: { value: true } }),
]);
```

Pass to `MarketplaceConfig`:
```typescript
hasAnkorstoreConfig={!!ankorstoreConfig}
ankorstoreEnabled={ankorstoreEnabledRow?.value === "true"}
```

- [ ] **Step 4: Commit**

```bash
git add components/admin/settings/MarketplaceConfig.tsx app/(admin)/admin/parametres/page.tsx
git commit -m "feat(ankorstore): add config section in marketplace settings"
```

---

## Task 16: Wire Reverse Sync Into Product Actions

**Files:**
- Modify: Product update server actions (same files where `triggerPfsSync` is called)

- [ ] **Step 1: Find all triggerPfsSync calls**

Search for `triggerPfsSync` in the codebase. For each call site, add `triggerAnkorstoreSync` alongside it:

```typescript
import { triggerAnkorstoreSync } from "@/lib/ankorstore-reverse-sync";

// After existing triggerPfsSync call:
triggerAnkorstoreSync(product.id);
```

- [ ] **Step 2: Commit**

```bash
git add app/actions/admin/
git commit -m "feat(ankorstore): wire reverse sync into product update actions"
```

---

## Task 17: Update CLAUDE.md & Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Ankorstore references to CLAUDE.md**

In the architecture section, add a mention of Ankorstore sync alongside PFS. In the docs references at the top, add:

```markdown
> **Ankorstore** : `docs/ankorstore-system.md` (API, sync, mapping)
```

In the PFS sync section, add:

```markdown
### Ankorstore sync (bidirectional)

`lib/ankorstore-auth.ts` (OAuth2 token), `lib/ankorstore-api.ts` (read), `lib/ankorstore-api-write.ts` (write), `lib/ankorstore-sync.ts` (import AK→BJ), `lib/ankorstore-reverse-sync.ts` (export BJ→AK). Config: `ankorstore_client_id`, `ankorstore_client_secret`, `ankorstore_enabled` in SiteConfig.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: add Ankorstore integration documentation"
```
