# eFashion Paris Integration — Design Spec

> Date: 2026-03-31
> Status: Approved
> Priority: Import eFashion → BJ, puis reverse sync BJ → eFashion

---

## Contexte

eFashion Paris est un second marketplace à intégrer aux côtés de PFS. Chaque produit de la boutique doit exister sur les deux marketplaces. Les systèmes sont complètement indépendants — PFS est REST, eFashion est GraphQL — donc aucune abstraction commune.

**API eFashion** : GraphQL (`https://wapi.efashion-paris.com/graphql`) + REST pour images. Auth cookie-based. Documentation complète dans `EFASHION_API_DOCUMENTATION.md`.

---

## Décisions architecturales

| Décision | Choix |
|----------|-------|
| Approche | Copier-adapter (fichiers indépendants de PFS) |
| Sync produit | Chaque produit sync sur PFS ET eFashion |
| Priorité | Import eFashion → BJ d'abord |
| Credentials | Admin UI SiteConfig + fallback env vars |
| Mapping | Table séparée `EfashionMapping` (pas de table commune avec PFS) |
| UI admin | Section séparée `/admin/efashion/*` |
| Reverse sync | Auto au save produit (comme PFS) |

---

## Couche API — `lib/efashion-*.ts`

### `lib/efashion-graphql.ts`
Helper pour exécuter des queries/mutations GraphQL avec gestion cookie, parsing des erreurs GraphQL.

### `lib/efashion-auth.ts`
- Login via mutation `login()` → cookie session stocké en mémoire
- `getEfashionClient()` : fetch wrapper avec cookie
- `checkEfashionAuth()` : query `me {}`
- Auto-reconnexion sur session expirée
- Credentials depuis SiteConfig (`efashion_email`, `efashion_password`) + fallback `EFASHION_EMAIL` / `EFASHION_PASSWORD`

### `lib/efashion-api.ts` (lecture)
- `efashionListProducts(skip, take)` → query `productsPage`
- `efashionGetProduct(id)` → query `produit`
- `efashionGetProductDetails(id)` → parallel: description + stocks + couleurs + compositions
- `efashionGetProductPhotos(id)` → REST batch endpoint
- Référentiels : categories, couleurs, packs, déclinaisons, collections, compositions
- Retry logic propre (reconnexion cookie sur 401, backoff sur erreurs)

### `lib/efashion-api-write.ts` (écriture)
- CRUD produit : `createProduit`, `updateProduit`
- Stocks : `saveProduitStocks`, `upsertProduitStock`
- Descriptions : `saveProduitDescription`
- Couleurs : `updateProduitCouleursProduit`
- Images : REST POST upload, delete, reorder
- Visibilité : `setProduitsVisible`, `softDeleteProduits`
- Compositions, caractéristiques, promotions

### `lib/efashion-sync.ts` (import eFashion → BJ)
Même pattern que `pfs-sync.ts` :
- Pipeline concurrent pour produits + images
- Pagination `skip/take` avec `hasMore`
- Pour chaque produit : fetch détails (description, stocks, couleurs, compositions) en parallèle
- Download images depuis eFashion → process WebP → upload R2
- Création produit en DB avec toutes les relations
- Tracking via `EfashionSyncJob`

### `lib/efashion-reverse-sync.ts` (BJ → eFashion)
Même pattern que `pfs-reverse-sync.ts` :
- `triggerEfashionSync(productId)` : fire-and-forget
- `syncProductToEfashion(productId)` : diff-based, push uniquement les changements
- Sync metadata, stocks, couleurs, descriptions, images
- Images : conversion WebP → JPEG avant upload REST
- Mapping statut : ONLINE → `visible: true`, OFFLINE → `visible: false`, ARCHIVED → `softDelete`

### `lib/efashion-analyze.ts`
Dry-run avant import : détecter les entités manquantes (catégories, couleurs, compositions non mappées).

### `lib/efashion-prepare.ts`
Workflow prepare → review → approve/reject pour import contrôlé.

---

## Modèle de données (Prisma)

### Champs ajoutés sur `Product`
- `efashionProductId` : Int? @unique — id_produit sur eFashion
- `efashionSyncStatus` : String? — null | "pending" | "synced" | "failed"
- `efashionSyncError` : String? @db.Text
- `efashionSyncedAt` : DateTime?

### Champs ajoutés sur entités existantes
- `Color.efashionColorId` : Int? — id_couleur eFashion
- `Category.efashionCategoryId` : Int? — id_categorie eFashion
- `ProductColor.efashionColorId` : Int? — override couleur eFashion

### Nouvelles tables
- `EfashionMapping` : type + efashionName + efashionId + bjEntityId + bjName (@@unique type+efashionName)
- `EfashionSyncJob` : même structure que PfsSyncJob (status, counters, logs, lastSkip pour resume)
- `EfashionPrepareJob` : même structure que PfsPrepareJob
- `EfashionStagedProduct` : même structure que PfsStagedProduct

### Enum
Réutiliser `PfsSyncStatus` pour les jobs eFashion (PENDING, ANALYZING, NEEDS_VALIDATION, RUNNING, COMPLETED, FAILED, STOPPED).

---

## Routes API — `app/api/admin/efashion-sync/`

Même structure que `/api/admin/pfs-sync/` :
- POST `/` — lancer un import
- GET `/` — statut du job en cours
- POST `/resume` — reprendre un import échoué
- POST `/cancel` — annuler
- POST `/analyze` — analyse dry-run (SSE)
- POST `/create-entities` — créer les entités manquantes
- GET `/count` — compter les produits eFashion
- GET `/attributes` — référentiels eFashion (catégories, couleurs, packs, etc.)
- GET `/mapping-data` — entités BJ avec refs eFashion
- GET `/live-check/[productId]` — comparaison live BJ vs eFashion
- POST `/prepare` — démarrer prepare job
- GET `/prepare/history` — historique prepare
- Endpoints staged products (approve, reject, compare, bulk)

---

## Server Actions — `app/actions/admin/`

- `efashion-reverse-sync.ts` : `forceEfashionSync(productId)`
- `efashion-live-sync.ts` : `applyEfashionLiveSync()` — sync bidirectionnelle par champ

---

## Pages admin — `app/(admin)/admin/efashion/`

### `/admin/efashion/mapping`
6 onglets : couleurs, catégories, compositions, packs, déclinaisons, collections.
Chaque onglet : liste des entités eFashion à associer aux entités locales.

### `/admin/efashion/sync`
Dashboard d'import : analyser, lancer, suivi en temps réel, logs, erreurs.

### `/admin/efashion/historique/[id]`
Review des produits préparés : grille, cards, approve/reject.

---

## Composants — `components/efashion/`

- `EfashionSyncButton.tsx` — bouton sur fiche produit (live check + compare)
- `EfashionLiveCompareModal.tsx` — diff bidirectionnel par champ
- `EfashionValidationPanel.tsx` — mapping entités manquantes
- `EfashionReviewGrid.tsx` — grille produits staged
- `EfashionStagedProductCard.tsx` — card produit staged
- `EfashionHistoryClient.tsx` — historique jobs
- `EfashionMappingClient.tsx` — UI mapping 6 onglets

---

## Paramètres admin

Ajouter dans la section marketplace des paramètres :
- `efashion_email` — email eFashion (chiffré via `SENSITIVE_KEYS`)
- `efashion_password` — mot de passe eFashion (chiffré)
- `efashion_vendor_id` — id_vendeur sur eFashion (nécessaire pour les queries)

---

## Intégration reverse sync automatique

Modifier les server actions existantes (createProduct, updateProduct, etc.) pour appeler `triggerEfashionSync()` en plus de `triggerPfsSync()` après chaque sauvegarde.

---

## Différences clés eFashion vs PFS à gérer

| Aspect | PFS | eFashion |
|--------|-----|----------|
| API | REST JSON | GraphQL + REST images |
| Auth | Bearer token | Cookie session |
| Pagination | page + per_page | skip + take |
| IDs | String UUID | Int |
| Variants | Endpoint dédié `/variants` | Stocks + couleurs = queries séparées |
| Images upload | Multipart REST (JPEG) | REST `/api/upload-product-photo` (FormData) |
| Tailles | Dans les variants | Packs (12 slots) ou Déclinaisons |
| Statut | READY_FOR_SALE/DRAFT/ARCHIVED | `visible` boolean + `supprimer` |
| Descriptions | Inline dans produit | Query séparée multi-langue |
| Compositions | Inline dans checkReference | Query séparée |
| Couleurs | Référence string (GOLDEN) | Int `id_couleur` avec nom/hex |
