# CLAUDE.md

## À qui tu parles

Cliente **non-développeuse** qui dirige le projet.
- Pas de jargon. Français simple. Court.
- Décris ce qui change **pour elle et ses clients**, pas le code.
- Tests = trajets dans le site (« Ouvrez l'admin, allez dans… »), jamais de commande terminal.
- Détails techniques : entre toi et le code.

> Docs : `docs/architecture.md` · `docs/pfs-system.md` · `docs/styling.md` · `docs/pfs-api.md`

---

## Règles de travail

- **Auto-MAJ CLAUDE.md** si nouvelle convention/env var.
- **Parallélisation** : sous-agents indépendants en parallèle.
- **Récap** à la fin : « Ce que vous m'avez demandé » (1-3 phrases).
- **Impact croisé** : prévenir **avant** de coder si autre feature impactée.
- **Suggestions** : proposer variantes UX/perf en plus. Elle décide.
- **Tests Vitest obligatoires** sur toute feature/modif.

### Workflow modif → validation → push
1. Modifier **local uniquement**. Pas de push auto.
2. Informer + trajet de test.
3. Attendre décision :
   - **« Mettre de côté »** → push groupé.
   - **« Push en production »** : pré-flight → backup prod → `git add/commit/push origin master`. **GitHub Actions `.github/workflows/deploy.yml` prend le relais** : build runner Ubuntu 24.04, rsync `.next` + `node_modules` + `prisma` + `public` sur VPS, exécute `scripts/deploy/vps-receive.sh` (applique `prisma db push` si schema.prisma changé — hash comparé à `/root/.beliandjolie-schema-hash`, puis `pm2 restart beliandjolie` + health check des 2 tenants suivant redirs 307 next-intl → /fr et vérifiant `<title>`). Si échec, GitHub notifie et prod reste sur l'ancienne version. **Durée totale ~2 min 30 à 3 min** (build ~1min05, rsync ~20-30s, restart ~10s, health ~10s).
4. L'informer à la fin (URL du run). Code identique local/GitHub/VPS.

**Secrets GitHub obligatoires** (`Settings → Secrets and variables → Actions`) :
- `VPS_SSH_KEY` : contenu de `/root/.ssh/github_actions_ed25519` (clé privée générée sur VPS 2026-07-31). Workflow auto-wrap les headers `-----BEGIN/END OPENSSH PRIVATE KEY-----` s'ils manquent (paste depuis Claude peut les perdre) — mais idéalement les inclure.
- `VPS_HOST` : `72.61.106.128` · `VPS_USER` : `root` · `VPS_APP_DIR` : `/var/www/beliandjolie`.
- Clé publique correspondante déjà dans `/root/.ssh/authorized_keys` du VPS.

**Pièges corrigés dans le workflow** (à garder en tête si refonte) :
- `ssh-keyscan` timeout depuis runners GitHub → skip + `StrictHostKeyChecking=no` + `UserKnownHostsFile=/dev/null`.
- IPv6 runner GitHub → VPS Hostinger = timeout → forcer `-4` sur ssh/rsync.
- Health check strict (200 seul) échoue à cause du 307 next-intl → `curl -sL` (follow redirects).
- Sur nouveau VPS/clone : `git config --global --add safe.directory /var/www/beliandjolie` sous root (sinon `git rev-parse` refuse après rsync mismatch owner).

**Fallback deploy sur VPS** — `scripts/deploy/vps-build-with-freeze.sh` : uniquement si GitHub Actions HS ou urgence. Diff : **stop PM2 avant build** pour libérer 2-3 Go de RAM (VPS 7.8 Go dont 6 pris par workers — sans stop, build swap ~30 min ; avec, ~10-15 min). Downtime ~10 min — activer page maintenance nginx si `snippets/maintenance.conf` existe.

**Raccourci deploy rapide — CASSÉ 2026-07-28, NE PAS UTILISER** `scripts/deploy/deploy-fast.ps1` (build local Windows + rsync `.next`). Turbopack **hashe les noms des modules externes** (`sharp`, `pdfkit`, `playwright`, `exceljs`) avec des infos de chemin — hash Windows ≠ hash Linux, VPS crashe au boot sur `Cannot find module 'sharp-<hash>'`. `serverExternalPackages` **ne protège pas** en mode Turbopack. **Remplacé par GitHub Actions** (runner Ubuntu = même arch que VPS).

**Pré-flight AVANT push prod (obligatoire, sans demander)** — `pm2 restart` tue tous les workers en cours (images, translation, marketplace queue, PFS refresh, chat, shooting eFashion…) ; **jamais** de restart si travail en vol côté cliente. Ordre des vérifs — **remonter à la cliente** si l'une répond « occupé », attendre son go explicite :
1. **Marketplaces** — `mysql beliandjolie -e "SELECT status, marketplace, COUNT(*) FROM MarketplaceRefreshJob WHERE status IN ('QUEUED','IN_PROGRESS','AWAITING_CALLBACK') GROUP BY status, marketplace;"`. Si ≥ 1 ligne → « X jobs en cours (Rafraîchir/Publier/Resync), tu veux que j'attende ? ».
2. **Images** — `mysql beliandjolie -e "SELECT status, COUNT(*) FROM ImageProcessingJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status;"`. Si > 0 → même question. Restart met PROCESSING → PENDING (idempotent) mais attente plus longue + job Sharp/WebP en cours peut foirer.
3. **Ankorstore désormais synchrone** — plus de check (ops terminées avant clic suivant). Ancien check `AnkorstoreOperation WHERE status='PENDING'` obsolète, table supprimée.
4. **Ankorstore catalog / imports** — `tail -200 /root/.pm2/logs/beliandjolie-out.log | grep -E "Ankorstore|Chargement|Import|Preview job"` sur les 60 dernières s. Si activité récente → attendre.
5. **Traductions / mails** — `mysql beliandjolie -e "SELECT status, COUNT(*) FROM TranslationJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status; SELECT status, COUNT(*) FROM EmailQueueJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status;"`. Si > 0 → prévenir.

Une fois tout calme (ou go explicite), enchaîner backup + deploy. Après restart, refaire SELECT MarketplaceRefreshJob pour vérifier qu'aucun n'est bloqué en IN_PROGRESS (startup sweep marque FAILED mais race condition rare peut en laisser un — nettoyer manuellement).

**Backup avant push prod (obligatoire, sans demander)** — `/root/backups/pre-push-YYYYMMDD-HHMMSS/` :
1. `mkdir -p` dossier horodaté.
2. `mysqldump --single-transaction --routines --triggers --events --databases beliandjolie | gzip > db-beliandjolie.sql.gz` (~10 Mo, 2 tenants).
3. `git rev-parse HEAD > git-head.txt` (rollback via `git reset --hard <sha>`).
4. `git archive --format=tar HEAD | gzip > code-git-head.tar.gz` (snapshot code sans historique).
5. `cp .env → .env.backup ; chmod 600` (secrets Stripe/PFS/Ankor).
6. `cp -al public/uploads → uploads-public` + `cp -al private/uploads → uploads-private` (hardlinks : ~0 disque, restauration complète même après suppression).

Restauration : `zcat db-beliandjolie.sql.gz | mysql`, `cd /var/www/beliandjolie && git reset --hard $(cat …/git-head.txt)`, `cp .env.backup /var/www/beliandjolie/.env`. Garder ≥ 7 jours.

**Exception Ankorstore** : push direct prod (callbacks async ne hittent pas localhost).

Confirmation **uniquement** avant : suppression données, drop tables, push --force, secrets.

### Maquette avant tout design
Dès qu'une demande touche au visuel (couleurs, mise en page, composants, refonte écran, hero, sidebar…) :
1. HTML autonome dans `C:/Users/Admin/Downloads/` (Tailwind CDN, aucune dépendance repo).
2. Ouvrir dans navigateur.
3. Ajuster jusqu'à validation.
4. Appliquer au vrai code.

Sauter si elle dit « pas besoin de maquette » ou changement trivial (libellé, faute, padding chiffré).

### Procédures en attente
- **« feu vert journaux »** → exécuter `docs/operations/mysql-binlog-cleanup.md`. Une fois OK, supprimer le fichier + retirer cette ligne.

---

## Architecture

B2B SaaS e-commerce générique (vente en gros). **Next.js 16 · MySQL/Prisma · Tailwind v4 · TS**.

### Route groups
| Group | URL | Access |
|-------|-----|--------|
| `(auth)` | `/connexion`, `/inscription` | Non-auth |
| `(admin)` | `/admin/*` | ADMIN |
| `(client)` | `/espace-pro`, `/panier`, `/commandes`, `/favoris` | CLIENT APPROVED |
| direct | `/produits`, `/collections`, `/categories` | Public — prix masqués si pas APPROVED |

Protection : `middleware.ts` (edge) + `layout.tsx`. Maintenance cache 60s **on success only**.

**Prix visibles** : `lib/price-visibility.ts` (`canSeePrices()`). API remet `unitPrice`/`discountPercent` à 0/null si non autorisé ; filtres `minPrice/maxPrice` ignorés.

### Layers
- **Server actions** (`app/actions/`) : mutations. `requireAdmin()`/`requireAuth()` obligatoire.
- **API routes** (`app/api/`) : webhooks, SSE, file-serving.
- **Lib** (`lib/`) : logic. Modules : `pfs-*`, `ankorstore-*`, `marketplace-pricing`, `storage`, `email`, `cached-data`, `security`, `encryption`, `logger`, `seo`.

### Marketplaces (PFS + Ankorstore + eFashion)
- **IDs** : `Product.pfsProductId`/`ankorsProductId`/`efashionReferenceBase` + `ProductColor.pfsVariantId`/`ankorsVariantId`. `null` = non publié.
- **`*SyncRequired`** : posé par `updateProduct` (champ clé modifié) et worker images (`lib/image-queue.ts`). Reset par sync réussie ou `clearSyncRequiredFlag()`. Badge orange « Synchro nécessaire » dans `MarketplaceStatusButtons` + `AdminProductsTable`. Priorité visuelle : loading > syncRequired > online > offline.
- **Kill switch marketplaces — 2 dimensions (2026-08-18)** : chaque marketplace (PFS, Ankorstore, eFashion, Faire, Microstore) a 2 toggles dans `/admin/parametres` onglet Marketplaces :
  - **« Gestion Produits »** (SiteConfig `{marketplace}_products_management_enabled`, défaut ON) : OFF = aucun push/publish/refresh/resync/synchro/delete ; badge grisé partout ; cases masquées dans modales publish/refresh. Lecture via `getCachedXEnabled()` (sémantique = hasConfig ∧ productsManagementEnabled).
  - **« Gestion Commandes »** (SiteConfig `{marketplace}_orders_worker_enabled`, défaut ON) : OFF = worker sync commandes skip silencieusement ce tenant. Lecture via `isMarketplaceAutoSyncEnabled(tid, source)` (`lib/marketplace-auto-sync.ts`).
  - Server actions : `setMarketplaceProductsManagement(marketplace, enabled)` + `setMarketplaceAutoSyncEnabled({source, enabled})`. Anciens `togglePfsEnabled/toggleAnkorstoreEnabled/…` supprimés.
  - Migration one-shot : `npx tsx scripts/migrate-marketplace-toggles.ts --apply` (copie `X_enabled` → `X_products_management_enabled` puis supprime l'ancienne).
- **Modale save** : case par marketplace si produit complet + configurée → enqueue `MarketplaceRefreshWidget`.
- **Publish vs Update** : `*UpdateProductInPlace()` si ID connu (PATCH + diff snapshot), sinon `*PublishProduct()`. Fallback publish si update échoue.
- **PFS fallback compo (mobile API)** : 2 APIs PFS — `wholesaler-api.parisfashionshops.com` (import/audit, OAuth) et `admin.parisfashionshops.com` (appli mobile « PFS - Back Office Grossiste », Bearer via `/api/auth/seller`). Bug PFS : produit créé via mobile → synchro wholesaler↔admin incomplète sur `material_composition` → wholesaler renvoie `[]` alors que compo saisie. Fallback `lib/pfs-admin-api.ts::pfsAdminFetchMaterialComposition(pfsProductId)` relit côté admin quand wholesaler vide. Déclenché dans `lib/pfs-import.ts` (approveAndImportPfsProduct), `lib/pfs-verify.ts` (verifyPfsProduct), `lib/pfs-verify-apply.ts` (`applyPfsVerifyPullsOnly`/`applyPfsVerifyActions` via `enrichCheckRefCompositionIfEmpty`). Pull auto compo depuis 2026-08-01 : `resolvePfsCompositionsToLocal` matérialise ProductComposition (auto-création via `createOrLinkMapping` si code PFS inconnu, dédoublonnage/merge % si 2 codes → même Composition). Mêmes credentials que wholesaler (`pfs_email`+`pfs_password` SiteConfig). Constante `AemikSEAUID = "AemikWeb3_PFSBKOFFICE"` requise dans tous POST admin. **Doc** : `docs/pfs-mobile-api.md`.
- **Diff snapshot** (`pfsLastSyncSnapshot` Json?) : envoie que le delta. Reset `Prisma.DbNull` quand `pfsProductId` change. `null` = sync complète.
- **Resync forcé** (↻) : `forceFullSync: true`, ne touche pas l'ID.
- **Best Seller PFS** : au save, STAR/REMOVE_STAR seulement si changé.
- **Annexes PFS** : LIVE `lib/pfs-annexes.ts` (cache 60min, tag `pfs-annexes`).
- **Proxy images marketplace** : `/api/marketplace-image?path=…` upscale à 500px si source < 500px (Ankorstore ≥ 500). Fichiers d'origine intacts. Pas pour PFS.
- **Delete** : PFS = local-only. Ankorstore = auto callback via `ankorstoreKickoffStandaloneDelete()`.
- **Modale de liaison — intents « créer/supprimer/importer »** (2026-07-28) : `LinkMarketplaceModal` (unifié PFS/Ankor/eFa/Faire) accepte 3 intentions via `LinkIntents` :
  - `colorsToCreate` : couleurs BJ orphelines (pas de variante mkt équivalente) que l'admin choisit de **créer chez mkt avec upload photo**. Bouton « ➕ Créer cette couleur » à côté du `VariantPicker` étape 3 (grisé si pas de photo boutique).
  - `orphansToDelete` : variantes mkt orphelines à **supprimer chez mkt**.
  - `orphansToImport` : variantes mkt orphelines à **importer en ProductColor BJ + lier**. Via `createLocalVariantFrom{Mkt}Variant()` (une par mkt, cf. `app/actions/admin/{efashion,ankorstore,pfs,faire}.ts`) — trouve/crée Color, choisit Size TU, calcule prix/poids, crée ProductColor UNIT avec `{mkt}VariantId` posé.
  - **Anti-doublon** : `createLocalVariantFrom{Mkt}Variant()` vérifie d'abord si produit BJ a déjà ProductColor UNIT sur cette Color. Oui + non-liée → RELIE (update `{mkt}VariantId`). Oui + déjà liée à AUTRE variante mkt → erreur. Sinon crée. UI étape 4 ajoute hint 💡 quand cas détecté (revenir étape 3 lier au lieu d'importer).
  - **Validation dure UI** : chaque variante mkt non-mappée DOIT être dans `orphansToDelete` ou `orphansToImport`. Bouton « Valider » bloqué tant qu'orpheline « à trancher » (compteur dans CTA).
  - Serveur : `link{Mkt}ProductManually` accepte `intents?` en dernier arg. Ordre : (1) delete orphelines marquées, (2) transaction link, (3) import orphelines marquées (nécessite `{mkt}ProductId` posé par link), (4) sync post-liaison `updateProductInPlace({forceFullSync:true})`.
  - Suppression variante isolée par mkt : **PFS** `pfsDeleteVariant()`, **eFashion** `efashionDeleteShootingProduct()` (hard delete), **Faire** `DELETE /products/{id}/variants/{vid}`, **Ankorstore** = pas d'endpoint direct → kickoff overwrite écrase l'état.
  - Auto-création côté mkt : réutilise forceFullSync (PFS `variantsToCreate`, eFashion `duplicateWithNewColor`, Faire `variantsAdded diff`, Ankorstore = write state override).
  - Garde-fou UI : refus si `orphansToDelete` couvre TOUTES les variantes mkt ET aucune couleur BJ mappée/à-créer (fiche mkt vide).
  - Retour `LinkResult` étendu : `autoCreatedOnMarketplace` + `deletedOnMarketplace` + `importedFromMarketplace`, affichés dans widget flottant Marketplaces après job.

### Orderchamp (2026-08-19)
Marketplace B2B européen basé aux Pays-Bas. **API GraphQL** (endpoint unique `https://api.orderchamp.com/v1/graphql`, auth Bearer token privé par tenant, stocké chiffré dans SiteConfig `orderchamp_api_key`).

> **Chantier en cours — état complet et TODO dans `ORDERCHAMP-STATUS.md` à la racine du projet.** Consulter ce fichier avant de reprendre.

**Modules `lib/orderchamp-*.ts`** : `auth`, `client`, `queries`, `sku`, `country`, `description`, `shape`, `sync-diff`, `pricing`, `inventory`, `taxonomy`, `custom-category`, `publish`, `update`, `refresh`, `delete`. Server action : `app/actions/admin/orderchamp.ts`.

**Champs Prisma nouveaux** : `Product.orderchampProductId/LastSyncSnapshot/LastRefreshedAt/SyncRequired/Enabled/LastExportedAt`, `ProductColor.orderchampVariantId/ColorNameOverride`, `Category.orderchampCategoryPath` (feuille standard) + `orderchampCustomCategoryId` (perso auto), `Composition.orderchampMaterialCode`. Modèles `OrderchampOrder` + `OrderchampOrderItem`. Enum `MarketplaceJobTarget.ORDERCHAMP`.

**Règles métier figées** (cf. `memory/project_orderchamp_rules.md`) :
- **Axes en anglais obligatoires** : `option1: "Color"` + `option2: "Size"` sur le produit. "Couleur"/"Taille" en français fait qu'Orderchamp ne peuple pas `variant.color`/`variant.size` et rend le produit illisible côté back-office.
- **Toutes les variantes ont taille + couleur** : chaque variante envoie `option1` (nom couleur libre : "Or", "Rose gold"…) et `option2` (nom taille : "S"/"M"/"L" ou fallback `"One Size"` si mono-taille locale).
- **Dimensions physiques toujours envoyées** : `weight` en grammes, `length/width/height/diameter` en cm (BDD BJ en mm, conversion ÷10 dans `orderchamp-publish`). Envoyées produit ET variante.
- **Catégorie feuille impérative** : le champ `category` accepte l'enum `CategoryPath` (branches OK à l'input) mais le back-office lit `ProductCategoryPath` (feuilles seulement). Envoyer une branche = « Catégorie de marché » vide côté UI. Toujours mapper via une feuille (ex `JEWELRY_ACCESSORIES_BRACELETS_BANGLE_BRACELETS`).
- **CustomCategory doit être publiée** : `customCategoryCreate` retourne `isPublished:false`. Enchaîner obligatoirement `customCategoryUpdate({isPublished:true})` avant d'attribuer à un produit — sinon `productUpdate` accepte silencieusement l'input mais `customCategory` reste null (**pas de userError**). Séquence encapsulée dans `ensureOrderchampCustomCategory()`.
- **Refresh via `productRepublish` (jamais delete+recreate)** — garde l'ID Orderchamp stable, URL fiche acheteur inchangée (comparable Ankorstore, différent de Faire).
- **Stock via `inventoryLevelBulkAdjust`** — action `SET` pour synchro régulière, `ADJUST` pour delta commande. Format `[{productVariantId, action, adjustment}, ...]`, batches de 100 max.
- **Filtres marketing (`filterMaterial`, `filterColor`, `filterKarat`…)** : sur variante, arrays typés `[FilterXValue]` avec `maximumValues` variable par catégorie (matériaux : max 4 pour bijoux). Chaque `productVariantUpdate` **écrase** — réenvoyer la liste complète.
- **Piège scalar `diameter`** : typé `Liter` dans le schéma GraphQL (bug de leur nommage) mais accepte bien un nombre en cm en pratique.
- **`salesChannels` en lecture seule via API** : APP/DROPSHIPPING/MARKETPLACE/PORTAL/TICA doivent être activés manuellement dans Settings > Sales channels côté back-office OC. Passer `salesChannels: [...]` dans un input est ignoré silencieusement si le canal n'est pas activé pour le compte.
- **Publish sur storefront** : `productPublish(input: { id, storefrontId })` requiert le `storefrontId` de la vitrine marque pour que le produit soit visible aux acheteuses. Sans lui, le produit reste en brouillon. Le helper `lib/orderchamp-storefront.ts` résout et cache l'ID par tenant (chaque compte fournisseur = 1 storefront). `orderchampPublishProduct` appelle `productPublish` automatiquement en post-create si `Product.status === "ONLINE"` BJ.
- **Storefront `isPublished`** : la vitrine elle-même a un flag `isPublished` séparé, à activer manuellement une fois dans le back-office OC après validation compte (pas d'API pour la modifier).

**Compte de dev / production** : `PRINCESSE` (email `contact@beliandjolie.com`).

### Ankorstore back-office reverse-engineered (2026-08-13)
Toutes ops (publish/update/refresh/delete, enable/disable, liaison, commandes) **100 % synchrones** via API interne back-office `fr.ankorstore.com`. **Plus de callback**, table `AnkorstoreOperation`, webhook, polling UI.
- Module : `lib/ankorstore-bo/` (auth session cookie + CSRF, referentials hardcodés, publish/update/read/mass-action/link/images/orders/builder/sku).
- Server actions : `app/actions/admin/ankorstore-bo.ts` (`publishProductToAnkorstoreBo`, `deleteProductFromAnkorstoreBo`, `setProductVisibilityOnAnkorstoreBo`, `searchAnkorstoreBoCandidatesForBjProduct`, `linkBjProductToAnkorstoreBo`, `unlinkAllBjProductsFromAnkorstoreBo`).
- Auth : email + mdp compte marque, chiffrés dans SiteConfig (`ankorstore_bo_email`, `ankorstore_bo_password`). Configurable via `/admin/parametres?tab=marketplaces`.
- **Dev local marche** — plus de dépendance callback.
- SKU nouveau format `{REFERENCE}_{COULEUR_NORMALISEE}` (ex : `A1720_VERT_DEAU`) — cf. `lib/ankorstore-bo/sku.ts`.
- Statut BJ → Ankor : ONLINE = mass-action `enable`, OFFLINE/ARCHIVED = `disable`. Stock BJ vrai stock envoyé peu importe le statut.
- Image produit-père Ankor = 1ʳᵉ image de la couleur principale (`Product.primaryColorId`).
- Bug 422 SKU sur PUT contourné en injectant les `variant.id` connus.
- **Commandes** : lecture (list + détail + tracking) via `lib/ankorstore-bo/orders.ts`. Worker orders désactivé — à réactiver après reverse des POST tracking/reject.

### Refresh produit
Bouton « Rafraîchir » + bulk. Modale : boutique (bump `lastRefreshedAt`) + PFS + Ankorstore. Parallèle 5 max via `MarketplaceRefreshWidget`. `pfsRefreshProduct()` crée ref TEMP, archive l'ancien, renomme. Rollback auto.
« Nouveauté » = `max(createdAt, lastRefreshedAt) > now - 30j`.

### Vérification par code OTP (actions destructives)
Filet contre bugs propagation marketplace : toute suppression, rafraîchissement marketplace ou archivage passe par `<OtpConfirmDialog>` → code 6 chiffres envoyé sur boîte pro (`smtp_from_email`, forwardée sur mail perso).
- Table Prisma : `AdminActionOtp` (id, adminId, action, productIds JSON, codeHash, expiresAt, attempts, usedAt). TTL 15 min, 5 tentatives max.
- Lib : `lib/admin-action-otp.ts` (`createOtpForAction`, `verifyAndConsumeOtp`, `guardAdminActionOtp`, `isOtpPauseActive`, `applyPauseChoice`).
- Server actions : `requestAdminActionOtp`, `verifyAdminActionOtpForRefresh`, `setAdminActionOtpPause` (`app/actions/admin/admin-action-otp.ts`). `bulkDeleteProducts` + `bulkUpdateProductStatus(ARCHIVED)` acceptent `otpCheck?` en 2ᵉ/3ᵉ arg et appellent `guardAdminActionOtp` en début.
- Refresh (bulk et unitaire) : vérif client-side dans `useRefreshMarketplaceDialog.requireOtpForRefresh` (bypass silencieux si options local-only sans marketplace ciblée).
- Pause : menu déroulant dans la modale, options 15min/1h/24h. Stockée `SiteConfig[admin_action_otp_pause_until]` (timestamp ms). Bypass silencieux tant qu'active. Défaut = « Toujours prévenir ».
- Provider `<OtpConfirmProvider>` monté globalement dans `app/layout.tsx`.

### Marketplace pricing
SiteConfig : 3 types (`percent`/`fixed`/`multiplier`), 3 arrondis (`none`/`up`/`down`). Clés : `{marketplace}_price_markup_{type|value|rounding}`. **PACK** : markup sur prix unitaire (total÷qty), arrondi, ×qty. Jamais sur le total.
- **Retail = markup appliqué sur le WHOLESALE déjà majoré et arrondi** (pas sur basePrice BJ). Convention métier confirmée juillet 2026 (bug U02 Faire) — la cliente dit « ×3 sur prix de gros » et ça doit donner ×3 sur le wholesale, pas ×3 sur son prix d'achat interne. Faire : `applyFaireMarkupWithClamp` (lib/marketplace-pricing-shared.ts). Ankorstore : `getAnkorstoreChainedRetailPrice` (lib/ankorstore-pricing.ts).
- **Arrondi passe TOUJOURS par centimes entiers** (`Math.round(price*100)`) AVANT le `Math.ceil/floor` au dixième, sinon `4.2 * 3 = 12.600000000000001` en IEEE-754 fait dériver le retail d'un cran (12,60 → 12,70). Fix dans `applyMarketplaceMarkup`, ne pas le retirer.

### Import PFS
`/admin/produits/importer-pfs` — choix → import direct. Chaque attribut manquant (compo, pays, saison, taille, couleur, catégorie) **créé auto** dans `createOrLinkMapping`. Auto-traduction en fond via API PFS. Rattrapage : `npx tsx scripts/enrich-pfs-products.ts`.

### Import Excel produits
`/admin/produits/importer` : upload → preview → **récap éditable UI** → job background. **Excel uniquement**.
- Modèle : 5 lignes en-tête (section/headers/Obligatoire-Facultatif/exemples/données).
- Composants : `EditableProductCard`, `EntitySelect` (bouton +), `CompositionEditor`, `effective-status.ts`, `QuickCreateModal`.
- **Overrides** : `ImportOverride` JSON dans `{filePath}.overrides.json`, appliqué après propagation référence.
- **Quick-create idempotent** : pas de P2002.

### Onboarding wizard
`/admin/bienvenue` → 8 étapes (welcome/company/brand/stripe/email/shipping/legal/done). Layout : `app/(admin)/admin/bienvenue/layout.tsx` (rend `WizardShell` client). État : SiteConfig `onboarding_steps_completed` + `onboarding_completed_at`. Actions : `markStepCompleted(step)` / `completeOnboarding()` (= skip). Middleware redirige admin non-fini vers `/admin/bienvenue`.

### Auth
NextAuth v4, Credentials + JWT (30d). New users = `PENDING`. Token : `id`, `role`, `status`, `company`.

### i18n
next-intl 4.x, préfixe (`/fr/…`, `/en/…`). Locales **fr (défaut) + en**. Auto-translation API PFS (gratuit). Toggle `auto_translate_enabled`.
- Hors i18n : `/admin/*`, `/api/*`, `/maintenance`, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/icon`, `/apple-icon`.
- Liens admin → public : hardcoder `/fr/…`.
- Sitemap : 7× chaque URL + `alternates.languages`.
- Sélecteur : `router.replace(pathname, { locale })`.
- Mapping PFS pays/compo : libellé FR. Publish : `country_of_manufacture` priorité `isoCode → pfsCountryRef → "CN"`.

### Styling
**Tailwind v4** — theme dans `app/globals.css` `@theme {}`, pas de config JS. **Pas de dark mode côté public** (boutique clients toujours en clair). **Mode sombre admin uniquement** (voir bloc dédié). Flat design + ombres subtiles. Utilities standard.

#### Mode sombre admin (2026-08-13)
Bascule dans **Paramètres → Affichage** (onglet dédié). Préférence dans cookie `bj_admin_theme` (`light`|`dark`, 5 ans, path `/`, `SameSite=Lax`).
- Lecture serveur : `app/(admin)/layout.tsx` lit cookie via `next/headers.cookies()`, résout via `parseAdminTheme()` (`lib/admin-theme.ts`) et pose classe `admin-dark` sur `#admin-theme-wrapper` — pas de flash.
- Bascule client : `AdminThemeToggle` (`components/admin/settings/`) applique classe à chaud puis persiste via server action `setAdminTheme` (`app/actions/admin/admin-theme.ts`).
- Portée : CSS scopé strict `#admin-theme-wrapper.admin-dark { … }` dans `app/globals.css` (fin du fichier). Pages `/admin/*` concernées, jamais boutique publique ni auth.
- Approche pragmatique — **redéfinir les variables du design system** (`--color-bg-primary` etc.) + **surcharger les classes Tailwind figées** (`.bg-white`, `.bg-zinc-*`, `.text-zinc-*`, `.border-zinc-*`, `.bg-slate-*`, dégradés `from-*-50`). Certaines cartes au look très particulier (aurora du hero, badges pastels) peuvent nécessiter ajustement au 2ᵉ passage — retoucher au cas par cas.
- Test Vitest : `__tests__/lib/admin-theme.test.ts` verrouille les helpers.

#### Style espace pro / public (obligatoire hors `/admin`)
Réf : `app/[locale]/(client)/commandes/page.tsx` + `components/client/orders/OrdersTableClient.tsx` (2026-07-17, validé cliente).
- **Palette ardoise** uniquement — variables `bg-*`, `text-*`, `border-*` de `globals.css` @theme. **Interdit** : warm/or/beige/aurora doré, tons chauds décoratifs. Couleurs sémantiques (`success/warning/error/info`) réservées aux statuts, alertes et compteurs KPI — jamais en décoration principale.
- **Couleurs des initiales marketplaces** (rond avec lettre P/A/E/F/O/M) — figées, réutiliser à l'identique :
  - **PFS** (P) : `linear-gradient(135deg,#4f46e5,#6366f1)` (indigo/violet)
  - **Ankorstore** (A) : `linear-gradient(135deg,#0ea5e9,#38bdf8)` (sky)
  - **eFashion Paris** (E) : `linear-gradient(135deg,#db2777,#ec4899)` (rose/pink)
  - **Faire** (F) : `linear-gradient(135deg,#f59e0b,#fbbf24)` (amber)
  - **Orderchamp** (O) : `linear-gradient(135deg,#F97316,#FDBA74)` (orange)
  - **Microstore** (M) : `linear-gradient(135deg,#0891b2,#22d3ee)` (cyan)
  - **Boutique** (B&J) : `linear-gradient(135deg,#64748b,#334155)` (slate)
  Ces gradients servent **exclusivement** à colorer le rond d'initiale. Interdit en halo, aurora, bandeau, bordure de carte ou CTA — le reste reste ardoise.
- **Police sans-serif** partout : body `var(--font-roboto)`, titres `var(--font-poppins)` via `font-heading`. **Interdit** : empattements (Cormorant Garamond, Playfair, serif, etc.).
- **Cartes** : `bg-bg-primary border border-border rounded-2xl shadow-sm`. Sur-titre eyebrow uppercase `tracking-[0.2em] text-text-muted`.
- **KPI tiles** : mêmes cartes, valeur en `font-heading text-3xl font-bold`. Couleur sémantique (success/warning/info) uniquement si compteur d'état, sinon `text-text-primary`.
- **CTA principal** : `bg-bg-dark text-text-inverse` (jamais un accent coloré).
- **Timeline / progression** : `bg-bg-secondary rounded-2xl`, pastilles `bg-text-primary` (active) / `bg-text-secondary` (done) / `bg-bg-tertiary border-dashed` (todo).
- Vaut pour toute maquette autonome (`Downloads/*.html`) **et** toute nouvelle page hors admin.

#### Style admin cockpit (obligatoire sur `/admin`)
Réf : `app/(admin)/admin/page.tsx`, `parametres` marketplaces, `produits/page.tsx`. Inspi Stripe/Linear/Vercel. **Pas de retour au flat blanc/gris.**
- **Hero** : `rounded-3xl` aurora (`bg-gradient-to-br from-{c}-50 via-bg-primary` + halos radiaux). Eyebrow chip + pastille + uppercase `tracking-[0.18em]`. Titre `font-heading text-2xl/3xl font-bold`.
- **KPI tiles** : `rounded-2xl`, fond pastel dégradé, **valeur** en `text-{accent}-700`, halo flou (`absolute -top-10 -right-10 w-24 h-24 rounded-full blur-3xl bg-{accent}-300/30`), icône `bg-{accent}-100 ring-1 ring-{accent}-200`.
- **Cartes** : `rounded-2xl`, bande dégradée fine en haut, halo coin, eyebrow coloré.
- **Section headers** : barre verticale colorée + uppercase `tracking-[0.18em]`.
- **Nav** : Principal=dark, Catalogue=emerald, Ventes=sky, Système=violet. Actif = dégradé pastel + barre gauche + icône colorée.
- **Brand chips** : dégradé 135°, halo doré, pastille verte pulse pour online.
- **Palette** : `emerald` (catalogue/revenu), `sky` (commandes), `violet` (système/premium), `amber` (alertes), `rose` (stock bas), `slate` (neutre).
- **Mobile-first** : `grid-cols-2 sm:grid-cols-4`, tables → cartes sous `md`, hero stack vertical.
- **Drawers** > modales pour réglages riches (`MarketplaceConfig.tsx`).
- **Pas d'arc-en-ciel** sur cartes filtres/recherche.

#### Widget flottant (`components/admin/widgets-rail/`)
Toutes tâches longues admin (traduction, synchro marketplaces, images, shooting eFashion, chat) passent par un **widget flottant unique** en bas à droite (refonte validée 2026-07-13, remplace l'ancien rail latéral). **Grammaire visuelle responsive :**

| Breakpoint | Widget | Tiroir |
|-----------|--------|--------|
| `≥ md` (768+) | FAB noir 56 px en bas à droite → clic déploie 5 mini-boutons colorés empilés vers le haut | Panneau flottant 400 × 620 px ancré au-dessus du FAB (`bottom-24 right-6`) |
| `< md` (< 768) | FAB en bas à droite avec halo pulsant | Plein écran, header sticky avec flèche back |

- **Palette par widget** : violet=Traduction, sky=Marketplaces, emerald=Images, amber=Shooting eFashion, rose=Chat.
- **Un seul tiroir ouvert** à la fois (`useRightRail()` context).
- **Badge cumul** sur FAB fermé = somme des files ; halo `animate-ping` autour du FAB si ≥ 1 file signale `pulse:true`.
- **Badge par mini-bouton** = compteur individuel, fond blanc avec ring coloré.
- **Backdrop léger + blur** derrière mini-menu ouvert (clic ou ESC ferme). **Aucun backdrop** derrière un tiroir (page cliquable pendant qu'une tâche tourne).
- **Tooltip stylisé** au survol du mini-bouton (fond `bg-slate-900`, portalé dans `document.body`).
- **Structure de tiroir uniforme** via `DrawerShell` : header aurora coloré (dégradé foncé + halo flou, texte blanc) + eyebrow uppercase + titre + icône + zone scrollable + footer optionnel.
- **Sections pliables** pour listes longues (marketplaces) : Erreurs + En cours ouvertes par défaut, En attente + Terminés repliées (`<details open>`).
- **Chat** : géré par `AdminChatWidget.tsx` (composant séparé, branché sur `useRightRail().openWidget === "chat"`). Monté uniquement dans `/admin`.
- **Layout admin** : wrapper `#admin-theme-wrapper` a un `pb-24` pour ne pas cacher le contenu bas de page derrière le FAB, mais **pas** de `pr-*` — largeur intégrale.

### Enums Prisma
- `ProductStatus` : OFFLINE|ONLINE|ARCHIVED|SYNCING
- `SaleType` : UNIT|PACK
- `OrderStatus` : PENDING|SHIPPED|CANCELLED (PENDING = « Nouveau » admin / « En attente » client, seule transition = PENDING→SHIPPED, annulation depuis PENDING)
- `UserRole` : ADMIN|CLIENT
- `UserStatus` : PENDING|APPROVED|REJECTED

### Multi-tenant (déployé prod depuis 2026-07-12)
Prod sert 2 boutiques depuis 1 seul Next.js/PM2/DB : **beliandjolie.com** (tenant `beliandjolie`) + **issyma.fr** (tenant `issyma`, shopName "FORCYMA"). Anciens installs `/var/www/issyma` et `/var/www/demo` supprimés.

**Résolution tenant** — Middleware lit `Host:` → mappe via `TenantDomain` → pose `x-tenant-id/slug/name` en headers. `lib/tenant.ts::getCurrentTenant()` + ALS `lib/tenant-als.ts` propagent au reste. Extension Prisma `lib/prisma-tenant-scope.ts` scope auto sur ~60 modèles.

**Écrire SiteConfig** — `setSiteConfig(key, value)` / `unsetSiteConfig(key)` (`lib/site-config-write.ts`). **Ne jamais** `prisma.siteConfig.upsert({where:{key}})` — PK composite `(tenantId, key)`.

**Lire SiteConfig par clé** — `findFirst({where:{key}})`, PAS `findUnique({where:{key}})`.

**Autres tables composite** — `Product.reference`, `Order.orderNumber`, `User.email/siret/stripeCustomerId`, `Product.pfsProductId/ankorsProductId/faireProductId` — `findFirst({where:{X:...}})` au lieu de `findUnique`. Extension injecte `tenantId` en `AND`. Sur `Category/SubCategory/Color/Size/Composition/Season/ManufacturingCountry/Tag` idem (@@unique composite depuis 2026-07-13).

**Uploads** — Convention `/uploads/{tenantSlug}/…` (ex: `/uploads/beliandjolie/produits/…`, `/uploads/issyma/produits/…`). Aucune legacy sans prefix. Passer `tenant.slug` en 2ᵉ arg des helpers `productImageDir`, `collectionImageDir`, `bannerDir`, `faviconDir`, `colorPatternDir`, `chatAttachmentDir`, `bordereauDir`, `kbisDir`, `clientDocumentsDir`, `invoiceDir`, `claimDir`, `creditNoteDir`, `emailAttachmentDir`, `renameProductFolder`, `renameCollectionFolder`. Récup via `const tenant = await requireCurrentTenant()`.

**Fire-and-forget** (jobs background hors headers) — Capturer tenantId côté handler HTTP AVANT l'IIFE, wrap dans `tenantALS.run(tenantId, async () => …)`. Sans ça, extension retombe en passthrough → fuite marketplace (push BJ atterrit sur compte Issyma). Workers déjà wrappés : `marketplace-queue-worker.processJob`, `translation-queue.processJob`, `efashion-shooting-batch` server action.

**Caches auth marketplaces** — PFS/Ankor/eFashion/Faire/Stripe : **cache PAR tenant** (`Map<tenantId, TokenCache>`). Sinon token du 1er tenant réutilisé partout → catastrophe. Voir `lib/pfs-auth.ts`, `lib/ankorstore-auth.ts`, `lib/efashion-client.ts` (cookie jar), `lib/efashion-auth.ts` (lastLoginAt), `lib/faire-auth.ts` (primedApiKey), `lib/stripe.ts` (instance par clé).

**Caches SiteConfig** — Utiliser `tenantScopedCacheWithTid` (lib/cached-data.ts) qui résout tid via ALS + fallback `headers()`. Tid doit être **capturé AU CALLSITE** et passé au callback via closure — ALS PAS visible dans callbacks `unstable_cache` (Next 16 parallel rendering). Idem `getCachedSeoConfig` (lib/seo.ts).

**Sitemap / robots / favicon / manifest** — Utiliser `Host:` header courant comme baseUrl (pas `NEXTAUTH_URL` hardcodée BJ). `app/sitemap.ts`, `app/robots.ts`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/manifest.ts` bindent l'ALS via `await getCurrentTenantId()` en tête.

**Scripts CLI** — Hors requête, extension passthrough. Passer `tenantId` explicitement pour scope, sinon reads globaux. Ex: `MULTI_TENANT_SCOPE=off npx tsx scripts/backfill-tenant-id-all.ts`.

**Onboarding wizard** — Chaque nouveau tenant a son propre onboarding. Middleware redirige admins non-onboardés vers `/admin/bienvenue`.

**Chantier futur** — `AccountLockout.email` et `Claim.reference` gardent `@unique` global (à basculer en composite si collisions inter-tenants deviennent possibles).

---

## Versions critiques

| Lib | Version | Contrainte |
|-----|---------|-----------|
| Next.js | 16.2.12 | `params` = Promise (await). `revalidateTag(tag, "default")` 2 args |
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
- Pas de dark mode public : vars CSS (`bg-bg-primary`, `text-text-primary`, `border-border`). Mode sombre uniquement admin — bloc « Mode sombre admin » ci-dessus.
- Touch min 44px, `prefers-reduced-motion` respecté.

### Produits / Variantes
- **Jamais supprimer** un `ARCHIVED`.
- `Color.patternImage` > `Color.hex`.
- 1 variante = 1 couleur. `groupKey` = `colorId` (helper `variantGroupKeyFromState()`).
- **PACK mono-couleur** : `colorId` + `VariantSize`. `unitPrice` = `computeTotalPrice(v)` (total BDD).
- **PACK multi-couleurs** : `PackColorLine[]` + `PackColorLineSize[]`. `variantSizes` vide. Détection : `isMultiColorPack(v)` UI / `c.packLines.length > 0` serveur.
- **UNIT** : max 1 taille (description, pas sélection client).
- `OrderItem.sizesJson` > `OrderItem.size` legacy.

### Server actions / Cache
- `requireAdmin()` / `requireAuth()` obligatoire.
- Retour : `{ success: boolean, error?: string }`.
- Cache : `getCached*` + `revalidateTag(tag, "default")` (**2 args Next 16**).
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
- Module unique : `lib/storage.ts`. Helpers : `productImageDir/BaseName`, `collectionImageDir`, `bannerDir`, `kbisDir`, `invoiceDir`. **Jamais hardcoder de path.**
- Public `public/uploads/` : `produits/`, `collections/`, `motifs-couleurs/`, `banniere/`, `catalogues/`, `bordereaux/`, `reclamations/`.
- Privé `private/uploads/` : `kbis/`, `documents/`, `factures/`, `pieces-jointes-email/`, `avoirs/`, `_image_jobs/`.
- Produit : WebP 3 tailles (large/`-md`/`-thumb`), max 5/couleur. Compat ancien `_md`/`_thumb` via `getImagePaths()`.
- Renommage : `renameProductFolder(oldRef, newRef)` dans txn Prisma.
- Brouillon : `uploads/produits/_brouillon/` si pas de ref.
- DB paths = URL publique.
- **PFS image sync** : JPEG (pas WebP), multipart. Logs `[PFS Images]`.
- **Upload async** : `POST /api/admin/products/images` écrit buffer brut dans `private/uploads/_image_jobs/`, crée `ImageProcessingJob` PENDING, retourne `dbPath` futur. Worker `lib/image-queue.ts` (démarré `instrumentation-node.ts`, 3 parallèle, poll 800ms) traite via `processProductImage`. Au boot, PROCESSING → PENDING (idempotent). Dernier job DONE d'un produit lié → pose `*SyncRequired = true`.
- Reset : `npx tsx scripts/wipe-data.ts` (préserve ADMIN, SiteConfig, CompanyInfo, LegalDocument).

### SEO
- `lib/seo.ts` : `buildAlternates(path)`, `buildOrganizationSchema()`, `buildWebsiteSchema()`.
- Organization JSON-LD **uniquement** dans `app/layout.tsx`. WebSite sur home. Product + BreadcrumbList sur fiche.
- Clés SEO : `site_logo_url`, `social_*_url`.
- Favicon dynamique : `app/icon.tsx` + `apple-icon.tsx` via `ImageResponse`.

### Integrations
- **SSE** : `lib/product-events.ts` (`globalThis` singleton). Hook `useProductStream()`.
- **Easy-Express** : centimes (÷100), poids min 1kg, +5€ marge, `transactionId` expire vite.

---

## Env vars

- **Obligatoires** : `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_KEY`.
- **Stripe** : 3 clés (`stripe_secret_key`, `stripe_publishable_key`, `stripe_webhook_secret`) en BDD **par tenant** (SiteConfig chiffré). **Plus aucune clé dans `.env`** depuis 2026-08-05 — tenant sans Stripe configuré → « Paiement indisponible » au checkout au lieu de retomber sur clés du tenant historique (mismatch pk/sk garanti). `readStripeConfig()` (lib/stripe.ts) strict BDD-only, scopé au tenant courant via ALS/headers. `updateStripeConfig()` (app/actions/admin/stripe-config.ts) distingue `undefined` (« ne touche pas » — placeholder « déjà en place ») de `""` (« vider ») pour éviter de wipe une clé conservée lors d'un save partiel.
- **Email** : `SMTP_*` retirés des `.env` depuis 2026-07-13 — chaque tenant a sa **propre config SMTP BDD** (SiteConfig chiffré). Envoi via Postfix/Dovecot interne sur `mail.beliandjolie.com:587`. Boîtes `contact@beliandjolie.com` et `contact@issyma.fr` (quota 5 Go/boîte). `provisionShopMailbox()` (app/actions/admin/mailbox-provision.ts) crée boîte + config auto pour **nouveau tenant** — **nécessite `scripts/deploy/add-mail-domain.sh` (à créer, cf. TODO)**. **Roundcube retiré du VPS le 2026-08-04** — plus de webmail, la cliente lit ses mails pro dans Gmail via transfert instantané (`lib/mail-notify-worker.ts` → IMAP Dovecot → forward vers `admin_personal_email`) et répond en `contact@…` via Gmail « Send As » (tutoriel `/admin/parametres?tab=messagerie`). Vhost nginx `mail.beliandjolie.com` reste coquille vide (cert renewal certbot) — backup `/root/backups/pre-roundcube-removal-20260804-144048/` si rollback.
- **Via UI (chiffrés BDD)** : clé Easy-Express, identifiants PFS (email + mdp — réutilisés pour traduction auto), identifiants Ankorstore back-office (email + mdp), identifiants eFashion / Faire.

---

## Commandes

```bash
npm run dev / build / start / lint
npm run test / test:watch / test:coverage
npm run test:pfs-smoke
npx prisma db push && npx prisma generate
npx prisma studio
npx tsx scripts/create-admin.ts
npx tsx scripts/seed-demo-clients.ts          # 14 faux clients + 78 commandes (aperçu local liste clients)
npx tsx scripts/seed-demo-clients.ts --clean  # supprime le jeu de démo (emails @demo-local.test)
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
