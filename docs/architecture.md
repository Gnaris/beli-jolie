# Architecture Reference

## Route Groups

| Group | Path | Access |
|---|---|---|
| `(auth)` | `/connexion`, `/inscription` | Unauthenticated only |
| `(admin)` | `/admin/*` | ADMIN role |
| `(client)` | `/espace-pro/*`, `/panier/*`, `/commandes/*`, `/favoris` | CLIENT (APPROVED) |
| *(direct)* | `/produits/*`, `/collections/*`, `/categories` | Public / guest (`bj_access_code` cookie) |

Protection: `middleware.ts` (edge) + group `layout.tsx` (server fallback).
Middleware: maintenance mode, guest access, admin redirect (bypass with `bj_admin_preview=1`).

## Auth Flow

NextAuth v4, Credentials + JWT (30 days). Token enriched: `id`, `role`, `status`, `company` in `lib/auth.ts`.
New users: `role=CLIENT, status=PENDING` — admin approves. PENDING/REJECTED = 401 at sign-in.
Types: `types/next-auth.d.ts`. Admin preview: `bj_admin_preview=1` cookie (8h TTL).

## Product Data Model

```
Product
  ├── ProductColor[] (variant: saleType UNIT|PACK, unitPrice, weight, stock, discount*, packQuantity, pfsVariantId?)
  │     ├── colorId: String? (UNIT=main color, PACK=null → colors in PackColorLine[])
  │     ├── ProductColorSubColor[] (UNIT: optional sub-colors)
  │     ├── VariantSize[] (sizeId + quantity + pricePerUnit? [PACK only])
  │     ├── PackColorLine[] → PackColorLineColor[] (PACK: ordered color compositions)
  │     └── ProductColorImage[] (max 5, linked via productColorId)
  ├── ProductTranslation[] (en/ar/zh/de/es/it)
  ├── ProductSimilar[] / PendingSimilar[] (M2M self-relation)
  ├── ProductComposition[] (material + %)
  ├── ProductTag[]
  └── RestockAlert[]
Size: name @unique, position, SizeCategoryLink[] (M2M), SizePfsMapping[] (M2M)
```

PFS fields on entities: `Color.pfsColorRef`, `Category.pfsCategoryId`, `Composition.pfsCompositionRef`, `ManufacturingCountry.pfsCountryRef`, `Season.pfsSeasonRef`, `Product.pfsProductId/pfsSyncStatus/pfsSyncError/pfsSyncedAt`, `ProductColor.pfsVariantId`.

Prices: `unitPrice` = total for UNIT and PACK. PACK formula: `sum(size.qty * size.pricePerUnit) * packQuantity`.

## Order Data Model

```
Order → OrderItem[], status (PENDING→PROCESSING→SHIPPED→DELIVERED|CANCELLED)
  orderNumber: BJ-YYYY-XXXXXX, carrier*, TVA*, Payment (Stripe), Easy-Express (tracking/label)
```

## File Storage

| Type | Path | Access |
|------|------|--------|
| Product images | `public/uploads/products/` | Public |
| Collection images | `public/uploads/collections/` | Public |
| Color patterns | `public/uploads/patterns/` | Public |
| Kbis | `private/uploads/kbis/` | ADMIN via API |
| Invoices | `private/uploads/invoices/` | ADMIN or owner |
| Email attachments | `private/uploads/email-attachments/` | Internal |

## Image Processing (`lib/image-processor.ts`)

`processProductImage()`: EXIF auto-rotate → WebP 3 sizes (large 1200/q90, medium 800/q82, thumb 400/q80).
DB stores large path only. Derive others with `getImageSrc(path, "thumb"|"medium"|"large")`.
Manual rotation: `POST /api/admin/products/images/rotate` → 90° CW all 3 sizes, returns `cacheBuster`.

## Additional DB Models (compact)

- `Favorite` (userId+productId unique), `SiteConfig` (key/value), `PasswordResetToken` (1h TTL, `used` flag)
- `LoginAttempt` (email/ip/success), `AccountLockout` (progressive, 11 levels), `RegistrationLog` (3h cooldown)
- `ImportJob` (bulk import history), `ImportDraft` (error rows PRODUCTS|IMAGES)
- `AccessCode` (guest browsing, prefill fields, expiry), `Catalog`/`CatalogProduct` (shareable via token)
- `SentEmail` (admin email history), `TranslationQuota` (provider+monthYear)
- `*Translation` tables: Category, SubCategory, Color, Composition, ManufacturingCountry, Season
- `ManufacturingCountry` (name, isoCode, pfsCountryRef), `Season` (name, pfsSeasonRef)
- `Size` (name, position), `SizeCategoryLink` (M2M), `SizePfsMapping` (M2M pfsSizeRef)
- `VariantSize` (productColorId+sizeId unique, quantity, pricePerUnit? PACK only)
- `PackColorLine` (position) → `PackColorLineColor` (colorId, position)
- `RestockAlert` (client subscribes to out-of-stock variant)

## i18n

next-intl, cookie `bj_locale` (1y TTL), default `fr`. RTL: `ar`. Messages: `messages/[locale].json`.
`setLocale()` in `app/actions/client/locale.ts`. DeepL Free API (500K chars/month, `:fx` key).
AI descriptions: Claude Sonnet via `lib/claude.ts`. Auto-translated: products, categories, subcategories, colors, compositions.

## Key Components

- **Public header**: `PublicSidebar.tsx` (NOT Navbar.tsx)
- **Admin mobile**: `AdminMobileNav.tsx`
- **3D Hero**: `JewelryScene.tsx` via `JewelrySceneLoader.tsx` (client wrapper, ssr:false)
- **Product form**: `ProductForm.tsx` (4 blocks + unsaved changes guard → ConfirmDialog)
- **Variant manager**: `ColorVariantManager.tsx` (passes `availableSizes`, exports `variantGroupKeyFromState()`, `computeTotalPrice()`)
- **Sizes manager**: `SizesManager.tsx` at `/admin/tailles`
- **Live tracking**: `LiveClientsTracker.tsx` at `/admin/suivi` + `CartModal.tsx`
- **Reusable UI**: `ConfirmDialog` (useConfirm), `CustomSelect`, `Toast` (useToast), `ColorSwatch` (subColors, patternImage)
- **Import**: `ImportHistoryClient.tsx` at `/admin/produits/importer/historique`
- **PFS Sync**: `/admin/pfs`, `PfsMappingTab.tsx` → lazy-loads `PfsMappingClient` (5-tab mapping)
- **Email**: `ComposeEmailDrawer.tsx` (bottom-right, minimizable, rich text, attachments). Context: `EmailComposeProvider`/`useEmailCompose()`. Trigger: `SendEmailButton`

## Real-Time SSE (`lib/product-events.ts`)

In-memory pub/sub via `globalThis` singleton. SSE: `GET /api/products/stream` (30s heartbeat).
Single fetch: `GET /api/products/[id]/live`. Client hook: `useProductStream()` (5s reconnect).
Events: `PRODUCT_ONLINE/OFFLINE/UPDATED`, `STOCK_CHANGED`, `BESTSELLER_CHANGED`.
Emitters: createProduct, updateProduct, bulkUpdateProductStatus, archiveProduct, updateVariantQuick, bulkUpdateVariants, refreshProduct.
**Important**: `globalThis` required (not module-level const).

## Security & Rate Limiting

- `lib/security.ts`: login lockout (3 failures → 11 levels 1min→permanent), registration anti-spam (3h cooldown)
- `lib/rate-limit.ts`: IP-based. `forgot-password` 3/h, `reset-password` 10/h, `report-error` 3/15min
- Admin unlock: `app/actions/admin/unlockAccount.ts`. Client unlock request: `app/api/auth/unlock-request/`

## Password Reset

`POST /api/auth/forgot-password` → token → `/reinitialiser-mot-de-passe?token=xxx` → `POST /api/auth/reset-password`.
Admin: via `/admin/parametres` → `AdminPasswordResetButton`. Rules: 8 chars, 1 uppercase, 1 digit (same everywhere).

## Caching (`lib/cached-data.ts`)

`getCachedSiteConfig(key)` (5min), `getCachedCategories/Collections/Colors/Tags/ManufacturingCountries/Seasons/Sizes` (1h),
`getCachedSizesByCategory(categoryId)`, `getCachedProductCount` (5min), `getCachedBestsellerRefs(limit)` (10min),
`getCachedAdminWarnings()` (5min), `getCachedDashboardStats()` (5min).
Rule: `unstable_cache` + unique key array + tags. Invalidate with `revalidateTag(tag, "default")`.

## Integrations

### Easy-Express v3
Base: `https://easy-express.fr`, Auth: Bearer `EASY_EXPRESS_API_KEY`.
Flow: `POST /api/v3/shipments/rates` → transactionId → `POST /api/v3/shipments/checkout`.
Prices in centimes (÷100). Min weight 1kg. +5EUR margin. transactionId expires fast. Fallback: hardcoded rates.

### Stripe
PaymentIntent: card + bank_transfer. Webhook: `succeeded`, `processing`, `payment_failed`.
Bank transfer: `awaiting_transfer` → webhook → Easy-Express + PDF + email. Customer stored in `user.stripeCustomerId`.

### TVA
France 20%, DOM-TOM 0%, EU+VAT(VIES) 0% (reverse charge), EU sans VAT 20%, Non-EU 0%.

### Bulk Import (`lib/import-processor.ts`)
Excel/JSON via `/admin/produits/importer`. Preview → confirm → background `ImportJob`.
Multi-color: "/" separator. Image filenames: "," separator. Color match: accent-insensitive (`normalizeColorName()`).
Quick-create: `/api/admin/products/import/quick-create`. Search: `GET /api/admin/products/search?q=xxx&fields=catalog`.
