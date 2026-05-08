# CLAUDE.md

Guide de Claude Code pour ce dépôt.

## À qui tu parles

La personne qui te parle **n'est pas développeuse, pas informaticienne** — elle dirige le projet. Parle-lui comme à un client qui veut savoir ce qui a changé sur son site, pas comme à un collègue technicien :
- **Pas de jargon** ("fonction", "endpoint", "cache", "revalidate", "schema", "SSR"…). Si obligé, explique le mot en une phrase de tous les jours.
- **Dis ce qui change pour elle et ses clients** quand ils utilisent le site (ex : *« Maintenant, quand vous cliquez sur Exporter, le fichier Excel contient aussi les prix de détail. »*), pas ce que tu as touché dans le code.
- **Court, en français simple.** Pas de grosses listes à puces techniques.
- **Tests proposés = trajets dans le site** (*« Ouvrez l'admin, allez dans Produits, cliquez sur… »*) — jamais de commandes terminal.
- **Détails techniques** (noms de fichiers, lignes de code) restent entre toi et le code.

> **Architecture** `docs/architecture.md` · **PFS Sync** `docs/pfs-system.md` · **Styling** `docs/styling.md` · **API PFS** `docs/pfs-api.md`

---

## Architecture

B2B SaaS e-commerce générique (vente en gros, tout type de produit). Stack : **Next.js 16 App Router · MySQL (Prisma) · Tailwind v4 · TypeScript**. Chaque client peut déployer sa propre instance.

### Route groups (`app/`)

| Group | URL pattern | Access |
|-------|-------------|--------|
| `(auth)` | `/connexion`, `/inscription` | Unauthenticated only |
| `(admin)` | `/admin/*` | ADMIN role |
| `(client)` | `/espace-pro/*`, `/panier/*`, `/commandes/*`, `/favoris` | CLIENT (APPROVED) |
| *(direct)* | `/produits/*`, `/collections/*`, `/categories` | Public — visiteurs anonymes inclus, mais prix masqués tant que la session n'est pas APPROVED |

Protection : `middleware.ts` (edge) + group `layout.tsx` (server fallback). Middleware gère aussi la maintenance (60s module-level cache **only on success** — errors are not cached so a transient fetch failure at app startup doesn't lock the site in maintenance for 1 minute) et la preview admin (`bj_admin_preview=1` cookie).

**Visibilité des prix** (depuis mai 2026) : système de code d'accès invité (`bj_access_code`, modèle `AccessCode`, page `/admin/codes-acces`) supprimé. Tout le monde peut consulter le site, mais tarifs et boutons d'achat masqués tant que la session n'est pas ADMIN ou CLIENT APPROVED. Logique centralisée dans `lib/price-visibility.ts` (`canSeePrices(session)`).
- **API publique** (`/api/products`, `/api/products/search`, `/api/products/[id]/live`) : `unitPrice` et `discountPercent` remis à 0/null avant la réponse JSON quand le visiteur n'a pas le droit ; filtres `minPrice/maxPrice` ignorés (anti-recherche par dichotomie).
- **UI** : `ProductCard`, `ProductDetail`, `ProductCarousel`, `FeaturedProduct` affichent « Connectez-vous pour voir les prix » + bouton « Créer un compte pour commander » à la place du bloc tarif/qty/CTA.

### Key layers

- **Server actions** (`app/actions/admin/`, `app/actions/client/`) — toutes les mutations. `requireAdmin()` / `requireAuth()` obligatoire.
- **API routes** (`app/api/`) — webhooks (Stripe, heartbeat), SSE streams, file-serving, marketplace Excel export.
- **Lib** (`lib/`) — business logic : `marketplace-excel/` (PFS Excel generators), `pfs-api.ts` / `pfs-api-write.ts` (read + delete), `stripe.ts`, `easy-express.ts`, `email.ts` (SMTP via nodemailer — `sendMail()` unique point d'envoi), `notifications.ts` (emails transactionnels), `cached-data.ts`, `security.ts`, `image-processor.ts`, `storage.ts` (local filesystem image storage under `/public`).
- **Components** — `components/admin/` (backoffice), `components/client/` (espace-pro), `components/ui/` (shared primitives), `components/home/` (landing page).
- **Note Ankorstore** : intégration en pause (mai 2026) — code et paramètres retirés. Doc API conservée dans `docs/ankorstore-api.md` pour réactivation future.

### Observability & Data flow

- **`lib/logger.ts`** — structured logger (JSON en prod, lisible en dev). Utiliser `logger.info/warn/error()` au lieu de `console.*`.
- **`lib/env.ts`** — Zod validation des env vars au startup, importé dans le root layout. Ajouter les nouvelles vars requises ici.
- Prisma ORM → Server Actions + API routes. Cache via `unstable_cache` dans `lib/cached-data.ts`. Invalidation : `revalidateTag(tag, "default")` (2 args obligatoires Next 16). Server actions return `{ success: boolean, error?: string }` consistently.

### Product model

`Product` → `ProductColor[]` (variantes UNIT ou PACK) → images, sizes, pack color lines. **Une variante = une couleur** (plus de sous-couleurs/composition). Pricing : UNIT = `unitPrice` direct, PACK = calculé via `computeTotalPrice()`. Pour les **packs multi-couleurs** (ex : pack tricolore), composition dans `PackColorLine[]` + `PackColorLineSize[]` (1 ligne par couleur du pack avec ses tailles/quantités). Le `Color.name` (bibliothèque) doit correspondre exactement à ce que PFS attend pour l'export Excel.

### Marketplace publishing via API live (PFS uniquement)

Create / update sur PFS = **direct via les API**. Plus d'export Excel manuel.

**Identifiants stockés** : `Product.pfsProductId` + `ProductColor.pfsVariantId`. Renseignés à l'import PFS et à chaque publish/refresh. `null` = produit pas encore publié → badge gris « Non publié ».

**Modale au save produit** : à chaque `Enregistrer` du formulaire produit (création OU édition), si produit complet et PFS configuré, modale avec case à cocher PFS. Si cochée → enqueue `PfsRefreshWidget` avec `mode: "publish"`.

**Server action** `app/actions/admin/marketplace-publish.ts` → `publishProductToMarketplaces(productId, { pfs })` :
- Si `pfsProductId` connu → `pfsUpdateProductInPlace()` (mise à jour PATCH)
- Sinon → `pfsPublishProduct()` (première création)
- Fallback : si l'update PFS échoue (ID stale), on retombe sur publish

**Fichiers clés** :
- `lib/pfs-publish.ts` — première publication PFS (sans swap d'ancien produit)
- `lib/pfs-refresh.ts` — renouvellement (création + soft-delete + remplacement IDs)
- `lib/pfs-update.ts` — mise à jour PATCH d'un produit déjà publié (utilise le diff de snapshot, voir ci-dessous)
- `lib/pfs-sync-diff.ts` — types + `diffSnapshots()` qui compare l'instantané précédent à l'état cible
- `app/actions/admin/marketplace-publish.ts` + `marketplace-refresh.ts` + `marketplace-resync.ts`
- `app/api/admin/marketplace-publish/route.ts` + `marketplace-refresh/route.ts` + `marketplace-resync/route.ts`
- `components/admin/products/PfsRefreshContext.tsx` — queue partagée publish/refresh/resync, dispatch via `mode: "publish" | "refresh" | "resync"`

**Diff de sync (optimisation update)** : `Product.pfsLastSyncSnapshot` (Json?) stocke l'état envoyé à la dernière sync réussie : product fields, defaultColor, variants (price/stock/weight/isActive par pfsVariantId), images (path par colorRef/slot), status, **isBestSeller**. À chaque appel de `pfsUpdateProductInPlace`, on construit le snapshot cible, on diff vs `pfsLastSyncSnapshot`, et on n'envoie à PFS que ce qui a changé : skip `pfsTranslate`+`pfsUpdateProduct` si product fields identiques, patch seulement les variantes modifiées, upload seulement les slots d'image dont le path a changé, skip `pfsUpdateStatus` si statut inchangé, **skip STAR/REMOVE_STAR si isBestSeller inchangé**. Le snapshot est sauvé en fin de sync (sections réussies seulement). Reset à `Prisma.DbNull` quand `pfsProductId` change (publish, refresh, fallback). Si `pfsLastSyncSnapshot` est null → sync complète (comme avant), puis snapshot initial sauvé.

**Resynchro forcée** : icône reload (↻) à côté du badge vert « Paris Fashion Shop » sur la page de modification produit (`MarketplaceStatusButtons`, visible uniquement quand `pfsProductId` existe). Au clic + confirmation, enqueue dans `PfsRefreshContext` avec `mode: "resync"` → API `POST /api/admin/marketplace-resync` → server action `resyncProductOnPfs` → `pfsUpdateProductInPlace(id, undefined, { skipRevalidation: true, forceFullSync: true })`. L'option `forceFullSync` traite localement `pfsLastSyncSnapshot` comme `null` → diff complet → toutes les sections (champs produit, variantes, images, statut, STAR/REMOVE_STAR) sont renvoyées à PFS. Le `pfsProductId` n'est **pas** modifié, le snapshot est mis à jour en fin de sync réussie. `committedSnapshot` est initialisé sur le **vrai** snapshot précédent (même en mode force) pour préserver l'état connu en cas de crash partiel. Pas de fallback automatique sur publish en cas d'échec : on retourne l'erreur (l'utilisatrice peut alors lancer un « Rafraîchir » manuel qui sait recréer).

**Best Seller PFS** : la case « Best Seller » du formulaire produit est un champ comme les autres — son changement n'est appliqué qu'au save (plus de toggle instantané). À l'enregistrement, si la case est cochée et a changé depuis la dernière sync, on appelle `pfsUpdateStatus([{id, status: "STAR"}])` (`lib/pfs-api-write.ts:pfsUpdateStatus`). Si décochée et qu'elle a changé, on appelle `pfsRemoveStar(pfsProductId)` qui tape l'endpoint single body-less `PATCH /catalog/products/{id}/updateStatus/REMOVE_STAR`. Pareil sur publish initial (`lib/pfs-publish.ts`) et refresh (`lib/pfs-refresh.ts`) : si `isBestSeller=true` et statut cible ≠ ARCHIVED, on pose STAR juste après le `pfsUpdateStatus` final. La server action `toggleBestSeller` dans `app/actions/admin/products.ts` reste exposée (utilisée par les tests d'intégration) mais n'est plus appelée par l'UI.

**Annexes PFS** : alimentées en LIVE via `lib/pfs-annexes.ts` (cache `unstable_cache` 60min, tag `pfs-annexes`) qui appelle `pfsGetGenders/Families/Categories/Colors/Compositions/Countries/Sizes/Collections`. Plus de parsing du template Excel.

**Delete** est 100 % local : `deleteProduct(id)` et `bulkDeleteProducts(ids)` ne touchent pas aux marketplaces.

**Famille PFS** : stockée dans `Category.pfsFamilyName` (renseignée manuellement dans l'UI catégorie). `pfsCategoryId`/`pfsGender`/`pfsFamilyId` (IDs Salesforce) conservés pour référence.

### Refresh produit (`lib/pfs-refresh.ts` + `app/actions/admin/marketplace-refresh.ts`)

Bouton « Rafraîchir » dans `/admin/produits` (par ligne + bulk) et sur la page `/modifier`. Modale avec cases à cocher : **boutique** (bump `Product.lastRefreshedAt`, jamais `createdAt`) + **PFS** (re-push live via API, remplace `pfsProductId` + `pfsVariantId` après création nouveau).

Traitement en arrière-plan via `PfsRefreshProvider` (monté dans `app/(admin)/layout.tsx`) + `PfsRefreshWidget` (popup bas-droite, minimisable, fermable uniquement quand tous les produits sont terminés). Items traités séquentiellement.

`pfsRefreshProduct()` : `pfsCheckReference(ref)` → si inexistant = erreur « Produit inexistant sur PFS » ; sinon crée nouveau produit avec ref TEMP aléatoire, upload images locales→JPEG, renomme l'ancien en ref aléatoire + statut `DELETED`, renomme le nouveau avec la vraie ref, passe en `READY_FOR_SALE` (ou `ARCHIVED` si stock 0 sur toutes variantes). Rollback automatique en cas d'échec mi-parcours.

« Nouveauté » frontend = `max(createdAt, lastRefreshedAt) > now - 30j` (filter + orderBy compound sur `/produits`, `/api/products`, home carousel, favoris, ProductsInfiniteScroll).

### Marketplace pricing (`lib/marketplace-pricing.ts`)

Markup configurable par marketplace via SiteConfig keys. **3 types** : `percent` (+X%), `fixed` (+X€), `multiplier` (×X). **3 arrondis** : `none`, `up` (ceil 0.1€), `down` (floor 0.1€). Pattern clés : `{marketplace}_markup_{type|value|rounding}` — ex : `pfs_price_markup_type/value/rounding`. **PACK** : markup s'applique au prix unitaire (`unitPrice / packQuantity`), arrondi, puis × packQuantity. Jamais markup sur le total directement.

### Auth

NextAuth v4, Credentials + JWT (30d). New users = `PENDING` → admin approves. Token carries `id`, `role`, `status`, `company` (`lib/auth.ts`). Types : `types/next-auth.d.ts`.

### i18n

**Routing par préfixe d'URL** (next-intl 4.x). Chaque page publique vit sous `app/[locale]/...` et est servie sur `/{locale}/...` (ex : `/fr/produits/123`, `/en/produits/123`). Locales : fr (défaut), en, de, es, it, ar (RTL), zh. Messages : `messages/[locale].json`. Auto-translations : DeepL Free (500K chars/mois). Toggle : `auto_translate_enabled` dans SiteConfig.

**DeepL retry** : `lib/translate.ts` expose `translateWithRetry()` (5 essais, backoff exponentiel 1s→16s, `delayFn` injectable pour les tests) et `translateTextStrict()` qui retourne **`null`** quand DeepL plante après retry — au lieu de retourner le texte FR d'origine. `auto-translate.ts` utilise `translateTextStrict` et **ne fait pas d'upsert** quand null : l'icône d'alerte ⚠ existante reste visible côté UI. `translateToAllLocales()` omet les locales qui échouent (pas de fallback FR pour ne pas masquer les manquants). `translateText()` reste comme wrapper compat (retombe sur le texte d'origine) pour les usages product description.

**Mapping PFS pays/composition** (depuis nov. 2026) : le scan d'import (`lib/pfs-import.ts`) stocke et recherche les pays/compositions par leur **libellé FR** (ex : `pfsCountryRef = "Chine"`, `pfsCompositionRef = "Polyester"`) — pareil que les saisons. Cohérent avec `pfsAnnexes.countries/compositions` au CustomSelect. Côté publication PFS (`lib/pfs-publish.ts`, `pfs-refresh.ts`, `pfs-update.ts`), `country_of_manufacture` envoyé à PFS suit la priorité **`isoCode → pfsCountryRef → "CN"`** (PFS attend un code ISO).

- **Config** : `i18n/routing.ts` (`localePrefix: "always"`, `localeDetection: false`), `i18n/navigation.ts` exporte `Link`, `redirect`, `useRouter`, `usePathname` localisés
- **Request** : `i18n/request.ts` lit la locale depuis `requestLocale` (params URL). Plus de cookie `bj_locale`
- **Routes hors i18n** (sans préfixe locale) : `/admin/*`, `/api/*`, `/maintenance`, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/icon`, `/apple-icon`
- **Middleware** : combine next-intl (préfixe + redirection 307 des URLs legacy `/produits` → `/fr/produits`) avec la logique d'auth (admin, client, pending, codes accès, maintenance). Applique la logique sur le pathname « sans locale » (helper `stripLocale`)
- **Layouts** : `app/layout.tsx` (root) reste tel quel — `getLocale()` fonctionne via `requestLocale` (fallback `fr` pour les routes admin). `app/[locale]/layout.tsx` appelle `setRequestLocale(locale)` + `notFound()` si locale invalide
- **Liens admin → public** : hardcoder `/fr/...` (admin n'a pas de locale courante)
- **Sitemap** : génère 7× chaque URL (1 par locale) avec `alternates.languages` (hreflang)
- **`buildAlternates(path, locale)` de `lib/seo.ts`** : émet canonical (URL préfixée par locale courante) + hreflang `x-default` (toujours fr) + 1 entrée par locale
- **Sélecteur de langue** : `LanguageSwitcher` utilise `router.replace(pathname, { locale })` (bascule sans recharger)

### Styling

**Tailwind CSS v4** — pas de `tailwind.config.js`. Theme tokens dans `app/globals.css` `@theme {}`. **Pas de dark mode**. Clean flat design avec ombres subtiles (`--shadow-card`, `--shadow-card-md`, `--shadow-card-lg`, `--shadow-sm`). **No claymorphism** — utiliser les utilities Tailwind standard (`shadow-sm`, `shadow-md`, `shadow-lg`).

### Key Prisma enums

`ProductStatus` (OFFLINE|ONLINE|ARCHIVED|SYNCING), `SaleType` (UNIT|PACK), `OrderStatus` (PENDING|SHIPPED|CANCELLED — workflow simplifié : PENDING libellé « Nouveau » côté admin et « En attente » côté client, seule transition admin = PENDING → SHIPPED, annulation possible uniquement depuis PENDING. Emails client : à la création (PENDING) et à l'expédition. Plus de PROCESSING ni DELIVERED), `UserRole` (ADMIN|CLIENT), `UserStatus` (PENDING|APPROVED|REJECTED), `ImportDraftStatus`, `ImportJobStatus`. Définitions complètes dans `prisma/schema.prisma`. (`PfsSyncStatus` / `PfsStagedStatus` et modèles `PfsSyncJob` / `PfsPrepareJob` / `PfsStagedProduct` / `PfsMapping` ont été retirés avec la bascule vers l'export Excel.)

`StripeWebhookEvent` model exists for webhook deduplication (idempotency check before processing).

---

## Règles de travail

- **Auto-maintenance CLAUDE.md** : mettre à jour après chaque tâche si nouvelle convention/endpoint/env var.
- **Parallélisation** : lancer des sous-agents en parallèle quand les sous-tâches sont indépendantes.
- **Résumé** : fournir un résumé des changements + guide de test à la fin de chaque tâche.
- **Récap demande** : à la toute fin de chaque réponse, ajouter une section **« Ce que vous m'avez demandé »** (1-3 phrases simples résumant la demande initiale).
- **Impact croisé** : avant d'exécuter une tâche, vérifier si elle peut impacter d'autres fonctionnalités/données/pages/comportements existants. Si oui, prévenir l'utilisatrice **avant** de toucher au code (zones concernées en français simple).
- **Suggestions d'amélioration** : si une idée/variante peut améliorer la tâche (UX, robustesse, simplicité, perf, cohérence), la proposer en plus de la demande initiale, en français simple. Elle décide.

### Workflow modification → validation → push

Quand l'utilisatrice demande **corriger / réparer / rendre fonctionnel / mettre à jour** quelque chose qui touche au site :

1. **Modifier en local uniquement** (`C:\Users\Admin\Desktop\beli-jolie\`). Pas de push automatique.
2. **À la fin**, l'informer que c'est prêt à tester côté local. Lister ce qui a changé pour elle/ses clients + un trajet de test dans le site.
3. **Attendre sa décision** après ses tests :
   - **« Mettre de côté »** → garder la modif locale en attendant qu'une autre soit prête, pour push tout en un coup plus tard.
   - **« Push en production »** → lancer la boucle complète :
     1. `git add` + `git commit` + `git push origin master`
     2. SSH VPS (`ssh root@72.61.106.128`) : `cd /var/www/beliandjolie && git fetch origin master && git reset --hard origin/master`
     3. `npm install --no-audit --no-fund` (seulement si dépendances modifiées) + `npx prisma generate && npx prisma db push --skip-generate` (seulement si schema modifié)
     4. `NODE_OPTIONS='--max-old-space-size=4096' npm run build`
     5. `pm2 restart beliandjolie`
     6. **Vérification « parcours visiteur »** : `curl -sL` sur `https://beliandjolie.com/` ou la route concernée, suivre les redirections, vérifier que le `<title>` final correspond à ce qui est attendu (page de connexion, page produit…) — **pas juste un endpoint interne**.
4. **L'informer à la fin dans tous les cas** (modif locale prête / mise de côté confirmée / déploiement terminé). Après un push prod, le code doit être strictement identique aux trois endroits (local, GitHub, VPS) — pareil pour les modifs serveur (nginx, swap, env).

Demander confirmation **uniquement** avant les actions vraiment risquées (suppression de données, drop de tables, push --force, secrets).

## Commandes

```bash
npm run dev / build / start / lint
npm run test / test:watch / test:coverage   # Vitest
npm run test:pfs-smoke                      # PFS smoke tests
npx prisma db push && npx prisma generate   # Après modif schema, redémarrer dev server d'abord
npx prisma studio
npx tsx scripts/create-admin.ts
```

### Testing

Vitest + dossier `__tests__/`. Integration tests dans `__tests__/integration/` (DB-backed, `fileParallelism: false`). PFS smoke tests dans `__tests__/pfs/`.

## Variables d'environnement

- **Obligatoires** : `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_KEY`
- **Stripe (env-only, mode simple)** : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — pas d'UI admin, plus de Stripe Connect.
- **Email (env var uniquement)** : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`. Le destinataire des notifs admin (inscriptions, nouvelles commandes, demandes de déblocage, messages, réclamations) est lu depuis **Admin > Paramètres > Société > Email** — plus de `NOTIFY_EMAIL`.
- **Configurables uniquement via paramètres admin** (chiffrés en BDD, plus de var d'env / fallback côté code) : clé Easy-Express, clé DeepL, identifiants PFS (email + mot de passe).

### Stripe (mode simple)

Une seule paire de clés en `.env` : `STRIPE_SECRET_KEY` (serveur), `STRIPE_WEBHOOK_SECRET` (signature webhook), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (frontend). Plus de Stripe Connect, plus de routes `/api/stripe/connect|disconnect|reset|callback`, plus d'UI admin Paiement, plus d'`application_fee_amount`. Helpers : `getStripeInstance()` / `getStripeWebhookSecret()` / `getStripePublishableKey()` / `isStripeConfigured()` dans `lib/stripe.ts`.

## Versions critiques

| Lib | Version | Contrainte |
|-----|---------|-----------|
| Next.js | 16.1.6 | `params` = `Promise` (await). `revalidateTag("tag", "default")` = 2 args |
| Prisma | 5.22.0 | PAS v7 (breaking changes) |
| NextAuth | v4 | PAS v5. JWT + Credentials |
| Zod | 4.3.6 | `.issues` PAS `.errors` |
| Tailwind | v4 | No config file. Theme in `globals.css` `@theme inline {}` |
| React | 19.2.3 | |

Autres : Stripe 20.4.1, Recharts, bcryptjs (12 rounds), pdfkit, exceljs, playwright, nodemailer 7.x (SMTP via `lib/email.ts`), DeepL (HTTP direct).
`serverExternalPackages: ["pdfkit", "sharp", "exceljs"]` dans `next.config.ts`. Path alias : `@/*` → `./*`.

## Gotchas critiques

### Rendering & UI Components
- **`ssr: false`** interdit dans Server Components → wrapper `"use client"`
- **`PublicSidebar.tsx`** = header public (PAS `Navbar.tsx`)
- **Badges** : toujours `badge badge-*` (success/warning/error/neutral/info/purple). Jamais inline
- **Dropdowns** : toujours `CustomSelect`, jamais `<select>` natif
- **UI context** : `useConfirm()` de ConfirmDialog, `useToast()` de Toast — pas de default import
- **Fonts** : `var(--font-poppins)` headings, `var(--font-roboto)` body
- **No dark mode** : admin light-only. Utiliser les classes CSS variables (`bg-bg-primary`, `text-text-primary`, `border-border`)
- **Admin forms** : blocs `bg-bg-primary border border-border rounded-2xl p-6 shadow-sm`
- **Shadows** : utilities Tailwind (`shadow-sm`, `shadow-md`, `shadow-lg`). No custom inline shadows. Cards = `.card` / `.card-hover`
- **Mobile-first** : touch targets min 44px, `prefers-reduced-motion` respecté
- **Error boundaries** : par segment (`(admin)`, `(client)`, `(auth)`) en plus du root `error.tsx`

### Product & Variant Data
- **`ProductStatus`** : OFFLINE | ONLINE | ARCHIVED | SYNCING — ne jamais supprimer un ARCHIVED
- **`Color.patternImage`** prioritaire sur `Color.hex` pour le rendu
- **Une variante = une couleur** (plus de sous-couleurs ni de combinaisons). `groupKey` = `colorId` (helper : `variantGroupKeyFromState()`)
- **PACK mono-couleur** : `colorId` + `VariantSize`. `unitPrice` = `computeTotalPrice(v)` (prix total du pack en BDD, pas unitaire). `packQuantity` = somme des qty des tailles
- **PACK multi-couleurs** : composition dans `PackColorLine[]` + `PackColorLineSize[]`. Chaque ligne = 1 couleur du pack avec ses tailles/quantités (ex : 1 paquet « Tricolore » = Rouge S×2 M×3, Bleu M×2, Noir L×1 = 8 pièces). `ProductColor.colorId` = 1ère couleur du pack (utilisé pour SKU/index/images). `variantSizes` reste vide quand `packLines.length > 0`. Détection : `isMultiColorPack(v)` côté UI ; `c.packLines.length > 0` côté serveur. Helpers : `computePackLinesTotal`, `packLinesColorList`. Modale d'édition : `components/admin/products/PackCompositionModal.tsx`
- **PACK pricing marketplace** : markup s'applique au prix unitaire (total ÷ qty), arrondi, puis × qty. Jamais markup sur le total directement
- **UNIT** : max 1 taille. Tailles = description du contenu, pas sélection client
- **PendingSimilar** : vérifier à la création produit
- **OrderItem.sizesJson** : préférer sur `OrderItem.size` (string legacy)

### Images & fichiers (stockage local)
- **Module unique** : `lib/storage.ts` — slugify, helpers de chemin, renommage, suppression. Roots résolus en lazy via `process.cwd()` pour rester testables.
- **Arbo publique** (`public/uploads/`) :
  - `produits/{slug-ref}/{slug-ref}-{slug-couleur}-{n}.webp` (+ `-md.webp` + `-thumb.webp`) — 1 dossier par produit, nom de fichier parlant
  - `collections/{slug}/couverture.webp` (+ `-md.webp`)
  - `motifs-couleurs/{slug-couleur}-{stamp}.{ext}` — anciens "patterns/"
  - `banniere/accueil-{stamp}.webp`
  - `catalogues/{nom-slugifié}.pdf`
  - `bordereaux/{clientId}/commande-{ref}-{rand}.{ext}`
  - `temp/chat/{nom}-{stamp}.webp`
  - `reclamations/commande-{ref}/photo-{n}-{stamp}.webp` *(public car affiché par `<img src>` direct — déviation par rapport à la spec privée initiale, voir issue future)*
- **Arbo privée** (`private/uploads/`, jamais servie publiquement) :
  - `kbis/{siret}/kbis-{stamp}.{ext}`
  - `documents/{siret}/{doc}-{stamp}.{ext}` (kit complémentaire client)
  - `factures/{annee}/commande-{ref}.pdf`
  - `pieces-jointes-email/{annee-mois}/...`
  - `avoirs/...`
- **Helpers de chemin** (à utiliser systématiquement, ne pas hardcoder) : `productImageDir(ref)`, `productImageBaseName(ref, color, n)`, `collectionImageDir(slug)`, `bannerDir()`, `colorPatternDir()`, `chatAttachmentDir()`, `bordereauDir(clientId)`, `kbisDir(siret)`, `clientDocumentsDir(siret)`, `invoiceDir(year)`, `claimDir(orderRef)`, `creditNoteDir()`, `emailAttachmentDir(yearMonth)`. `slugify()` : minuscules, accents conservés (UTF-8), espaces→tirets, supprime caractères Windows-illegaux, fallback `"sans-nom"`.
- **Suffixes WebP** : écriture en `-md`/`-thumb` (tirets). Lecture compatible avec l'ancien `_md`/`_thumb` via `getImagePaths()` qui accepte les deux. Toujours utiliser `getImageSrc(path, size)`.
- **Renommage automatique** : `renameProductFolder(oldRef, newRef)` et `renameCollectionFolder(oldSlug, newSlug)` retournent `{ renamed: [{ oldDbPath, newDbPath }] }` — appelés dans la transaction Prisma de `updateProduct`/`updateCollection`. Rollback du dossier si la transaction échoue. No-op si dossier absent.
- **Suppression** : `deleteDirectory(dirKey)` (rm -rf). Appelé par `deleteProduct`/`deleteCollection` pour purger en cascade.
- **Brouillons** : si l'admin upload une image avant d'avoir saisi la référence, le dossier est `uploads/produits/_brouillon/` (idem `collections/_brouillon/`). Le prochain save écrit les vrais paths.
- **Helpers I/O** : `uploadFile`, `readFile`, `deleteFile`, `deleteFiles`, `copyFile`, `moveFile`, `listFiles`, `assertFileExists`, `deleteDirectory` — clés préfixées `private/...` résolues contre `<project>/private/`.
- **Images produit** : `processProductImage()` → WebP 3 tailles (large/medium/thumb), max 5 images par couleur.
- **DB paths** : format `/uploads/produits/{slug}/{base}.webp`. Le chemin BDD est déjà l'URL publique (pas de préfixe à ajouter).
- **Sauvegardes** : penser à sauvegarder régulièrement les dossiers `public/uploads` ET `private/uploads` du VPS — pas de réplication externe.
- **Reset complet** : `npx tsx scripts/wipe-data.ts` (double confirmation interactive). Préserve uniquement le compte ADMIN, `SiteConfig`, `TranslationQuota` et l'arborescence de dossiers.
- **PFS image sync** : `DELETE /catalog/products/{id}/image` avec body `{ color, slot }`. Upload = POST multipart (JPEG uniquement, pas WebP). Logs détaillés via `[PFS Images]` prefix.

### SEO
- **`lib/seo.ts`** — helpers SEO : `buildAlternates(path)` (canonical + hreflang x-default + toutes les locales), `buildOrganizationSchema()`, `buildWebsiteSchema()` (avec SearchAction), `getCachedSeoConfig()` (lit CompanyInfo + clés sociales depuis SiteConfig, tag `company-info` + `site-config`)
- **JSON-LD** : `Organization` rendu **uniquement** dans `app/layout.tsx` (pas dans la home pour éviter le doublon). `WebSite` avec SearchAction sur la home. `Product` + `BreadcrumbList` sur fiche produit
- **Clés SiteConfig SEO** (toutes optionnelles, non chiffrées) : `site_logo_url`, `social_facebook_url`, `social_instagram_url`, `social_linkedin_url`, `social_twitter_url`, `social_youtube_url`, `social_tiktok_url`. Renseignées = remontent dans `sameAs` du schema Organization
- **Favicon dynamique** : `app/icon.tsx` (32×32) + `app/apple-icon.tsx` (180×180) générés via `ImageResponse` à partir de la 1re lettre du `shopName`. `app/manifest.ts` = Web App Manifest
- **i18n SEO** : routing par cookie `bj_locale` donc hreflang techniquement limité — `buildAlternates` émet les bonnes balises mais toutes pointent vers la même URL. Pour un vrai gain, migrer vers routing `/[locale]/`

### Encryption (secrets en BDD)
- **`lib/encryption.ts`** : AES-256-GCM. Clé maître = `ENCRYPTION_KEY` (env var, base64 32 bytes)
- **`SENSITIVE_KEYS`** dans encryption.ts = liste des clés SiteConfig chiffrées. Toute nouvelle clé sensible doit y être ajoutée
- **Écriture** : `encryptIfSensitive(key, value)` avant `prisma.siteConfig.upsert()`
- **Lecture** : `decryptIfSensitive(key, value)` après lecture BDD. Compatible migration progressive (valeurs en clair retournées telles quelles)

### Custom Hooks (`hooks/`)
- **`useProductStream()`** — SSE real-time product updates (5s reconnect)
- **`useProductTranslation()`** — fetch translated product names
- **`useBackdropClose()`** — close dropdowns on outside click

### Caching & Security
- **`getCachedSiteConfig(key)`** : cache unique par key. Toujours `getCached*` + `revalidateTag(tag, "default")`
- **Cache TTLs** : 5min (site-config, dashboard-stats, product-count), 10min (bestsellers), 60min (categories, colors, tags, collections, sizes, countries, seasons)
- **Security** : `lib/security.ts` obligatoire dans auth. Lockout progressif jamais bypassé. 3h cooldown inscription
- **Server actions** : `requireAdmin()` / `requireAuth()` obligatoire

### Real-Time & Integrations
- **SSE temps réel** : `lib/product-events.ts` via `globalThis` singleton (pas module-level). Hook client : `useProductStream()`
- **Easy-Express** : prix en centimes (÷100), poids min 1kg, +5€ marge, transactionId expire vite
- **PFS live image sync** : `applyLiveImageChanges()` dans `app/actions/admin/pfs-live-sync.ts`. Logs `[IMG_SYNC]` et `[DnD]` côté client

### Logging
- **Jamais `console.log/warn/error`** côté serveur — utiliser `import { logger } from "@/lib/logger"`
- Logger sort du JSON en prod (log aggregators), format lisible en dev

### Auth redirects
- **Login → /admin** : `LoginForm.redirectAfterLogin()` utilise `window.location.href = "/admin"` (full reload), **pas** `router.push("/admin")`. Le router de `@/i18n/navigation` ajoute le préfixe locale → produit `/fr/admin` qui est un 404 (admin hors i18n). Le full reload contourne le router localisé proprement.

---

## Production (`https://beliandjolie.com`)

VPS Hostinger Ubuntu 24.04 LTS. Tout le code vit dans `/var/www/beliandjolie` côté serveur.

### Stack serveur

| Composant | Version | Rôle |
|-----------|---------|------|
| Ubuntu | 24.04 LTS | OS |
| Node.js | 20 LTS (NodeSource) | Runtime Next.js |
| MySQL | 8 | Base de données (`beliandjolie`, user dédié) |
| Nginx | 1.24 | Reverse proxy `127.0.0.1:3000` + sert `/uploads/` et `/_next/static/` directement |
| PM2 | 7 | Process manager, géré par systemd via `pm2-root.service` (autostart au boot) |
| Certbot | 2.9 | HTTPS Let's Encrypt, renouvellement auto via systemd timer |

### Fichiers de config production

- **`/etc/nginx/sites-available/beliandjolie`** — vhost (HTTP→HTTPS redirect géré par certbot, `client_max_body_size 50M` pour les uploads)
- **`/var/www/beliandjolie/.env`** — secrets (DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY). Permissions `0666` pour l'édition via le lecteur SSHFS-Win monté côté admin. ⚠️ **Lu uniquement au démarrage du site** : restart PM2 obligatoire après modif
- **PM2 dump** : `/root/.pm2/dump.pm2` (généré par `pm2 save`, restauré au boot par `pm2-root.service`)

### Sécurité serveur

- **UFW** : seuls les ports 22 (SSH), 80 (HTTP), 443 (HTTPS) ouverts en entrée
- **SSH** : `PasswordAuthentication no` + `PermitRootLogin prohibit-password` → clé uniquement
- **Mot de passe root** changé après l'installation initiale (sert seulement pour le panneau VPS du registrar)
- Le poste admin se connecte avec une clé `~/.ssh/id_ed25519` côté Windows, pas de mot de passe à taper

### Playwright / Chromium (import images PFS)

L'import PFS télécharge les images des produits via un Chromium headless (cf. `lib/pfs-import.ts` → `downloadImagesWithPlaywright`). Le binaire **n'est PAS installé par `npm install`** : il faut le télécharger à part, une fois après chaque déploiement initial ou montée de version Playwright :

```
ssh root@72.61.106.128 "cd /var/www/beliandjolie && npx playwright install --with-deps chromium"
pm2 restart beliandjolie
```

Sans ça, l'import PFS plante avec `browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/...`. Le binaire vit dans `/root/.cache/ms-playwright/` (~500 Mo, hors repo).

### Accès administrateur côté cliente

- Lecteur réseau Windows **`V:`** monté via SSHFS-Win (`\\sshfs.kr\root@72.61.106.128\var\www\beliandjolie`) avec auto-mount au login (tâche planifiée `Mount-VPS-Beliandjolie`)
- Script de mount : `~/Documents/mount-vps.ps1` côté Windows. Options clés : `IdentityFile=/cygdrive/c/Users/Admin/.ssh/id_ed25519`, `idmap=user`, `cache=no`
- Permet l'édition directe du `.env` et des fichiers du site, drag-and-drop des photos vers `V:\public\uploads\products\`

### Pas dans le repo

- `scripts/deploy/` (gitignoré) — contient les helpers de déploiement local + secrets éventuels (mots de passe DB et root générés à l'install). Toute manipulation prod doit être faite via SSH ou via le lecteur V:, jamais via des secrets commités.
- `public/uploads/` (gitignoré) — vit uniquement sur le VPS, pas répliqué. **Penser à organiser une sauvegarde régulière** de ce dossier (rsync/cron à mettre en place).
