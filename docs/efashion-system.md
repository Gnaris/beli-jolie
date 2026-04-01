# eFashion Paris Integration — API & System Documentation

> **API URL**: `https://wapi.efashion-paris.com/graphql` (GraphQL)
> **REST Base**: `https://wapi.efashion-paris.com` (photos, files)
> **Platform**: B2B wholesale marketplace for fashion/jewelry

---

## 1. Authentication

**Method**: Cookie-based session (`auth-token` JWT, 7 days)

```graphql
mutation {
  login(email: "...", password: "...", rememberMe: true) {
    user { id_vendeur email nomBoutique }
    message
  }
}
```

**Response**: `Set-Cookie: auth-token=<jwt>; Max-Age=604800`

All subsequent requests must include `Cookie: auth-token=<jwt>` header.

**Credentials**: Stored encrypted in `SiteConfig` (`efashion_email`, `efashion_password`). Env var fallback: `EFASHION_EMAIL`, `EFASHION_PASSWORD`.

**In-memory cache**: `lib/efashion-graphql.ts` caches cookie + expiry. Auto-refresh via `ensureEfashionAuth()`.

**Files**:
- `lib/efashion-auth.ts` — login, ensureAuth, reauthenticate
- `lib/efashion-graphql.ts` — GraphQL client, REST client, cookie management

---

## 2. API Conventions

| Item | Value |
|------|-------|
| GraphQL URL | `https://wapi.efashion-paris.com/graphql` |
| REST URL | `https://wapi.efashion-paris.com/api/...` |
| IDs | `Int` (not String UUID) |
| Pagination | `skip` + `take` (not page/per_page) |
| Total | returned in response, no `hasMore` field |
| Auth | Cookie header on every request |
| Retry | 3 attempts with backoff: 2s, 5s, 15s |

---

## 3. Product Data Model (eFashion side)

### How variants work

eFashion treats each color variant as a **separate product**. A "product" with 3 colors = 3 separate `produit` entries linked by:

- **`liaison`** (read-only): points to the "main" product's `id_produit`
- **`id_couleur_liee`** (write): set on secondary variants to link to the main
- **`reference_base`**: common base reference (e.g., `A2348` for `A2348-DORE`, `A2348-ARGENT`)

Each variant has exactly **one color** assigned via `updateProduitCouleursProduit`.

### Key fields on `produit`

| Field | Type | Description |
|-------|------|-------------|
| `id_produit` | Int | Unique ID |
| `reference` | String | Full reference (e.g., `A2348-DORE`) |
| `reference_base` | String? | Base reference without color suffix |
| `id_vendeur` | Int | Vendor ID |
| `id_categorie` | Int | Category ID |
| `id_vendeur_marque` | Int? | Brand ID |
| `id_pack` | Int? | Pack grid ID (quantity per unit) |
| `id_declinaison` | Int? | Size grid ID |
| `id_collection` | Int? | Season/collection ID |
| `id_provenance` | Int? | Country of origin ID |
| `id_couleur_liee` | Int? | Main product ID (for variant linking) |
| `vendu_par` | String | `"couleurs"` = UNIT, `"assortiment"` = PACK |
| `prix` | Float | Price |
| `prixReduit` | Float? | Discounted price |
| `poids` | Float | Weight in kg |
| `visible` | Boolean | Published on marketplace |
| `supprimer` | Boolean | Soft-deleted |
| `nb_photos` | Int | Photo count |
| `liaison` | Int? | (read-only) Main product ID for grouping |
| `premel` | String | Premium level |

### Related entities

| Entity | Query | Key fields |
|--------|-------|------------|
| Colors | `couleursProduitByProduitId(id_produit)` | `id_couleur`, `couleur.couleur_FR`, `couleur.couleur_EN` |
| Description | `produitDescription(id_produit)` | `texte_fr`, `texte_uk`, `instructions`, `commentaires` |
| Stocks | `produitStocks(id_produit)` | `id_couleur`, `value`, `taille` |
| Compositions | `produitCompositions(id_produit, lang)` | `id_composition`, `id_composition_localisation`, `value`, `libelle`, `famille` |
| Photos | REST `GET /api/product-photos/{id}` | Returns `{ photos: string[], nbPhotos: number }` |

---

## 4. GraphQL Mutations

### Create product

```graphql
mutation CreateProduit($input: CreateProduitInput!) {
  createProduit(input: $input) { id_produit reference }
}
# Input: { id_vendeur, id_categorie, reference, prix }
# Returns id_produit as STRING (must parseInt)
```

### Update product

```graphql
mutation UpdateProduit($input: UpdateProduitInput!) {
  updateProduit(input: $input) { id_produit }
}
# Input fields: id_produit (required), plus optional:
#   id_categorie, id_declinaison, id_pack, id_collection,
#   id_provenance, id_vendeur_marque, id_couleur_liee,
#   reference, reference_base, vendu_par, prix, prixReduit,
#   poids, visible, main
#
# NOT available: liaison (read-only), qteMini, supprimer
```

### Set colors

```graphql
mutation UpdateProduitCouleursProduit($input: UpdateProduitCouleursInput!) {
  updateProduitCouleursProduit(input: $input)
}
# Input: { id_produit, ids_couleur_efashion: [Int!]! }
# IMPORTANT: field is "ids_couleur_efashion", NOT "couleurs"
```

### Save description

```graphql
mutation SaveProduitDescription($input: SaveProduitDescriptionInput!) {
  saveProduitDescription(input: $input)
}
# Input: { id_produit, texte_fr?, texte_uk?, instructions?, commentaires? }
```

### Save stocks

```graphql
mutation SaveProduitStocks($input: SaveProduitStocksInput!) {
  saveProduitStocks(input: $input)
}
# Input: { id_produit, items: [{ id_couleur, taille?, value }] }
# IMPORTANT: field is "items", NOT "stocks"
```

### Save compositions

```graphql
mutation SaveProduitCompositions($input: SaveProduitCompositionsInput!) {
  saveProduitCompositions(input: $input)
}
# Input: { id_produit, items: [{ id_composition, id_composition_localisation, value }] }
# IMPORTANT: field is "items", NOT "compositions"
```

### Visibility & deletion

```graphql
mutation SetProduitsVisible($ids: [Int!]!, $visible: Boolean!) {
  setProduitsVisible(ids: $ids, visible: $visible)
}

mutation SoftDeleteProduits($ids: [Int!]!) {
  softDeleteProduits(ids: $ids)
}
```

---

## 5. Photo Upload (REST)

```
POST https://wapi.efashion-paris.com/api/upload-product-photo
Content-Type: multipart/form-data
Cookie: auth-token=<jwt>

FormData:
  - "productId": "<id_produit>"     ← IMPORTANT: field name is "productId"
  - "photos": <file.jpg>            ← IMPORTANT: field name is "photos"
```

**Response** (201):
```json
{
  "success": true,
  "message": "1 photo(s) uploadee(s) avec succes",
  "photos": ["/uploads/products/2017/Produits/accueil/3556146-c.jpg"],
  "nbPhotos": 1
}
```

**Gotchas**:
- Field name for file is `"photos"` (NOT `"file"`)
- Field name for ID is `"productId"` (NOT `"id_produit"`)
- Only JPEG format accepted
- Using wrong field names: `"file"` → 400 "Unexpected field", `"id_produit"` → 201 with `success: false` "Identifiant produit invalide"

**Photo URLs**: Relative paths returned. Prefix with `https://wapi.efashion-paris.com` to get full URL.

---

## 6. GraphQL Queries

### List products (paginated)

```graphql
query ListProducts($filter: FilterProduitInput!) {
  productsPage(filter: $filter) {
    total
    items {
      id_produit reference reference_base marque categorie id_categorie
      prix poids vendu_par id_pack id_declinaison id_collection
      id_vendeur_marque id_provenance provenance prixReduit
      liaison id_couleur couleur nb_photos visible supprimer
      stock_value stock_renseigne premel
    }
  }
}
# filter: { id_vendeur, skip, take, statut, orderBy, orderDir }
# statut: EN_VENTE | HORS_LIGNE | RUPTURE | TOUS (enum, not string in variables — pass via $filter)
```

### Single product

```graphql
query { produit(id: <Int>) { id_produit reference ... } }
```

### Categories

```graphql
query { categoriesTree(lang: "fr") {
  id_categorie label id_parent_categorie children {
    id_categorie label children { id_categorie label }
  }
} }
```

### Default colors

```graphql
query { allCouleursDefaut { id_couleur couleur_FR couleur_EN defaut } }
```

### Packs (quantity grids)

```graphql
query GetPacks($id_vendeur: Int!) {
  packsByVendeur(id_vendeur: $id_vendeur) {
    id_pack titre p1 p2 p3 p4 p5 p6 p7 p8 p9 p10 p11 p12
  }
}
```

### Declinaisons (size grids)

```graphql
query GetDeclinaisons($idVendeur: Int!) {
  declinaisonsByVendeur(idVendeur: $idVendeur) {
    id_declinaison d1_FR d2_FR d3_FR d4_FR d5_FR d6_FR
    d7_FR d8_FR d9_FR d10_FR d11_FR d12_FR
  }
}
# NOTE: parameter is "idVendeur" (camelCase), not "id_vendeur"
```

---

## 7. Sync System (BJ ↔ eFashion)

### Import flow (eFashion → BJ)

```
Analyze → Validation → Prepare → Review → Approve
```

1. **Analyze** (`lib/efashion-analyze.ts`): Scans eFashion products, detects missing categories/colors/compositions. Groups variants by `liaison` for accurate product count.

2. **Validation** (`components/efashion/EfashionValidationPanel.tsx`): Admin maps missing entities to existing BJ entities or creates new ones.

3. **Prepare** (`lib/efashion-prepare.ts`): Fetches full product details. **Groups items by `liaison`** — variants with the same `liaison` become one staged product with multiple color variants. Stores as `EfashionStagedProduct` with status READY.

4. **Review** (`/admin/efashion/historique/[id]`): Admin reviews staged products, approves or rejects.

5. **Approve** (`approveEfashionStagedProduct()`): Downloads images from eFashion, processes with sharp → WebP, uploads to R2. Creates Product + ProductColor + VariantSize + ProductComposition in DB.

### Reverse sync (BJ → eFashion)

`lib/efashion-reverse-sync.ts` — Diff-based push. Compares local product state with eFashion state and syncs changes (price, stock, description, images, visibility).

### Key constants

```typescript
PREPARE_CONCURRENCY = 5    // Parallel product group fetches
PAGE_SIZE = 100            // eFashion list pagination
IMAGE_CONCURRENCY = 3      // Parallel image downloads
RETRY_DELAYS = [2000, 5000, 15000]
```

---

## 8. Database Models

### Prisma fields added for eFashion

```prisma
model Product {
  efashionProductId    Int?     @unique
  efashionSyncStatus   String?  // null, "pending", "synced", "failed"
  efashionSyncError    String?  @db.Text
  efashionSyncedAt     DateTime?
}

model Color {
  efashionColorId      Int?
}

model Category {
  efashionCategoryId   Int?
}

model ProductColor {
  efashionColorId      Int?     // Per-variant color mapping override
}
```

### Staging models

```prisma
model EfashionPrepareJob {
  status            PfsSyncStatus  // PENDING, ANALYZING, NEEDS_VALIDATION, RUNNING, COMPLETED, FAILED, STOPPED
  totalProducts     Int
  processedProducts Int
  readyProducts     Int
  errorProducts     Int
  approvedProducts  Int
  rejectedProducts  Int
  analyzeResult     Json?          // { missingEntities, existingEntities, existingMappings }
  logs              Json?          // { analyzeLogs: [], prepareLogs: [] }
}

model EfashionStagedProduct {
  efashionProductId  Int
  reference          String
  status             PfsStagedStatus  // PREPARING, READY, APPROVED, REJECTED, ERROR
  variants           Json             // StagedVariant[]
  compositions       Json             // StagedComposition[]
  translations       Json             // StagedTranslation[]
  imageUrls          Json             // string[]
  colorData          Json             // StagedColorData[]
}

model EfashionMapping {
  type          String   // "category", "color", "composition"
  efashionName  String
  efashionId    Int?
  bjEntityId    String
  bjName        String
}
```

---

## 9. API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/admin/efashion-sync` | Start analyze job |
| GET | `/api/admin/efashion-sync` | Get latest/specific job |
| DELETE | `/api/admin/efashion-sync?id=` | Stop running job |
| POST | `/api/admin/efashion-sync/prepare` | Start prepare (skip analyze) |
| GET | `/api/admin/efashion-sync/count` | eFashion vs BJ product counts |
| POST | `/api/admin/efashion-sync/create-entities` | Create/map missing entities |
| GET | `/api/admin/efashion-sync/staged` | List staged products |
| POST | `/api/admin/efashion-sync/staged/[id]/approve` | Approve one |
| POST | `/api/admin/efashion-sync/staged/[id]/reject` | Reject one |
| POST | `/api/admin/efashion-sync/staged/approve-bulk` | Bulk approve |
| POST | `/api/admin/efashion-sync/staged/reject-bulk` | Bulk reject |

---

## 10. Common Vendor Attribute IDs (Beli & Jolie)

| Attribute | ID | Value |
|-----------|----|-------|
| Vendor | 2017 | Beli & Jolie |
| Brand | 3228 | Beli & Jolie |
| Pack (unit=1) | 12744 | "1" → [1,0,0,...] |
| Declinaison | 11096 | Default size grid |
| Collection | 3 | Toutes les saisons |
| Provenance | 1 | Chine |
| Composition (Acier) | 64 | id_composition_localisation=4 |

### Common color IDs

| Color | ID |
|-------|----|
| Doré | 78 |
| Argent | 22 |
| Noir | 59 |
| Bleu roi | 92 |
| Cognac | 24 |

---

## 11. Gotchas & Learned the Hard Way

1. **`createProduit` returns `id_produit` as String** — must `parseInt()` before using in other mutations
2. **Mutation input field names differ from query field names**:
   - Stocks: write `items`, read `produitStocks`
   - Compositions: write `items`, read `produitCompositions`
   - Colors: write `ids_couleur_efashion`, read `couleursProduitByProduitId`
   - Photo upload: `"productId"` + `"photos"` (not `"id_produit"` + `"file"`)
3. **`liaison` is read-only** — to link variants, use `id_couleur_liee` in `updateProduit`
4. **`declinaisonsByVendeur` uses `idVendeur`** (camelCase), not `id_vendeur`
5. **Statut enum** in `FilterProduitInput`: must be passed as variable (not inline string), otherwise GraphQL validation fails
6. **`unstable_cache` not available** outside Next.js runtime — standalone scripts must bypass `getCachedEfashionCredentials` and query DB directly
7. **Photo upload returns 201 even on failure** — always check `success` field in response body
8. **Products with `vendu_par: "couleurs"`** still need `id_pack` set (e.g., pack "1" = 12744)

---

## 12. Files Reference

| File | Purpose |
|------|---------|
| `lib/efashion-auth.ts` | Login, session management |
| `lib/efashion-graphql.ts` | GraphQL/REST transport, cookie cache |
| `lib/efashion-api.ts` | Read-only API wrappers |
| `lib/efashion-api-write.ts` | Write mutations + photo upload |
| `lib/efashion-analyze.ts` | Analyze job (detect missing entities) |
| `lib/efashion-prepare.ts` | Prepare + approve/reject staged products |
| `lib/efashion-reverse-sync.ts` | Push BJ changes to eFashion |
| `components/efashion/EfashionValidationPanel.tsx` | Entity mapping UI |
| `components/efashion/EfashionStagedProductCard.tsx` | Staged product review card |
| `app/(admin)/admin/efashion/` | Admin sync pages |
| `app/api/admin/efashion-sync/` | API routes |
