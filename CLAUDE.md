# CLAUDE.md

## À qui tu parles
Cliente **non-développeuse**. Français simple, court. Impact décrit **pour elle et ses clients**, jamais en code. Tests = trajets dans le site. Détails techniques : entre toi et le code.

> Docs : `docs/architecture.md` · `docs/pfs-system.md` · `docs/pfs-api.md` · `docs/pfs-mobile-api.md` · `docs/ankorstore-api.md` · `docs/efashion-api.md` · `docs/faire-api.md` · `docs/smarty365-api.md` · `docs/microstore-api.md` · `docs/styling.md`

---

## Règles de travail
- **Auto-MAJ CLAUDE.md** si nouvelle convention/env var.
- **Parallélisation** : sous-agents indépendants en parallèle.
- **Récap fin** : « Ce que vous m'avez demandé » (1-3 phrases).
- **Impact croisé** : prévenir **avant** de coder si autre feature impactée.
- **Suggestions** : proposer variantes UX/perf, elle décide.
- **Tests Vitest obligatoires** sur toute feature/modif.
- **Serveur local jamais lancé par Claude** : jamais `npm run dev`, jamais kill/restart sur `localhost:3000`. Après modif qui nécessite restart (schema Prisma, `.env`, `next.config.ts`), le dire — pas le faire. Si port 3000 gêne : demander avant.

### Workflow modif → validation → push
1. Modifier local. Pas de push auto.
2. Informer + trajet de test.
3. Décision : **« Mettre de côté »** = push groupé. **« Push prod »** = pré-flight → backup → `git add/commit/push origin master`.
4. **GitHub Actions `.github/workflows/deploy.yml`** : build Ubuntu 24.04 → rsync `.next`+`node_modules`+`prisma`+`public` sur VPS → `scripts/deploy/vps-receive.sh` (prisma db push si schema changé, hash vs `/root/.beliandjolie-schema-hash`, puis `pm2 restart beliandjolie` + health check 2 tenants `curl -sL` suivant redirs 307). Durée ~2 min 30-3 min. Échec → prod reste sur l'ancienne version.

**Secrets GitHub** : `VPS_SSH_KEY` (clé privée `/root/.ssh/github_actions_ed25519`, auto-wrap BEGIN/END OPENSSH), `VPS_HOST=72.61.106.128`, `VPS_USER=root`, `VPS_APP_DIR=/var/www/beliandjolie`.

**Pièges workflow** : `ssh-keyscan` timeout runners → skip + `StrictHostKeyChecking=no` + `UserKnownHostsFile=/dev/null`. IPv6 runner → forcer `-4` sur ssh/rsync. Nouveau VPS/clone : `git config --global --add safe.directory /var/www/beliandjolie`.

**Fallback deploy** `scripts/deploy/vps-build-with-freeze.sh` (si GitHub HS) : stop PM2 avant build (libère RAM 7.8 Go VPS), downtime ~10 min.

**⛔ `scripts/deploy/deploy-fast.ps1` CASSÉ depuis 2026-07-28** : Turbopack hashe `sharp`/`pdfkit`/`playwright`/`exceljs` avec chemin → Windows ≠ Linux → VPS crash.

**Pré-flight AVANT push prod** — `pm2 restart` tue tous workers. Vérifs — si occupé, remonter à la cliente et attendre go :
1. `mysql beliandjolie -e "SELECT status,marketplace,COUNT(*) FROM MarketplaceRefreshJob WHERE status IN ('QUEUED','IN_PROGRESS','AWAITING_CALLBACK') GROUP BY status,marketplace;"`
2. `mysql beliandjolie -e "SELECT status,COUNT(*) FROM ImageProcessingJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status;"` (restart = PROCESSING→PENDING idempotent)
3. `tail -200 /root/.pm2/logs/beliandjolie-out.log | grep -E "Ankorstore|Chargement|Import|Preview job"` — activité récente → attendre.
4. Idem TranslationJob/EmailQueueJob.

Après restart : revérifier aucun IN_PROGRESS bloqué (startup sweep marque FAILED, race rare peut laisser).

**Backup avant push prod** — `/root/backups/pre-push-YYYYMMDD-HHMMSS/` :
1. `mysqldump --single-transaction --routines --triggers --events --databases beliandjolie | gzip > db-beliandjolie.sql.gz`
2. `git rev-parse HEAD > git-head.txt` + `git archive --format=tar HEAD | gzip > code-git-head.tar.gz`
3. `cp .env .env.backup ; chmod 600`
4. `cp -al public/uploads uploads-public` + `cp -al private/uploads uploads-private` (hardlinks).

Restauration : `zcat db-*.sql.gz | mysql`, `git reset --hard $(cat git-head.txt)`, `cp .env.backup .env`. Rotation auto > 14 j via cron `/etc/cron.d/rotate-backups`.

**Exception Ankorstore** : push direct prod (callbacks async ne hittent pas localhost).

Confirmation **uniquement** avant : suppression données, drop tables, push --force, secrets.

### Maquette avant tout design
Demande visuelle (couleurs, mise en page, hero, sidebar) → HTML autonome dans `C:/Users/Admin/Downloads/` (Tailwind CDN) → ouvrir navigateur → ajuster → appliquer au vrai code. Sauter si « pas besoin » ou trivial.

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

Protection : `middleware.ts` (edge) + `layout.tsx`. **Prix visibles** via `lib/price-visibility.ts::canSeePrices()`.

**Visibilité produit vitrine** — un produit apparaît sur listings publics seulement si `status === "ONLINE"` ET au moins une `ProductColor` non désactivée avec `stock > 0`. Filtre centralisé `PUBLIC_SELLABLE_COLORS_CLAUSE` (`lib/public-product-visibility.ts`) — à réutiliser sur tout nouveau listing public. Fiche produit `/produits/[slug]` reste accessible en direct (SEO + backlinks).

### Layers
- **Server actions** (`app/actions/`) : mutations. `requireAdmin()`/`requireAuth()` obligatoire.
- **API routes** (`app/api/`) : webhooks, SSE, file-serving.
- **Lib** (`lib/`) : `pfs-*`, `ankorstore-*`, `smarty365`, `easy-express`, `marketplace-pricing`, `storage`, `email`, `cached-data`, `security`, `encryption`, `logger`, `seo`.

### Microstore (Dokkr)
API native `/goods/add|update|disable|del` + couleur. Token QR compagnon `5_XXX` (cliente scanne 1×/an via `MicrostoreConnectCard`). Doc : `docs/microstore-api.md`.
- **Prisma IDs** : `Product.microstoreProductId Int?` + `ProductColor.microstoreVariantId Int?` (del_id dans update).
- **Mapping manuel BJ ↔ MS** : `Color/Category/SubCategory/Season.microstoreXxxId` via `<MicrostoreAttributeSelect>`. Prioritaire sur match par nom. Compositions non mappées (envoyées en texte libre dans `remark_material`).
- **Étiquette catégorie** : la cliente choisit cat principale (défaut) ou sous-cat attribuée via `resolveMicrostoreCategoryChoice()`. Push refusé si source non mappée. Mapping sous-cat depuis `/admin/categories` (badge « M »).
- **Visibilité H5 = statut BJ** : flag `disable` dans body `/goods/update` (jamais `/goods/disable` qui répond « Service App error »). OFFLINE/ARCHIVED→1, ONLINE/SYNCING→0. Timestamp Unix côté MS (0=visible). Règle `shouldDisableOnMicrostore()`.
- **Libs** : `lib/microstore-goods-crud.ts`, `lib/microstore-attributes.ts`, `lib/microstore-products.ts`. Actions `app/actions/admin/microstore-{products,attributes}.ts`.
- **Backfill IDs** après deploy : `scripts/backfill-microstore-goods-ids.ts` (dry-run défaut, `--apply`).

### Vérification WhatsApp (Baileys, scopé tenant)
Icône verte sur `/admin/clients` + fiche commande. **Session par tenant** via `baileys` v7 (reverse-engineered, risque Meta atténué par cache + rate-limit). Pairing par **code à 8 chiffres** (pas de QR) depuis `/admin/parametres` → tuile « WhatsApp ».
- **Modules** : `lib/whatsapp-session.ts` (`Map<tenantId, store>`, sessions `private/whatsapp-session/{slug}/`), `lib/whatsapp-check.ts` (cache BDD + rate-limit 100/jour/tenant), `app/actions/admin/whatsapp-pairing.ts`.
- **Prisma** : `User.hasWhatsapp Boolean?` + `whatsappCheckedAt DateTime?` (null = lazy).
- **Boot** : `instrumentation-node.ts` scanne sous-dossiers, remonte chaque session via `tenantALS.run(id, () => startWhatsappSession(id, slug))`.
- **2 déclencheurs** : clic icône orange « Non vérifié » (manuel) + auto sur `PENDING→APPROVED` (fire-and-forget wrappé `tenantALS.run`). **Jamais sur listing** (quota).
- **UI 3 états** `PhoneContactIcons` : 🟢 valide / 🟠 non vérifié (cliquable) / ⚪ invalide.
- **Baileys dans `serverExternalPackages`**. Dynamic import. Recommandation : SIM dédiée par boutique.

### Marketplaces (PFS + Ankorstore + eFashion + Faire + Orderchamp + Microstore)
- **IDs** : `Product.{pfs,ankors,efashionReferenceBase,faire,orderchamp}ProductId` + `ProductColor.{pfs,ankors,orderchamp}VariantId`. `null` = non publié.
- **`*SyncRequired`** : posé par `updateProduct` (champ clé modifié) + worker images. Reset par sync réussie. Badge orange. Priorité : loading > syncRequired > online > offline.
- **Kill switch 2 dimensions** : SiteConfig par mkt `{mkt}_products_management_enabled` (push/publish/refresh/resync/delete) + `{mkt}_orders_worker_enabled`. Actions `setMarketplaceProductsManagement()` + `setMarketplaceAutoSyncEnabled()`.
- **Modale save** : case par mkt si produit lié + mkt configurée. 1ʳᵉ publication via badge fiche. OC caché si OFFLINE. Bulk « Rafraîchir » reste upsert-style pour OC/Microstore.
- **Publish vs Update** : `*UpdateProductInPlace()` si ID connu (PATCH + diff snapshot), sinon `*PublishProduct()`. Fallback publish si update échoue.
- **Diff snapshot** (`*LastSyncSnapshot` Json?) : envoie delta. Reset `Prisma.DbNull` quand ID change. `null` = sync complète.
- **Resync forcé** (↻) : `forceFullSync: true`, ne touche pas l'ID.
- **Proxy images** `/api/marketplace-image?path=…` upscale à 500px si source < 500 (Ankor ≥ 500). Pas pour PFS.
- **Delete** : PFS = local-only. Ankor = auto callback.
- **PFS compo — API mobile prioritaire** : `lib/pfs-admin-api.ts::pfsAdminFetchMaterialComposition()` lue en premier ; wholesaler = fallback. Appliqué dans `pfs-import`, `pfs-verify`, `pfs-verify-apply`. Pull auto compo (`resolvePfsCompositionsToLocal`, auto-création `createOrLinkMapping`, dédoublonnage/merge %). Credentials wholesaler : `pfs_email`+`pfs_password`. Constante `AemikSEAUID = "AemikWeb3_PFSBKOFFICE"` requise POST admin.
- **Modale de liaison — intents** : `LinkMarketplaceModal` unifié PFS/Ankor/eFa/Faire accepte 3 `LinkIntents` :
  - `colorsToCreate` : couleurs BJ orphelines à créer chez mkt (upload photo obligatoire).
  - `orphansToDelete` : variantes mkt orphelines à supprimer chez mkt.
  - `orphansToImport` : variantes mkt orphelines → ProductColor BJ via `createLocalVariantFrom{Mkt}Variant()`. **Anti-doublon** : si BJ a déjà ProductColor UNIT sur cette Color + non-liée → RELIE. Déjà liée AUTRE mkt → erreur.
  - **Validation dure** : chaque variante mkt non-mappée DOIT être dans delete ou import.
  - Ordre serveur : (1) delete orphelines, (2) link txn, (3) import orphelines, (4) `updateProductInPlace({forceFullSync:true})`.
  - Suppression variante isolée : PFS `pfsDeleteVariant()`, eFashion `efashionDeleteShootingProduct()` (soft via mutation GraphQL `softDeleteProduits`, l'ancien REST ne supprime rien), Faire `DELETE /products/{id}/variants/{vid}`, Ankor = kickoff overwrite.
  - Retour `LinkResult` : `autoCreatedOnMarketplace`+`deletedOnMarketplace`+`importedFromMarketplace`.

### Orderchamp
Marketplace B2B Pays-Bas. API GraphQL, Bearer token par tenant (SiteConfig `orderchamp_api_key` chiffré). > État dans `ORDERCHAMP-STATUS.md` racine. Modules `lib/orderchamp-*.ts`. Action `app/actions/admin/orderchamp.ts`.
- **Prisma** : `Product.orderchampProductId/LastSyncSnapshot/LastRefreshedAt/SyncRequired/Enabled/LastExportedAt`, `ProductColor.orderchampVariantId/ColorNameOverride`, `Category.orderchampCategoryPath` + `orderchampCustomCategoryId`, `Composition.orderchampMaterialCode`. Modèles `OrderchampOrder` + `OrderchampOrderItem`.

**Règles figées** (cf. `memory/project_orderchamp_rules.md`) :
- **Axes anglais** : `option1:"Color"` + `option2:"Size"` (sinon OC ne peuple pas `variant.color/size`).
- **Toutes variantes ont taille + couleur** (fallback `"One Size"` si mono-taille).
- **Dimensions physiques toujours envoyées** : weight g, length/width/height/diameter cm (BDD mm, ÷10 dans publish). Produit ET variante.
- **Catégorie feuille impérative** : `category` accepte branches mais back-office lit feuilles (ex `JEWELRY_ACCESSORIES_BRACELETS_BANGLE_BRACELETS`).
- **Mapping catégorie obligatoire par produit** : chaque `Category` BJ mappée via `/admin/categories` (drawer OC). Facultatif sur `SubCategory`. Résolution : première sous-cat mappée (ordre alpha) → fallback `Category.orderchampCategoryPath`. Publish/update refusent si rien mappé. Taxonomie pullée par introspection, cache 24h tag `orderchamp-taxonomy`.
- **CustomCategory doit être publiée** : enchaîner `customCategoryCreate` → `customCategoryUpdate({isPublished:true})` sinon `productUpdate` laisse null silencieux. Helper `ensureOrderchampCustomCategory()`.
- **Refresh via `productRepublish`** (jamais delete+recreate — garde ID OC stable).
- **Stock via `inventoryLevelBulkAdjust`** : SET synchro régulière, ADJUST delta commande. Batches 100.
- **Filtres marketing** (`filterMaterial/Color/Karat…`) : arrays typés sur variante, `maximumValues` par catégorie. Chaque update **écrase** — réenvoyer liste complète.
- **Piège scalar `diameter`** : typé `Liter` (bug schéma) mais accepte cm.
- **`salesChannels` read-only API** : à activer manuellement OC Settings > Sales channels.
- **Publish storefront** : `productPublish(input:{id, storefrontId})` requiert storefrontId sinon brouillon. Helper `lib/orderchamp-storefront.ts` cache par tenant.

Compte : `PRINCESSE` (`contact@beliandjolie.com`).

### Ankorstore back-office reverse-engineered
Toutes ops **100 % synchrones** via API interne `fr.ankorstore.com`. Plus de callback / `AnkorstoreOperation` / webhook. Module `lib/ankorstore-bo/` (auth cookie+CSRF, referentials hardcodés). Actions `app/actions/admin/ankorstore-bo.ts`. Auth : email+mdp (chiffrés `ankorstore_bo_email/password`). SKU `{REFERENCE}_{COULEUR_NORMALISEE}` (`lib/ankorstore-bo/sku.ts`). Statut BJ→Ankor : ONLINE=`enable`, OFFLINE/ARCHIVED=`disable`. Image père = 1ʳᵉ image couleur principale. Bug 422 PUT contourné en injectant `variant.id` connus. **Commandes** lues via `lib/ankorstore-bo/orders.ts` (worker désactivé — à réactiver après reverse POST tracking/reject).

### Refresh produit
Bouton « Rafraîchir » + bulk. Modale : boutique (bump `lastRefreshedAt`) + PFS + Ankor. Parallèle 5 max via `MarketplaceRefreshWidget`. « Nouveauté » = `max(createdAt, lastRefreshedAt) > now - 30j`.

**⛔ Règle absolue — audit auto ≠ refresh** (incident 14/09/2026, 189 fiches eFa + 189 Faire recréées sur Issyma) : audit PFS auto (`pfs-audit-runner.ts::enqueueMarketplacePropagation`) et **toute automatisation** (scheduler, cron, worker, post-import) propage en `mode="RESYNC"` (update in place `forceFullSync:true`), **JAMAIS `mode="REFRESH"`**. Sur eFa/Faire, refresh = delete+recreate = casse URLs/favoris. Bouton manuel reste REFRESH. Test anti-régression : `__tests__/lib/pfs-audit-runner-propagation-mode.test.ts`.

**Refs temporaires** : incluent la ref BJ pour identifier les orphelines. Format : `DEL-{ref_bj}-{random4}-{couleur}` sur eFashion, `TMP-{ref_bj}-{random6}` sur PFS, `{nom} [REFRESH_{ref_bj}_{ts}]` sur Faire.

### Vérification par code OTP (actions destructives)
Suppression / refresh mkt / archivage → `<OtpConfirmDialog>` → code 6 chiffres sur boîte pro. Prisma `AdminActionOtp` (TTL 15 min, 5 tentatives). Lib `lib/admin-action-otp.ts`. Pause : dropdown 15 min / 1h / 24h via `SiteConfig[admin_action_otp_pause_until]`. Provider `<OtpConfirmProvider>` monté `app/layout.tsx`.

### Marketplace pricing
3 types (`percent`/`fixed`/`multiplier`) × 3 arrondis (`none`/`up`/`down`). Clés SiteConfig `{marketplace}_price_markup_{type|value|rounding}`. **PACK** : markup sur prix unitaire (total÷qty), arrondi, ×qty. Jamais sur le total. **Retail = markup sur WHOLESALE déjà majoré et arrondi** (pas sur basePrice BJ). Faire : `applyFaireMarkupWithClamp` (`lib/marketplace-pricing-shared.ts`). Ankor : `getAnkorstoreChainedRetailPrice`. **Arrondi passe TOUJOURS par centimes entiers** (`Math.round(price*100)`) AVANT `Math.ceil/floor` au dixième — sinon IEEE-754 (`4.2*3 = 12.600000000000001`) fait dériver.

### Arrondi commande / facture — règle Sage 50
Tout l'arrondi monétaire passe par `roundCent` (`lib/money.ts`) — **au centime le plus proche** (round half up) + correction `Number.EPSILON`. Sage 50 arrondit au plus proche (pas `Math.floor`). **Règle** : Remise = `roundCent(HT × taux)`, Net HT = HT − Remise, TVA = `roundCent(NetHT × tvaRate)`, TTC = NetHT + TVA (**pas de re-arrondi**). Callers : `lib/order-pricing.ts`, `lib/order-totals.ts`, `lib/notifications.ts`, 2 routes PDF, 2 pages fiche, `OrderContent.tsx`. Marketplaces non touchées. Résumé admin affiche ancien barré → nouveau sur 5 lignes.

### Livraison — Easy-Express + Smarty365
- **Fournisseur actif** : SiteConfig `active_shipping_provider` (`easy_express` défaut | `smarty365`). Lu par `/api/carriers` + `generateShipmentLabel`.
- **Chaque commande garde son provider** (`Order.shippingProvider`). Résolution `resolveProviderForOrder` : priorité `shippingProvider` posé > labelUrl posé > `carrierId` préfixé `smarty:` > provider actif.
- **Prisma Order** : `eeTrackingId`, `eeLabelUrl` + `smartyParcelId/TrackingId/LabelUrl/Transporter/RouteCode` + `shippingProvider`.
- **HMAC Smarty** : `verifyCarrierSignature` refuse `transactionId` vide → `/api/carriers` génère jeton synthétique `smarty:v1:{random}`.
- **Assurance Smarty obligatoire** : fondue dans prix port. Cotation ajoute `subtotalHT × rate%/100`, parcel envoie `insuredValue: Math.ceil(subtotalHT)`. Taux `smarty365_insurance_rate_pct` (défaut 0,6%).
- **Points relais masqués** : `isPickupPointRoute` filtre `RELAY_POINT/POST_OFFICE/RELAY_13H/_2SP_/_2SPEU_/MONDIAL_RELAY_*`.
- **DOM-TOM / hors UE** : Smarty exige `parcels[].items[]`. Détection `EU_COUNTRY_CODES` (27 UE + FR métropole). `buildCustomsItemsForOrder` : `description=productName`, `hscode=Product.hsCode.code` (fallback `71171900`), `originCountry=Product.countryIsoCode` (fallback `CN`). Pré-check dur `checkOrderCustomsReadiness` refuse génération si code SH manquant. Champs officiels : `hscode` minuscule, `originCountry`, `value` string. Jamais `customClearance/hasInvoice/parcelType` (crashent).
- **Doc officielle Smarty** : `GET https://www.smarty365.com/api-spec.js` avec Bearer. Lire AVANT de reverse-engineerer.
- **Easy-Express** : centimes (÷100), poids min 1kg, +5€ marge, `transactionId` expire vite.
- **Marge frais port** (`shipping_margin_type/value`) s'applique aux 2.
- **Doc** : `docs/smarty365-api.md`.

### Import PFS
`/admin/produits/importer-pfs` → import direct. Attribut manquant (compo, pays, saison, taille, couleur, catégorie) créé auto dans `createOrLinkMapping`. Auto-traduction en fond. Rattrapage : `scripts/enrich-pfs-products.ts`.

### Import Excel produits
`/admin/produits/importer` : upload → preview → récap éditable UI → job background. **Excel uniquement**. Modèle 5 lignes en-tête. Composants `EditableProductCard`, `EntitySelect` (bouton +), `CompositionEditor`, `effective-status.ts`, `QuickCreateModal`. **Overrides** : `ImportOverride` JSON dans `{filePath}.overrides.json`. Quick-create idempotent (pas de P2002).

### Onboarding wizard
`/admin/bienvenue` → 8 étapes (welcome/company/brand/stripe/email/shipping/legal/done). `WizardShell`. SiteConfig `onboarding_steps_completed` + `onboarding_completed_at`. Middleware redirige admin non-fini.

### Auth
NextAuth v4, Credentials + JWT 30d. New users `PENDING`. Token : `id`, `role`, `status`, `company`.

### i18n
next-intl 4.x, préfixe (`/fr/…`, `/en/…`). Locales **fr (défaut) + en**. Auto-traduction fire-and-forget limitée à EN. Toggle `auto_translate_enabled`. Hors i18n : `/admin/*`, `/api/*`, `/maintenance`, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/icon`, `/apple-icon`, `/.well-known/*` (indispensable Apple Pay Stripe en `text/plain`). Liens admin → public : hardcoder `/fr/…`. Sitemap : 7× URL + `alternates.languages`. Publish : `country_of_manufacture` priorité `isoCode → pfsCountryRef → "CN"`.

### Styling
**Tailwind v4** — theme dans `app/globals.css @theme {}`, pas de config JS. **Pas de dark mode public**. **Mode sombre admin uniquement**. Flat design + ombres subtiles. Détails : `docs/styling.md`.

#### Mode sombre admin
Bascule Paramètres → Affichage. Cookie `bj_admin_theme` 5 ans. Lecture serveur `app/(admin)/layout.tsx` via `parseAdminTheme()` → classe `admin-dark` sur `#admin-theme-wrapper`. CSS scopé `#admin-theme-wrapper.admin-dark { … }` (fin `app/globals.css`). Pages `/admin/*` uniquement.

#### Style public / espace pro (hors `/admin`)
Réf `app/[locale]/(client)/commandes/page.tsx`.
- **Palette ardoise** uniquement. **Interdit** : warm/or/beige/aurora doré. Sémantiques réservées statuts.
- **Couleurs initiales marketplaces** (rond + lettre) — figées : **PFS** `#4f46e5→#6366f1` · **Ankor** `#0ea5e9→#38bdf8` · **eFa** `#db2777→#ec4899` · **Faire** `#f59e0b→#fbbf24` · **OC** `#F97316→#FDBA74` · **MS** `#0891b2→#22d3ee` · **B&J** `#64748b→#334155`. Rond d'initiale exclusivement. Interdit halo/aurora/bandeau/CTA.
- **Police sans-serif** : body `var(--font-roboto)`, titres `var(--font-poppins)` via `font-heading`. Interdit empattements.
- **Cartes** : `bg-bg-primary border border-border rounded-2xl shadow-sm`. Eyebrow uppercase `tracking-[0.2em] text-text-muted`.
- **CTA principal** : `bg-bg-dark text-text-inverse`.
- Vaut aussi pour maquettes `Downloads/*.html`.

#### Style admin cockpit (sur `/admin`)
Inspi Stripe/Linear/Vercel. **Pas de retour au flat blanc/gris.**
- **Hero** `rounded-3xl` aurora. Eyebrow chip + pastille + uppercase `tracking-[0.18em]`. Titre `font-heading text-2xl/3xl font-bold`.
- **KPI tiles** `rounded-2xl`, fond pastel, halo flou, icône `bg-{accent}-100 ring-1 ring-{accent}-200`.
- **Cartes** bande dégradée fine en haut, halo coin, eyebrow coloré.
- **Nav** : Principal=dark, Catalogue=emerald, Ventes=sky, Système=violet.
- **Palette** : emerald (catalogue/revenu), sky (commandes), violet (système), amber (alertes), rose (stock bas), slate (neutre).
- **Mobile-first** : `grid-cols-2 sm:grid-cols-4`, tables → cartes sous `md`.
- **Drawers** > modales pour réglages riches.

#### Widget flottant (`components/admin/widgets-rail/`)
Tâches longues admin (traduction, mkt, images, shooting eFa, chat) via **widget flottant unique** bas-droite.
- ≥ md : FAB noir 56px → clic déploie 5 mini-boutons | Tiroir 400×620px.
- < md : FAB halo pulsant | Tiroir plein écran.
- **Palette** : violet=Traduction, sky=Mkt, emerald=Images, amber=Shooting eFa, rose=Chat.
- **Un seul tiroir ouvert** (`useRightRail()`). Badge cumul = somme files. `DrawerShell` : header aurora + eyebrow + titre + zone scrollable + footer.
- **Layout admin** wrapper `#admin-theme-wrapper` a `pb-24`.

### Enums Prisma
- `ProductStatus` : OFFLINE|ONLINE|ARCHIVED|SYNCING
- `SaleType` : UNIT|PACK
- `OrderStatus` : PENDING|SHIPPED|CANCELLED (seule transition PENDING→SHIPPED, annulation depuis PENDING)
- `UserRole` : ADMIN|CLIENT
- `UserStatus` : PENDING|APPROVED|REJECTED

### Multi-tenant (prod depuis 2026-07-12)
Prod sert 2 boutiques depuis 1 Next/PM2/DB : **beliandjolie.com** (`beliandjolie`) + **issyma.fr** (`issyma`, shopName "FORCYMA").

- **Résolution** : Middleware lit `Host:` → mappe via `TenantDomain` → pose `x-tenant-id/slug/name` headers. `lib/tenant.ts::getCurrentTenant()` + ALS `lib/tenant-als.ts`. Extension Prisma `lib/prisma-tenant-scope.ts` scope auto ~60 modèles.
- **SiteConfig** : écrire via `setSiteConfig(key, value)` / `unsetSiteConfig(key)` (`lib/site-config-write.ts`). **Jamais** `upsert({where:{key}})` — PK composite `(tenantId, key)`. Lire par clé : `findFirst({where:{key}})`, PAS `findUnique`.
- **Tables composite** : `Product.reference`, `Order.orderNumber`, `User.email/siret/stripeCustomerId`, `Product.{pfs,ankors,faire}ProductId` → `findFirst({where:{X:...}})`. Idem `Category/SubCategory/Color/Size/Composition/Season/ManufacturingCountry/Tag`.
- **Uploads** : `/uploads/{tenantSlug}/…`. Passer `tenant.slug` en 2ᵉ arg des helpers `storage.ts` (`productImageDir`, `collectionImageDir`, `bannerDir`, `kbisDir`, `invoiceDir`, etc.). Récup via `requireCurrentTenant()`.
- **Fire-and-forget** : Capturer tenantId côté handler AVANT l'IIFE, wrap `tenantALS.run(tenantId, async () => …)`. Sans ça → fuite mkt (push BJ → Issyma). Workers wrappés : `marketplace-queue-worker`, `translation-queue`, `efashion-shooting-batch`.
- **Caches auth marketplaces** : **par tenant** (`Map<tenantId, TokenCache>`) — PFS/Ankor/eFa/Faire/Stripe. Sinon token 1er tenant partout.
- **Caches SiteConfig** : `tenantScopedCacheWithTid` (`lib/cached-data.ts`) résout tid via ALS + fallback `headers()`. Tid **capturé AU CALLSITE** et passé via closure (ALS invisible dans callbacks `unstable_cache`).
- **Sitemap/robots/favicon/manifest** : `Host:` comme baseUrl. Bindent l'ALS via `await getCurrentTenantId()` en tête.
- **Scripts CLI** : extension passthrough hors requête. Passer `tenantId` explicite ou `MULTI_TENANT_SCOPE=off`.
- **Chantier futur** : `AccountLockout.email` et `Claim.reference` restent `@unique` global.

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
- `useConfirm()` / `useToast()` (context).
- Pas de dark mode public : vars CSS (`bg-bg-primary`, `text-text-primary`, `border-border`).
- Touch min 44px, `prefers-reduced-motion` respecté.

### Produits / Variantes
- **Suppression = définitive** : `deleteProduct` / `bulkDeleteProducts` suppriment même avec commandes. OrderItems gardent snapshot (nom, ref, couleur, prix) + miniature dans `/uploads/{tenant}/commandes/{orderNumber}/`. Clic ref produit disparu → page « produit supprimé ».
- `Color.patternImage` > `Color.hex`.
- 1 variante = 1 couleur. `groupKey` = `colorId` (helper `variantGroupKeyFromState()`).
- **PACK mono-couleur** : `colorId` + `VariantSize`. `unitPrice` = `computeTotalPrice(v)` (total BDD).
- **PACK multi-couleurs** : `PackColorLine[]` + `PackColorLineSize[]`. Détection `isMultiColorPack(v)` UI / `c.packLines.length > 0` serveur.
- **UNIT** : max 1 taille.
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
- Module unique `lib/storage.ts`. **Jamais hardcoder de path.**
- Public `public/uploads/` : `produits/`, `collections/`, `motifs-couleurs/`, `banniere/`, `catalogues/`, `bordereaux/`, `reclamations/`.
- Privé `private/uploads/` : `kbis/`, `documents/`, `factures/`, `pieces-jointes-email/`, `avoirs/`, `_image_jobs/`.
- Produit : WebP 3 tailles (large/`-md`/`-thumb`), max 5/couleur. Compat ancien `_md`/`_thumb` via `getImagePaths()`.
- Renommage `renameProductFolder(oldRef, newRef)` dans txn Prisma. Brouillon `uploads/produits/_brouillon/`. DB paths = URL publique.
- **PFS image sync** : JPEG (pas WebP), multipart.
- **Upload async** : `POST /api/admin/products/images` écrit buffer brut `private/uploads/_image_jobs/`, crée `ImageProcessingJob` PENDING. Worker `lib/image-queue.ts` (3 parallèle, poll 800ms). Boot PROCESSING→PENDING. Dernier DONE lié → pose `*SyncRequired=true`.
- Reset : `scripts/wipe-data.ts` (préserve ADMIN, SiteConfig, CompanyInfo, LegalDocument).

### SEO
- `lib/seo.ts` : `buildAlternates(path)`, `buildOrganizationSchema()`, `buildWebsiteSchema()`.
- Organization JSON-LD **uniquement** `app/layout.tsx`. WebSite sur home. Product + BreadcrumbList sur fiche.
- Clés SEO : `site_logo_url`, `social_*_url`. Favicon dynamique via `app/icon.tsx` + `apple-icon.tsx` (`ImageResponse`).

### Integrations
- **SSE** : `lib/product-events.ts` (`globalThis` singleton). Hook `useProductStream()`.
- **Livraison** : voir bloc Architecture + `docs/smarty365-api.md`.

---

## Env vars
- **Obligatoires** : `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_KEY`.
- **Stripe** : 3 clés en BDD **par tenant** (SiteConfig chiffré). **Plus aucune clé dans `.env`**. Tenant sans Stripe → « Paiement indisponible » au checkout. `readStripeConfig()` strict BDD-only. `updateStripeConfig()` distingue `undefined` (« ne touche pas ») de `""` (« vider »).
- **Email** : SMTP par tenant en BDD (chiffré). Postfix/Dovecot interne `mail.beliandjolie.com:587`. Boîtes `contact@…` (quota 5 Go). `provisionShopMailbox()` auto — nécessite `scripts/deploy/add-mail-domain.sh` (TODO à créer). Roundcube retiré 2026-08-04 : cliente lit via Gmail (transfert IMAP `lib/mail-notify-worker.ts` + répond via Gmail « Send As »).
- **Via UI (chiffrés BDD)** : Easy-Express, JWT Smarty365, PFS (email+mdp, réutilisés traduction auto), Ankorstore BO (email+mdp), eFashion / Faire / Orderchamp.

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
npx tsx scripts/seed-demo-clients.ts --clean  # supprime jeu démo
```
Integration tests : `__tests__/integration/` (DB-backed, `fileParallelism: false`).

---

## Production (`beliandjolie.com`)
VPS Hostinger Ubuntu 24.04. `/var/www/beliandjolie`. Nginx → Next `127.0.0.1:3000`. PM2 systemd. MySQL 8, Node 20, Certbot.

- `.env` prod : `/var/www/beliandjolie/.env`. Lu au démarrage → `pm2 restart beliandjolie` après modif.
- UFW : 22/80/443. SSH par clé.
- **V:** = SSHFS-Win → édition directe.
- **Playwright Chromium** (import PFS) : `ssh root@72.61.106.128 "cd /var/www/beliandjolie && npx playwright install --with-deps chromium"` après deploy initial / upgrade.
- Hors repo : `scripts/deploy/`, `public/uploads/`, `private/uploads/`. Sauvegarder uploads VPS.
- **HTTP/2 obligatoire par vhost nginx** : vérifier `listen 443 ssl http2;` à chaque nouveau tenant (sinon `ERR_HTTP2_PROTOCOL_ERROR`).
