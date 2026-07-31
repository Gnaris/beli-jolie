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
   - **« Mettre de côté »** → garder pour push groupé.
   - **« Push en production »** : **pré-flight obligatoire** (voir bloc ci-dessous) → **backup prod obligatoire d'abord** (voir bloc ci-dessous) → `git add/commit/push origin master`. **Le workflow GitHub Actions `.github/workflows/deploy.yml` prend le relais automatiquement** : build sur runner Ubuntu 24.04 (~5-7 min), rsync `.next` + `node_modules` + `prisma` + `public` sur le VPS, exécute `scripts/deploy/vps-receive.sh` qui applique `prisma db push` (si schema.prisma a changé — hash comparé à `/root/.beliandjolie-schema-hash`), `pm2 restart beliandjolie`, health check des 2 tenants. Si le workflow échoue, GitHub notifie et la prod reste sur l'ancienne version.
4. L'informer à la fin (URL du run GitHub Actions). Code identique local/GitHub/VPS.

**Secrets GitHub obligatoires** (à définir une fois dans `Settings → Secrets and variables → Actions` du repo) :
- `VPS_SSH_KEY` : contenu de `/root/.ssh/github_actions_ed25519` (clé privée générée sur le VPS 2026-07-31).
- `VPS_HOST` : `72.61.106.128`.
- `VPS_USER` : `root`.
- `VPS_APP_DIR` : `/var/www/beliandjolie`.
Clé publique correspondante déjà ajoutée dans `/root/.ssh/authorized_keys` du VPS.

**Fallback deploy sur le VPS** — `scripts/deploy/vps-build-with-freeze.sh` : à utiliser UNIQUEMENT si GitHub Actions est HS ou pour un deploy manuel d'urgence. Diff vs l'ancien workflow direct : **stop PM2 avant le build** pour libérer 2-3 Go de RAM (le VPS n'a que 7.8 Go dont 6 Go pris par les workers — sans stop, le build passe en swap et prend ~30 min ; avec stop, ~10-15 min). Downtime pendant le build (~10 min) — activer la page maintenance nginx si `snippets/maintenance.conf` existe.

**Raccourci deploy rapide — CASSÉ 2026-07-28, NE PAS UTILISER** `scripts/deploy/deploy-fast.ps1` (build local Windows + rsync `.next`). Turbopack **hashe les noms des modules externes** (`sharp`, `pdfkit`, `playwright`, `exceljs`) avec des infos de chemin — le hash Windows ne matche pas le hash Linux, le VPS crashe au boot sur `Cannot find module 'sharp-<hash>'`. `serverExternalPackages` **ne protège pas** en mode Turbopack. **Remplacé par GitHub Actions** (runner Ubuntu = même arch que VPS, pas de bug de hash).

**Pré-flight AVANT push prod (obligatoire, sans demander)** — un `pm2 restart` tue tous les workers en cours (image queue, translation, marketplace queue, PFS refresh, chat, shooting eFashion…) ; **ne jamais** déclencher un restart si un travail est en vol côté cliente. Vérifs à faire dans cet ordre, et **remonter à la cliente** si l'une répond « occupé » — attendre son go explicite avant de continuer :
1. **Widget flottant marketplaces** — SQL sur le VPS : `mysql beliandjolie -e "SELECT status, marketplace, COUNT(*) FROM MarketplaceRefreshJob WHERE status IN ('QUEUED','IN_PROGRESS','AWAITING_CALLBACK') GROUP BY status, marketplace;"`. Si ≥ 1 ligne → « Il y a X jobs marketplace en cours (Rafraîchir/Publier/Resync), tu veux que j'attende ? ».
2. **Widget flottant images** — `mysql beliandjolie -e "SELECT status, COUNT(*) FROM ImageProcessingJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status;"`. Si > 0 → même question. Un restart met tous les PROCESSING en PENDING (idempotent) mais l'attente utilisateur devient plus longue et un job Sharp/WebP en cours peut foirer.
3. **Callbacks Ankorstore en attente** — `mysql beliandjolie -e "SELECT status, type, COUNT(*) FROM AnkorstoreOperation WHERE status='PENDING' GROUP BY status, type;"`. Si > 0 → prévenir. Un callback perdu = ré-cliquer sur « Publier » côté BJ pour relancer.
4. **Ankorstore catalog / imports en cours** — grep bref des dernières 60 s de logs (`tail -200 /root/.pm2/logs/beliandjolie-out.log | grep -E "Ankorstore Catalog|Chargement|Import|Preview job"`). Si activité récente → attendre.
5. **Traductions / mails** — `mysql beliandjolie -e "SELECT status, COUNT(*) FROM TranslationJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status; SELECT status, COUNT(*) FROM EmailQueueJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status;"`. Si > 0 → prévenir.

Une fois **tout** confirmé calme (ou go explicite de la cliente), on enchaîne backup + deploy. Après restart, refaire le SELECT MarketplaceRefreshJob pour vérifier qu'aucun job n'est resté bloqué en IN_PROGRESS (le startup sweep du worker les marque FAILED, mais un race condition rare peut en laisser un — nettoyer manuellement si besoin).

**Backup avant push prod (obligatoire, sans demander)** — dans `/root/backups/pre-push-YYYYMMDD-HHMMSS/` :
1. `mkdir -p` du dossier horodaté.
2. `mysqldump --single-transaction --routines --triggers --events --databases beliandjolie | gzip > db-beliandjolie.sql.gz` (~10 Mo, contient les 2 tenants).
3. `git rev-parse HEAD > git-head.txt` (pour rollback via `git reset --hard <sha>`).
4. `git archive --format=tar HEAD | gzip > code-git-head.tar.gz` (snapshot code sans historique).
5. `cp .env → .env.backup ; chmod 600` (secrets et clés Stripe/PFS/Ankor).
6. `cp -al public/uploads → uploads-public` + `cp -al private/uploads → uploads-private` (hardlinks : quasi 0 disque, restauration complète possible même après suppression).
Restauration : `zcat db-beliandjolie.sql.gz | mysql`, `cd /var/www/beliandjolie && git reset --hard $(cat …/git-head.txt)`, `cp .env.backup /var/www/beliandjolie/.env`. Garder au moins 7 jours.

**Exception Ankorstore** : push direct prod (callbacks async ne hittent pas localhost).

Confirmation **uniquement** avant : suppression données, drop tables, push --force, secrets.

### Maquette avant tout design
Dès qu'une demande touche au visuel (couleurs, mise en page, composants, refonte écran, hero, sidebar…) :
1. HTML autonome dans `C:/Users/Admin/Downloads/` (Tailwind CDN, aucune dépendance repo).
2. Ouvrir dans navigateur.
3. Ajuster jusqu'à validation.
4. Appliquer au vrai code.

Sauter si elle dit « pas besoin de maquette » ou changement trivial (renommer libellé, faute, padding chiffré).

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
- **`*SyncRequired`** : posé par `updateProduct` (champ clé modifié) et worker images (`lib/image-queue.ts`). Reset par flows sync réussis ou `clearSyncRequiredFlag()`. Badge orange « Synchro nécessaire » dans `MarketplaceStatusButtons` + `AdminProductsTable`. Priorité visuelle : loading > syncRequired > online > offline.
- **Kill switch Ankorstore** : `getCachedAnkorstoreEnabled()`. PFS toujours actif si configuré.
- **Modale save** : case par marketplace si produit complet + configurée → enqueue `MarketplaceRefreshWidget`.
- **Publish vs Update** : `*UpdateProductInPlace()` si ID connu (PATCH + diff snapshot), sinon `*PublishProduct()`. Fallback publish si update échoue.
- **Diff snapshot** (`pfsLastSyncSnapshot` Json?) : envoie que le delta. Reset `Prisma.DbNull` quand `pfsProductId` change. `null` = sync complète.
- **Resync forcé** (↻) : `forceFullSync: true`, ne touche pas l'ID.
- **Best Seller PFS** : au save, STAR/REMOVE_STAR seulement si changé.
- **Annexes PFS** : LIVE `lib/pfs-annexes.ts` (cache 60min, tag `pfs-annexes`).
- **Proxy images marketplace** : `/api/marketplace-image?path=…` upscale à 500px si source < 500px (Ankorstore ≥ 500). Fichiers d'origine intacts. Pas pour PFS.
- **Delete** : PFS = local-only. Ankorstore = auto callback via `ankorstoreKickoffStandaloneDelete()`.
- **Modale de liaison — intents « créer / supprimer / importer »** (2026-07-28) : `LinkMarketplaceModal` (composant unifié PFS/Ankor/eFa/Faire) accepte 3 intentions transmises via `LinkIntents` :
  - `colorsToCreate` : couleurs BJ orphelines (pas de variante marketplace équivalente) que l'admin choisit explicitement de **créer chez le marketplace avec upload de la photo**. Bouton « ➕ Créer cette couleur » à côté du `VariantPicker` de l'étape 3 (grisé si pas de photo côté boutique).
  - `orphansToDelete` : variantes marketplace orphelines à **supprimer chez le marketplace**.
  - `orphansToImport` : variantes marketplace orphelines à **importer en tant que ProductColor BJ + lier**. Passe par `createLocalVariantFrom{Mkt}Variant()` (une par marketplace, cf. `app/actions/admin/{efashion,ankorstore,pfs,faire}.ts`) — trouve/crée la Color, choisit la Size TU, calcule le prix/poids, crée la ProductColor UNIT avec `{mkt}VariantId` posé.
  - **Anti-doublon** : chaque `createLocalVariantFrom{Mkt}Variant()` vérifie d'abord si le produit BJ a déjà une ProductColor UNIT sur cette Color. Si oui et qu'elle est non-liée → on la RELIE (update `{mkt}VariantId`), pas de doublon. Si oui mais déjà liée à une AUTRE variante marketplace → erreur retournée. Sinon on crée la ProductColor. L'UI étape 4 ajoute une hint 💡 quand elle détecte le cas pour inviter l'admin à revenir à l'étape 3 lier au lieu d'importer.
  - **Validation dure UI** : chaque variante marketplace non-mappée DOIT être soit dans `orphansToDelete` soit dans `orphansToImport`. Le bouton « Valider » est bloqué tant qu'il reste une orpheline « à trancher » (compteur affiché dans le CTA).
  - Serveur : chaque `link{Mkt}ProductManually` accepte `intents?` en dernier arg. Ordre d'exécution : (1) delete des orphelines marquées, (2) transaction link, (3) import des orphelines marquées (a besoin du `{mkt}ProductId` posé par le link), (4) sync post-liaison `updateProductInPlace({forceFullSync:true})`.
  - Suppression variante isolée par marketplace : **PFS** `pfsDeleteVariant()`, **eFashion** `efashionDeleteShootingProduct()` (hard delete), **Faire** `DELETE /products/{id}/variants/{vid}`, **Ankorstore** = pas d'endpoint direct → géré par le kickoff overwrite qui écrase l'état.
  - Auto-création côté marketplace : réutilise la logique existante de forceFullSync (PFS `variantsToCreate`, eFashion `duplicateWithNewColor`, Faire `variantsAdded diff`, Ankorstore = write our state override).
  - Garde-fou UI supplémentaire : refus si `orphansToDelete` couvre TOUTES les variantes marketplace ET aucune couleur BJ n'est mappée/à-créer (fiche marketplace se retrouverait vide).
  - Retour `LinkResult` étendu : `autoCreatedOnMarketplace` + `deletedOnMarketplace` + `importedFromMarketplace`, affichés dans le widget flottant Marketplaces après la job.

### Ankorstore callback-only
Toutes ops (publish/update/refresh/delete) **async** : kickoff → `operationId` → webhook `/api/webhooks/ankorstore`. **Aucun polling.**
- Table `AnkorstoreOperation`.
- `ANKORSTORE_WEBHOOK_SECRET` en query string du callback.
- **Dev local** : Ankorstore ne hitte pas localhost → PENDING. Tests prod uniquement.
- UI poll `/api/admin/ankorstore-operations` toutes les 3s.
- Callback perdu → re-cliquer « Publier » relance (annule anciennes PENDING).
- PATCH stock/prices restent synchrones.

### Refresh produit
Bouton « Rafraîchir » + bulk. Modale : boutique (bump `lastRefreshedAt`) + PFS + Ankorstore. Parallèle 5 max via `MarketplaceRefreshWidget`. `pfsRefreshProduct()` crée ref TEMP, archive l'ancien, renomme. Rollback auto.
« Nouveauté » = `max(createdAt, lastRefreshedAt) > now - 30j`.

### Vérification par code OTP (actions destructives)
Filet de sécurité contre les bugs de propagation marketplace : toute suppression, rafraîchissement marketplace ou archivage passe par `<OtpConfirmDialog>` → code 6 chiffres envoyé sur la boîte pro (`smtp_from_email`, forwardée sur le mail perso).
- Table Prisma : `AdminActionOtp` (id, adminId, action, productIds JSON, codeHash, expiresAt, attempts, usedAt). TTL 15 min, 5 tentatives max.
- Lib : `lib/admin-action-otp.ts` (`createOtpForAction`, `verifyAndConsumeOtp`, `guardAdminActionOtp`, `isOtpPauseActive`, `applyPauseChoice`).
- Server actions : `requestAdminActionOtp`, `verifyAdminActionOtpForRefresh`, `setAdminActionOtpPause` (`app/actions/admin/admin-action-otp.ts`). `bulkDeleteProducts` + `bulkUpdateProductStatus(ARCHIVED)` acceptent `otpCheck?` en 2ᵉ/3ᵉ arg et appellent `guardAdminActionOtp` en début.
- Refresh (bulk et unitaire) : vérif client-side dans `useRefreshMarketplaceDialog.requireOtpForRefresh` (bypass silencieux si options local-only sans marketplace ciblée).
- Pause : menu déroulant dans la modale, options 15min/1h/24h. Stockée `SiteConfig[admin_action_otp_pause_until]` (timestamp ms). Bypass silencieux tant qu'active. Défaut = « Toujours prévenir ».
- Provider `<OtpConfirmProvider>` monté globalement dans `app/layout.tsx`.

### Marketplace pricing
SiteConfig : 3 types (`percent`/`fixed`/`multiplier`), 3 arrondis (`none`/`up`/`down`). Clés : `{marketplace}_price_markup_{type|value|rounding}`. **PACK** : markup sur prix unitaire (total÷qty), arrondi, ×qty. Jamais sur le total.
- **Retail = markup appliqué sur le WHOLESALE déjà majoré et arrondi** (pas sur le basePrice BJ). Convention métier confirmée juillet 2026 (bug U02 Faire) — la cliente dit « ×3 sur le prix de gros » et ça doit donner ×3 sur le wholesale, pas ×3 sur son prix d'achat interne. Faire : `applyFaireMarkupWithClamp` (lib/marketplace-pricing-shared.ts). Ankorstore : `getAnkorstoreChainedRetailPrice` (lib/ankorstore-pricing.ts).
- **Arrondi passe TOUJOURS par les centimes entiers** (`Math.round(price*100)`) AVANT le `Math.ceil/floor` au dixième, sinon `4.2 * 3 = 12.600000000000001` en IEEE-754 fait dériver le retail d'un cran (12,60 → 12,70). Fix dans `applyMarketplaceMarkup`, ne pas le retirer.

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
**Tailwind v4** — theme dans `app/globals.css` `@theme {}`, pas de config JS. **Pas de dark mode**. Flat design + ombres subtiles. Utilities standard.

#### Style espace pro / public (obligatoire hors `/admin`)
Réf : `app/[locale]/(client)/commandes/page.tsx` + `components/client/orders/OrdersTableClient.tsx` (2026-07-17, validé par la cliente).
- **Palette ardoise** uniquement — variables `bg-*`, `text-*`, `border-*` de `globals.css` @theme. **Interdit** : warm/or/beige/aurora doré, tons chauds décoratifs. Les couleurs sémantiques (`success/warning/error/info`) restent réservées aux statuts, alertes et compteurs KPI — jamais en décoration principale.
- **Couleurs des initiales marketplaces** (rond avec la lettre P/A/E/F/Fai/M) — figées, réutiliser à l'identique partout où on affiche une initiale marketplace :
  - **PFS** (P) : `linear-gradient(135deg,#4f46e5,#6366f1)` (indigo/violet)
  - **Ankorstore** (A) : `linear-gradient(135deg,#0ea5e9,#38bdf8)` (sky)
  - **eFashion Paris** (E) : `linear-gradient(135deg,#db2777,#ec4899)` (rose/pink)
  - **Faire** (F) : `linear-gradient(135deg,#f59e0b,#fbbf24)` (amber)
  - **Microstore** (M) : `linear-gradient(135deg,#0891b2,#22d3ee)` (cyan)
  - **Boutique** (B&J) : `linear-gradient(135deg,#64748b,#334155)` (slate)
  Ces gradients servent **exclusivement** à colorer le rond d'initiale. Interdit en halo, aurora, bandeau, bordure de carte ou CTA — le reste de l'UI reste ardoise.
- **Police sans-serif** partout : body `var(--font-roboto)`, titres `var(--font-poppins)` via `font-heading`. **Interdit** : police à empattements (Cormorant Garamond, Playfair, serif, etc.).
- **Cartes** : `bg-bg-primary border border-border rounded-2xl shadow-sm`. Sur-titre eyebrow uppercase `tracking-[0.2em] text-text-muted`.
- **KPI tiles** : mêmes cartes, valeur en `font-heading text-3xl font-bold`. Couleur sémantique (success/warning/info) uniquement si compteur d'état, sinon `text-text-primary`.
- **CTA principal** : `bg-bg-dark text-text-inverse` (jamais un accent coloré).
- **Timeline / progression** : `bg-bg-secondary rounded-2xl`, pastilles `bg-text-primary` (active) / `bg-text-secondary` (done) / `bg-bg-tertiary border-dashed` (todo).
- Cette règle vaut pour toute maquette autonome (`Downloads/*.html`) **et** toute nouvelle page hors admin.

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
Toutes les tâches longues admin (traduction, synchro marketplaces, images, shooting eFashion, chat) passent par un **widget flottant unique** en bas à droite (refonte validée 2026-07-13, remplace l'ancien rail latéral). **Grammaire visuelle responsive :**

| Breakpoint | Widget | Tiroir |
|-----------|--------|--------|
| `≥ md` (768+) | FAB noir 56 px en bas à droite → clic déploie 5 mini-boutons colorés empilés vers le haut | Panneau flottant 400 × 620 px ancré au-dessus du FAB (`bottom-24 right-6`) |
| `< md` (< 768) | FAB en bas à droite avec halo pulsant | Plein écran, header sticky avec flèche back |

- **Palette par widget** : violet=Traduction, sky=Marketplaces, emerald=Images, amber=Shooting eFashion, rose=Chat.
- **Un seul tiroir ouvert** à la fois (`useRightRail()` context).
- **Badge cumul** sur le FAB fermé = somme des files ; halo `animate-ping` autour du FAB si au moins une file signale `pulse:true`.
- **Badge par mini-bouton** = compteur individuel, fond blanc avec ring coloré.
- **Backdrop léger + blur** derrière le mini-menu ouvert (clic ou ESC ferme). **Aucun backdrop** derrière un tiroir (page cliquable pendant qu'une tâche tourne).
- **Tooltip stylisé** au survol du mini-bouton (fond `bg-slate-900`, portalé dans `document.body`).
- **Structure de tiroir uniforme** via `DrawerShell` : header aurora coloré (dégradé foncé + halo flou, texte blanc) + eyebrow uppercase + titre + icône + zone scrollable + footer optionnel.
- **Sections pliables** pour listes longues (marketplaces) : Erreurs + En cours ouvertes par défaut, En attente + Terminés repliées (`<details open>`).
- **Chat** : géré par `AdminChatWidget.tsx` (composant séparé, branché sur `useRightRail().openWidget === "chat"`). Monté uniquement dans `/admin`.
- **Layout admin** : le wrapper `#admin-theme-wrapper` a un `pb-24` pour ne pas cacher le contenu bas de page derrière le FAB, mais **pas** de `pr-*` — la largeur est intégrale.

### Enums Prisma
- `ProductStatus` : OFFLINE|ONLINE|ARCHIVED|SYNCING
- `SaleType` : UNIT|PACK
- `OrderStatus` : PENDING|SHIPPED|CANCELLED (PENDING = « Nouveau » admin / « En attente » client, seule transition = PENDING→SHIPPED, annulation depuis PENDING)
- `UserRole` : ADMIN|CLIENT
- `UserStatus` : PENDING|APPROVED|REJECTED

### Multi-tenant (déployé en prod depuis 2026-07-12)
Prod sert 2 boutiques depuis 1 seul Next.js/PM2/DB : **beliandjolie.com** (tenant `beliandjolie`) + **issyma.fr** (tenant `issyma`, shopName "FORCYMA"). L'ancien install `/var/www/issyma` et `/var/www/demo` sont supprimés.

**Résolution tenant** — Middleware lit `Host:` → mappe via `TenantDomain` → pose `x-tenant-id/slug/name` en headers. `lib/tenant.ts::getCurrentTenant()` + ALS `lib/tenant-als.ts` propagent au reste. Extension Prisma `lib/prisma-tenant-scope.ts` scope auto sur ~60 modèles.

**Écrire SiteConfig** — `setSiteConfig(key, value)` / `unsetSiteConfig(key)` (helpers `lib/site-config-write.ts`). **Ne jamais** `prisma.siteConfig.upsert({where:{key}})` — PK composite `(tenantId, key)`.

**Lire SiteConfig par clé** — `findFirst({where:{key}})`, PAS `findUnique({where:{key}})`.

**Autres tables composite** — `Product.reference`, `Order.orderNumber`, `User.email/siret/stripeCustomerId`, `Product.pfsProductId/ankorsProductId/faireProductId` — utiliser `findFirst({where:{X:...}})` au lieu de `findUnique`. L'extension injecte `tenantId` en `AND`. Sur `Category/SubCategory/Color/Size/Composition/Season/ManufacturingCountry/Tag` idem (@@unique composite depuis 2026-07-13).

**Uploads** — Convention `/uploads/{tenantSlug}/…` (ex: `/uploads/beliandjolie/produits/…`, `/uploads/issyma/produits/…`). Aucune legacy sans prefix. Passer `tenant.slug` en 2ᵉ arg des helpers `productImageDir`, `collectionImageDir`, `bannerDir`, `faviconDir`, `colorPatternDir`, `chatAttachmentDir`, `bordereauDir`, `kbisDir`, `clientDocumentsDir`, `invoiceDir`, `claimDir`, `creditNoteDir`, `emailAttachmentDir`, `renameProductFolder`, `renameCollectionFolder`. Récup via `const tenant = await requireCurrentTenant()`.

**Fire-and-forget** (jobs background hors headers) — Capturer le tenantId côté handler HTTP AVANT l'IIFE, puis wrap dans `tenantALS.run(tenantId, async () => …)`. Sans ça, l'extension retombe en passthrough → fuite marketplace (push BJ atterrit sur compte Issyma). Workers déjà wrappés : `marketplace-queue-worker.processJob`, `translation-queue.processJob`, `efashion-shooting-batch` server action.

**Caches auth marketplaces** — PFS/Ankor/eFashion/Faire/Stripe : **cache PAR tenant** (`Map<tenantId, TokenCache>`). Sinon token du 1er tenant réutilisé partout → catastrophe. Voir `lib/pfs-auth.ts`, `lib/ankorstore-auth.ts`, `lib/efashion-client.ts` (cookie jar), `lib/efashion-auth.ts` (lastLoginAt), `lib/faire-auth.ts` (primedApiKey), `lib/stripe.ts` (instance par clé).

**Caches SiteConfig** — Utiliser `tenantScopedCacheWithTid` (lib/cached-data.ts) qui résout tid via ALS + fallback `headers()`. Le tid doit être **capturé AU CALLSITE** et passé au callback via closure — l'ALS n'est PAS visible dans les callbacks `unstable_cache` (Next 16 parallel rendering). Idem `getCachedSeoConfig` (lib/seo.ts).

**Sitemap / robots / favicon / manifest** — Utiliser le `Host:` header courant comme baseUrl (pas `NEXTAUTH_URL` hardcodée BJ). `app/sitemap.ts`, `app/robots.ts`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/manifest.ts` bindent l'ALS via `await getCurrentTenantId()` en tête.

**Scripts CLI** — Hors requête, extension passthrough. Passer `tenantId` explicitement pour scope, sinon reads globaux. Ex: `MULTI_TENANT_SCOPE=off npx tsx scripts/backfill-tenant-id-all.ts`.

**Onboarding wizard** — Chaque nouveau tenant a son propre onboarding. Le middleware redirige les admins non-onboardés vers `/admin/bienvenue`.

**Chantier futur** — `AccountLockout.email` et `Claim.reference` gardent leur `@unique` global (à basculer en composite si collisions inter-tenants deviennent possibles).

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
- Pas de dark mode : vars CSS (`bg-bg-primary`, `text-text-primary`, `border-border`).
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
- **Stripe (env-only)** : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- **Email** : `SMTP_*` retirés des `.env` depuis 2026-07-13 — chaque tenant a sa **propre config SMTP en BDD** (SiteConfig chiffré). Envoi via serveur mail interne Postfix/Dovecot sur `mail.beliandjolie.com:587`. Boîtes `contact@beliandjolie.com` et `contact@issyma.fr` avec quota 5 Go/boîte. `provisionShopMailbox()` (app/actions/admin/mailbox-provision.ts) sait créer une boîte + config auto pour un **nouveau tenant** — **nécessite `scripts/deploy/add-mail-domain.sh` (à créer, cf. TODO ci-dessous)**. Roundcube webmail à `https://mail.beliandjolie.com` (accessible via lien « Messagerie » dans admin sidebar Système). **Patchs Roundcube VPS (hors repo, à ré-appliquer après `apt upgrade roundcube-core`)** : (1) `/etc/roundcube/config.inc.php` — `ini_set('session.cookie_lifetime', 2592000)` en tête + `$config['session_lifetime']=43200` + `$config['login_autocomplete']=2` (30 jours + auto-remplissage navigateur) ; (2) `/usr/share/roundcube/program/lib/Roundcube/rcube.php` ligne 478 — remplacer `ini_set('session.cookie_lifetime', 0)` par `ini_set('session.cookie_lifetime', $lifetime ?: 0)` (sinon Roundcube overwrite à 0) ; (3) `/var/lib/roundcube/public_html/skins/elastic/templates/login.html` — script JS qui lit `?_user=` dans l'URL et pré-remplit `rcmloginuser`. Backups `.bak.YYYYMMDD-HHMMSS` à côté de chaque fichier. Le page admin `/admin/messagerie` passe `smtp_from_email` du tenant courant en `?_user=` à l'iframe.
- **Ankorstore webhook** : `ANKORSTORE_WEBHOOK_SECRET`.
- **Via UI (chiffrés BDD)** : clé Easy-Express, identifiants PFS (email + mdp — réutilisés pour traduction auto).

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
