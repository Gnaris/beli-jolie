# API Ankorstore - Documentation

> Base URL: `https://www.ankorstore.com/api/v1` | Format: JSON:API v1.0 | ~9 193 produits | Env: `ankorstore_client_id`, `ankorstore_client_secret` (SiteConfig chiffré)
> Official docs: https://ankorstore.github.io/api-docs/ | Support: api@ankorstore.com

---

## 1. Authentication

**Method**: OAuth2 Client Credentials

```
POST https://www.ankorstore.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={client_id}&client_secret={client_secret}&scope=*
```

**Response**:
```json
{
  "token_type": "Bearer",
  "expires_in": 3600,
  "access_token": "eyJ..."
}
```

**Token lifetime**: 1 hour. Refresh 5-10 min before expiry.
`/oauth/token` rate limit: **60 requests/hour** — never request per API call.

**Credentials**: Stored encrypted in `SiteConfig` table (`ankorstore_client_id`, `ankorstore_client_secret`).

---

## 2. API Conventions

| Item | Value |
|------|-------|
| Base URL | `https://www.ankorstore.com/api/v1` |
| Format | JSON:API v1.0 |
| Accept header | `application/vnd.api+json` |
| Content-Type | `application/vnd.api+json` |
| Pagination | Cursor-based (`page[after]`, `page[before]`, `page[limit]`) |
| Page limit | Min 3, max 50 |
| Rate limits | 600/min, 24K/hour, 288K/day (authenticated) |

**Rate limit headers**:
- `X-RateLimit-Remaining`
- `X-RateLimit-Limit`
- `Retry-After` (on 429)
- `X-RateLimit-Reset` (Unix timestamp)

**Pagination response**:
```json
{
  "meta": { "page": { "from": "uuid", "to": "uuid", "hasMore": true, "perPage": 50 } },
  "links": { "first": "...", "next": "...", "prev": "..." }
}
```

---

## 3. Product Data Model (READ — verified via live API)

### Product (`type: "products"`)

```json
{
  "type": "products",
  "id": "uuid",
  "attributes": {
    "name": "string",                    // Product name
    "description": "string",             // HTML or plain text
    "language": "fr",                    // Language code
    "dimensions": null,                  // Optional dimensions
    "netWeight": null,                   // Optional weight (grams)
    "capacity": null,                    // Optional capacity
    "position": 0,                       // Display order
    "unitMultiplier": 1,                 // Units per order item
    "vatRate": 20,                       // VAT percentage
    "discountRate": 0,                   // Discount percentage (0-100)
    "productTypeId": 6716,               // Ankorstore category ID
    "active": true,                      // Is visible/purchasable
    "outOfStock": false,                 // Stock status flag
    "archived": false,                   // Archived flag
    "retailPrice": 1680,                 // Retail price in CENTS
    "wholesalePrice": 560,               // Wholesale price in CENTS
    "originalWholesalePrice": 560,       // Before any discount
    "createdAt": "2026-03-31T12:00:34+00:00",
    "indexedAt": null,                   // Search index timestamp
    "updatedAt": "2026-03-31T19:28:37+00:00",
    "images": [                          // Product-level images
      { "order": 1, "url": "https://img.ankorstore.com/media/{uuid}.jpg?auto=format" }
    ],
    "tags": []                           // String tags array
  },
  "relationships": {
    "productVariants": {
      "data": [
        { "type": "productVariants", "id": "uuid" }
      ]
    }
  }
}
```

### ProductVariant (`type: "productVariants"`)

```json
{
  "type": "productVariants",
  "id": "uuid",
  "attributes": {
    "name": "string",                    // Variant display name
    "sku": "COLLIERDOS09_DORÉ",          // Unique SKU
    "ian": null,                         // EAN/barcode (nullable)
    "createdAt": "2026-03-31T12:00:34+00:00",
    "updatedAt": "2026-03-31T12:00:35+00:00",
    "archivedAt": null,                  // Archived timestamp
    "retailPrice": 1680,                 // Retail in CENTS
    "wholesalePrice": 560,               // Wholesale in CENTS
    "originalWholesalePrice": 560,       // Before discount
    "fulfillableId": null,               // Fulfillment center ID
    "availableAt": null,                 // Availability date
    "images": [                          // Variant-specific images
      { "order": 1, "url": "https://img.ankorstore.com/media/{uuid}.jpg?auto=format" }
    ],
    "isAlwaysInStock": true,             // Infinite stock mode
    "availableQuantity": null,           // Available (when not always-in-stock)
    "reservedQuantity": null,            // Reserved for orders
    "stockQuantity": null                // Total stock (when not always-in-stock)
  }
}
```

### Key observations from live data

- **Prices in centimes** (€5.60 = `560`)
- **SKU format**: `{REFERENCE}_{COLOR}` (e.g., `COLLIERDOS09_DORÉ`, `COLLIERDOS09_ ARGENT`)
- **Images**: Hosted on `img.ankorstore.com`, with `?auto=format` suffix
- **productTypeId**: Maps to Ankorstore categories (observed: 6694, 6703, 6707, 6711, 6716, 6721, 8069)
- **Always in stock**: Most variants use `isAlwaysInStock: true` (no quantity tracking)
- **Variant names**: Often identical to parent product name

---

## 4. Verified Endpoints

### Read Products

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/products` | GET | List products (cursor pagination, max 50/page) |
| `/products/{id}` | GET | Single product |
| `/products/{id}?include=productVariants` | GET | Product with variants (in `included[]`) |
| `/product-variants/{id}` | GET | Single variant |

**Include support**: `?include=productVariants` returns variants in `included[]` array.

### Update Variant Stock (VERIFIED ✅)

```
PATCH /api/v1/product-variants/{id}/stock
```

**Request**:
```json
{
  "data": {
    "type": "product-variant-stock",
    "attributes": {
      "isAlwaysInStock": false,
      "stockQuantity": 50
    }
  }
}
```

**Response**: Full variant object with updated stock.

**Constraints**:
- Cannot set `stockQuantity` when `isAlwaysInStock: true` (409 error)
- Must set `isAlwaysInStock: false` first, then set quantity
- Can set both in same request

### Update Variant Prices (VERIFIED ✅)

```
PATCH /api/v1/product-variants/{id}/prices
```

**Request**:
```json
{
  "data": {
    "type": "product-variant-price",
    "attributes": {
      "wholesalePrice": 560,
      "retailPrice": 1680
    }
  }
}
```

**Response**: Full variant object with updated prices.

### Catalog Operations (Bulk) — PARTIALLY VERIFIED

**Create operation**:
```
POST /api/v1/catalog/integrations/operations
```

```json
{
  "data": {
    "type": "catalog-integration-operation",
    "attributes": {
      "source": "other",
      "operationType": "update",
      "callbackUrl": "https://your-domain.com/api/webhooks/ankorstore/callback"
    }
  }
}
```

**Valid `operationType` values**: `"update"`, `"delete"` (verified). Others rejected.
**Valid `source` values**: `"other"`, `"shopify"`, `"woocommerce"`, `"prestashop"` (verified).

**`updateFields`** (optional, only `"name"` and `"description"` accepted):
```json
{ "updateFields": ["name", "description"] }
```

**Operation lifecycle**:
1. `created` — Initial state after POST
2. Add products via `POST /operations/{id}/products`
3. PATCH status to `"started"` to begin processing
4. System processes → `"completed"` or `"skipped"` (if no products)

**Add products** (format underdocumented — silently accepts but returns `totalProductsCount: 0`):
```
POST /api/v1/catalog/integrations/operations/{id}/products
```

**Get operation status**:
```
GET /api/v1/catalog/integrations/operations/{id}
```

**Operation response**:
```json
{
  "data": {
    "type": "catalog-integration-operation",
    "id": "uuid",
    "attributes": {
      "source": "other",
      "status": "created",
      "operationType": "update",
      "updateFields": [],
      "createdAt": "...",
      "startedAt": null,
      "completedAt": null,
      "callbackUrl": "...",
      "totalProductsCount": 0,
      "processedProductsCount": 0,
      "failedProductsCount": 0
    }
  }
}
```

### User / Config

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/me` | GET | Current user info (id, uuid, email, roles) |
| `/me/config` | GET | User config |

### Webhooks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook-subscriptions` | GET | List subscriptions |
| `/webhook-subscriptions` | POST | Create subscription |
| `/webhook-subscriptions/{id}` | PATCH | Update subscription |
| `/webhook-subscriptions/{id}` | DELETE | Delete subscription |

**Webhook events** (order-related, for future use):
- `order.brand_created`, `order.brand_accepted`, `order.brand_rejected`
- `order.shipped`, `order.shipment_received`, `order.brand_paid`, `order.cancelled`

**Signature verification**: `X-Ankorstore-Hmac-SHA256` header (HMAC-SHA256 of raw body with subscription secret).

---

## 5. Rate Limits

| Scope | Limit |
|-------|-------|
| Authenticated | 600/min, 24K/hour, 288K/day |
| Unauthenticated | 120/min |
| `/oauth/token` | 60/hour |

---

## 6. Known Constraints & Gotchas

1. **Page limit range**: 3–50 (below 3 or above 50 returns 400)
2. **Prices are in centimes** (integer, not decimal)
3. **Stock vs always-in-stock**: Cannot set stockQuantity when isAlwaysInStock=true
4. **Catalog Operations bulk add**: Underdocumented — the add-products endpoint silently returns empty. Prefer individual variant stock/price updates for now
5. **SKU uniqueness**: SKUs are the primary identifier for variants
6. **Image URLs**: Read-only from API; images are managed through the Ankorstore seller dashboard or bulk import
7. **JSON:API compliance**: All requests/responses use JSON:API format (type, id, attributes, relationships)
8. **Cursor pagination**: Use `page[after]` with the `to` value from meta, not page numbers

---

## 7. Account Info

| Field | Value |
|-------|-------|
| Brand email | beliandjolie@gmail.com |
| User roles | `brand_admin` |
| Account type | `brand` |
| Account ID | `1f03afbf-a58d-6cb6-ab00-2e23a0d85cbe` |
| Total products | 2600+ (as of 2026-03-31) |

---

## 8. Mapping: Ankorstore ↔ BJ Data Model

| Ankorstore | BJ (Prisma) | Notes |
|------------|-------------|-------|
| Product | Product | 1:1 by reference |
| Product.name | Product.name | Direct |
| Product.description | Product.description | Direct |
| Product.productTypeId | Category? | Needs mapping table |
| Product.wholesalePrice | ProductColor.unitPrice | AK in centimes, BJ in euros (Decimal) |
| Product.retailPrice | — | BJ doesn't store retail price (B2B only) |
| ProductVariant | ProductColor | 1:1 by SKU |
| ProductVariant.sku | Derived from reference + color | Format: `{REF}_{COLOR}` |
| ProductVariant.images | ProductColorImage | Download from AK CDN → R2 |
| ProductVariant.stockQuantity | ProductColor.stock | AK int, BJ int |
| ProductVariant.isAlwaysInStock | — | BJ doesn't have this concept |
| Product.active | Product.status | active=true → ONLINE |
| Product.archived | Product.status | archived=true → ARCHIVED |

---

## 9. Sync Strategy (Design Reference)

### Import (Ankorstore → BJ)

1. Paginate products with variants (`?include=productVariants&page[limit]=50`)
2. For each product:
   - Match by reference (extracted from SKU or name)
   - Map productTypeId to BJ Category
   - Download images from `img.ankorstore.com` → process → upload to R2
   - Create/update Product + ProductColor records
3. Track sync status via `ankorstoreSyncStatus` field on Product

### Reverse Sync (BJ → Ankorstore)

1. For stock changes: `PATCH /product-variants/{id}/stock`
2. For price changes: `PATCH /product-variants/{id}/prices`
3. Match BJ ProductColor to AK variant via stored `akVariantId`
4. Fire-and-forget pattern (like PFS reverse sync)

### Differences from PFS

| Aspect | PFS | Ankorstore |
|--------|-----|-----------|
| Auth | Email/password bearer token | OAuth2 client_credentials (1h) |
| API format | REST | JSON:API |
| Pagination | Page number (100/page) | Cursor-based (50/page max) |
| Product creation | Individual endpoints | Catalog Operations (bulk) or dashboard |
| Stock update | Variant PATCH (rate limited 30/min) | Variant stock PATCH (600/min) |
| Price update | Variant PATCH | Variant prices PATCH (separate endpoint) |
| Images | Upload via multipart (JPEG only) | Managed via dashboard/bulk import |
| Webhooks | None | Native webhook system |
| Rate limits | Undocumented | Well-documented (600/min) |
