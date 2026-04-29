# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## À qui tu parles

La personne avec qui tu discutes **n'est pas développeuse, pas informaticienne**. C'est elle qui dirige le projet, c'est tout.

Donc quand tu lui expliques ce que tu as fait, parle-lui comme tu parlerais à un client qui veut simplement savoir ce qui a changé sur son site. Pas comme à un collègue technicien.

Concrètement ça veut dire :
- Pas de mots techniques (pas de "fonction", "endpoint", "cache", "revalidate", "schema", "SSR"…). Si tu es obligé d'en utiliser un, explique-le en une phrase avec des mots de tous les jours.
- Dis ce qui change **pour elle et pour ses clients** quand ils utilisent le site, pas ce que tu as touché dans le code. Par exemple : *"Maintenant, quand vous cliquez sur Exporter, le fichier Excel contient aussi les prix de détail."*
- Sois court, en français simple. Pas de grosses listes à puces techniques.
- Quand tu lui proposes un test, écris-le comme un trajet à suivre dans le site (*"Ouvrez l'admin, allez dans Produits, cliquez sur…"*) — jamais une commande à taper dans un terminal.
- Les détails techniques (noms de fichiers, lignes de code, etc.) restent entre toi et le code. Pas besoin de les lui raconter.

> **Architecture** : `docs/architecture.md` (routes, auth, data models, components, integrations)
> **PFS Sync** : `docs/pfs-system.md` (sync, reverse sync, mapping, prepare flow)
> **Styling** : `docs/styling.md` (palette, CSS utilities, conventions)
> **API PFS** : `docs/pfs-api.md` (endpoints, request/response formats)
---

## Architecture

B2B SaaS e-commerce platform — generic wholesale for any product type. Next.js 16 App Router, MySQL (Prisma), Tailwind v4, TypeScript. Each client can deploy their own instance to sell any product category online.

### Route groups (`app/`)

| Group | URL pattern | Access |
|-------|-------------|--------|
| `(auth)` | `/connexion`, `/inscription` | Unauthenticated only |
| `(admin)` | `/admin/*` | ADMIN role |
| `(client)` | `/espace-pro/*`, `/panier/*`, `/commandes/*`, `/favoris` | CLIENT (APPROVED) |
| *(direct)* | `/produits/*`, `/collections/*`, `/categories` | Public / guest (`bj_access_code` cookie) |

Protection: `middleware.ts` (edge) + group `layout.tsx` (server fallback). Middleware also handles maintenance mode (60s module-level cache, fail-safe: assumes maintenance on fetch error) and admin preview (`bj_admin_preview=1` cookie).

### Key layers

- **Server actions** (`app/actions/admin/`, `app/actions/client/`) — all mutations. `requireAdmin()` / `requireAuth()` obligatoire.
- **API routes** (`app/api/`) — webhooks (Stripe, heartbeat), SSE streams, file-serving, marketplace Excel export.
- **Lib** (`lib/`) — business logic: `marketplace-excel/` (PFS + Ankorstore Excel generators), `pfs-api.ts` / `pfs-api-write.ts` (read + delete), `ankorstore-api.ts` / `ankorstore-api-write.ts` (read + delete), `stripe.ts`, `easy-express.ts`, `email.ts` (SMTP via nodemailer — `sendMail()` unique point d'envoi), `notifications.ts` (emails transactionnels), `cached-data.ts`, `security.ts`, `image-processor.ts`, `storage.ts` (local filesystem image storage under `/public`).
- **Components** — `components/admin/` (backoffice), `components/client/` (espace-pro), `components/ui/` (shared primitives), `components/home/` (landing page).

### Observability

- **`lib/logger.ts`** — structured logger (JSON in prod, readable in dev). Use `logger.info/warn/error()` instead of `console.*`
- **`lib/env.ts`** — Zod validation of env vars at startup. Imported in root layout. Add new required vars there

### Data flow

Prisma ORM → Server Actions + API routes. Cache via `unstable_cache` dans `lib/cached-data.ts`. Invalidation: `revalidateTag(tag, "default")` (2 args obligatoires Next 16). Server actions return `{ success: boolean, error?: string }` consistently.

### Product model

`Product` → `ProductColor[]` (variantes UNIT ou PACK) → images, sizes, pack color lines. **Une variante = une couleur** (plus de sous-couleurs/composition). Pricing: UNIT = `unitPrice` direct, PACK = calculé via `computeTotalPrice()`. Pour les **packs multi-couleurs** (ex: pack tricolore), la composition vit dans `PackColorLine[]` + `PackColorLineSize[]` (1 ligne par couleur du pack avec ses tailles/quantités). Le nom de la couleur dans la bibliothèque (`Color.name`) doit correspondre exactement à ce que PFS attend pour l'export Excel.

### Marketplace publishing via API live (PFS + Ankorstore)

Create / update sur PFS + Ankorstore se fait **en direct via les API**. Plus d'export Excel manuel.

**Identifiants stockés** : `Product.pfsProductId` / `Product.ankorsProductId` + `ProductColor.pfsVariantId` / `ProductColor.ankorsVariantId`. Renseignés à l'import PFS et à chaque publish/refresh. `null` = produit pas encore publié → badge gris « Non publié ».

**Modale au save produit** : à chaque `Enregistrer` dans le formulaire produit (création OU édition), si le produit est complet et qu'au moins une marketplace est configurée, une modale s'ouvre avec cases à cocher PFS / Ankorstore. Si cochées → enqueue dans le widget existant `PfsRefreshWidget` avec `mode: "publish"`.

**Server action** : `app/actions/admin/marketplace-publish.ts` → `publishProductToMarketplaces(productId, { pfs, ankorstore })` :
- Si `pfsProductId` connu → `pfsRefreshProduct()` (renouvelle = crée nouveau + remplace ID)
- Sinon → `pfsPublishProduct()` (première création)
- Idem pour Ankorstore avec fallback automatique sur publish si refresh échoue (`not_found`)

Fichiers clés :
- `lib/pfs-publish.ts` — première publication PFS (sans swap d'ancien produit)
- `lib/pfs-refresh.ts` — renouvellement (création + soft-delete + remplacement IDs)
- `lib/ankorstore-publish.ts` — première publication Ankorstore (push + search by ref pour récupérer IDs)
- `lib/ankorstore-refresh.ts` — refresh Ankorstore (search → push → IDs)
- `app/actions/admin/marketplace-publish.ts` + `app/actions/admin/marketplace-refresh.ts`
- `app/api/admin/marketplace-publish/route.ts` + `app/api/admin/marketplace-refresh/route.ts`
- `components/admin/products/PfsRefreshContext.tsx` — queue partagée publish/refresh, dispatch via `mode: "publish" | "refresh"`

**Annexes PFS** : alimentées en LIVE via `lib/pfs-annexes.ts` (cache `unstable_cache` 60min, tag `pfs-annexes`) qui appelle `pfsGetGenders/Families/Categories/Colors/Compositions/Countries/Sizes/Collections`. Plus de parsing du template Excel.

**Delete** est 100 % local : `deleteProduct(id)` et `bulkDeleteProducts(ids)` ne touchent pas aux marketplaces.

**Famille PFS** : stockée dans `Category.pfsFamilyName` (renseignée manuellement dans l'UI catégorie). `pfsCategoryId`/`pfsGender`/`pfsFamilyId` (IDs Salesforce) conservés pour référence.

### Refresh produit (`lib/pfs-refresh.ts` + `app/actions/admin/marketplace-refresh.ts`)

Bouton "Rafraîchir" dans `/admin/produits` (par ligne + bulk) et sur la page `/modifier`. Ouvre une modale avec cases à cocher : **boutique** (bump `Product.lastRefreshedAt`, jamais `createdAt`) + **PFS** (re-push live via API, remplace `pfsProductId` + `pfsVariantId` après création nouveau) + **Ankorstore** (fire-and-forget, capture IDs après push via search by ref).

Traitement en arrière-plan via `PfsRefreshProvider` (monté dans `app/(admin)/layout.tsx`) + `PfsRefreshWidget` (popup bas-droite, minimisable, fermable uniquement quand tous les produits sont terminés). Items traités séquentiellement, outcomes per-marketplace affichés.

`pfsRefreshProduct()` : `pfsCheckReference(ref)` → si inexistant = erreur "Produit inexistant sur PFS" ; sinon crée nouveau produit avec ref TEMP aléatoire, upload images locales→JPEG, renomme l'ancien en ref aléatoire + statut `DELETED`, renomme le nouveau avec la vraie ref, passe en `READY_FOR_SALE` (ou `ARCHIVED` si stock 0 sur toutes variantes). Rollback automatique en cas d'échec mi-parcours.

`ankorstoreRefreshProduct()` : `ankorstoreSearchProductsByRef(ref)` → si inexistant = erreur "Produit inexistant sur Ankorstore" ; sinon `ankorstorePushProducts([product], "update")` (upsert par external_id = reference). Fire-and-forget : pas de callback webhook, l'admin vérifie sur le dashboard Ankorstore. Un bandeau d'avertissement s'affiche dans le widget dès qu'un push Ankorstore réussit.

"Nouveauté" frontend = `max(createdAt, lastRefreshedAt) > now - 30j` (filter + orderBy compound sur `/produits`, `/api/products`, home carousel, favoris, ProductsInfiniteScroll).

### Marketplace pricing (`lib/marketplace-pricing.ts`)

Configurable markup per marketplace via SiteConfig keys. Three markup types: `percent` (+X%), `fixed` (+X€), `multiplier` (×X). Three rounding modes: `none`, `up` (ceil to 0.1€), `down` (floor to 0.1€). SiteConfig keys follow the pattern `{marketplace}_markup_{type|value|rounding}` — e.g. `pfs_price_markup_type`, `ankorstore_wholesale_markup_value`, `ankorstore_retail_markup_rounding`. PACK pricing: markup applies to **per-unit price** (unitPrice / packQuantity), then multiply back by pack quantity. Retail markup on Ankorstore applies **on top of wholesale HT**, then VAT applied to produce retail TTC (colonne "Prix de détail/unité" de l'Excel). TVA configurable via `ankorstore_default_vat_rate` (défaut 20).

### Auth

NextAuth v4, Credentials + JWT (30d). New users = `PENDING` → admin approves. Token carries `id`, `role`, `status`, `company` (`lib/auth.ts`). Types: `types/next-auth.d.ts`.

### i18n

**Routing par préfixe d'URL** (next-intl 4.x). Chaque page publique vit sous `app/[locale]/...` et est servie sur `/{locale}/...` (ex: `/fr/produits/123`, `/en/produits/123`). Locales: fr (défaut), en, de, es, it, ar (RTL), zh. Messages: `messages/[locale].json`. Auto-translations: DeepL Free (500K chars/month). Auto-translate toggle: `auto_translate_enabled` in SiteConfig.

- **Config** : `i18n/routing.ts` (`localePrefix: "always"`, `localeDetection: false`), `i18n/navigation.ts` exporte `Link`, `redirect`, `useRouter`, `usePathname` localisés
- **Request** : `i18n/request.ts` lit la locale depuis `requestLocale` (params URL). Plus de cookie `bj_locale`
- **Routes hors i18n** : `/admin/*`, `/api/*`, `/maintenance`, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/icon`, `/apple-icon`. Sans préfixe locale
- **Middleware** : combine next-intl (préfixe + redirection 307 des URLs legacy `/produits` → `/fr/produits`) avec la logique d'auth (admin, client, pending, codes accès, maintenance). Le middleware applique la logique sur le pathname "sans locale" (helper `stripLocale`)
- **Layouts** : `app/layout.tsx` (root) reste tel quel — `getLocale()` fonctionne via `requestLocale` (fallback `fr` pour les routes admin). `app/[locale]/layout.tsx` appelle `setRequestLocale(locale)` + `notFound()` si locale invalide
- **Liens admin → public** : hardcoder `/fr/...` (admin n'a pas de locale courante)
- **Sitemap** : génère 7× chaque URL (1 par locale) avec `alternates.languages` (hreflang)
- **`buildAlternates(path, locale)` de `lib/seo.ts`** : émet canonical (URL préfixée par locale courante) + hreflang `x-default` (toujours fr) + 1 entrée par locale
- **Sélecteur de langue** : `LanguageSwitcher` utilise `router.replace(pathname, { locale })` pour basculer sans recharger

### Styling

**Tailwind CSS v4** — no `tailwind.config.js`. Theme tokens in `app/globals.css` inside `@theme {}`. No dark mode. Clean flat design with subtle shadows (`--shadow-card`, `--shadow-card-md`, `--shadow-card-lg`, `--shadow-sm`). No claymorphism — use standard Tailwind shadow utilities (`shadow-sm`, `shadow-md`, `shadow-lg`).

### Key Prisma enums

`ProductStatus` (OFFLINE|ONLINE|ARCHIVED|SYNCING), `SaleType` (UNIT|PACK), `OrderStatus` (PENDING|PROCESSING|SHIPPED|DELIVERED|CANCELLED), `UserRole` (ADMIN|CLIENT), `UserStatus` (PENDING|APPROVED|REJECTED), `ImportDraftStatus`, `ImportJobStatus`. Full definitions in `prisma/schema.prisma`. (`PfsSyncStatus` / `PfsStagedStatus` et modèles `PfsSyncJob` / `PfsPrepareJob` / `PfsStagedProduct` / `PfsMapping` ont été retirés avec la bascule vers l'export Excel.)

`StripeWebhookEvent` model exists for webhook deduplication (idempotency check before processing).

---

## Regles de travail

- **Auto-maintenance** : mettre a jour CLAUDE.md apres chaque tache si nouvelle convention/endpoint/env var.
- **Parallelisation** : lancer des sous-agents en parallele quand les sous-taches sont independantes.
- **Resume** : fournir un resume des changements + guide de test a la fin de chaque tache.
- **Récap demande** : à la toute fin de chaque réponse, ajouter une petite section **« Ce que vous m'avez demandé »** qui résume en 1-3 phrases simples la demande initiale. Ça permet de garder une trace claire de ce qui a été fait et pourquoi.

## Commandes

```bash
npm run dev / build / start / lint
npm run test / test:watch / test:coverage   # Vitest
npm run test:pfs-smoke                      # PFS smoke tests
npx prisma db push && npx prisma generate   # Apres modif schema, redemerrer dev server d'abord
npx prisma studio
npx tsx scripts/create-admin.ts
```

### Testing

Vitest + `__tests__/` dir. Integration tests in `__tests__/integration/` (DB-backed, `fileParallelism: false`). PFS smoke tests in `__tests__/pfs/`.

## Variables d'environnement

**Obligatoires** : `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_KEY`

**Optionnelles** : `STRIPE_PLATFORM_SECRET_KEY` (Stripe Connect platform mode)

**Email (env var uniquement)** : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `NOTIFY_EMAIL`

**Configurables via paramètres admin** (env var = fallback, admin UI prend priorité) : `EASY_EXPRESS_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `DEEPL_API_KEY`, `PFS_EMAIL`, `PFS_PASSWORD`

### Stripe Connect

Dual-mode: **Platform** (`STRIPE_PLATFORM_SECRET_KEY` + per-client `stripe_connect_account_id` in DB) ou **Manual** (per-client `stripe_secret_key` in DB). Endpoints: `/api/stripe/connect`, `/api/stripe/disconnect`, `/api/stripe/reset`.

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
`serverExternalPackages: ["pdfkit", "sharp", "exceljs"]` dans `next.config.ts`. Path alias: `@/*` → `./*`.

## Gotchas critiques

### Rendering & UI Components
- **`ssr: false`** interdit dans Server Components → wrapper `"use client"`
- **`PublicSidebar.tsx`** = header public (PAS `Navbar.tsx`)
- **Badges** : toujours `badge badge-*` (success/warning/error/neutral/info/purple). Jamais inline
- **Dropdowns** : toujours `CustomSelect`, jamais `<select>` natif
- **UI context** : `useConfirm()` de ConfirmDialog, `useToast()` de Toast — pas de default import
- **Fonts** : `var(--font-poppins)` headings, `var(--font-roboto)` body
- **No dark mode** : admin is light-only. Use CSS variable classes (`bg-bg-primary`, `text-text-primary`, `border-border`) for consistency
- **Admin forms** : blocs `bg-bg-primary border border-border rounded-2xl p-6 shadow-sm`
- **Shadows** : use Tailwind utilities (`shadow-sm`, `shadow-md`, `shadow-lg`). No custom inline shadows. Cards use `.card` / `.card-hover` classes
- **Mobile-first** : touch targets min 44px, `prefers-reduced-motion` respecte
- **Error boundaries** : exist per segment (`(admin)`, `(client)`, `(auth)`) in addition to root `error.tsx`

### Product & Variant Data
- **`ProductStatus`** : OFFLINE | ONLINE | ARCHIVED | SYNCING — ne jamais supprimer un ARCHIVED
- **`Color.patternImage`** prioritaire sur `Color.hex` pour le rendu
- **Une variante = une couleur** : plus de sous-couleurs ni de combinaisons. `groupKey` = `colorId` (helper : `variantGroupKeyFromState()`).
- **PACK mono-couleur** : `colorId` + `VariantSize`. `unitPrice` = `computeTotalPrice(v)` (prix total du pack en BDD, pas unitaire). `packQuantity` = somme des qty des tailles.
- **PACK multi-couleurs** : la composition vit dans `PackColorLine[]` + `PackColorLineSize[]`. Chaque ligne = 1 couleur du pack avec ses tailles/quantités (ex: 1 paquet « Tricolore » = Rouge S×2 M×3, Bleu M×2, Noir L×1 = 8 pièces). `ProductColor.colorId` = 1ère couleur du pack (utilisé pour SKU/index/images). `variantSizes` reste vide quand `packLines.length > 0`. Détection : `isMultiColorPack(v)` côté UI ; `c.packLines.length > 0` côté serveur. Helpers : `computePackLinesTotal`, `packLinesColorList`. Modale d'édition : `components/admin/products/PackCompositionModal.tsx`.
- **PACK pricing Ankorstore** : markup s'applique au prix unitaire (total ÷ qty), arrondi, puis × qty. Jamais markup sur le total directement
- **UNIT** : max 1 taille. Tailles = description du contenu, pas selection client
- **PendingSimilar** : verifier a la creation produit
- **OrderItem.sizesJson** : preferer sur `OrderItem.size` (string legacy)

### Images (stockage local)
- **Stockage** : toutes les images sont écrites sur le **disque local** dans `public/uploads/...`. Next.js sert le dossier `/public` automatiquement, donc une image écrite à `public/uploads/products/abc.webp` est accessible à `/uploads/products/abc.webp`. Module : `lib/storage.ts`
- **Images produit** : `processProductImage()` → WebP 3 tailles (large/medium/thumb) → écriture disque. Utiliser `getImageSrc(path, size)` pour dériver les chemins. Max 5 images par couleur
- **DB paths** : format `/uploads/products/abc.webp`. Pas de préfixe à ajouter — le chemin BDD est déjà l'URL publique
- **Helpers stockage** : `uploadFile()`, `readFile()`, `deleteFile()`, `deleteFiles()`, `copyFile()`, `moveFile()`, `listFiles()`, `assertFileExists()` — tous dans `lib/storage.ts`
- **Sauvegardes** : penser à sauvegarder régulièrement le dossier `public/uploads` du VPS — il n'est plus répliqué chez un service externe
- **PFS image sync** : `DELETE /catalog/products/{id}/image` avec body `{ color, slot }`. Upload = POST multipart (JPEG uniquement, pas WebP). Logs détaillés via `[PFS Images]` prefix

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
- **Security** : `lib/security.ts` obligatoire dans auth. Lockout progressif jamais bypasse. 3h cooldown inscription
- **Server actions** : `requireAdmin()` / `requireAuth()` obligatoire

### Real-Time & Integrations
- **SSE temps réel** : `lib/product-events.ts` via `globalThis` singleton (pas module-level). Hook client: `useProductStream()`
- **Easy-Express** : prix en centimes (÷100), poids min 1kg, +5€ marge, transactionId expire vite
- **PFS live image sync** : `applyLiveImageChanges()` dans `app/actions/admin/pfs-live-sync.ts`. Logs `[IMG_SYNC]` et `[DnD]` cote client

### Logging
- **Never use `console.log/warn/error`** in server-side code — use `import { logger } from "@/lib/logger"` instead
- Logger outputs JSON in production (for log aggregators), human-readable format in development
