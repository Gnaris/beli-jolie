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
| *(direct)* | `/produits/*`, `/collections/*`, `/categories` | Public — visiteurs anonymes inclus, mais prix masqués tant que la session n'est pas APPROVED |

Protection: `middleware.ts` (edge) + group `layout.tsx` (server fallback). Middleware also handles maintenance mode (60s module-level cache **only on success** — errors are not cached so a transient fetch failure at app startup doesn't lock the site in maintenance for 1 minute) and admin preview (`bj_admin_preview=1` cookie).

**Visibilité des prix** : depuis mai 2026, le système de code d'accès invité (`bj_access_code`, modèle `AccessCode`, page `/admin/codes-acces`) est supprimé. Tout le monde peut consulter le site, mais les tarifs et les boutons d'achat sont masqués tant que la session n'est pas ADMIN ou CLIENT APPROVED. Logique centralisée dans `lib/price-visibility.ts` (`canSeePrices(session)`). Côté API publique (`/api/products`, `/api/products/search`, `/api/products/[id]/live`), les `unitPrice` et `discountPercent` sont remis à 0/null avant la réponse JSON quand le visiteur n'a pas le droit ; les filtres `minPrice/maxPrice` sont aussi ignorés pour empêcher la recherche par dichotomie. Côté UI, `ProductCard`, `ProductDetail`, `ProductCarousel` et `FeaturedProduct` affichent « Connectez-vous pour voir les prix » et un bouton « Créer un compte pour commander » à la place du bloc tarif/qty/CTA.

### Key layers

- **Server actions** (`app/actions/admin/`, `app/actions/client/`) — all mutations. `requireAdmin()` / `requireAuth()` obligatoire.
- **API routes** (`app/api/`) — webhooks (Stripe, heartbeat), SSE streams, file-serving, marketplace Excel export.
- **Lib** (`lib/`) — business logic: `marketplace-excel/` (PFS Excel generators), `pfs-api.ts` / `pfs-api-write.ts` (read + delete), `stripe.ts`, `easy-express.ts`, `email.ts` (SMTP via nodemailer — `sendMail()` unique point d'envoi), `notifications.ts` (emails transactionnels), `cached-data.ts`, `security.ts`, `image-processor.ts`, `storage.ts` (local filesystem image storage under `/public`).
- **Note** : l'intégration Ankorstore a été mise en pause (mai 2026). Tout le code et les paramètres associés ont été retirés. La doc API reste dans `docs/ankorstore-api.md` pour pouvoir réactiver l'intégration plus tard.
- **Components** — `components/admin/` (backoffice), `components/client/` (espace-pro), `components/ui/` (shared primitives), `components/home/` (landing page).

### Observability

- **`lib/logger.ts`** — structured logger (JSON in prod, readable in dev). Use `logger.info/warn/error()` instead of `console.*`
- **`lib/env.ts`** — Zod validation of env vars at startup. Imported in root layout. Add new required vars there

### Data flow

Prisma ORM → Server Actions + API routes. Cache via `unstable_cache` dans `lib/cached-data.ts`. Invalidation: `revalidateTag(tag, "default")` (2 args obligatoires Next 16). Server actions return `{ success: boolean, error?: string }` consistently.

### Product model

`Product` → `ProductColor[]` (variantes UNIT ou PACK) → images, sizes, pack color lines. **Une variante = une couleur** (plus de sous-couleurs/composition). Pricing: UNIT = `unitPrice` direct, PACK = calculé via `computeTotalPrice()`. Pour les **packs multi-couleurs** (ex: pack tricolore), la composition vit dans `PackColorLine[]` + `PackColorLineSize[]` (1 ligne par couleur du pack avec ses tailles/quantités). Le nom de la couleur dans la bibliothèque (`Color.name`) doit correspondre exactement à ce que PFS attend pour l'export Excel.

### Marketplace publishing via API live (PFS uniquement)

Create / update sur PFS se fait **en direct via les API**. Plus d'export Excel manuel.

**Identifiants stockés** : `Product.pfsProductId` + `ProductColor.pfsVariantId`. Renseignés à l'import PFS et à chaque publish/refresh. `null` = produit pas encore publié → badge gris « Non publié ».

**Modale au save produit** : à chaque `Enregistrer` dans le formulaire produit (création OU édition), si le produit est complet et que PFS est configuré, une modale s'ouvre avec une case à cocher PFS. Si cochée → enqueue dans le widget `PfsRefreshWidget` avec `mode: "publish"`.

**Server action** : `app/actions/admin/marketplace-publish.ts` → `publishProductToMarketplaces(productId, { pfs })` :
- Si `pfsProductId` connu → `pfsUpdateProductInPlace()` (mise à jour PATCH)
- Sinon → `pfsPublishProduct()` (première création)
- Fallback : si l'update PFS échoue (ID stale), on retombe sur publish

Fichiers clés :
- `lib/pfs-publish.ts` — première publication PFS (sans swap d'ancien produit)
- `lib/pfs-refresh.ts` — renouvellement (création + soft-delete + remplacement IDs)
- `lib/pfs-update.ts` — mise à jour PATCH d'un produit déjà publié (utilise le diff de snapshot, voir ci-dessous)
- `lib/pfs-sync-diff.ts` — types + `diffSnapshots()` qui compare l'instantané précédent à l'état cible

**Diff de sync (optimisation update)** : `Product.pfsLastSyncSnapshot` (Json?) stocke l'état envoyé à la dernière sync réussie : product fields, defaultColor, variants (price/stock/weight/isActive par pfsVariantId), images (path par colorRef/slot), status, **isBestSeller**. À chaque appel de `pfsUpdateProductInPlace`, on construit le snapshot cible, on diff vs `pfsLastSyncSnapshot`, et on n'envoie à PFS que ce qui a changé : skip `pfsTranslate`+`pfsUpdateProduct` si product fields identiques, patch seulement les variantes modifiées, upload seulement les slots d'image dont le path a changé, skip `pfsUpdateStatus` si statut inchangé, **skip STAR/REMOVE_STAR si isBestSeller inchangé**. Le snapshot est sauvé en fin de sync (sections réussies seulement). Reset à `Prisma.DbNull` quand `pfsProductId` change (publish, refresh, fallback). Si `pfsLastSyncSnapshot` est null → sync complète (comme avant), puis snapshot initial sauvé.

**Resynchro forcée** : icône reload (↻) à côté du badge vert « Paris Fashion Shop » sur la page de modification produit (`MarketplaceStatusButtons`, visible uniquement quand `pfsProductId` existe). Au clic + confirmation, enqueue dans `PfsRefreshContext` avec `mode: "resync"` → API `POST /api/admin/marketplace-resync` → server action `resyncProductOnPfs` → `pfsUpdateProductInPlace(id, undefined, { skipRevalidation: true, forceFullSync: true })`. L'option `forceFullSync` traite localement `pfsLastSyncSnapshot` comme `null` → diff complet → toutes les sections (champs produit, variantes, images, statut, STAR/REMOVE_STAR) sont renvoyées à PFS. Le `pfsProductId` n'est **pas** modifié, le snapshot est mis à jour en fin de sync réussie. `committedSnapshot` est initialisé sur le **vrai** snapshot précédent (même en mode force) pour préserver l'état connu en cas de crash partiel. Pas de fallback automatique sur publish en cas d'échec : on retourne l'erreur (l'utilisatrice peut alors lancer un « Rafraîchir » manuel qui sait recréer).

**Best Seller PFS** : la case « Best Seller » du formulaire produit est un champ comme les autres — son changement n'est appliqué qu'au save (plus de toggle instantané). À l'enregistrement, si la case est cochée et a changé depuis la dernière sync, on appelle `pfsUpdateStatus([{id, status: "STAR"}])` (`lib/pfs-api-write.ts:pfsUpdateStatus`). Si décochée et qu'elle a changé, on appelle `pfsRemoveStar(pfsProductId)` qui tape l'endpoint single body-less `PATCH /catalog/products/{id}/updateStatus/REMOVE_STAR`. Pareil sur publish initial (`lib/pfs-publish.ts`) et refresh (`lib/pfs-refresh.ts`) : si `isBestSeller=true` et statut cible ≠ ARCHIVED, on pose STAR juste après le `pfsUpdateStatus` final. La server action `toggleBestSeller` dans `app/actions/admin/products.ts` reste exposée (utilisée par les tests d'intégration) mais n'est plus appelée par l'UI.
- `app/actions/admin/marketplace-publish.ts` + `app/actions/admin/marketplace-refresh.ts` + `app/actions/admin/marketplace-resync.ts`
- `app/api/admin/marketplace-publish/route.ts` + `app/api/admin/marketplace-refresh/route.ts` + `app/api/admin/marketplace-resync/route.ts`
- `components/admin/products/PfsRefreshContext.tsx` — queue partagée publish/refresh/resync, dispatch via `mode: "publish" | "refresh" | "resync"`

**Annexes PFS** : alimentées en LIVE via `lib/pfs-annexes.ts` (cache `unstable_cache` 60min, tag `pfs-annexes`) qui appelle `pfsGetGenders/Families/Categories/Colors/Compositions/Countries/Sizes/Collections`. Plus de parsing du template Excel.

**Delete** est 100 % local : `deleteProduct(id)` et `bulkDeleteProducts(ids)` ne touchent pas aux marketplaces.

**Famille PFS** : stockée dans `Category.pfsFamilyName` (renseignée manuellement dans l'UI catégorie). `pfsCategoryId`/`pfsGender`/`pfsFamilyId` (IDs Salesforce) conservés pour référence.

### Refresh produit (`lib/pfs-refresh.ts` + `app/actions/admin/marketplace-refresh.ts`)

Bouton "Rafraîchir" dans `/admin/produits` (par ligne + bulk) et sur la page `/modifier`. Ouvre une modale avec cases à cocher : **boutique** (bump `Product.lastRefreshedAt`, jamais `createdAt`) + **PFS** (re-push live via API, remplace `pfsProductId` + `pfsVariantId` après création nouveau).

Traitement en arrière-plan via `PfsRefreshProvider` (monté dans `app/(admin)/layout.tsx`) + `PfsRefreshWidget` (popup bas-droite, minimisable, fermable uniquement quand tous les produits sont terminés). Items traités séquentiellement.

`pfsRefreshProduct()` : `pfsCheckReference(ref)` → si inexistant = erreur "Produit inexistant sur PFS" ; sinon crée nouveau produit avec ref TEMP aléatoire, upload images locales→JPEG, renomme l'ancien en ref aléatoire + statut `DELETED`, renomme le nouveau avec la vraie ref, passe en `READY_FOR_SALE` (ou `ARCHIVED` si stock 0 sur toutes variantes). Rollback automatique en cas d'échec mi-parcours.

"Nouveauté" frontend = `max(createdAt, lastRefreshedAt) > now - 30j` (filter + orderBy compound sur `/produits`, `/api/products`, home carousel, favoris, ProductsInfiniteScroll).

### Marketplace pricing (`lib/marketplace-pricing.ts`)

Configurable markup per marketplace via SiteConfig keys. Three markup types: `percent` (+X%), `fixed` (+X€), `multiplier` (×X). Three rounding modes: `none`, `up` (ceil to 0.1€), `down` (floor to 0.1€). SiteConfig keys follow the pattern `{marketplace}_markup_{type|value|rounding}` — e.g. `pfs_price_markup_type`, `pfs_price_markup_value`, `pfs_price_markup_rounding`. PACK pricing: markup applies to **per-unit price** (unitPrice / packQuantity), then multiply back by pack quantity.

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

`ProductStatus` (OFFLINE|ONLINE|ARCHIVED|SYNCING), `SaleType` (UNIT|PACK), `OrderStatus` (PENDING|SHIPPED|CANCELLED — workflow simplifié : PENDING libellé « Nouveau » côté admin et « En attente » côté client, seule transition admin = PENDING → SHIPPED, annulation possible uniquement depuis PENDING. Emails client : à la création (PENDING) et à l'expédition. Plus de PROCESSING ni DELIVERED), `UserRole` (ADMIN|CLIENT), `UserStatus` (PENDING|APPROVED|REJECTED), `ImportDraftStatus`, `ImportJobStatus`. Full definitions in `prisma/schema.prisma`. (`PfsSyncStatus` / `PfsStagedStatus` et modèles `PfsSyncJob` / `PfsPrepareJob` / `PfsStagedProduct` / `PfsMapping` ont été retirés avec la bascule vers l'export Excel.)

`StripeWebhookEvent` model exists for webhook deduplication (idempotency check before processing).

---

## Regles de travail

- **Auto-maintenance** : mettre a jour CLAUDE.md apres chaque tache si nouvelle convention/endpoint/env var.
- **Parallelisation** : lancer des sous-agents en parallele quand les sous-taches sont independantes.
- **Resume** : fournir un resume des changements + guide de test a la fin de chaque tache.
- **Récap demande** : à la toute fin de chaque réponse, ajouter une petite section **« Ce que vous m'avez demandé »** qui résume en 1-3 phrases simples la demande initiale. Ça permet de garder une trace claire de ce qui a été fait et pourquoi.
- **Impact croisé** : avant d'exécuter une tâche, vérifier si elle peut impacter d'autres fonctionnalités, données, pages ou comportements existants. Si oui, prévenir l'utilisatrice **avant** de toucher au code et lister les zones concernées en français simple, pour qu'elle puisse confirmer ou ajuster la demande.
- **Suggestions d'amélioration** : quand une tâche est demandée et que tu vois une idée, recommandation ou variante qui pourrait l'améliorer (UX, robustesse, simplicité, perf, cohérence avec le reste du site), proposer cette idée à l'utilisatrice en plus de la demande initiale, en français simple. Elle décide ensuite si elle veut intégrer ta proposition.
- **Déploiement complet (local + prod)** : quand l'utilisatrice demande de **corriger**, **réparer**, **rendre fonctionnel**, ou **mettre à jour** quelque chose qui touche au site en ligne, faire la boucle complète sans demander entre chaque étape :
  1. Modifier les fichiers en local (`C:\Users\chenb\Desktop\beli-jolie\`)
  2. `git add` + `git commit` + `git push origin master`
  3. SSH au VPS (`ssh root@72.61.106.128`) : `cd /var/www/beliandjolie && git fetch origin master && git reset --hard origin/master`
  4. `npm install --no-audit --no-fund` (seulement si dépendances modifiées) + `npx prisma generate && npx prisma db push --skip-generate` (seulement si schema modifié)
  5. `NODE_OPTIONS='--max-old-space-size=4096' npm run build`
  6. `pm2 restart beliandjolie`
  7. **Vérification "parcours visiteur"** : `curl -sL` sur `https://beliandjolie.com/` ou la route concernée, suivre les redirections, vérifier que le `<title>` final correspond bien à ce qui est attendu (page de connexion, page produit, etc.) — **pas juste un endpoint interne**
  À la fin, le code doit être strictement identique aux trois endroits (local, GitHub, VPS) — pareil pour les modifs de config serveur (nginx, swap, env). Demander confirmation **uniquement** avant les actions vraiment risquées (suppression de données, drop de tables, push --force, secrets).

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

**Stripe (env-only, mode simple)** : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — pas d'UI admin, plus de Stripe Connect.

**Email (env var uniquement)** : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`. Le destinataire des notifs admin (inscriptions, nouvelles commandes, demandes de déblocage, messages, réclamations) est lu depuis **Admin > Paramètres > Société > Email**, plus de `NOTIFY_EMAIL`.

**Configurables uniquement via paramètres admin** (chiffrés en BDD, plus de var d'env / fallback côté code) : clé Easy-Express, clé DeepL, identifiants PFS (email + mot de passe).

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
- **PACK pricing marketplace** : markup s'applique au prix unitaire (total ÷ qty), arrondi, puis × qty. Jamais markup sur le total directement
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

### Auth redirects
- **Login → /admin** : `LoginForm.redirectAfterLogin()` utilise `window.location.href = "/admin"` (full reload), **pas** `router.push("/admin")`. Le router de `@/i18n/navigation` ajoute le préfixe locale → produit `/fr/admin` qui est un 404 (admin est hors i18n). Le full reload contourne le router localisé proprement.

---

## Production (`https://beliandjolie.com`)

Le site est en production sur un VPS Hostinger (Ubuntu 24.04 LTS). Tout le code vit dans `/var/www/beliandjolie` côté serveur.

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
- **`/var/www/beliandjolie/.env`** — secrets (DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY). Permissions `0666` pour permettre l'édition via le lecteur SSHFS-Win monté côté admin. ⚠️ **Lu uniquement au démarrage du site** : restart PM2 obligatoire après modif.
- **PM2 dump** : `/root/.pm2/dump.pm2` (généré par `pm2 save`, restauré au boot par `pm2-root.service`)

### Sécurité serveur

- **UFW** : seuls les ports 22 (SSH), 80 (HTTP), 443 (HTTPS) sont ouverts en entrée
- **SSH** : `PasswordAuthentication no` + `PermitRootLogin prohibit-password` → clé uniquement
- **Mot de passe root** changé après l'installation initiale (sert seulement pour le panneau VPS du registrar)
- Le poste admin se connecte avec une clé `~/.ssh/id_ed25519` côté Windows, pas de mot de passe à taper

### Workflow de déploiement (mise à jour du code)

Quand un commit doit partir en prod :
1. `git push origin master` (depuis le poste de la cliente, ou depuis Claude pour son compte)
2. SSH au serveur : `cd /var/www/beliandjolie && git fetch origin master && git reset --hard origin/master`
3. `npm install --no-audit --no-fund` (si dépendances changées)
4. `npx prisma generate && npx prisma db push --skip-generate` (si schema changé)
5. `NODE_OPTIONS='--max-old-space-size=4096' npm run build`
6. `pm2 restart beliandjolie`

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
