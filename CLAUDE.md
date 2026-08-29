# CLAUDE.md

## À qui tu parles
Cliente **non-développeuse**. Français simple, court. Impact décrit **pour elle et ses clients**, jamais en code. Tests = trajets dans le site, jamais de commande terminal. Détails techniques : entre toi et le code.

> Docs : `docs/architecture.md` · `docs/pfs-system.md` · `docs/pfs-api.md` · `docs/pfs-mobile-api.md` · `docs/ankorstore-api.md` · `docs/efashion-api.md` · `docs/faire-api.md` · `docs/smarty365-api.md` · `docs/microstore-api.md` · `docs/styling.md`

---

## Règles de travail
- **Auto-MAJ CLAUDE.md** si nouvelle convention/env var.
- **Parallélisation** : sous-agents indépendants en parallèle.
- **Récap fin** : « Ce que vous m'avez demandé » (1-3 phrases).
- **Impact croisé** : prévenir **avant** de coder si autre feature impactée.
- **Suggestions** : proposer variantes UX/perf, elle décide.
- **Tests Vitest obligatoires** sur toute feature/modif.
- **Serveur local jamais lancé par Claude** : ne **jamais** exécuter `npm run dev`, ni tuer/redémarrer un process sur `localhost:3000`. La cliente ouvre elle-même son serveur local dans son terminal. Après une modif qui nécessite un redémarrage (schema Prisma, `.env`, `next.config.ts`), le lui dire — ne pas le faire. Si un port 3000 tourne et gêne une commande, demander avant d'agir.

### Workflow modif → validation → push
1. Modifier local. Pas de push auto.
2. Informer + trajet de test.
3. Décision : **« Mettre de côté »** = push groupé. **« Push prod »** = pré-flight → backup → `git add/commit/push origin master`.
4. **GitHub Actions `.github/workflows/deploy.yml`** prend le relais : build runner Ubuntu 24.04, rsync `.next`+`node_modules`+`prisma`+`public` sur VPS, exécute `scripts/deploy/vps-receive.sh` (applique `prisma db push` si `schema.prisma` changé — hash comparé à `/root/.beliandjolie-schema-hash`, puis `pm2 restart beliandjolie` + health check 2 tenants suivant redirs 307 next-intl → /fr, vérif `<title>`). Si échec, prod reste sur l'ancienne version. **Durée ~2 min 30-3 min**. Code identique local/GitHub/VPS.

**Secrets GitHub** (`Settings → Secrets → Actions`) : `VPS_SSH_KEY` (clé privée `/root/.ssh/github_actions_ed25519`, workflow auto-wrap headers `-----BEGIN/END OPENSSH PRIVATE KEY-----`), `VPS_HOST=72.61.106.128`, `VPS_USER=root`, `VPS_APP_DIR=/var/www/beliandjolie`. Clé publique dans `authorized_keys` VPS.

**Pièges workflow** : `ssh-keyscan` timeout runners GitHub → skip + `StrictHostKeyChecking=no` + `UserKnownHostsFile=/dev/null`. IPv6 runner → VPS Hostinger timeout → forcer `-4` sur ssh/rsync. Health check strict échoue sur 307 next-intl → `curl -sL`. Nouveau VPS/clone : `git config --global --add safe.directory /var/www/beliandjolie` root.

**Fallback deploy sur VPS** — `scripts/deploy/vps-build-with-freeze.sh` : seulement si GitHub Actions HS. Stop PM2 avant build (libère 2-3 Go RAM sur VPS 7.8 Go, sinon build swap ~30 min ; avec, ~10-15 min). Downtime ~10 min.

**Raccourci deploy CASSÉ 2026-07-28 NE PAS UTILISER** `scripts/deploy/deploy-fast.ps1`. Turbopack hashe les noms des modules externes (`sharp`, `pdfkit`, `playwright`, `exceljs`) avec chemin — hash Windows ≠ Linux, VPS crashe. `serverExternalPackages` ne protège pas en Turbopack. Remplacé par GitHub Actions (Ubuntu = arch VPS).

**Pré-flight AVANT push prod** — `pm2 restart` tue tous workers (images, translation, marketplace queue, PFS refresh, chat, shooting eFashion) ; **jamais** si travail en vol. Vérifs — remonter à la cliente si occupé, attendre go explicite :
1. `mysql beliandjolie -e "SELECT status,marketplace,COUNT(*) FROM MarketplaceRefreshJob WHERE status IN ('QUEUED','IN_PROGRESS','AWAITING_CALLBACK') GROUP BY status,marketplace;"` — si ≥ 1 → « j'attends ? ».
2. `mysql beliandjolie -e "SELECT status,COUNT(*) FROM ImageProcessingJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status;"` — si > 0 → même question. Restart met PROCESSING → PENDING (idempotent).
3. Ankorstore synchrone : plus de check (`AnkorstoreOperation` obsolète).
4. `tail -200 /root/.pm2/logs/beliandjolie-out.log | grep -E "Ankorstore|Chargement|Import|Preview job"` — activité récente → attendre.
5. `mysql … "SELECT … FROM TranslationJob/EmailQueueJob WHERE status IN ('PENDING','PROCESSING')…"` — si > 0 → prévenir.

Une fois calme : backup + deploy. Après restart, refaire SELECT MarketplaceRefreshJob pour vérifier aucun IN_PROGRESS bloqué (startup sweep marque FAILED mais race rare peut laisser — nettoyer manuellement).

**Backup avant push prod** — `/root/backups/pre-push-YYYYMMDD-HHMMSS/` :
1. `mkdir -p` horodaté.
2. `mysqldump --single-transaction --routines --triggers --events --databases beliandjolie | gzip > db-beliandjolie.sql.gz` (~10 Mo, 2 tenants).
3. `git rev-parse HEAD > git-head.txt` (rollback `git reset --hard <sha>`).
4. `git archive --format=tar HEAD | gzip > code-git-head.tar.gz`.
5. `cp .env → .env.backup ; chmod 600`.
6. `cp -al public/uploads → uploads-public` + `cp -al private/uploads → uploads-private` (hardlinks, ~0 disque).

Restauration : `zcat db-beliandjolie.sql.gz | mysql`, `git reset --hard $(cat git-head.txt)`, `cp .env.backup .env`. Garder ≥ 7 jours.

**Exception Ankorstore** : push direct prod (callbacks async ne hittent pas localhost).

Confirmation **uniquement** avant : suppression données, drop tables, push --force, secrets.

### Maquette avant tout design
Dès qu'une demande touche au visuel (couleurs, mise en page, composants, refonte, hero, sidebar) :
1. HTML autonome dans `C:/Users/Admin/Downloads/` (Tailwind CDN, aucune dép repo).
2. Ouvrir navigateur.
3. Ajuster jusqu'à validation.
4. Appliquer au vrai code.

Sauter si elle dit « pas besoin » ou trivial (libellé, faute, padding).

### Procédures en attente
- **« feu vert journaux »** → `docs/operations/mysql-binlog-cleanup.md`. Une fois OK, supprimer le fichier + retirer cette ligne.

---

## Architecture
B2B SaaS e-commerce générique (vente en gros). **Next.js 16 · MySQL/Prisma · Tailwind v4 · TS**.

### Route groups
| Group | URL | Access |
|---|---|---|
| `(auth)` | `/connexion`, `/inscription` | Non-auth |
| `(admin)` | `/admin/*` | ADMIN |
| `(client)` | `/espace-pro`, `/panier`, `/commandes`, `/favoris` | CLIENT APPROVED |
| direct | `/produits`, `/collections`, `/categories` | Public — prix masqués si non APPROVED |

Protection : `middleware.ts` (edge) + `layout.tsx`. Maintenance cache 60s **on success only**. **Prix visibles** via `lib/price-visibility.ts::canSeePrices()` : API remet `unitPrice`/`discountPercent` à 0/null si non autorisé ; filtres `minPrice/maxPrice` ignorés.

### Layers
- **Server actions** (`app/actions/`) : mutations. `requireAdmin()`/`requireAuth()` obligatoire.
- **API routes** (`app/api/`) : webhooks, SSE, file-serving.
- **Lib** (`lib/`) : `pfs-*`, `ankorstore-*`, `smarty365`, `easy-express`, `marketplace-pricing`, `storage`, `email`, `cached-data`, `security`, `encryption`, `logger`, `seo`.

### Microstore (Dokkr) — API native (2026-08-25)
Depuis 2026-08-25, Microstore utilise l'API native `/goods/add` + `/goods/update` + `/goods/disable` + `/goods/del` (au lieu du CSV `/goods/import_v1` historique). Endpoints reversés via HAR HTTP Toolkit de l'appli mobile MC Gérant. Le token QR compagnon `5_XXX` (déjà en place) autorise write. **Doc complète** : `docs/microstore-api.md` § 4.3-4.5.
- **Prisma** : `Product.microstoreProductId Int?` (unique par tenant) + `ProductColor.microstoreVariantId Int?` — remplis auto par push, permettent update ciblé + delete variantes propre (`del_id` dans /goods/update).
- **Mapping BJ ↔ Microstore** : `Color.microstoreColorId`, `Category.microstoreCategoryId`, `SubCategory.microstoreCategoryId`, `Season.microstoreSeasonId` (Int?) — mapping MANUEL via `<MicrostoreAttributeSelect>` dans les formulaires d'attributs BJ. Priorité sur match par nom au push. Les compositions BJ **n'ont pas** de mapping : elles ne sont pas un attribut natif Microstore et sont envoyées en texte libre dans `remark_material` sur le produit. **Branchement UI en cours** — voir `docs/microstore-mapping-plan.md`.
- **Étiquette catégorie envoyée à Microstore (2026-08-25)** : sur la fiche produit, la cliente peut choisir d'envoyer la catégorie principale (défaut) OU une sous-catégorie attribuée. Résolution centralisée dans `resolveMicrostoreCategoryChoice()` (`lib/microstore-subcategory.ts`) : source sous-cat prioritaire si choisie, chaque source doit être mappée à un ID Microstore sinon push refusé. UI `ProductForm` grise le badge « M » des sous-cats non mappées + tooltip explicatif. La sous-cat se mappe depuis `/admin/categories` via le badge « M » sur ses chips (`SubCategoryChips`).
- **Libs** : `lib/microstore-goods-crud.ts` (CRUD produit + variantes), `lib/microstore-attributes.ts` (CRUD cat/brand/year/season + couleur), `lib/microstore-products.ts` (refactor pour utiliser les 2 précédentes au lieu du CSV).
- **Visibilité vitrine H5 pilotée par le statut BJ (2026-08-25)** : chaque push envoie le flag `disable` dans le body de `/goods/update` (pas via `/goods/disable` qui répond « Service App error »). OFFLINE/ARCHIVED → `disable=1`, ONLINE/SYNCING → `disable=0`. Microstore stocke le champ comme un **timestamp Unix de désactivation** (0 = visible, sinon masqué). Règle centralisée `shouldDisableOnMicrostore()` (`lib/microstore-products.ts`) — nécessite le champ `status` sur `ExportProduct` (chargé par `loadExportProducts`).
- **Server actions** : `app/actions/admin/microstore-products.ts` étendu (`toggleMicrostoreProductDisabled`, `deleteProductFromMicrostore`) + `app/actions/admin/microstore-attributes.ts` (CRUD complet).
- **UI** : `MicrostoreStatusCard` a 2 nouveaux boutons ronds (masquer/afficher, supprimer) — visibles si `microstoreProductId != null`. Composant `MicrostoreAttributeSelect` (`components/admin/shared/`) prêt à brancher dans les formulaires BJ.
- **Connexion QR** : `MicrostoreConnectCard` remplace le bookmarklet historique par un vrai flow QR compagnon (`/api/admin/microstore/qr` + poll) — cliente scanne 1 fois par an avec son appli MC Gérant, ça coexiste avec sa session mobile.
- **Backfill IDs Microstore** : `scripts/backfill-microstore-goods-ids.ts` (dry-run par défaut, `--apply` pour écrire). À exécuter après le déploiement prod pour retrouver les IDs des produits déjà poussés en CSV.
- **CSV legacy** : `/goods/import_v1` conservé dans `microstore-products.ts` (fonctions dépréciées `MICROSTORE_API_HEADERS` + `productToMicrostoreApiRows`) uniquement pour rollback d'urgence.

### Marketplaces (PFS + Ankorstore + eFashion + Faire + Orderchamp + Microstore)
- **IDs** : `Product.pfsProductId`/`ankorsProductId`/`efashionReferenceBase`/`faireProductId`/`orderchampProductId` + `ProductColor.pfsVariantId`/`ankorsVariantId`/`orderchampVariantId`. `null` = non publié.
- **`*SyncRequired`** : posé par `updateProduct` (champ clé modifié) + worker images (`lib/image-queue.ts`). Reset par sync réussie ou `clearSyncRequiredFlag()`. Badge orange dans `MarketplaceStatusButtons` + `AdminProductsTable`. Priorité : loading > syncRequired > online > offline.
- **Kill switch 2 dimensions (2026-08-18)** : chaque marketplace a 2 toggles dans Paramètres → Marketplaces :
  - **Gestion Produits** (SiteConfig `{mkt}_products_management_enabled`, défaut ON) : OFF = aucun push/publish/refresh/resync/synchro/delete ; badge grisé. Lu via `getCachedXEnabled()` (= hasConfig ∧ productsManagementEnabled).
  - **Gestion Commandes** (SiteConfig `{mkt}_orders_worker_enabled`, défaut ON) : OFF = worker sync commandes skip. Lu via `isMarketplaceAutoSyncEnabled(tid, source)`.
  - Actions : `setMarketplaceProductsManagement()` + `setMarketplaceAutoSyncEnabled()`. Anciens `togglePfsEnabled/…` supprimés. Migration : `npx tsx scripts/migrate-marketplace-toggles.ts --apply`.
- **Modale save** : case par marketplace si produit complet + configurée → enqueue `MarketplaceRefreshWidget`. PFS/Ankor/eFa/Faire/OC/Microstore n'apparaissent que si le produit y est **déjà lié** (1ʳᵉ publication via badge fiche). Alignement Microstore avec les 5 autres depuis 2026-08-25 (avant : upsert-style — toute modif proposait Microstore même sans lien). Critère « déjà lié Microstore » = `microstoreLastPushedAt != null`. OC caché quand produit OFFLINE. Le bouton « Rafraîchir » bulk reste upsert-style pour OC/Microstore (crée la fiche depuis un produit non lié — parcours explicite).
- **Publish vs Update** : `*UpdateProductInPlace()` si ID connu (PATCH + diff snapshot), sinon `*PublishProduct()`. Fallback publish si update échoue.
- **Diff snapshot** (`pfsLastSyncSnapshot` Json?) : envoie que le delta. Reset `Prisma.DbNull` quand ID change. `null` = sync complète.
- **Resync forcé** (↻) : `forceFullSync: true`, ne touche pas l'ID. **Best Seller PFS** : STAR/REMOVE_STAR si changé.
- **Annexes PFS** : LIVE `lib/pfs-annexes.ts` (cache 60min, tag `pfs-annexes`).
- **Proxy images** : `/api/marketplace-image?path=…` upscale à 500px si source < 500px (Ankor ≥ 500). Origine intacte. Pas pour PFS.
- **Delete** : PFS = local-only. Ankor = auto callback `ankorstoreKickoffStandaloneDelete()`.
- **PFS compo — API admin (mobile) prioritaire (2026-08-27)** : 2 APIs PFS — `wholesaler-api.parisfashionshops.com` (import/audit, OAuth) et `admin.parisfashionshops.com` (appli mobile, Bearer via `/api/auth/seller`). Bug PFS : le wholesaler renvoie parfois une compo stale ou vide alors que la cliente a saisi via l'appli mobile. Depuis 2026-08-27, **on lit toujours l'API admin d'abord** via `lib/pfs-admin-api.ts::pfsAdminFetchMaterialComposition(pfsProductId)` ; wholesaler ne sert que de fallback si mobile est vide ou HS. Avant cette date on faisait l'inverse (mobile en fallback) : angle mort découvert sur produit issyma 375 où wholesaler renvoyait une compo différente du mobile. Appliqué dans `pfs-import`, `pfs-verify`, `pfs-verify-apply` (via `preferMobileComposition`). Pull auto compo depuis 2026-08-01 : `resolvePfsCompositionsToLocal` matérialise ProductComposition (auto-création `createOrLinkMapping` si code PFS inconnu, dédoublonnage/merge % si 2 codes → même Composition). Credentials wholesaler (`pfs_email`+`pfs_password`). Constante `AemikSEAUID = "AemikWeb3_PFSBKOFFICE"` requise dans POST admin. **Doc** : `docs/pfs-mobile-api.md`.
- **Modale de liaison — intents (2026-07-28)** : `LinkMarketplaceModal` unifié PFS/Ankor/eFa/Faire, accepte 3 `LinkIntents` :
  - `colorsToCreate` : couleurs BJ orphelines à créer chez mkt avec upload photo (bouton étape 3, grisé sans photo).
  - `orphansToDelete` : variantes mkt orphelines à supprimer chez mkt.
  - `orphansToImport` : variantes mkt orphelines à importer en ProductColor BJ + lier. Via `createLocalVariantFrom{Mkt}Variant()` (une par mkt dans `app/actions/admin/{efashion,ankorstore,pfs,faire}.ts`) — trouve/crée Color, choisit Size TU, calcule prix/poids, crée ProductColor UNIT avec `{mkt}VariantId`.
  - **Anti-doublon** : `createLocalVariantFrom{Mkt}Variant()` vérifie si produit BJ a déjà ProductColor UNIT sur cette Color. Oui + non-liée → RELIE. Oui + déjà liée AUTRE mkt → erreur. Sinon crée. UI hint 💡 étape 4 quand détecté.
  - **Validation dure UI** : chaque variante mkt non-mappée DOIT être dans `orphansToDelete` ou `orphansToImport`. Bouton « Valider » bloqué sinon.
  - Serveur : `link{Mkt}ProductManually` accepte `intents?` en dernier arg. Ordre : (1) delete orphelines, (2) transaction link, (3) import orphelines (nécessite `{mkt}ProductId` posé), (4) sync `updateProductInPlace({forceFullSync:true})`.
  - Suppression variante isolée : PFS `pfsDeleteVariant()`, eFashion `efashionDeleteShootingProduct()` (hard), Faire `DELETE /products/{id}/variants/{vid}`, Ankor = pas d'endpoint → kickoff overwrite.
  - Auto-création côté mkt : réutilise forceFullSync (PFS `variantsToCreate`, eFashion `duplicateWithNewColor`, Faire `variantsAdded diff`, Ankor = write state override).
  - Garde-fou UI : refus si `orphansToDelete` couvre TOUTES variantes mkt ET aucune couleur BJ mappée.
  - Retour `LinkResult` étendu : `autoCreatedOnMarketplace` + `deletedOnMarketplace` + `importedFromMarketplace`, affichés dans widget Marketplaces.

### Orderchamp (2026-08-19)
Marketplace B2B Pays-Bas. **API GraphQL** (`https://api.orderchamp.com/v1/graphql`, Bearer token privé par tenant, SiteConfig `orderchamp_api_key` chiffré). > **Chantier en cours — état + TODO dans `ORDERCHAMP-STATUS.md` racine.** Consulter avant reprise. **Modules `lib/orderchamp-*.ts`** : auth, client, queries, sku, country, description, shape, sync-diff, pricing, inventory, taxonomy, custom-category, publish, update, refresh, delete. Action `app/actions/admin/orderchamp.ts`. **Prisma** : `Product.orderchampProductId/LastSyncSnapshot/LastRefreshedAt/SyncRequired/Enabled/LastExportedAt`, `ProductColor.orderchampVariantId/ColorNameOverride`, `Category.orderchampCategoryPath` (feuille standard) + `orderchampCustomCategoryId` (perso auto), `Composition.orderchampMaterialCode`. Modèles `OrderchampOrder` + `OrderchampOrderItem`. Enum `MarketplaceJobTarget.ORDERCHAMP`.

**Règles métier figées** (cf. `memory/project_orderchamp_rules.md`) :
- **Axes en anglais** : `option1:"Color"` + `option2:"Size"`. "Couleur"/"Taille" français → OC ne peuple pas `variant.color/size`.
- **Toutes variantes ont taille + couleur** : `option1` couleur libre + `option2` taille ("S"/"M" ou fallback `"One Size"` si mono-taille).
- **Dimensions physiques toujours envoyées** : `weight` g, `length/width/height/diameter` cm (BDD mm, conversion ÷10 `orderchamp-publish`). Produit ET variante.
- **Catégorie feuille impérative** : `category` accepte l'enum `CategoryPath` (branches OK) mais back-office lit `ProductCategoryPath` (feuilles seulement). Mapper via feuille (ex `JEWELRY_ACCESSORIES_BRACELETS_BANGLE_BRACELETS`).
- **Mapping catégorie obligatoire par produit (2026-08-24)** : chaque `Category` BJ doit être mappée à une feuille standard OC via `/admin/categories` (drawer « Orderchamp »). Facultatif sur `SubCategory`. Résolution au push (`lib/orderchamp-category-resolve.ts`) : priorité **première sous-catégorie mappée** (ordre alphabétique) → sinon fallback sur `Category.orderchampCategoryPath`. `orderchampPublishProduct` / `orderchampUpdateProduct` refusent le produit si rien n'est mappé (message clair remonté à la modale save). Taxonomie OC pullée par introspection GraphQL sur `ProductCategoryPath`, cache 24 h tag `orderchamp-taxonomy` (`lib/orderchamp-taxonomy.ts`). OC devine parfois seul mais rate trop souvent — d'où le mapping manuel.
- **CustomCategory doit être publiée** : `customCategoryCreate` retourne `isPublished:false`. Enchaîner `customCategoryUpdate({isPublished:true})` avant d'attribuer — sinon `productUpdate` accepte silencieusement mais `customCategory` reste null (pas de userError). Encapsulé `ensureOrderchampCustomCategory()`.
- **Refresh via `productRepublish`** (jamais delete+recreate) — garde ID OC stable, URL fiche inchangée (comparable Ankor, différent Faire).
- **Stock via `inventoryLevelBulkAdjust`** — `SET` synchro régulière, `ADJUST` delta commande. Format `[{productVariantId, action, adjustment}, …]`, batches 100.
- **Filtres marketing** (`filterMaterial`, `filterColor`, `filterKarat`…) : sur variante, arrays typés `[FilterXValue]` avec `maximumValues` variable par catégorie (matériaux : max 4 pour bijoux). Chaque `productVariantUpdate` **écrase** — réenvoyer liste complète.
- **Piège scalar `diameter`** : typé `Liter` (bug schéma) mais accepte cm en pratique.
- **`salesChannels` en lecture seule API** : APP/DROPSHIPPING/MARKETPLACE/PORTAL/TICA à activer manuellement Settings > Sales channels OC. Input `salesChannels:[…]` ignoré si canal non activé.
- **Publish sur storefront** : `productPublish(input:{id, storefrontId})` requiert `storefrontId` de la vitrine pour visibilité acheteuses. Sans lui, brouillon. Helper `lib/orderchamp-storefront.ts` résout + cache par tenant. `orderchampPublishProduct` appelle auto post-create si `Product.status === "ONLINE"` BJ.
- **Storefront `isPublished`** : flag séparé, à activer manuellement back-office OC après validation compte.

**Compte dev/prod** : `PRINCESSE` (`contact@beliandjolie.com`).

### Ankorstore back-office reverse-engineered (2026-08-13)
Toutes ops **100 % synchrones** via API interne back-office `fr.ankorstore.com`. Plus de callback, table `AnkorstoreOperation`, webhook, polling UI. Module `lib/ankorstore-bo/` (auth session cookie + CSRF, referentials hardcodés, publish/update/read/mass-action/link/images/orders/builder/sku). Actions `app/actions/admin/ankorstore-bo.ts` (`publishProductToAnkorstoreBo`, `deleteProductFromAnkorstoreBo`, `setProductVisibilityOnAnkorstoreBo`, `searchAnkorstoreBoCandidatesForBjProduct`, `linkBjProductToAnkorstoreBo`, `unlinkAllBjProductsFromAnkorstoreBo`). Auth : email+mdp compte marque, chiffrés SiteConfig (`ankorstore_bo_email`, `ankorstore_bo_password`). Dev local marche. SKU `{REFERENCE}_{COULEUR_NORMALISEE}` (ex `A1720_VERT_DEAU`, cf. `lib/ankorstore-bo/sku.ts`). Statut BJ → Ankor : ONLINE = `enable`, OFFLINE/ARCHIVED = `disable`. Stock BJ vrai stock. Image père = 1ʳᵉ image couleur principale (`Product.primaryColorId`). Bug 422 SKU sur PUT contourné en injectant `variant.id` connus. **Commandes** : lecture via `lib/ankorstore-bo/orders.ts`. Worker orders désactivé (à réactiver après reverse POST tracking/reject).

### Refresh produit
Bouton « Rafraîchir » + bulk. Modale : boutique (bump `lastRefreshedAt`) + PFS + Ankor. Parallèle 5 max via `MarketplaceRefreshWidget`. `pfsRefreshProduct()` crée ref TEMP, archive l'ancien, renomme. Rollback auto. « Nouveauté » = `max(createdAt, lastRefreshedAt) > now - 30j`.

### Vérification par code OTP (actions destructives)
Filet contre bugs propagation : suppression / rafraîchissement marketplace / archivage → `<OtpConfirmDialog>` → code 6 chiffres sur boîte pro (`smtp_from_email`, forwardée mail perso). Prisma `AdminActionOtp` (id, adminId, action, productIds JSON, codeHash, expiresAt, attempts, usedAt), TTL 15 min, 5 tentatives. Lib `lib/admin-action-otp.ts` (`createOtpForAction`, `verifyAndConsumeOtp`, `guardAdminActionOtp`, `isOtpPauseActive`, `applyPauseChoice`). Actions `requestAdminActionOtp`, `verifyAdminActionOtpForRefresh`, `setAdminActionOtpPause`. `bulkDeleteProducts` + `bulkUpdateProductStatus(ARCHIVED)` acceptent `otpCheck?` et appellent `guardAdminActionOtp`. Refresh (bulk/unitaire) : vérif client-side `useRefreshMarketplaceDialog.requireOtpForRefresh` (bypass si local-only). Pause : dropdown modale, 15min/1h/24h, stockée `SiteConfig[admin_action_otp_pause_until]` (ms). Provider `<OtpConfirmProvider>` monté `app/layout.tsx`.

### Marketplace pricing
SiteConfig : 3 types (`percent`/`fixed`/`multiplier`), 3 arrondis (`none`/`up`/`down`). Clés `{marketplace}_price_markup_{type|value|rounding}`. **PACK** : markup sur prix unitaire (total÷qty), arrondi, ×qty. Jamais sur le total. **Retail = markup appliqué sur le WHOLESALE déjà majoré et arrondi** (pas sur basePrice BJ). Convention confirmée juillet 2026 (bug U02 Faire) — cliente dit « ×3 sur prix de gros » = ×3 sur wholesale, pas sur prix achat. Faire : `applyFaireMarkupWithClamp` (`lib/marketplace-pricing-shared.ts`). Ankor : `getAnkorstoreChainedRetailPrice` (`lib/ankorstore-pricing.ts`). **Arrondi passe TOUJOURS par centimes entiers** (`Math.round(price*100)`) AVANT `Math.ceil/floor` au dixième — sinon `4.2*3 = 12.600000000000001` IEEE-754 fait dériver le retail d'un cran (12,60 → 12,70). Fix dans `applyMarketplaceMarkup`, ne pas retirer.

### Livraison — 2 fournisseurs Easy-Express + Smarty365
- **Fournisseur actif** : SiteConfig `active_shipping_provider` (`"easy_express"` défaut | `"smarty365"`). Bascule Paramètres → Mode de livraison via `ActiveShippingProviderSelect`. Lu par `/api/carriers` (checkout) et `generateShipmentLabel` (bordereau admin).
- **Chaque commande garde son provider** (`Order.shippingProvider`). Résolution `resolveProviderForOrder` (`app/actions/admin/shipping.ts`) : priorité `shippingProvider` posé > `smartyLabelUrl`/`eeLabelUrl` posé > `carrierId` préfixé `smarty:` > provider actif.
- **Prisma Order** : `eeTrackingId`, `eeLabelUrl` + `smartyParcelId`, `smartyTrackingId`, `smartyLabelUrl`, `smartyTransporter`, `smartyRouteCode` + `shippingProvider`.
- **HMAC signature** : `verifyCarrierSignature` refuse `transactionId` vide → pour Smarty365 (pas de token cotation), `/api/carriers` génère jeton synthétique `smarty:v1:{random}` par requête. Le client repasse à `/api/payments/create-intent`.
- **Assurance Smarty365 obligatoire** : coût fondu dans le prix de port (pas de mention séparée client). Cotation ajoute `subtotalHT × rate%/100`, parcel envoie `insuredValue: Math.ceil(subtotalHT)` dans le sous-parcel. Taux `SiteConfig[smarty365_insurance_rate_pct]` (défaut 0,6 % = niveau Claisy public).
- **Points relais masqués** (tunnel BJ n'a pas de widget) : `isPickupPointRoute` filtre `RELAY_POINT`, `POST_OFFICE`, `RELAY_13H`, `_2SP_`/`_2SPEU_`, tout `MONDIAL_RELAY_*`.
- **DOM-TOM / hors UE** : Smarty365 exige `parcels[].items[]` (déclaration douanière). Détection auto via `EU_COUNTRY_CODES` (27 pays UE + FR métropole). Construction ligne par ligne dans `buildCustomsItemsForOrder` : chaque `OrderItem` → 1 item avec `description = productName`, `hscode = Product.hsCode.code` (fallback `71171900`), `originCountry = Product.countryIsoCode` (fallback `CN`), `value/weight/quantity` réels. **Pré-check dur** `checkOrderCustomsReadiness` : refuse la génération si un produit rattaché n'a PAS de code SH, message listant les refs concernées. Champs officiels Smarty365 : `hscode` (minuscule), `originCountry`, `value` (string), pas de `customClearance`/`hasInvoice`/`parcelType` (n'existent pas dans la doc, faux champs qui crashent l'API).
- **Doc officielle Smarty365** : `GET https://www.smarty365.com/api-spec.js` avec Bearer (fichier JS 54 K qui alimente leur Developer Center). Toujours lire cette source AVANT de reverse-engineerer.
- **Easy-Express** : centimes (÷100), poids min 1kg, +5€ marge, `transactionId` expire vite.
- **Marge frais port** (SiteConfig `shipping_margin_type/value`) s'applique aux 2 providers.
- **Doc complète** : `docs/smarty365-api.md`.

### Import PFS
`/admin/produits/importer-pfs` — choix → import direct. Attribut manquant (compo, pays, saison, taille, couleur, catégorie) **créé auto** dans `createOrLinkMapping`. Auto-traduction en fond via API PFS. Rattrapage : `npx tsx scripts/enrich-pfs-products.ts`.

### Import Excel produits
`/admin/produits/importer` : upload → preview → **récap éditable UI** → job background. **Excel uniquement**. Modèle 5 lignes en-tête (section/headers/Obligatoire-Facultatif/exemples/données). Composants `EditableProductCard`, `EntitySelect` (bouton +), `CompositionEditor`, `effective-status.ts`, `QuickCreateModal`. **Overrides** : `ImportOverride` JSON dans `{filePath}.overrides.json`, appliqué après propagation référence. **Quick-create idempotent** : pas de P2002.

### Onboarding wizard
`/admin/bienvenue` → 8 étapes (welcome/company/brand/stripe/email/shipping/legal/done). Layout `app/(admin)/admin/bienvenue/layout.tsx` (rend `WizardShell` client). État SiteConfig `onboarding_steps_completed` + `onboarding_completed_at`. Actions `markStepCompleted(step)` / `completeOnboarding()` (= skip). Middleware redirige admin non-fini vers `/admin/bienvenue`.

### Auth
NextAuth v4, Credentials + JWT (30d). New users `PENDING`. Token : `id`, `role`, `status`, `company`.

### i18n
next-intl 4.x, préfixe (`/fr/…`, `/en/…`). Locales **fr (défaut) + en**. Auto-translation API PFS (gratuit). Toggle `auto_translate_enabled`. Hors i18n : `/admin/*`, `/api/*`, `/maintenance`, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/icon`, `/apple-icon`. Liens admin → public : hardcoder `/fr/…`. Sitemap : 7× chaque URL + `alternates.languages`. Sélecteur : `router.replace(pathname, { locale })`. Mapping PFS pays/compo : libellé FR. Publish : `country_of_manufacture` priorité `isoCode → pfsCountryRef → "CN"`.

### Styling
**Tailwind v4** — theme dans `app/globals.css @theme {}`, pas de config JS. **Pas de dark mode public** (boutique toujours claire). **Mode sombre admin uniquement**. Flat design + ombres subtiles. Détails complets dans `docs/styling.md`.

#### Mode sombre admin (2026-08-13)
Bascule Paramètres → Affichage. Cookie `bj_admin_theme` (`light`|`dark`, 5 ans, `SameSite=Lax`). Lecture serveur `app/(admin)/layout.tsx` via `next/headers.cookies()` + `parseAdminTheme()` (`lib/admin-theme.ts`), pose classe `admin-dark` sur `#admin-theme-wrapper` (pas de flash). Bascule client `AdminThemeToggle` applique classe à chaud + persiste via `setAdminTheme`. Portée : CSS scopé strict `#admin-theme-wrapper.admin-dark { … }` (fin de `app/globals.css`). Pages `/admin/*` uniquement. Approche : redéfinir vars design system (`--color-bg-primary`…) + surcharger classes Tailwind figées (`.bg-white`, `.bg-zinc-*`, `.text-zinc-*`, `.border-zinc-*`, `.bg-slate-*`, dégradés `from-*-50`). Test `__tests__/lib/admin-theme.test.ts`.

#### Style espace pro / public (obligatoire hors `/admin`)
Réf `app/[locale]/(client)/commandes/page.tsx` + `components/client/orders/OrdersTableClient.tsx` (2026-07-17, validé cliente).
- **Palette ardoise** uniquement. **Interdit** : warm/or/beige/aurora doré, tons chauds. Sémantiques (`success/warning/error/info`) réservées statuts/alertes/KPI.
- **Couleurs initiales marketplaces** (rond avec lettre) — figées : **PFS** (P) `linear-gradient(135deg,#4f46e5,#6366f1)` · **Ankorstore** (A) `linear-gradient(135deg,#0ea5e9,#38bdf8)` · **eFashion** (E) `linear-gradient(135deg,#db2777,#ec4899)` · **Faire** (F) `linear-gradient(135deg,#f59e0b,#fbbf24)` · **Orderchamp** (O) `linear-gradient(135deg,#F97316,#FDBA74)` · **Microstore** (M) `linear-gradient(135deg,#0891b2,#22d3ee)` · **Boutique** (B&J) `linear-gradient(135deg,#64748b,#334155)`. Exclusivement rond d'initiale. Interdit en halo/aurora/bandeau/bordure/CTA.
- **Police sans-serif** : body `var(--font-roboto)`, titres `var(--font-poppins)` via `font-heading`. Interdit empattements (Cormorant, Playfair, serif).
- **Cartes** : `bg-bg-primary border border-border rounded-2xl shadow-sm`. Eyebrow uppercase `tracking-[0.2em] text-text-muted`.
- **KPI tiles** : mêmes cartes, valeur `font-heading text-3xl font-bold`. Couleur sémantique uniquement si compteur d'état.
- **CTA principal** : `bg-bg-dark text-text-inverse` (jamais accent coloré).
- **Timeline** : `bg-bg-secondary rounded-2xl`, pastilles `bg-text-primary` (active) / `bg-text-secondary` (done) / `bg-bg-tertiary border-dashed` (todo).
- Vaut pour maquettes autonomes (`Downloads/*.html`) et pages hors admin.

#### Style admin cockpit (obligatoire sur `/admin`)
Réf `app/(admin)/admin/page.tsx`, `parametres`, `produits/page.tsx`. Inspi Stripe/Linear/Vercel. **Pas de retour au flat blanc/gris.**
- **Hero** : `rounded-3xl` aurora (`bg-gradient-to-br from-{c}-50 via-bg-primary` + halos radiaux). Eyebrow chip + pastille + uppercase `tracking-[0.18em]`. Titre `font-heading text-2xl/3xl font-bold`.
- **KPI tiles** : `rounded-2xl`, fond pastel, valeur `text-{accent}-700`, halo flou, icône `bg-{accent}-100 ring-1 ring-{accent}-200`.
- **Cartes** : `rounded-2xl`, bande dégradée fine en haut, halo coin, eyebrow coloré.
- **Section headers** : barre verticale colorée + uppercase `tracking-[0.18em]`.
- **Nav** : Principal=dark, Catalogue=emerald, Ventes=sky, Système=violet. Actif = dégradé pastel + barre gauche + icône colorée.
- **Brand chips** : dégradé 135°, halo doré, pastille verte pulse pour online.
- **Palette** : `emerald` (catalogue/revenu), `sky` (commandes), `violet` (système), `amber` (alertes), `rose` (stock bas), `slate` (neutre).
- **Mobile-first** : `grid-cols-2 sm:grid-cols-4`, tables → cartes sous `md`, hero stack vertical.
- **Drawers** > modales pour réglages riches. Pas d'arc-en-ciel sur cartes filtres.

#### Widget flottant (`components/admin/widgets-rail/`)
Toutes tâches longues admin (traduction, marketplaces, images, shooting eFashion, chat) via **widget flottant unique** en bas à droite (refonte 2026-07-13).
- ≥ md (768+) : FAB noir 56px bas-droite → clic déploie 5 mini-boutons colorés empilés | Tiroir panneau flottant 400×620px (`bottom-24 right-6`).
- < md (<768) : FAB + halo pulsant | Tiroir plein écran, header sticky flèche back.
- **Palette** : violet=Traduction, sky=Marketplaces, emerald=Images, amber=Shooting eFashion, rose=Chat.
- **Un seul tiroir ouvert** (`useRightRail()` context). **Badge cumul** FAB = somme files ; halo `animate-ping` si file signale `pulse:true`. **Backdrop léger + blur** derrière mini-menu (clic/ESC ferme). **Aucun backdrop** derrière tiroir (page cliquable pendant tâche). **Tooltip stylisé** au survol (fond `bg-slate-900`, portalé). **Structure tiroir** via `DrawerShell` : header aurora + eyebrow + titre + icône + zone scrollable + footer. **Sections pliables** longues listes : Erreurs + En cours ouvertes défaut. **Chat** `AdminChatWidget.tsx` séparé, monté uniquement `/admin`.
- **Layout admin** : wrapper `#admin-theme-wrapper` a `pb-24`, pas de `pr-*`.

### Enums Prisma
- `ProductStatus` : OFFLINE|ONLINE|ARCHIVED|SYNCING
- `SaleType` : UNIT|PACK
- `OrderStatus` : PENDING|SHIPPED|CANCELLED (PENDING = « Nouveau » admin / « En attente » client, seule transition PENDING→SHIPPED, annulation depuis PENDING)
- `UserRole` : ADMIN|CLIENT
- `UserStatus` : PENDING|APPROVED|REJECTED

### Multi-tenant (prod depuis 2026-07-12)
Prod sert 2 boutiques depuis 1 Next.js/PM2/DB : **beliandjolie.com** (tenant `beliandjolie`) + **issyma.fr** (tenant `issyma`, shopName "FORCYMA"). Anciens `/var/www/issyma` et `/var/www/demo` supprimés.

- **Résolution tenant** : Middleware lit `Host:` → mappe via `TenantDomain` → pose `x-tenant-id/slug/name` headers. `lib/tenant.ts::getCurrentTenant()` + ALS `lib/tenant-als.ts`. Extension Prisma `lib/prisma-tenant-scope.ts` scope auto ~60 modèles.
- **Écrire SiteConfig** : `setSiteConfig(key, value)` / `unsetSiteConfig(key)` (`lib/site-config-write.ts`). **Jamais** `prisma.siteConfig.upsert({where:{key}})` — PK composite `(tenantId, key)`.
- **Lire SiteConfig par clé** : `findFirst({where:{key}})`, PAS `findUnique`.
- **Autres tables composite** : `Product.reference`, `Order.orderNumber`, `User.email/siret/stripeCustomerId`, `Product.pfsProductId/ankorsProductId/faireProductId` → `findFirst({where:{X:...}})`. Extension injecte `tenantId` en `AND`. Idem `Category/SubCategory/Color/Size/Composition/Season/ManufacturingCountry/Tag` (`@@unique` composite depuis 2026-07-13).
- **Uploads** : `/uploads/{tenantSlug}/…` (ex `/uploads/beliandjolie/produits/…`). Aucune legacy sans prefix. Passer `tenant.slug` en 2ᵉ arg des helpers `productImageDir`, `collectionImageDir`, `bannerDir`, `faviconDir`, `colorPatternDir`, `chatAttachmentDir`, `bordereauDir`, `kbisDir`, `clientDocumentsDir`, `invoiceDir`, `claimDir`, `creditNoteDir`, `emailAttachmentDir`, `renameProductFolder`, `renameCollectionFolder`. Récup via `requireCurrentTenant()`.
- **Fire-and-forget** : Capturer tenantId côté handler HTTP AVANT l'IIFE, wrap `tenantALS.run(tenantId, async () => …)`. Sans ça, extension passthrough → fuite marketplace (push BJ atterrit sur Issyma). Workers wrappés : `marketplace-queue-worker.processJob`, `translation-queue.processJob`, `efashion-shooting-batch`.
- **Caches auth marketplaces** : PFS/Ankor/eFashion/Faire/Stripe : **cache PAR tenant** (`Map<tenantId, TokenCache>`). Sinon token 1er tenant réutilisé partout → catastrophe. Voir `lib/pfs-auth.ts`, `lib/ankorstore-auth.ts`, `lib/efashion-client.ts`, `lib/efashion-auth.ts`, `lib/faire-auth.ts`, `lib/stripe.ts`.
- **Caches SiteConfig** : `tenantScopedCacheWithTid` (`lib/cached-data.ts`) résout tid via ALS + fallback `headers()`. Tid **capturé AU CALLSITE** et passé au callback via closure — ALS PAS visible dans callbacks `unstable_cache` (Next 16 parallel rendering). Idem `getCachedSeoConfig` (`lib/seo.ts`).
- **Sitemap/robots/favicon/manifest** : `Host:` courant comme baseUrl (pas `NEXTAUTH_URL` BJ hardcodée). `app/sitemap.ts`, `app/robots.ts`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/manifest.ts` bindent l'ALS via `await getCurrentTenantId()` en tête.
- **Scripts CLI** : hors requête, extension passthrough. Passer `tenantId` explicite, sinon reads globaux. Ex `MULTI_TENANT_SCOPE=off npx tsx scripts/backfill-tenant-id-all.ts`.
- **Onboarding wizard** : chaque nouveau tenant. Middleware redirige non-onboardés vers `/admin/bienvenue`.
- **Chantier futur** : `AccountLockout.email` et `Claim.reference` gardent `@unique` global (à basculer composite si collisions inter-tenants).

---

## Versions critiques
| Lib | Version | Contrainte |
|---|---|---|
| Next.js | 16.2.12 | `params` = Promise (await). `revalidateTag(tag,"default")` 2 args |
| Prisma | 5.22.0 | **PAS v7** |
| NextAuth | v4 | **PAS v5** |
| Zod | 4.3.6 | `.issues` PAS `.errors` |
| Tailwind | v4 | Pas de config JS |
| React | 19.2.3 | |

`serverExternalPackages: ["pdfkit", "sharp", "exceljs"]` dans `next.config.ts`. Alias `@/*` → `./*`.

---

## Gotchas

### UI
- `ssr: false` interdit en Server Component → wrap `"use client"`.
- `PublicSidebar.tsx` = header public (PAS `Navbar.tsx`).
- Badges : `badge badge-*` (success/warning/error/neutral/info/purple).
- Dropdowns : `CustomSelect`, jamais `<select>` natif.
- `useConfirm()` / `useToast()` (context, pas de default).
- Pas de dark mode public : vars CSS (`bg-bg-primary`, `text-text-primary`, `border-border`).
- Touch min 44px, `prefers-reduced-motion` respecté.

### Produits / Variantes
- **Jamais supprimer** un `ARCHIVED`.
- `Color.patternImage` > `Color.hex`.
- 1 variante = 1 couleur. `groupKey` = `colorId` (helper `variantGroupKeyFromState()`).
- **PACK mono-couleur** : `colorId` + `VariantSize`. `unitPrice` = `computeTotalPrice(v)` (total BDD).
- **PACK multi-couleurs** : `PackColorLine[]` + `PackColorLineSize[]`. `variantSizes` vide. Détection `isMultiColorPack(v)` UI / `c.packLines.length > 0` serveur.
- **UNIT** : max 1 taille (description).
- `OrderItem.sizesJson` > `OrderItem.size` legacy.

### Server actions / Cache
- `requireAdmin()` / `requireAuth()` obligatoire.
- Retour `{ success: boolean, error?: string }`.
- Cache `getCached*` + `revalidateTag(tag, "default")` (**2 args Next 16**).
- TTLs : 5min (site-config, dashboard), 10min (bestsellers), 60min (categories/colors/tags/collections/sizes/countries/seasons/pfs-annexes).

### Logging
- **Jamais `console.*`** serveur → `import { logger } from "@/lib/logger"`.
- Erreur + stack : `logger.error("[X] msg", { error: err })`.
- `instrumentation.ts` capte `uncaughtException`/`unhandledRejection`.

### Auth redirect
- Login → `/admin` : `window.location.href = "/admin"` (full reload), **pas** `router.push()` (produit `/fr/admin` = 404).

### Encryption
- `lib/encryption.ts` AES-256-GCM, `ENCRYPTION_KEY` (base64 32B).
- `SENSITIVE_KEYS` = liste SiteConfig chiffrés. Ajouter toute clé sensible.

### Images & fichiers
- Module unique `lib/storage.ts`. Helpers `productImageDir/BaseName`, `collectionImageDir`, `bannerDir`, `kbisDir`, `invoiceDir`. **Jamais hardcoder de path.**
- Public `public/uploads/` : `produits/`, `collections/`, `motifs-couleurs/`, `banniere/`, `catalogues/`, `bordereaux/`, `reclamations/`.
- Privé `private/uploads/` : `kbis/`, `documents/`, `factures/`, `pieces-jointes-email/`, `avoirs/`, `_image_jobs/`.
- Produit : WebP 3 tailles (large/`-md`/`-thumb`), max 5/couleur. Compat ancien `_md`/`_thumb` via `getImagePaths()`.
- Renommage `renameProductFolder(oldRef, newRef)` dans txn Prisma. Brouillon `uploads/produits/_brouillon/` si pas de ref. DB paths = URL publique.
- **PFS image sync** : JPEG (pas WebP), multipart. Logs `[PFS Images]`.
- **Upload async** : `POST /api/admin/products/images` écrit buffer brut dans `private/uploads/_image_jobs/`, crée `ImageProcessingJob` PENDING, retourne `dbPath` futur. Worker `lib/image-queue.ts` (démarré `instrumentation-node.ts`, 3 parallèle, poll 800ms) traite via `processProductImage`. Au boot PROCESSING → PENDING (idempotent). Dernier job DONE d'un produit lié → pose `*SyncRequired = true`.
- Reset : `npx tsx scripts/wipe-data.ts` (préserve ADMIN, SiteConfig, CompanyInfo, LegalDocument).

### SEO
- `lib/seo.ts` : `buildAlternates(path)`, `buildOrganizationSchema()`, `buildWebsiteSchema()`.
- Organization JSON-LD **uniquement** dans `app/layout.tsx`. WebSite sur home. Product + BreadcrumbList sur fiche.
- Clés SEO : `site_logo_url`, `social_*_url`.
- Favicon dynamique : `app/icon.tsx` + `apple-icon.tsx` via `ImageResponse`.

### Integrations
- **SSE** : `lib/product-events.ts` (`globalThis` singleton). Hook `useProductStream()`.
- **Livraison** : voir bloc « Livraison » Architecture + `docs/smarty365-api.md`.

---

## Env vars
- **Obligatoires** : `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_KEY`.
- **Stripe** : 3 clés (`stripe_secret_key`, `stripe_publishable_key`, `stripe_webhook_secret`) en BDD **par tenant** (SiteConfig chiffré). **Plus aucune clé dans `.env`** depuis 2026-08-05 — tenant sans Stripe configuré → « Paiement indisponible » au checkout (au lieu de retomber sur clés tenant historique = mismatch pk/sk garanti). `readStripeConfig()` (`lib/stripe.ts`) strict BDD-only, scopé tenant courant via ALS/headers. `updateStripeConfig()` distingue `undefined` (« ne touche pas ») de `""` (« vider ») pour éviter wipe accidentel sur save partiel.
- **Email** : `SMTP_*` retirés `.env` depuis 2026-07-13 — chaque tenant a sa **propre config SMTP BDD** (SiteConfig chiffré). Envoi via Postfix/Dovecot interne sur `mail.beliandjolie.com:587`. Boîtes `contact@beliandjolie.com` et `contact@issyma.fr` (quota 5 Go/boîte). `provisionShopMailbox()` crée boîte + config auto — **nécessite `scripts/deploy/add-mail-domain.sh` (à créer, TODO)**. **Roundcube retiré 2026-08-04** — plus de webmail, cliente lit mails pro Gmail via transfert instantané (`lib/mail-notify-worker.ts` → IMAP Dovecot → forward vers `admin_personal_email`) et répond en `contact@…` via Gmail « Send As » (tuto `/admin/parametres?tab=messagerie`). Vhost nginx `mail.beliandjolie.com` reste coquille vide (cert renewal certbot) — backup `/root/backups/pre-roundcube-removal-20260804-144048/` si rollback.
- **Via UI (chiffrés BDD)** : clé Easy-Express, **JWT Smarty365**, identifiants PFS (email+mdp, réutilisés traduction auto), identifiants Ankorstore back-office (email+mdp), identifiants eFashion / Faire / Orderchamp.

---

## Commandes
```bash
npm run dev / build / start / lint
npm run test / test:watch / test:coverage
npm run test:pfs-smoke
npx prisma db push && npx prisma generate
npx prisma studio
npx tsx scripts/create-admin.ts
npx tsx scripts/seed-demo-clients.ts          # 14 faux clients + 78 commandes
npx tsx scripts/seed-demo-clients.ts --clean  # supprime jeu démo (emails @demo-local.test)
```
Integration tests : `__tests__/integration/` (DB-backed, `fileParallelism: false`).

---

## Production (`beliandjolie.com`)
VPS Hostinger Ubuntu 24.04. `/var/www/beliandjolie`. Nginx → Next.js `127.0.0.1:3000`. PM2 systemd (`pm2-root.service`). MySQL 8, Node 20, Certbot.

- `.env` prod : `/var/www/beliandjolie/.env`. Lu au démarrage → `pm2 restart beliandjolie` après modif.
- UFW : 22/80/443 seulement. SSH par clé.
- **V:** = SSHFS-Win → édition directe.
- **Playwright Chromium** (import PFS) : `ssh root@72.61.106.128 "cd /var/www/beliandjolie && npx playwright install --with-deps chromium"` après deploy initial / upgrade.
- Hors repo : `scripts/deploy/`, `public/uploads/`, `private/uploads/`. **Sauvegarder uploads VPS** (rsync/cron).
