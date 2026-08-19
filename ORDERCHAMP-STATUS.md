# Orderchamp — Intégration BJ · État d'avancement

**Chantier démarré** : 2026-08-19
**Compte OC de dev/prod** : `PRINCESSE` (`contact@beliandjolie.com`, slug vitrine `beli-jolie`)
**Endpoint** : `https://api.orderchamp.com/v1/graphql` — Bearer token privé par tenant
**Doc de référence** : https://developers.orderchamp.com/getting-started

---

## Ce qui est fait ✅

### Phase 1 — Prisma + config globale

- `prisma/schema.prisma` — nouveaux champs :
  - `Product` : `orderchampProductId`, `orderchampLastSyncSnapshot`, `orderchampLastRefreshedAt`, `orderchampSyncRequired`, `orderchampEnabled`, `orderchampLastExportedAt` + `@@unique([tenantId, orderchampProductId])` + index
  - `ProductColor` : `orderchampVariantId`, `orderchampColorNameOverride` + index
  - `Category` : `orderchampCategoryPath` (feuille standard OC), `orderchampCustomCategoryId` (perso auto-créée)
  - `Composition` : `orderchampMaterialCode` (enum `FilterMaterialValue`)
  - Nouveaux modèles : `OrderchampOrder` + `OrderchampOrderItem` (miroir de `FaireOrder`)
  - Enum étendus : `MarketplaceJobTarget.ORDERCHAMP`, `OrderchampOrderStatus`
  - `MarketplaceRefreshJob.orderchampOutcome` (Json?)
- `lib/encryption.ts` — clé `orderchamp_api_key` chiffrée
- `lib/marketplaces-brand.ts` — identité visuelle orange `#F97316 → #FDBA74`, monogramme « O »
- `lib/marketplace-enabled.ts` — union `MarketplaceKey` étendue
- `lib/marketplace-auto-sync.ts` — source `ORDERCHAMP` + clés SiteConfig
- `lib/marketplace-queue-serializer.ts` — mapping `orderchamp` ↔ `ORDERCHAMP`
- `lib/marketplace-job-intent.ts` — `ID_FIELD_BY_MARKETPLACE.orderchamp`
- `lib/cached-data.ts` — `getCachedOrderchampApiKey/HasConfig/Enabled`
- `lib/platform-config.ts` — maintenance orderchamp
- `app/actions/admin/site-config.ts` — `updateOrderchampCredentials` + `validateOrderchampCredentials` + markup wholesale/retail + `PRODUCTS_MGMT_KEY.orderchamp`

### Phase 2 — Auth + client GraphQL

- `lib/orderchamp-auth.ts` — Bearer token par tenant, cache anti-fuite multi-boutique, `testOrderchampApiKey`
- `lib/orderchamp-client.ts` — wrapper GraphQL avec retry 429/5xx, gestion `userErrors` + `errors` top-level (`OrderchampGraphQLError`)
- `lib/orderchamp-queries.ts` — toutes les queries/mutations validées par introspection réelle

### Phase 3 — CRUD produit + wiring orchestrateurs

**Modules purs** (16 fichiers) :

- `lib/orderchamp-sku.ts` — génération SKU déterministe max 60 chars
- `lib/orderchamp-country.ts` — mapping ISO alpha-2 (Orderchamp n'exige pas alpha-3)
- `lib/orderchamp-description.ts` — description enrichie (compo + tailles + made-in)
- `lib/orderchamp-shape.ts` — validation pré-publish (règles couleur/dimensions/prix)
- `lib/orderchamp-sync-diff.ts` — snapshot pour diff incrémental (version 1)
- `lib/orderchamp-pricing.ts` — wholesale + retail chaînés (règle IEEE-754 via centimes entiers)
- `lib/orderchamp-inventory.ts` — bulk stock via `inventoryLevelBulkAdjust`
- `lib/orderchamp-taxonomy.ts` — pull des 1 382 catégories + cache 24h + helpers cascade
- `lib/orderchamp-custom-category.ts` — auto-create + auto-publish customCategory (piège isPublished=false résolu)
- `lib/orderchamp-publish.ts` — payload complet BJ→OC (titre, desc, catégorie feuille, custom cat auto-publiée, dimensions cm, variantes multi-couleur×taille `option1="Color"`/`option2="Size"`, images racine, attribution image par variante en post-passe, matériaux via `filterMaterial`, publish sur storefront si `Product.status === "ONLINE"`)
- `lib/orderchamp-update.ts` — re-push meta + bulk stock
- `lib/orderchamp-refresh.ts` — `productRepublish` (garde le même ID Orderchamp)
- `lib/orderchamp-delete.ts` — `unpublish` (soft) + `hardDelete` (idempotent)
- `lib/orderchamp-storefront.ts` — résout et cache l'ID storefront par tenant

**Wiring dans les orchestrateurs BJ** :

- `app/actions/admin/marketplace-publish.ts` — branche `if (options.orderchamp)`
- `app/actions/admin/marketplace-refresh.ts` — branche orderchamp
- `app/actions/admin/marketplace-delete.ts` — `deleteProductsOnOrderchamp()` bulk
- `app/actions/admin/marketplace-resync.ts` — `resyncProductOnOrderchamp()`
- `app/actions/admin/products.ts` (`updateProduct`) — pose `orderchampSyncRequired=true` au save (3 endroits)
- `lib/image-queue.ts` — pose `orderchampSyncRequired=true` quand nouvelle image
- `lib/marketplace-queue-worker.ts` — dispatch case `ORDERCHAMP` + `runOrderchampJob()` complet
- `app/actions/admin/marketplace-sync-flags.ts` — clearSyncRequiredFlag + canTriggerResync étendus
- `app/actions/admin/product-marketplace-enabled.ts` — champ `orderchampEnabled` géré

### Phase 4 — Server actions

- `app/actions/admin/orderchamp.ts` — 6 actions :
  - `publishProductToOrderchamp(productId)`
  - `updateProductInOrderchamp(productId, { forceFullSync? })`
  - `refreshProductOnOrderchamp(productId)`
  - `deleteProductFromOrderchamp(productId)`
  - `unpublishProductOnOrderchamp(productId)`
  - `removeOrderchampMatch(productId)` (unlink local sans toucher OC)

### Phase 5 — UI admin (partiellement fait)

**Fait** :

- `app/(admin)/admin/parametres/page.tsx` — lit toutes les configs orderchamp + stats
- `components/admin/settings/MarketplaceConfig.tsx` — 6ᵉ tuile « Orderchamp », drawer complet (saisie token + validation live + kill-switches + markup wholesale/retail)
- `components/admin/products/ProductMarketplaceToggles.tsx` — toggle enabled orderchamp par produit
- `components/admin/products/MarketplacePushModal.tsx` — case orderchamp
- `components/admin/products/RefreshMarketplaceDialog.tsx` — case + carte orderchamp
- `components/admin/products/BulkPublishDraftsModal.tsx` — case orderchamp
- `components/admin/products/MarketplaceMaintenanceContext.tsx` — flag orderchamp
- `app/api/admin/marketplace-enabled-counts/route.ts` — compteur orderchamp

**Restant côté UI (voir plus bas)**.

### Phase 7 — Tests + doc

- 6 suites Vitest / **41 tests verts** : `orderchamp-sku`, `orderchamp-country`, `orderchamp-description`, `orderchamp-pricing`, `orderchamp-sync-diff`, `orderchamp-shape`
- `CLAUDE.md` — section « Orderchamp (2026-08-19) » complète (règles métier, pièges, endpoint) + couleur initiale ajoutée
- Mémoire projet `project_orderchamp_rules.md` — 10 règles piégeuses documentées

---

## Ce qui reste à faire ⏳

### Bloquants côté cliente (à faire en 1er sur PC maison)

1. **Démarrer MySQL local** (Laragon/XAMPP)
2. **`npx prisma db push`** — ajoute toutes les nouvelles colonnes en base
3. **`npx prisma generate`** (déjà fait mais à refaire si nouveau clone)
4. **Aller dans `/admin/parametres > Marketplaces > Orderchamp`**, coller le token :
   ```
   2554a293008c44332e6f8abc44d933ce76b8eccb
   ```
   (⚠️ à régénérer par sécurité, il a transité en clair dans le chat)
5. **Publier la vitrine côté back-office Orderchamp** — clic sur « Go live » (actuellement `isPublished: false`)

### Phase 5 UI — reste

Par ordre de priorité :

#### 🔴 1. Mapping catégories dans `/admin/categories` (BLOQUANT pour rendu OC complet)

- **Fichier à modifier** : `components/admin/categories/CategoriesManager.tsx` (ou équivalent)
- **Objectif** : sélecteur en cascade `ProductCategoryPath` (racine → sous-cat → feuille obligatoire) avec libellés FR (via `getCachedOrderchampTaxonomy()`)
- **Stockage** : `Category.orderchampCategoryPath` (feuille imposée — sinon back-office OC affiche « Catégorie de marché » vide)
- **Nouveau composant** : `OrderchampCategoryCascadeSelector.tsx` (racine cliquable → développe sous-cats → clic feuille = validation)
- **Sans ça** : chaque publish OC aura ce champ vide (bug déjà observé lors des tests avec la cliente)

#### 🟠 2. Mapping matériaux dans `/admin/compositions` (BLOQUANT pour visibilité matériau)

- **Fichier à modifier** : `components/admin/compositions/CompositionsMasterDetail.tsx`
- **Objectif** : nouvelle colonne « Orderchamp » à côté de PFS/eFashion/Faire
- **Composant** : `CustomSelect` filtré aux ~35 matériaux bijoux (`FilterMaterialValue` enum : STAINLESS_STEEL, BRASS, ENAMEL, GOLD_PLATED, ROSE_GOLD_PLATED, GENUINE_PEARLS, ZIRCONIA, etc.) + search
- **Stockage** : `Composition.orderchampMaterialCode`
- **Sans ça** : les fiches OC affichent 0 matériau

#### 🟢 3. Badge « O » par produit dans `MarketplaceStatusButtons.tsx`

- **Fichier lourd** (~500 lignes) — patch estimé 30-40 remplacements
- **Objectif** : afficher le statut orderchamp (`orderchampProductId`/`Enabled`/`SyncRequired`/`LastRefreshedAt`) avec badge orange, actions publish/refresh/unlink au clic
- **Confort UX** : sans ça, tu passes obligatoirement par la modale save/refresh pour agir sur OC

#### 🟢 4. Table produits + bulk

- `components/admin/products/AdminProductsTable.tsx` — colonne/filtre orderchamp
- `components/admin/products/BulkActionBar.tsx` — case orderchamp dans les actions bulk

#### 🟢 5. Widget flottant `MarketplacesDrawer`

- `components/admin/widgets-rail/MarketplacesDrawer.tsx` — branche `marketplace === "orderchamp"` pour affichage jobs

### Phase 6 — Commandes (reporté à ta demande)

- `lib/orderchamp-orders-api.ts` — GraphQL wrappers list/get orders
- `lib/orderchamp-orders-sync.ts` — `syncRecentOrderchampOrders` + `importAllOrderchampOrdersFor`
- `lib/orderchamp-orders-worker.ts` — poll 5 min avec kill-switch
- `lib/orderchamp-orders-import-state.ts` — état import historique dans SiteConfig
- `lib/orderchamp-stock-deduction.ts` — déduction stock idempotente via `stockDeductedAt`
- `lib/marketplace-excel/generate-orderchamp.ts` — Excel export (si OC propose un import Excel)
- `instrumentation-node.ts` — démarrage worker orders au boot
- `app/actions/admin/orderchamp-orders.ts` — server actions gestion imports
- Route webhook éventuelle : `/api/webhooks/orderchamp/orders/route.ts`

### Améliorations bonus (optionnelles)

- `filterColor`, `filterKarat` (bijoux : 20 couleurs OC + 4 karats standardisés) — si tu veux enrichir les filtres acheteurs
- Prix par canal (`portalSurchargeGroup`, `marketplaceSurchargeGroup`, etc.) — si tu veux tarifer différemment selon canal
- Excel export si OC accepte des imports XLSX

---

## Découvertes API critiques (à ne PAS oublier)

Toutes documentées dans `~/.claude/projects/…/memory/project_orderchamp_rules.md` + `CLAUDE.md` :

1. **Axes en ANGLAIS obligatoires** : `option1: "Color"` + `option2: "Size"`. En français (`"Couleur"`/`"Taille"`) le produit devient illisible via `product(id)`.
2. **Toujours 2 axes** : variante envoie `option1` (couleur) + `option2` (taille), fallback `"One Size"` si mono-taille locale.
3. **Dimensions physiques toujours envoyées** : poids en grammes, longueur/largeur/hauteur/diamètre en cm (BDD BJ en mm, ÷10 dans `orderchamp-publish`).
4. **Catégorie feuille impérative** : `ProductCategoryPath` (feuilles) — pas les branches parents comme `JEWELRY_ACCESSORIES_BRACELETS`. Une feuille = ex `JEWELRY_ACCESSORIES_BRACELETS_BANGLE_BRACELETS`.
5. **CustomCategory doit être publiée** : `customCategoryCreate` retourne `isPublished:false`. Enchaîner `customCategoryUpdate({isPublished:true})` sinon l'attribution est ignorée silencieusement. Séquence encapsulée dans `ensureOrderchampCustomCategory()`.
6. **`productRepublish` garde l'ID** : refresh sans changer l'URL fiche acheteur (comparable Ankorstore).
7. **Stock via `inventoryLevelBulkAdjust`** : `SET` pour synchro, `ADJUST` pour delta commande.
8. **`filterMaterial` = array max 4** — chaque `productVariantUpdate` **écrase** la liste (pas d'append).
9. **Piège scalar `diameter`** typé `Liter` mais accepte cm.
10. **`salesChannels` en lecture seule** — activés côté back-office OC.
11. **Publish sur storefront** : `productPublish(input: { id, storefrontId })` obligatoire pour visibilité acheteur. Sans lui, produit reste brouillon.
12. **`Storefront.isPublished`** activable seulement via back-office OC (pas d'API pour modifier).

---

## Produits test créés sur OC (peuvent être supprimés)

| ID | Titre | État |
|---|---|---|
| `4118669474398209` | TEST BJ Orderchamp - Bracelet Or Fantaisie | Brouillon (option1 FR — invalide) |
| `4118678613917697` | TEST BJ Orderchamp - Bracelet TU avec dimensions | Brouillon (option1 FR — invalide) |
| `4118696448032769` | TEST BJ OC 3 - options EN | Brouillon (option1 EN OK) |
| `4118696469659650` | TEST BJ OC 4 - avec attributs marketing | Brouillon (option1 EN OK) |
| `4118701058703365` | TEST BJ OC MULTI - Bracelet 3 couleurs 2 tailles | Brouillon (6 variantes couleur×taille + 3 images + matériaux + customCategory Bracelets) |
| `4118794251010049` | TEST CRUD 1787144050 | ❌ Déjà supprimé (test productDelete) |
| `4118957649002497` | BJ LIVE 1787154023 - Bracelet Or 4mm | **PUBLIÉ EN LIVE** (status published sur storefront beli-jolie) |

CustomCategory créée : `Q3VzdG9tRmllbGRzVmFsdWU6NDExODcyNDQ0NjYxNzYwMQ` (« Bracelets »)

---

## Où reprendre depuis chez toi

1. **`git fetch origin && git checkout feat/orderchamp-integration`** (branche créée avec ce commit)
2. Démarrer MySQL, `npx prisma db push`, `npx prisma generate`
3. Ouvrir ce fichier `ORDERCHAMP-STATUS.md` — la liste « Ce qui reste à faire » sert de checklist
4. Priorité 🔴 1 (mapping catégories) puis 🟠 2 (mapping matériaux) — les 2 bloquent le rendu OC complet
5. Une fois ces 2 chantiers finis, publier un vrai produit BJ vers OC en test pour valider bout en bout
6. Continuer sur le badge fiche produit, la table, le widget, puis la Phase 6 commandes

Toutes les règles piégeuses sont dans `CLAUDE.md` section « Orderchamp (2026-08-19) » — je m'y référerai à chaque nouvelle session.
