# Ankorstore Integration — Design Spec

**Date**: 2026-03-31
**Scope**: Bidirectional product sync between BJ platform and Ankorstore marketplace
**Approach**: Copy-adapt PFS pattern (no shared abstraction layer)
**Reference**: `docs/ankorstore-system.md` (API documentation)

---

## 1. Architecture Overview

### New Files

| File | Purpose |
|------|---------|
| `lib/ankorstore-auth.ts` | OAuth2 token cache (client_credentials, 1h expiry, refresh at 50min) |
| `lib/ankorstore-api.ts` | Read API: list products, get product, get variant (cursor pagination) |
| `lib/ankorstore-api-write.ts` | Write API: PATCH variant stock, PATCH variant prices |
| `lib/ankorstore-sync.ts` | Import pipeline (AK → BJ): paginate, match, create/update products |
| `lib/ankorstore-reverse-sync.ts` | Export pipeline (BJ → AK): fire-and-forget stock/price push |
| `lib/ankorstore-analyze.ts` | Pre-sync analysis: detect unmapped productTypeIds |
| `app/api/admin/ankorstore-sync/route.ts` | POST (start sync), GET (status) |
| `app/api/admin/ankorstore-sync/cancel/route.ts` | POST cancel sync |
| `app/api/admin/ankorstore-sync/analyze/route.ts` | POST SSE dry-run analysis |
| `app/api/admin/ankorstore-sync/mapping-data/route.ts` | GET mapping data |
| `app/(admin)/admin/ankorstore/page.tsx` | Dashboard: status, stats, sync button |
| `app/(admin)/admin/ankorstore/mapping/page.tsx` | productTypeId ↔ Category mapping UI |
| `app/(admin)/admin/ankorstore/historique/page.tsx` | Sync job history |
| `app/actions/admin/ankorstore-sync.ts` | Server actions for sync operations |

### Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add AK fields to Product/ProductColor, new models |
| `lib/cached-data.ts` | Add `getCachedAnkorstoreCredentials()`, `getCachedAnkorstoreEnabled()` |
| `lib/encryption.ts` | Add `ankorstore_client_secret` to `SENSITIVE_KEYS` |
| `components/admin/Sidebar.tsx` | Add Ankorstore nav item |
| Admin settings page | Add Ankorstore config section (client_id, client_secret, toggle) |

---

## 2. Prisma Schema Changes

### Product (additional fields)

```prisma
akProductId    String?   @unique   // Ankorstore product UUID
akSyncStatus   String?             // null | "pending" | "synced" | "failed"
akSyncError    String?   @db.Text
akSyncedAt     DateTime?
```

### ProductColor (additional field)

```prisma
akVariantId    String?   @unique   // Ankorstore variant UUID
```

### AnkorstoreSyncJob (new model)

```prisma
model AnkorstoreSyncJob {
  id                 Int       @id @default(autoincrement())
  status             String    @default("PENDING")  // PENDING | RUNNING | COMPLETED | FAILED | CANCELLED
  startedAt          DateTime?
  completedAt        DateTime?
  totalProducts      Int       @default(0)
  processedProducts  Int       @default(0)
  newProducts        Int       @default(0)
  updatedProducts    Int       @default(0)
  failedProducts     Int       @default(0)
  skippedProducts    Int       @default(0)
  lastCursor         String?   // Resume point (AK cursor)
  error              String?   @db.Text
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
}
```

### AnkorstoreMapping (new model)

```prisma
model AnkorstoreMapping {
  id          Int     @id @default(autoincrement())
  type        String  // "productType"
  akValue     String  // Ankorstore value (e.g., "6716")
  akName      String  // Ankorstore display name (e.g., "Colliers")
  bjEntityId  Int     // BJ entity ID (e.g., category ID)
  bjName      String  // BJ entity name (e.g., "Colliers")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([type, akValue])
}
```

---

## 3. Authentication (`lib/ankorstore-auth.ts`)

Pattern: Token cache with proactive refresh (like `lib/pfs-auth.ts`).

- OAuth2 `client_credentials` grant
- Token cached in module-level variable
- Refresh when <10 min remaining (token lasts 60 min)
- Credentials from SiteConfig (encrypted) with env var fallback
- On 401 response, invalidate cache and retry once

```typescript
export async function getAnkorstoreToken(): Promise<string>
export async function ankorstoreFetch(path: string, options?: RequestInit): Promise<Response>
```

`ankorstoreFetch` is the base helper — adds auth header, handles 401 retry, respects rate limits.

---

## 4. Read API (`lib/ankorstore-api.ts`)

```typescript
// Paginate all products with variants
export async function akListProducts(cursor?: string): Promise<{
  products: AkProduct[];
  variants: AkVariant[];
  nextCursor: string | null;
}>

// Single product with variants
export async function akGetProduct(id: string): Promise<AkProduct & { variants: AkVariant[] }>

// Single variant
export async function akGetVariant(id: string): Promise<AkVariant>
```

Types:
```typescript
interface AkProduct {
  id: string;
  name: string;
  description: string;
  productTypeId: number;
  wholesalePrice: number;  // centimes
  retailPrice: number;     // centimes
  active: boolean;
  archived: boolean;
  outOfStock: boolean;
  images: { order: number; url: string }[];
  variantIds: string[];
}

interface AkVariant {
  id: string;
  name: string;
  sku: string;
  wholesalePrice: number;  // centimes
  retailPrice: number;     // centimes
  isAlwaysInStock: boolean;
  stockQuantity: number | null;
  availableQuantity: number | null;
  images: { order: number; url: string }[];
}
```

---

## 5. Write API (`lib/ankorstore-api-write.ts`)

```typescript
// Update variant stock
export async function akUpdateStock(variantId: string, opts: {
  isAlwaysInStock?: boolean;
  stockQuantity?: number;
}): Promise<AkVariant>

// Update variant prices
export async function akUpdatePrices(variantId: string, opts: {
  wholesalePrice: number;  // centimes
  retailPrice: number;     // centimes
}): Promise<AkVariant>
```

---

## 6. Import Pipeline (`lib/ankorstore-sync.ts`)

### Flow

1. Create `AnkorstoreSyncJob` (status: RUNNING)
2. Paginate AK products (50/page with variants)
3. For each page (10 products in parallel):
   a. Extract reference from SKU (part before `_`)
   b. Check if Product exists in BJ by reference
   c. **Existing**: Update prices, stock, images if changed
   d. **New**: Create Product + ProductColors + download images
4. Track progress on SyncJob (processedProducts, lastCursor)
5. On completion/failure, update SyncJob status

### Reference Extraction

SKU format: `{REFERENCE}_{COLOR}` (e.g., `COLLIERDOS09_DORÉ`)

```typescript
function extractReference(sku: string): string {
  // Split on first underscore — reference is everything before
  const idx = sku.indexOf('_');
  return idx > 0 ? sku.substring(0, idx) : sku;
}

function extractColor(sku: string): string {
  const idx = sku.indexOf('_');
  return idx > 0 ? sku.substring(idx + 1).trim() : '';
}
```

### Price Conversion

AK prices are in centimes (integer). BJ uses Decimal (euros).

```typescript
function akPriceToBj(centimes: number): number {
  return centimes / 100;  // 560 → 5.60
}

function bjPriceToAk(euros: number): number {
  return Math.round(euros * 100);  // 5.60 → 560
}
```

### Image Pipeline

1. Download from `img.ankorstore.com` (direct HTTP, no Playwright needed)
2. Strip `?auto=format` from URL to get original
3. Process with `processProductImage()` → WebP 3 sizes
4. Upload to R2
5. Save ProductColorImage records

Concurrency: 15 simultaneous downloads (same as PFS).

### Category Mapping

AK `productTypeId` → BJ `Category` via `AnkorstoreMapping` table.
Pre-sync analysis detects unmapped productTypeIds.
Admin maps them in `/admin/ankorstore/mapping` before running sync.

### Resumability

If sync is interrupted, resume from `lastCursor` stored on SyncJob.
API route: `POST /api/admin/ankorstore-sync?resume=true`

---

## 7. Reverse Sync (`lib/ankorstore-reverse-sync.ts`)

### Trigger

Called from product update actions (same pattern as `triggerPfsSync`):

```typescript
export function triggerAnkorstoreSync(productId: number): void
```

### Flow

1. Load product with colors (where `akVariantId` is set)
2. For each ProductColor with `akVariantId`:
   - Compare BJ stock vs AK stock → `akUpdateStock()` if different
   - Compare BJ price vs AK price → `akUpdatePrices()` if different
3. Update `akSyncStatus` / `akSyncedAt` on Product

### Diff-based

Only push changed fields (like PFS reverse sync). Fetch current AK variant state first, compare, then PATCH only if different.

---

## 8. Admin UI

### Dashboard (`/admin/ankorstore`)

- Connection status indicator (test OAuth2 token)
- Last sync summary (date, products synced, errors)
- "Lancer l'analyse" button → SSE dry-run
- "Lancer la synchronisation" button → starts sync
- Progress bar during sync (poll SyncJob)
- Link to mapping page if unmapped productTypeIds detected

### Mapping (`/admin/ankorstore/mapping`)

- Table: AK productTypeId | AK name (auto-detected) | BJ Category (dropdown)
- Save mappings to `AnkorstoreMapping` table
- Visual indicator for unmapped entries

### Historique (`/admin/ankorstore/historique`)

- List of AnkorstoreSyncJob records
- Status badges, timestamps, product counts
- Error details expandable

### Settings (in existing admin settings page)

- `ankorstore_client_id` (text input)
- `ankorstore_client_secret` (password input, encrypted)
- `ankorstore_enabled` (toggle)
- "Tester la connexion" button

---

## 9. SSE Analysis (`lib/ankorstore-analyze.ts`)

Pre-sync dry run via SSE (like PFS analyze):

1. Paginate first N pages of AK products
2. Collect all unique `productTypeId` values
3. Check which are mapped vs unmapped
4. Stream progress + results to client

---

## 10. Error Handling

- **Auth failures**: Retry once with fresh token, then fail with clear error
- **Rate limits (429)**: Read `Retry-After` header, wait, retry (max 3 retries)
- **Network errors**: Exponential backoff (2s → 4s → 8s, max 3 retries)
- **Per-product errors**: Log and continue (don't fail entire sync)
- **Sync job errors**: Store error text on SyncJob, set status FAILED

---

## 11. Config & Secrets

New SiteConfig keys (encrypted where marked):

| Key | Encrypted | Purpose |
|-----|-----------|---------|
| `ankorstore_client_id` | No | OAuth2 client ID |
| `ankorstore_client_secret` | Yes | OAuth2 client secret |
| `ankorstore_enabled` | No | Feature toggle |

Add `ankorstore_client_secret` to `SENSITIVE_KEYS` in `lib/encryption.ts`.

---

## 12. Testing Strategy

1. **Auth**: Test token acquisition and refresh
2. **Read API**: Test pagination, product parsing
3. **Write API**: Test stock/price updates on a test variant
4. **Import**: Test with `limit` parameter (sync first N products)
5. **Reverse sync**: Manually change a price in BJ, verify it pushes to AK
6. **Edge cases**: Duplicate references, missing images, rate limit handling
