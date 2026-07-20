# PFS Sync System Reference

## Overview

Bidirectional sync between Boutique (BJ) and Paris Fashion Shop (PFS) marketplace.
API Base: `https://wholesaler-api.parisfashionshops.com/api/v1`. CDN: `https://static.parisfashionshops.com`.

## Token Management (`lib/pfs-auth.ts`)

In-memory cache, auto-refresh 10min before expiration. `POST /oauth/token` with PFS credentials read from admin settings (`SiteConfig` keys `pfs_email` / `pfs_password`, chiffrés). Plus de fallback env var.

## API Client — Read (`lib/pfs-api.ts`)

3 endpoints with retry + exponential backoff:
- `pfsListProducts(page)` — paginated list (buggy weight/pieces — use /variants for correct values)
- `pfsCheckReference(ref)` — composition, description, collection, country, default_color
- `pfsGetVariants(id)` — correct weight, packQuantity, total price, sku_suffix

## Sync Processor PFS → BJ (`lib/pfs-sync.ts`)

- `findOrCreateColor/Category/Composition/Country/Season`: check PfsMapping → DB → return null if not found (NO auto-create). Unmapped entities = product skipped.
- Reference versioning: "A200VS3" → base "A200" for BJ
- Primary color: `detectDefaultColorRef()` matches DEFAULT image key or `default_color`
- 2-pipeline: product data (batches of 10) + image download (pool of 15 concurrent)
- Products created as SYNCING → ONLINE after images done
- Image download: 15s timeout, 3s→6s→12s backoff, min 1KB. Playwright fallback (5 browser contexts, diverse fingerprints)
- Page parallelism: 10 pages simultaneously (1000 products/wave)
- Orphaned mapping auto-cleanup. Prices identical (no markup)

## Pre-validation Flow (2-step)

1. `POST /api/admin/pfs-sync/analyze` — SSE dry-run, detects missing entities
2. Admin reviews → `POST /api/admin/pfs-sync/create-entities` creates + saves PfsMapping (auto-fills pfsColorRef/pfsCategoryId/pfsCompositionRef)
3. `POST /api/admin/pfs-sync` — actual sync starts

## API Routes (PFS Sync)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/admin/pfs-sync` | Start sync |
| GET | `/api/admin/pfs-sync` | Status |
| POST | `/api/admin/pfs-sync/resume` | Resume failed |
| POST | `/api/admin/pfs-sync/analyze` | Dry-run SSE |
| POST | `/api/admin/pfs-sync/create-entities` | Create validated entities |
| POST | `/api/admin/pfs-sync/retry` | Retry failed by reference |
| POST | `/api/admin/pfs-sync/cancel` | Cancel + reset SYNCING→OFFLINE |
| GET | `/api/admin/pfs-sync/mapping-data` | All BJ entities with PFS refs |
| GET | `/api/admin/pfs-sync/live-check/[productId]` | Live BJ vs PFS comparison |
| GET | `/api/admin/pfs-sync/attributes` | PFS colors/categories/compositions/countries/collections |

## Live-Check & Apply

`GET .../live-check/[productId]`: fetches PFS data, computes field-level diffs, returns `{ existing, pfs, differences, hasDifferences }`. Auto-links `Product.pfsProductId`.

`applyPfsLiveSync(productId, selections, pfsData, bjData)` in `app/actions/admin/pfs-live-sync.ts`:
- selections maps field → `"bj"|"pfs"|"add"`. "pfs" updates BJ. "bj" triggers reverse push. "add" creates new variant.

## Reverse Sync BJ → PFS (`lib/pfs-api-write.ts`, `lib/pfs-reverse-sync.ts`)

**Full auto**: createProduct, updateProduct, archiveProduct, unarchiveProduct, bulkUpdateProductStatus, updateVariantQuick, bulkUpdateVariants → `triggerPfsSync(productId)` (fire-and-forget).

Flow: load BJ product → PFS AI translations (`POST /ai/translations` → fr/en/de/es/it) → create/update on PFS → sync variants (create/update/delete, stock=0 → `is_active:false`) → WebP→JPEG upload → sync status (ONLINE→READY_FOR_SALE, OFFLINE→DRAFT, ARCHIVED→ARCHIVED).

**Product creation** (`POST /catalog/products/create`):
- `reference_code` (pas `reference`). `gender_label` = code ref (WOMAN/MAN/KID/SUPPLIES, pas le label FR).
- `material_composition` = tableau `[{id, value}]` (id = pfsCompositionRef, value = pourcentage string). Fallback: `[{id:"ACIERINOXYDABLE", value:"100"}]`.
- `brand_name` = existingPFS > `companyInfo.shopName` en DB > default "Ma Boutique".
- `variants: []` obligatoire (variants créées séparément via POST).
- Plus besoin de PATCH séparé pour multi-compositions — le tableau passe directement au POST.

**Variant delete**: 404 traité comme succès (variant déjà supprimée côté PFS).

`Product.pfsSyncStatus`: null|"pending"|"synced"|"failed" (+ `pfsSyncError`).

## Entity Mapping (required for sync)

| BJ Field | PFS Ref | Used in |
|----------|---------|---------|
| `Color.pfsColorRef` | "GOLDEN", "SILVER"... | variant color |
| `Category.pfsCategoryId` | "a045J000003KWwDQAW" | product category |
| `Composition.pfsCompositionRef` | "ACIERINOXYDABLE" | material_composition |
| `ManufacturingCountry.pfsCountryRef` | "CN", "TR" | country_of_manufacture |
| `Season.pfsSeasonRef` | "PE2026", "AH2025" | season_name |
| `ProductColor.pfsVariantId` | PFS variant ID | variant update/delete |
| `Size.pfsSizeRef` | "TU", "XS", "52" | size mapping (1:1, obligatoire) |

Uniqueness enforced: each PFS ref → ONE BJ entity (sauf pour les tailles, où plusieurs noms BJ peuvent pointer vers la même réf PFS).
Admin UI: mapping renseigné directement dans chaque page d'entité (`/admin/categories`, `/admin/couleurs`, `/admin/compositions`, `/admin/pays`, `/admin/seasons`, `/admin/tailles`) via `MarketplaceMappingSection` + `PfsSuggestions`. Le mapping sera rendu obligatoire côté UI pour garantir la complétude avant export.
Server actions: `updateColorPfsRef()`, `updateCategoryPfsId()`, `updateCompositionPfsRef()`, `updateManufacturingCountryPfsRef()`, `updateSeasonPfsRef()`, `setSizePfsMapping(sizeId, pfsSizeRef | null)`.
Quick-create: `createColorQuick()`, `createCategoryQuick()`, `createCompositionQuick()` accept optional PFS ref params.

## Critical PFS Constraints

- **SKU duplicate**: PFS auto-generates `sku_suffix = COLOR_SIZE`. Duplicate = silent reject (HTTP 200, errors:1). Always check `pfsVariantId` before POST; if exists, PATCH.
- **Accepted sizes**: integers, XS-6XL, T34-T68, bonnets (85A), EU shoes (20-46), TU. **Rejected**: UK format.
- **`size_details_tu`**: champ texte libre (ex: "52-56"), envoyé en POST/PATCH, stocké côté PFS. Champ `Product.sizeDetailsTu` en BDD locale.
- **Genre/family**: decoupled — PFS accepts mismatched combos without error.
- **WebP rejected**: convert to JPEG before upload.
- **Rate limit variants PATCH**: 30/minute.
- **DELETE image**: `DELETE /catalog/products/{id}/image` avec body `{ color, slot }`. Skip si `colorRef === "DEFAULT"` (PFS gère automatiquement).
- **Stock 0 sur création**: PFS force stock à 300 — il faut PATCH ensuite pour remettre à 0 + `is_active: false`.

## Prepare & Review Flow (`lib/pfs-prepare.ts`)

`PfsPrepareJob` → `PfsStagedProduct` (PREPARING→READY) → admin reviews in `/admin/pfs/historique/[id]` → `approveStagedProduct()` creates real Product.
Staged data: variants, compositions, translations, imagesByColor as JSON. On approve: FK integrity re-verified.
Error: saved in `PfsStagedProduct.errorMessage`, status stays READY for retry.

## PFS Refresh (`lib/pfs-refresh.ts`)

Duplicates a product on PFS to make it appear as "new" (resets `createdAt`). Used via `PfsRefreshWidget`.

Flow: fetch existing PFS data → generate random TEMP ref → create new product on PFS (with AI translations + compositions) → create all variants (UNIT + PACK) → patch stock-0 variants back to 0 + `is_active:false` → upload all images (pool of 3) → set `default_color` → swap references (old → random DELETE ref + DELETED status, new → real ref) → READY_FOR_SALE (or ARCHIVED if all variants out of stock) → update local DB (`pfsProductId`, `createdAt`, `pfsSyncStatus`).

Rollback on error: restore old product ref + READY_FOR_SALE, rename failed new product to DELETEXX + DELETED.

## PfsSyncButton (`components/pfs/PfsSyncButton.tsx`)

Auto-check PFS on product page mount (with session cache). States: checking → noDiffs (green "synchronisé") | hasDiffs (yellow "synchronisation nécessaire" → ouvre modal) | notOnPfs (badge "Absent" + bouton "Créer sur PFS" via `forcePfsSync()`) | error | mappingIssues (bloqué). Cache via `Map<productId, PfsCacheEntry>` en mémoire SPA.

`RetryImagesButton` supprimé — fonctionnalité intégrée dans le flux de sync.

## DB Models

- `PfsSyncJob`: progress tracking (dual logs: productLogs + imageLogs + imageStats in JSON)
- `PfsMapping`: PFS name → BJ entity (persists across syncs)
- `PfsPrepareJob` / `PfsStagedProduct`: staged import pipeline

## Orders — Lecture seule (2026-07-20)

Copie locale des commandes PFS. **Aucune écriture** côté PFS. Séparé de `Order` (commandes boutique) pour éviter toute pollution des stats boutique et permettre un cycle de sync propre.

**Modèles Prisma** :
- `PfsOrder` : `@@unique([tenantId, pfsOrderId])`, montants Decimal, `rawDetailJson` conservé pour rejeu, `statusTimelineJson`, FK optionnelle vers `AdminClientCard.id` (rattachement client)
- `PfsOrderItem` : `pfsOrderId` (cascade delete), `pfsProductRef` + `productId` optionnel (match tenant-scope sur `Product.reference`), `productColorId` optionnel (match sur `ProductColor.pfsVariantId`), snapshots `productSnapshotName` / `colorLabelFr`
- `AdminClientCard.pfsCustomerId` + `AdminClientCard.importedFromMarketplace` : clé rapide + marqueur "créée par la synchro PFS"
- `enum PfsOrderStatus { NEW VALIDATED SENT CANCELLED }`

**API Client (`lib/pfs-orders-api.ts`)** :
- `pfsListOrders({page, perPage=50})` → `PfsListOrdersResponse` (data + state + meta)
- `pfsGetOrderDetail(orderId)` → `PfsOrderDetail`
- Auth partagée avec `lib/pfs-auth.ts` (Bearer token par tenant)
- `fetchWithRetry` réutilisé depuis `lib/pfs-api.ts` (retry 5×, timeout 30s, 429/5xx backoff exponentiel avec jitter)

**Sync Logic (`lib/pfs-orders-sync.ts`)** :
- `upsertClientCardFromPfsCustomer(tenantId, customer)` : 3 étapes
  1. Lookup par `pfsCustomerId` (index composite tenant)
  2. Fallback SIRET (`normalizeIdentifier` retire les espaces)
  3. Création avec `hasPfs=true`, `importedFromMarketplace="PFS"`, `firstName=""`, `lastName=<customer.name>` (les 2 sont required en base)
- `upsertPfsOrderFromDetail(tenantId, detail)` : upsert idempotent — items déjà présents `deleteMany` puis `createMany` (simplifie le diff)
- `syncRecentPfsOrders(tenantId)` : polling incrémental page 1 (50 dernières), skip les commandes dont le statut BDD est identique à celui de la LIST
- `importAllPfsOrdersFor(tenantId, onProgress, {stopSignal})` : rattrapage historique complet, boucle pages 1→N, callback progression après chaque commande, `stopSignal` async pour annulation

**Worker (`lib/pfs-orders-worker.ts`)** :
- Tick 5 min via `setInterval` — `START_DELAY_MS=20s` au boot
- Boucle sur `Tenant.isActive=true` avec `SiteConfig.pfs_email + pfs_password` non vides
- Wrap `tenantALS.run(tenantId, ...)` obligatoire (fire-and-forget hors requête HTTP)
- Persistance dernière synchro : `SiteConfig.pfs_orders_last_synced_at` (timestamp ms)
- Démarré dans `instrumentation-node.ts` sur le pattern `startXxxWorker` + `STARTUP_GUARD` symbol

**Import Historique State (`lib/pfs-orders-import-state.ts`)** :
- `SiteConfig.pfs_orders_import_state` = JSON `PfsImportState` (status IDLE|RUNNING|DONE|ERROR|STOPPED, processedOrders, totalOrders, currentPage, totalPages, imported, skipped, errorMessage)
- `SiteConfig.pfs_orders_import_stop` = "1" quand la cliente annule (lu par le stopSignal async)
- `startPfsHistoricalImportInBackground(tenantId)` : idempotent (return current si RUNNING), fire-and-forget dans `tenantALS.run`
- Auto-cleanup : `PfsImportPill` client appelle `acknowledgePfsHistoricalImport` 15s après DONE/ERROR/STOPPED pour reset l'état

**Server Actions (`app/actions/admin/pfs-orders.ts`)** — toutes gardées par `requireAdmin() + requireCurrentTenant()` :
- `listPfsOrders({page, perPage, q, status, carrier, period})` : liste paginée filtrable
- `getPfsOrderDetail(orderId)` : détail enrichi (adresses parsées depuis `rawDetailJson`, articles avec nom produit résolu)
- `getPfsStats({period, topClientsLimit, topProductsLimit, topClientsSort, topProductsSort})` : KPIs + top clients (`groupBy pfsCustomerId`) + top produits (`groupBy pfsProductRef + productId`) + statusCounts
- `syncPfsOrdersNow()` : trigger manuel du polling incrémental
- `resyncPfsOrderById(orderId)` : re-fetch détail d'une commande
- `startPfsHistoricalImport()` / `stopPfsHistoricalImport()` / `acknowledgePfsHistoricalImport()` / `getPfsImportStateAction()` : gestion widget
- `getPfsSyncMeta()` : `{lastSyncedAt, totalOrdersInDb, hasCredentials}` pour la barre synchro
- `listPfsOrdersForClientCard(cardId)` : historique complet d'un client (utilisé par `AdminCardPfsOrdersSection`)

**Périodes supportées** (`PfsPeriodKey`) : `today | 3d | week | 15d | month | 3m | 6m | year | all`. `month` et `year` = calendaires (1er du mois / 1er janvier), autres = N derniers jours glissants.

**UI** :
- `/admin/commandes` : tabs Boutique / PFS via `?source=boutique|pfs`, tab bar `OrdersTabsNav` (contient les 2 initiales P/B avec les gradients marketplace figés)
- `components/admin/orders/pfs/PfsOrdersView.tsx` : orchestrateur client, appelle les server actions au mount et à chaque changement de filtre
- `PfsPeriodBar`, `PfsKpiRow`, `PfsTopClients`, `PfsTopProducts`, `PfsOrdersTable`, `PfsOrderDrawer` : sous-composants ardoise
- `PfsImportPill` : widget flottant en bas à droite (au-dessus du FAB rail existant), poll `getPfsImportStateAction` toutes les 3s
- `AdminCardPfsOrdersSection` : injecté dans `AdminCardDrawer` (mode edit), stats client + historique commandes PFS
- Deep link `/admin/utilisateurs?tab=fiches&card=<id>` : auto-ouvre le drawer client (consommé par `AdminCardsPane.useEffect`)

**Rappels multi-tenant** :
- Toutes les tables scope par `tenantId` (extension Prisma injecte `AND tenantId`)
- Worker capture `tenantId` avant l'IIFE fire-and-forget
- Cache PFS auth déjà par-tenant (`lib/pfs-auth.ts::tokenCacheByTenant`)

**Ce qu'on ne fait PAS** :
- Aucun webhook (PFS n'en propose pas pour les commandes)
- Aucune mutation côté PFS (aucun POST/PATCH/DELETE)
- Aucun mail de notif (la cliente ne le veut pas — cf. mémoire)
- Aucun stock decrement local (les stocks BJ ne bougent pas quand PFS vend, PFS gère ses stocks séparément — sujet à confirmer si la cliente le demande)
