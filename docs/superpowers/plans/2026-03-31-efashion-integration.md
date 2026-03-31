# eFashion Paris Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate eFashion Paris as a second marketplace alongside PFS — import products from eFashion into the local catalog, then reverse sync local changes back to eFashion.

**Architecture:** Independent file set (`lib/efashion-*.ts`) with GraphQL client, cookie-based auth, and same sync patterns as PFS. Separate Prisma models, API routes, admin pages, and components — no shared abstraction with PFS.

**Tech Stack:** Next.js 16, Prisma 5.22, GraphQL (fetch-based, no Apollo client), Tailwind v4, TypeScript.

**Vendor ID:** 2017 (Beli & Jolie on eFashion)

---

## Verified API Schema (from introspection)

### Key differences from documentation:
- `productsPage` returns `items` (not `products`), no `hasMore` field — use `total` for pagination
- `ProduitListItem` fields differ from `Produit` fields (list vs detail types)
- `ProduitDescription` has `texte_fr`, `texte_uk` (not `lang`/`titre`/`description`)
- `CouleurProduit` has `id_couleur_produit`, `couleur` (nested object with `couleur_FR`/`couleur_EN`)
- `CategorieNode` uses `label` (not `nom`), has `id_parent_categorie`, `id_top_categorie`
- `Declinaisons` uses `d1_FR`..`d12_FR` slots (not `tailles` array)
- `ProduitCompositionModel` has `id_composition`, `value`, `famille`, `libelle`
- Photos via REST: `GET /api/product-photos/{id}` returns `{ photos: ["/uploads/products/..."] }`
- Auth returns JWT cookie `auth-token` (Max-Age: 604800 = 7 days)

### Base URLs:
- GraphQL: `https://wapi.efashion-paris.com/graphql`
- REST/Images: `https://wapi.efashion-paris.com`
- Photo paths: `https://wapi.efashion-paris.com/uploads/products/...`

---

## Phase 1: Foundation (Auth + GraphQL Client + Prisma Schema)

### Task 1: Prisma Schema — eFashion models and fields

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add eFashion fields to Product model**

After the existing PFS fields on Product, add:

```prisma
  // ── eFashion Paris sync ──
  efashionProductId      Int?       @unique
  efashionSyncStatus     String?    // null | "pending" | "synced" | "failed"
  efashionSyncError      String?    @db.Text
  efashionSyncedAt       DateTime?
```

- [ ] **Step 2: Add eFashion fields to Color model**

```prisma
  efashionColorId        Int?       // id_couleur on eFashion
```

- [ ] **Step 3: Add eFashion fields to Category model**

```prisma
  efashionCategoryId     Int?       // id_categorie on eFashion
```

- [ ] **Step 4: Add eFashion fields to ProductColor model**

```prisma
  efashionColorId        Int?       // override eFashion color ID for this variant
```

- [ ] **Step 5: Create EfashionMapping model**

```prisma
model EfashionMapping {
  id             String   @id @default(cuid())
  type           String   // "category" | "color" | "composition" | "pack" | "declinaison"
  efashionName   String
  efashionId     Int?
  bjEntityId     String
  bjName         String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([type, efashionName])
  @@index([type])
}
```

- [ ] **Step 6: Create EfashionSyncJob model**

```prisma
model EfashionSyncJob {
  id                String        @id @default(cuid())
  status            PfsSyncStatus @default(PENDING)
  totalProducts     Int           @default(0)
  processedProducts Int           @default(0)
  createdProducts   Int           @default(0)
  updatedProducts   Int           @default(0)
  skippedProducts   Int           @default(0)
  errorProducts     Int           @default(0)
  lastSkip          Int           @default(0)
  errorMessage      String?       @db.Text
  errorDetails      Json?
  failedReferences  Json?
  logs              Json?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  adminId           String
  admin             User          @relation(fields: [adminId], references: [id])

  @@index([status])
  @@index([createdAt])
}
```

- [ ] **Step 7: Create EfashionPrepareJob and EfashionStagedProduct models**

```prisma
model EfashionPrepareJob {
  id                String                  @id @default(cuid())
  status            PfsSyncStatus           @default(PENDING)
  totalProducts     Int                     @default(0)
  processedProducts Int                     @default(0)
  readyProducts     Int                     @default(0)
  errorProducts     Int                     @default(0)
  approvedProducts  Int                     @default(0)
  rejectedProducts  Int                     @default(0)
  lastSkip          Int                     @default(0)
  errorMessage      String?                 @db.Text
  logs              Json?
  analyzeResult     Json?
  adminId           String
  admin             User                    @relation(fields: [adminId], references: [id])
  stagedProducts    EfashionStagedProduct[]
  createdAt         DateTime                @default(now())
  updatedAt         DateTime                @updatedAt

  @@index([status])
  @@index([createdAt])
}

model EfashionStagedProduct {
  id                       String              @id @default(cuid())
  prepareJobId             String
  prepareJob               EfashionPrepareJob  @relation(fields: [prepareJobId], references: [id], onDelete: Cascade)
  efashionProductId        Int
  reference                String
  status                   PfsStagedStatus     @default(PREPARING)
  name                     String
  description              String              @db.Text
  categoryId               Int
  categoryName             String
  isBestSeller             Boolean             @default(false)
  variants                 Json
  compositions             Json
  translations             Json
  imageUrls                Json
  colorData                Json
  manufacturingCountryId   String?
  manufacturingCountryName String?
  errorMessage             String?             @db.Text
  existsInDb               Boolean             @default(false)
  existingProductId        String?
  differences              Json?
  createdProductId         String?
  createdAt                DateTime            @default(now())
  updatedAt                DateTime            @updatedAt

  @@index([prepareJobId])
  @@index([status])
}
```

- [ ] **Step 8: Add User relations for new models**

In the User model, add:

```prisma
  efashionSyncJobs    EfashionSyncJob[]
  efashionPrepareJobs EfashionPrepareJob[]
```

- [ ] **Step 9: Run prisma db push**

```bash
npx prisma db push && npx prisma generate
```

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(efashion): add Prisma models for eFashion sync"
```

---

### Task 2: GraphQL Client — `lib/efashion-graphql.ts`

**Files:**
- Create: `lib/efashion-graphql.ts`

- [ ] **Step 1: Create the GraphQL helper**

```typescript
/**
 * eFashion Paris GraphQL client
 *
 * Cookie-based auth with automatic reconnection.
 * All GraphQL requests go through efashionQuery/efashionMutation.
 */

import { logger } from "@/lib/logger";

const EFASHION_GRAPHQL_URL = "https://wapi.efashion-paris.com/graphql";
const EFASHION_BASE_URL = "https://wapi.efashion-paris.com";

export { EFASHION_GRAPHQL_URL, EFASHION_BASE_URL };

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

let cachedCookie: string | null = null;
let cookieExpiresAt: number = 0;

export function getEfashionCookie(): string | null {
  if (cachedCookie && Date.now() < cookieExpiresAt) {
    return cachedCookie;
  }
  return null;
}

export function setEfashionCookie(cookie: string, maxAgeSeconds: number = 604800): void {
  cachedCookie = cookie;
  // Expire 10 minutes early to avoid edge cases
  cookieExpiresAt = Date.now() + (maxAgeSeconds - 600) * 1000;
}

export function invalidateEfashionCookie(): void {
  cachedCookie = null;
  cookieExpiresAt = 0;
}

/**
 * Execute a GraphQL query or mutation against eFashion API.
 * Requires an active cookie (call efashionLogin first).
 */
export async function efashionGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  cookie?: string
): Promise<T> {
  const authCookie = cookie || getEfashionCookie();
  if (!authCookie) {
    throw new Error("eFashion non authentifié — cookie manquant");
  }

  const res = await fetch(EFASHION_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: authCookie,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion GraphQL error (${res.status}): ${text}`);
  }

  const json: GraphQLResponse<T> = await res.json();

  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    logger.error("[eFashion GraphQL] Errors:", { errors: json.errors });
    throw new Error(`eFashion GraphQL: ${msg}`);
  }

  if (!json.data) {
    throw new Error("eFashion GraphQL: empty response (no data)");
  }

  return json.data;
}

/**
 * Make an authenticated REST request to eFashion.
 */
export async function efashionREST(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const authCookie = getEfashionCookie();
  if (!authCookie) {
    throw new Error("eFashion non authentifié — cookie manquant");
  }

  const url = path.startsWith("http") ? path : `${EFASHION_BASE_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: authCookie,
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/efashion-graphql.ts
git commit -m "feat(efashion): add GraphQL client helper"
```

---

### Task 3: Auth — `lib/efashion-auth.ts`

**Files:**
- Create: `lib/efashion-auth.ts`

- [ ] **Step 1: Create the auth module**

```typescript
/**
 * eFashion Paris Authentication
 *
 * Cookie-based session with in-memory cache.
 * Credentials from SiteConfig (admin settings) with env var fallback.
 */

import { getCachedEfashionCredentials } from "@/lib/cached-data";
import {
  EFASHION_GRAPHQL_URL,
  setEfashionCookie,
  getEfashionCookie,
  invalidateEfashionCookie,
  efashionGraphQL,
} from "@/lib/efashion-graphql";
import { logger } from "@/lib/logger";

/** Vendor ID returned from login — cached after first auth. */
let cachedVendorId: number | null = null;

export function getEfashionVendorId(): number | null {
  return cachedVendorId;
}

/**
 * Authenticate with eFashion and cache the session cookie.
 * Returns the vendor ID.
 */
export async function efashionLogin(): Promise<number> {
  const creds = await getCachedEfashionCredentials();
  const email = creds.email || process.env.EFASHION_EMAIL;
  const password = creds.password || process.env.EFASHION_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Identifiants eFashion manquants — configurer dans Paramètres > Marketplaces"
    );
  }

  const res = await fetch(EFASHION_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation { login(email: "${email}", password: "${password}", rememberMe: true) { user { id_vendeur email nomBoutique } message } }`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion login failed (${res.status}): ${text}`);
  }

  // Extract auth-token cookie
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie || !setCookie.includes("auth-token=")) {
    throw new Error("eFashion login: no auth-token cookie in response");
  }

  const cookieValue = setCookie.split(";")[0]; // "auth-token=..."
  const maxAgeMatch = setCookie.match(/Max-Age=(\d+)/i);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 604800;
  setEfashionCookie(cookieValue, maxAge);

  const data = await res.json();
  const user = data?.data?.login?.user;
  if (!user?.id_vendeur) {
    throw new Error("eFashion login: invalid response — no id_vendeur");
  }

  cachedVendorId = user.id_vendeur;
  logger.info("[eFashion] Authenticated", {
    vendorId: user.id_vendeur,
    boutique: user.nomBoutique,
  });

  return user.id_vendeur;
}

/**
 * Ensure we have a valid eFashion session. Login if needed.
 * Returns the cookie string.
 */
export async function ensureEfashionAuth(): Promise<string> {
  const existing = getEfashionCookie();
  if (existing) return existing;

  await efashionLogin();
  const cookie = getEfashionCookie();
  if (!cookie) throw new Error("eFashion auth: cookie not set after login");
  return cookie;
}

/**
 * Re-authenticate after a failed request (e.g., expired session).
 */
export async function reauthenticateEfashion(): Promise<string> {
  invalidateEfashionCookie();
  return ensureEfashionAuth();
}
```

- [ ] **Step 2: Add eFashion credentials to cached-data.ts**

In `lib/cached-data.ts`, add alongside the PFS credential functions:

```typescript
// ─── eFashion configured? ───────────────────────────────────────────────
export const getCachedHasEfashionConfig = unstable_cache(
  async () => {
    const row = await prisma.siteConfig.findUnique({
      where: { key: "efashion_email" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-efashion-config"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── eFashion enabled? ─────────────────────────────────────────────────
export const getCachedEfashionEnabled = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["efashion_email", "efashion_enabled"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const hasEmail = map.has("efashion_email");
    const enabled = map.get("efashion_enabled");
    return hasEmail && enabled === "true";
  },
  ["efashion-enabled"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── eFashion credentials ──────────────────────────────────────────────
export const getCachedEfashionCredentials = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["efashion_email", "efashion_password"] } },
    });
    const map = new Map(
      rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)])
    );
    return {
      email: map.get("efashion_email") ?? null,
      password: map.get("efashion_password") ?? null,
    };
  },
  ["efashion-credentials"],
  { revalidate: 300, tags: ["site-config"] }
);
```

- [ ] **Step 3: Add eFashion keys to SENSITIVE_KEYS in encryption.ts**

In `lib/encryption.ts`, add to the `SENSITIVE_KEYS` set:

```typescript
  "efashion_email",
  "efashion_password",
```

- [ ] **Step 4: Add eFashion env vars to env.ts**

In `lib/env.ts`, add to the optional section:

```typescript
  EFASHION_EMAIL: z.string().optional(),
  EFASHION_PASSWORD: z.string().optional(),
```

- [ ] **Step 5: Commit**

```bash
git add lib/efashion-auth.ts lib/efashion-graphql.ts lib/cached-data.ts lib/encryption.ts lib/env.ts
git commit -m "feat(efashion): add auth module with cookie-based session"
```

---

### Task 4: API Read Layer — `lib/efashion-api.ts`

**Files:**
- Create: `lib/efashion-api.ts`

- [ ] **Step 1: Create the read-only API client**

```typescript
/**
 * eFashion Paris API — Read operations
 *
 * All product listing, detail, and reference data queries.
 * Uses cookie-based GraphQL auth via efashion-graphql.ts.
 */

import { ensureEfashionAuth, reauthenticateEfashion, getEfashionVendorId } from "@/lib/efashion-auth";
import { efashionGraphQL, efashionREST, EFASHION_BASE_URL } from "@/lib/efashion-graphql";
import { logger } from "@/lib/logger";

// ─── Types ──────────────────────────────────────────────────────────────

export interface EfashionProductListItem {
  id_produit: number;
  id_vendeur: number;
  date_produit: string | null;
  reference: string;
  reference_base: string | null;
  marque: string | null;
  collection: string | null;
  categorie: string | null;
  id_categorie: number | null;
  prix: number;
  promotion: number | null;
  poids: number | null;
  visible: boolean;
  supprimer: boolean;
  id_couleur: number | null;
  couleur: string | null;
  stock_value: number | null;
  stock_renseigne: boolean | null;
  liaison: number | null;
  vendu_par: string; // "couleurs" | "assortiment"
  id_pack: number | null;
  id_declinaison: number | null;
  id_collection: number | null;
  id_vendeur_marque: number | null;
  id_provenance: number | null;
  provenance: string | null;
  prixReduit: number | null;
  premel: string | null;
  nb_photos: number;
}

export interface EfashionProduct {
  id_produit: string;
  reference: string;
  reference_base: string | null;
  id_categorie: number;
  id_vendeur: number;
  id_declinaison: number | null;
  id_pack: number | null;
  id_collection: number | null;
  id_provenance: number | null;
  vendu_par: string;
  prix: string; // returned as string
  prixReduit: number | null;
  poids: number;
  visible: boolean;
  supprimer: boolean;
  nb_photos: number;
  qteMini: number | null;
  dimension: string | null;
  dateCreation: string;
  dateModification: string;
  premel: string;
}

export interface EfashionCouleurProduit {
  id_couleur_produit: string;
  id_couleur: number;
  id_produit: number;
  description_paquet: string | null;
  reception: boolean;
  photo: boolean;
  couleur: {
    id_couleur: string;
    couleur_FR: string;
    couleur_EN: string;
    defaut: number;
  };
}

export interface EfashionDescription {
  id_produit: number;
  texte_fr: string | null;
  texte_uk: string | null;
  instructions: string | null;
  commentaires: string | null;
}

export interface EfashionStock {
  id_produit_stock: string;
  id_produit: number;
  id_couleur: number;
  value: number;
  taille: string | null;
}

export interface EfashionComposition {
  id_composition: number;
  id_composition_localisation: number;
  value: number | null;
  famille: string;
  libelle: string;
}

export interface EfashionCategoryNode {
  id_categorie: number;
  label: string;
  id_parent_categorie: number | null;
  id_top_categorie: number | null;
  children: EfashionCategoryNode[];
}

export interface EfashionPack {
  id_pack: string;
  id_vendeur: number;
  titre: string;
  p1: number; p2: number; p3: number; p4: number;
  p5: number; p6: number; p7: number; p8: number;
  p9: number; p10: number; p11: number; p12: number;
}

export interface EfashionDeclinaison {
  id_declinaison: string;
  d1_FR: string | null; d2_FR: string | null; d3_FR: string | null; d4_FR: string | null;
  d5_FR: string | null; d6_FR: string | null; d7_FR: string | null; d8_FR: string | null;
  d9_FR: string | null; d10_FR: string | null; d11_FR: string | null; d12_FR: string | null;
}

export interface EfashionDefaultColor {
  id_couleur: string;
  couleur_FR: string;
  couleur_EN: string;
  defaut: number;
}

// ─── Retry wrapper ──────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 15000];

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await ensureEfashionAuth();
      return await fn();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      // Auth expired — reauthenticate and retry
      if (msg.includes("non authentifié") || msg.includes("401") || msg.includes("Unauthorized")) {
        logger.warn(`[eFashion] Auth expired during ${label}, re-authenticating...`);
        await reauthenticateEfashion();
        if (attempt < MAX_RETRIES) continue;
      }

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || 15000;
        logger.warn(`[eFashion] ${label} failed (attempt ${attempt + 1}), retrying in ${delay}ms...`, { error: msg });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw error;
    }
  }
  throw new Error(`[eFashion] ${label} failed after ${MAX_RETRIES} retries`);
}

// ─── Product Queries ────────────────────────────────────────────────────

const PRODUCT_LIST_FIELDS = `
  id_produit reference reference_base marque collection categorie
  id_categorie prix promotion poids visible supprimer id_couleur couleur
  stock_value stock_renseigne liaison vendu_par id_pack id_declinaison
  id_collection id_vendeur_marque id_provenance provenance prixReduit premel nb_photos
`;

export async function efashionListProducts(
  skip: number = 0,
  take: number = 100,
  statut: "TOUS" | "EN_VENTE" | "HORS_LIGNE" | "RUPTURE" = "EN_VENTE"
): Promise<{ items: EfashionProductListItem[]; total: number }> {
  const vendorId = getEfashionVendorId();
  if (!vendorId) throw new Error("eFashion vendor ID not available — login first");

  return withRetry(async () => {
    const data = await efashionGraphQL<{
      productsPage: { items: EfashionProductListItem[]; total: number };
    }>(
      `query($filter: ProduitFilterInput!) {
        productsPage(filter: $filter) {
          items { ${PRODUCT_LIST_FIELDS} }
          total
        }
      }`,
      {
        filter: {
          id_vendeur: vendorId,
          skip,
          take,
          statut,
          orderBy: "dateModification",
          orderDir: "DESC",
        },
      }
    );
    return data.productsPage;
  }, `listProducts(skip=${skip})`);
}

const PRODUCT_DETAIL_FIELDS = `
  id_produit reference reference_base id_categorie id_vendeur
  id_declinaison id_pack id_collection id_provenance vendu_par
  prix prixReduit poids visible supprimer nb_photos qteMini
  dimension dateCreation dateModification premel
`;

export async function efashionGetProduct(id: number): Promise<EfashionProduct> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{ produit: EfashionProduct }>(
      `query { produit(id: ${id}) { ${PRODUCT_DETAIL_FIELDS} } }`
    );
    return data.produit;
  }, `getProduct(${id})`);
}

export async function efashionGetProductColors(
  id: number
): Promise<EfashionCouleurProduit[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      couleursProduitByProduitId: EfashionCouleurProduit[];
    }>(
      `query { couleursProduitByProduitId(id_produit: ${id}) {
        id_couleur_produit id_couleur id_produit description_paquet reception photo
        couleur { id_couleur couleur_FR couleur_EN defaut }
      } }`
    );
    return data.couleursProduitByProduitId;
  }, `getProductColors(${id})`);
}

export async function efashionGetProductDescription(
  id: number
): Promise<EfashionDescription> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      produitDescription: EfashionDescription;
    }>(
      `query { produitDescription(id_produit: ${id}) {
        id_produit texte_fr texte_uk instructions commentaires
      } }`
    );
    return data.produitDescription;
  }, `getProductDescription(${id})`);
}

export async function efashionGetProductStocks(
  id: number
): Promise<EfashionStock[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      produitStocks: EfashionStock[];
    }>(
      `query { produitStocks(id_produit: ${id}) {
        id_produit_stock id_produit id_couleur value taille
      } }`
    );
    return data.produitStocks;
  }, `getProductStocks(${id})`);
}

export async function efashionGetProductCompositions(
  id: number
): Promise<EfashionComposition[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      produitCompositions: EfashionComposition[];
    }>(
      `query { produitCompositions(id_produit: ${id}, lang: "fr") {
        id_composition id_composition_localisation value famille libelle
      } }`
    );
    return data.produitCompositions;
  }, `getProductCompositions(${id})`);
}

/**
 * Fetch product photos via REST API.
 * Returns array of relative paths (e.g., "/uploads/products/2017/...").
 */
export async function efashionGetProductPhotos(
  id: number
): Promise<string[]> {
  return withRetry(async () => {
    const res = await efashionREST(`/api/product-photos/${id}`);
    if (!res.ok) {
      throw new Error(`eFashion photos error (${res.status})`);
    }
    const data = await res.json();
    return data.photos || [];
  }, `getProductPhotos(${id})`);
}

/**
 * Fetch all product details in parallel.
 */
export async function efashionGetProductDetails(id: number) {
  const [product, colors, description, stocks, compositions, photos] =
    await Promise.all([
      efashionGetProduct(id),
      efashionGetProductColors(id),
      efashionGetProductDescription(id),
      efashionGetProductStocks(id),
      efashionGetProductCompositions(id),
      efashionGetProductPhotos(id),
    ]);

  return { product, colors, description, stocks, compositions, photos };
}

// ─── Reference Data ─────────────────────────────────────────────────────

export async function efashionGetCategories(): Promise<EfashionCategoryNode[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      categoriesTree: EfashionCategoryNode[];
    }>(
      `query { categoriesTree(lang: "fr") {
        id_categorie label id_parent_categorie id_top_categorie
        children { id_categorie label id_parent_categorie id_top_categorie children { id_categorie label } }
      } }`
    );
    return data.categoriesTree;
  }, "getCategories");
}

export async function efashionGetDefaultColors(): Promise<EfashionDefaultColor[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      allCouleursDefaut: EfashionDefaultColor[];
    }>(
      `query { allCouleursDefaut { id_couleur couleur_FR couleur_EN defaut } }`
    );
    return data.allCouleursDefaut;
  }, "getDefaultColors");
}

export async function efashionGetPacks(): Promise<EfashionPack[]> {
  const vendorId = getEfashionVendorId();
  if (!vendorId) throw new Error("eFashion vendor ID not available");

  return withRetry(async () => {
    const data = await efashionGraphQL<{ packsByVendeur: EfashionPack[] }>(
      `query { packsByVendeur(id_vendeur: ${vendorId}) {
        id_pack id_vendeur titre p1 p2 p3 p4 p5 p6 p7 p8 p9 p10 p11 p12
      } }`
    );
    return data.packsByVendeur;
  }, "getPacks");
}

export async function efashionGetDeclinaisons(): Promise<EfashionDeclinaison[]> {
  const vendorId = getEfashionVendorId();
  if (!vendorId) throw new Error("eFashion vendor ID not available");

  return withRetry(async () => {
    const data = await efashionGraphQL<{
      declinaisonsByVendeur: EfashionDeclinaison[];
    }>(
      `query { declinaisonsByVendeur(idVendeur: ${vendorId}) {
        id_declinaison d1_FR d2_FR d3_FR d4_FR d5_FR d6_FR d7_FR d8_FR d9_FR d10_FR d11_FR d12_FR
      } }`
    );
    return data.declinaisonsByVendeur;
  }, "getDeclinaisons");
}

export async function efashionTotalProducts(
  statut: "TOUS" | "EN_VENTE" = "EN_VENTE"
): Promise<number> {
  const vendorId = getEfashionVendorId();
  if (!vendorId) throw new Error("eFashion vendor ID not available");

  return withRetry(async () => {
    const data = await efashionGraphQL<{
      productsPage: { total: number };
    }>(
      `query { productsPage(filter: { id_vendeur: ${vendorId}, skip: 0, take: 1, statut: ${statut} }) { total } }`
    );
    return data.productsPage.total;
  }, "totalProducts");
}

/**
 * Get full image URL from a relative path.
 */
export function efashionImageUrl(relativePath: string): string {
  if (relativePath.startsWith("http")) return relativePath;
  return `${EFASHION_BASE_URL}${relativePath}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/efashion-api.ts
git commit -m "feat(efashion): add read-only API client"
```

---

### Task 5: Admin Settings — eFashion credentials UI

**Files:**
- Modify: `app/actions/admin/site-config.ts` (add eFashion credential actions)
- Modify: `components/admin/settings/MarketplaceConfig.tsx` (add eFashion section)

- [ ] **Step 1: Add eFashion server actions to site-config.ts**

Add alongside the existing PFS functions:

```typescript
// ─── eFashion Paris Configuration ────────────────────────────────────────────

export async function updateEfashionCredentials(config: {
  email: string;
  password: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { email, password } = config;

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
      upsertOrDelete("efashion_email", email),
      upsertOrDelete("efashion_password", password),
    ]);

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

export async function validateEfashionCredentials(config: {
  email: string;
  password: string;
}): Promise<{ valid: boolean; vendorId?: number; boutique?: string; error?: string }> {
  try {
    await requireAdmin();
    const res = await fetch("https://wapi.efashion-paris.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `mutation { login(email: "${config.email.trim()}", password: "${config.password.trim()}", rememberMe: true) { user { id_vendeur nomBoutique } message } }`,
      }),
    });
    if (!res.ok) return { valid: false, error: `Erreur (${res.status})` };
    const data = await res.json();
    const user = data?.data?.login?.user;
    if (!user?.id_vendeur) return { valid: false, error: "Réponse invalide." };
    return { valid: true, vendorId: user.id_vendeur, boutique: user.nomBoutique };
  } catch {
    return { valid: false, error: "Impossible de contacter eFashion Paris." };
  }
}

export async function toggleEfashionEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.siteConfig.upsert({
      where: { key: "efashion_enabled" },
      update: { value: enabled ? "true" : "false" },
      create: { key: "efashion_enabled", value: enabled ? "true" : "false" },
    });
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
```

- [ ] **Step 2: Add eFashion section to MarketplaceConfig.tsx**

Duplicate the PFS config section pattern but with:
- Title: "eFashion Paris"
- Fields: efashion_email, efashion_password
- Validation: calls `validateEfashionCredentials`
- Save: calls `updateEfashionCredentials`
- Toggle: calls `toggleEfashionEnabled`
- Use `getCachedEfashionEnabled` and `getCachedEfashionCredentials` for initial state

- [ ] **Step 3: Commit**

```bash
git add app/actions/admin/site-config.ts components/admin/settings/MarketplaceConfig.tsx
git commit -m "feat(efashion): add credentials management in admin settings"
```

---

## Phase 2: Import Pipeline (eFashion → BJ)

### Task 6: Analyze — `lib/efashion-analyze.ts`

**Files:**
- Create: `lib/efashion-analyze.ts`

The analyze module scans eFashion products and detects missing entity mappings (categories, colors, compositions) before import. Follow the same pattern as `lib/pfs-analyze.ts`:
- Paginate through products (skip/take)
- For each new product (not in DB by efashionProductId), check category/color mappings
- Collect missing entities with counts
- Save result to `EfashionPrepareJob.analyzeResult`
- Status: ANALYZING → NEEDS_VALIDATION (if missing) or COMPLETED (if none)

Key differences from PFS:
- Use `efashionListProducts()` for pagination
- Categories are `id_categorie` (int) mapped via `EfashionMapping`
- Colors are `id_couleur` with `couleur_FR` name
- Use `efashionGetProductDetails()` for compositions

- [ ] **Step 1: Implement efashion-analyze.ts** (follow pfs-analyze.ts pattern, adapted for eFashion types)
- [ ] **Step 2: Commit**

---

### Task 7: Prepare — `lib/efashion-prepare.ts`

**Files:**
- Create: `lib/efashion-prepare.ts`

Follow `lib/pfs-prepare.ts` pattern:
- Paginate products, skip existing
- For each: fetch details in parallel, resolve mappings
- Create `EfashionStagedProduct` with all data + image URLs (no download yet)
- Approve: download images → processProductImage → upload R2 → create Product in DB

Key differences from PFS:
- Photos come from REST endpoint, not CDN URL parsing
- Image URLs: `https://wapi.efashion-paris.com/uploads/products/...`
- Descriptions: `texte_fr` / `texte_uk` (not per-language array)
- Colors: `id_couleur` int with nested `couleur` object
- `vendu_par`: "couleurs" (≈ UNIT) or "assortiment" (≈ PACK)

- [ ] **Step 1: Implement efashion-prepare.ts**
- [ ] **Step 2: Commit**

---

### Task 8: API Routes — `app/api/admin/efashion-sync/`

**Files:**
- Create: `app/api/admin/efashion-sync/route.ts` (POST start, GET status)
- Create: `app/api/admin/efashion-sync/analyze/route.ts`
- Create: `app/api/admin/efashion-sync/count/route.ts`
- Create: `app/api/admin/efashion-sync/attributes/route.ts`
- Create: `app/api/admin/efashion-sync/mapping-data/route.ts`
- Create: `app/api/admin/efashion-sync/create-entities/route.ts`
- Create: `app/api/admin/efashion-sync/prepare/route.ts`
- Create: `app/api/admin/efashion-sync/prepare/history/route.ts`
- Create: `app/api/admin/efashion-sync/staged/[id]/approve/route.ts`
- Create: `app/api/admin/efashion-sync/staged/[id]/reject/route.ts`
- Create: `app/api/admin/efashion-sync/staged/approve-bulk/route.ts`
- Create: `app/api/admin/efashion-sync/staged/reject-bulk/route.ts`

Follow exact same patterns as `app/api/admin/pfs-sync/` routes, but using eFashion models and functions.

- [ ] **Step 1: Implement all API routes** (follow pfs-sync routes as template)
- [ ] **Step 2: Commit**

---

### Task 9: Admin Pages — `/admin/efashion/`

**Files:**
- Create: `app/(admin)/admin/efashion/page.tsx` (server wrapper)
- Create: `app/(admin)/admin/efashion/EfashionSyncPageClient.tsx` (client)
- Create: `app/(admin)/admin/efashion/mapping/page.tsx`
- Create: `app/(admin)/admin/efashion/historique/page.tsx`
- Create: `app/(admin)/admin/efashion/historique/[id]/page.tsx`

Follow PFS page patterns. `page.tsx` checks `getCachedEfashionEnabled()`, redirects if not configured.

- [ ] **Step 1: Create page server wrappers**
- [ ] **Step 2: Create EfashionSyncPageClient**
- [ ] **Step 3: Commit**

---

### Task 10: Components — `components/efashion/`

**Files:**
- Create: `components/efashion/EfashionMappingClient.tsx`
- Create: `components/efashion/EfashionValidationPanel.tsx`
- Create: `components/efashion/EfashionHistoryClient.tsx`
- Create: `components/efashion/EfashionReviewGrid.tsx`
- Create: `components/efashion/EfashionStagedProductCard.tsx`

Follow PFS component patterns. Key adaptations:
- Mapping tabs: categories, colors, compositions (not countries/seasons which eFashion doesn't have)
- Category tree: hierarchical with `label` field
- Colors: `id_couleur` + `couleur_FR` (not string ref)

- [ ] **Step 1: Implement mapping and validation components**
- [ ] **Step 2: Implement history and review components**
- [ ] **Step 3: Commit**

---

### Task 11: Admin Navigation — Add eFashion to sidebar

**Files:**
- Modify: `app/(admin)/layout.tsx`

- [ ] **Step 1: Add eFashion section to admin nav**

Add eFashion to `ADMIN_NAV_SECTIONS` alongside the existing structure. Conditionally show based on `getCachedEfashionEnabled()`.

- [ ] **Step 2: Commit**

---

## Phase 3: Reverse Sync (BJ → eFashion)

### Task 12: API Write Layer — `lib/efashion-api-write.ts`

**Files:**
- Create: `lib/efashion-api-write.ts`

Implement write operations using eFashion mutations:
- `efashionCreateProduct()` → mutation `createProduit`
- `efashionUpdateProduct()` → mutation `updateProduit`
- `efashionSaveStocks()` → mutation `saveProduitStocks`
- `efashionSaveDescription()` → mutation `saveProduitDescription`
- `efashionUpdateColors()` → mutation `updateProduitCouleursProduit`
- `efashionSetVisible()` → mutation `setProduitsVisible`
- `efashionUploadImage()` → REST POST `/api/upload-product-photo`
- `efashionDeleteImage()` → REST POST `/api/product-photo/delete`

- [ ] **Step 1: Implement write operations**
- [ ] **Step 2: Commit**

---

### Task 13: Reverse Sync — `lib/efashion-reverse-sync.ts`

**Files:**
- Create: `lib/efashion-reverse-sync.ts`

Follow `lib/pfs-reverse-sync.ts` pattern:
- `triggerEfashionSync(productId)` — fire-and-forget
- `syncProductToEfashion(productId)` — diff-based push
- Load product with all relations
- Validate eFashion mappings exist
- Create on eFashion if new, diff-update if existing
- Sync: metadata, stocks, colors, descriptions, images
- Update `efashionSyncStatus` on Product

Status mapping:
- ONLINE → `visible: true`
- OFFLINE → `visible: false`
- ARCHIVED → `softDeleteProduit`

- [ ] **Step 1: Implement reverse sync**
- [ ] **Step 2: Commit**

---

### Task 14: Integrate reverse sync triggers

**Files:**
- Modify: `app/actions/admin/products.ts` (or wherever createProduct/updateProduct live)
- Create: `app/actions/admin/efashion-reverse-sync.ts`

- [ ] **Step 1: Create force sync action**

```typescript
"use server";

import { requireAdmin } from "@/lib/auth";
import { syncProductToEfashion } from "@/lib/efashion-reverse-sync";

export async function forceEfashionSync(
  productId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await syncProductToEfashion(productId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
```

- [ ] **Step 2: Add triggerEfashionSync alongside triggerPfsSync**

In each server action that currently calls `triggerPfsSync()`, add `triggerEfashionSync()` right after (non-blocking).

- [ ] **Step 3: Commit**

---

### Task 15: Live Compare & Sync Button

**Files:**
- Create: `components/efashion/EfashionSyncButton.tsx`
- Create: `components/efashion/EfashionLiveCompareModal.tsx`
- Create: `app/api/admin/efashion-sync/live-check/[productId]/route.ts`

Follow PFS PfsSyncButton + PfsLiveCompareModal patterns. The sync button appears on each product form alongside the PFS sync button.

- [ ] **Step 1: Create live-check API route**
- [ ] **Step 2: Create EfashionSyncButton component**
- [ ] **Step 3: Create EfashionLiveCompareModal**
- [ ] **Step 4: Add EfashionSyncButton to product form** (alongside existing PfsSyncButton)
- [ ] **Step 5: Commit**

---

## Phase 4: Final Integration

### Task 16: Update CLAUDE.md and documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `EFASHION_API_DOCUMENTATION.md` (fix field names based on introspection)

- [ ] **Step 1: Add eFashion section to CLAUDE.md**

Document: new env vars, new lib files, new routes, eFashion-specific gotchas.

- [ ] **Step 2: Fix EFASHION_API_DOCUMENTATION.md**

Update field names to match real schema: `items` not `products`, `texte_fr` not `titre`, `label` not `nom`, etc.

- [ ] **Step 3: Commit**
