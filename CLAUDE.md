# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Architecture** : `docs/architecture.md` (routes, auth, data models, components, integrations)
> **PFS Sync** : `docs/pfs-system.md` (sync, reverse sync, mapping, prepare flow)
> **Styling** : `docs/styling.md` (palette, CSS utilities, conventions)
> **API PFS** : `API_DOCUMENTATION.md` (endpoints, request/response formats)

---

## Architecture

B2B SaaS e-commerce platform — generic wholesale for any product type. Next.js 16 App Router, MySQL (Prisma), Tailwind v4, TypeScript. Each client can deploy their own instance to sell any product category online.

### Route groups (`app/`)

| Group | URL pattern | Access |
|-------|-------------|--------|
| `(auth)` | `/connexion`, `/inscription` | Unauthenticated only |
| `(admin)` | `/admin/*`, `/admin/efashion/*` | ADMIN role |
| `(client)` | `/espace-pro/*`, `/panier/*`, `/commandes/*`, `/favoris` | CLIENT (APPROVED) |
| *(direct)* | `/produits/*`, `/collections/*`, `/categories` | Public / guest (`bj_access_code` cookie) |

Protection: `middleware.ts` (edge) + group `layout.tsx` (server fallback). Middleware also handles maintenance mode (60s module-level cache, fail-safe: assumes maintenance on fetch error) and admin preview (`bj_admin_preview=1` cookie).

### Key layers

- **Server actions** (`app/actions/admin/`, `app/actions/client/`) — all mutations. `requireAdmin()` / `requireAuth()` obligatoire.
- **API routes** (`app/api/`) — webhooks (Stripe, heartbeat), SSE streams, file-serving, PFS sync endpoints.
- **Lib** (`lib/`) — business logic: `pfs-*.ts` (PFS sync ecosystem), `stripe.ts`, `easy-express.ts`, `cached-data.ts`, `security.ts`, `image-processor.ts`, `r2.ts` (Cloudflare R2 storage).
- **Components** — `components/admin/` (backoffice), `components/client/` (espace-pro), `components/pfs/` (PFS mapping UI), `components/ui/` (shared primitives), `components/home/` (landing page).

### Observability

- **`lib/logger.ts`** — structured logger (JSON in prod, readable in dev). Use `logger.info/warn/error()` instead of `console.*`
- **`lib/env.ts`** — Zod validation of env vars at startup. Imported in root layout. Add new required vars there

### Data flow

Prisma ORM → Server Actions + API routes. Cache via `unstable_cache` dans `lib/cached-data.ts`. Invalidation: `revalidateTag(tag, "default")` (2 args obligatoires Next 16). Server actions return `{ success: boolean, error?: string }` consistently.

### Product model

`Product` → `ProductColor[]` (variantes UNIT ou PACK) → images, sizes, sub-colors, pack color lines. Pricing: UNIT = `unitPrice` direct, PACK = calculé via `computeTotalPrice()`.

### PFS sync (bidirectional)

`lib/pfs-reverse-sync.ts` (local→PFS push), `lib/pfs-sync.ts` (PFS→local import), `lib/pfs-api.ts` (read), `lib/pfs-api-write.ts` (write). Auth via `lib/pfs-auth.ts` (token cache).

### eFashion Paris sync (bidirectional)

`lib/efashion-graphql.ts` (GraphQL client), `lib/efashion-auth.ts` (cookie auth), `lib/efashion-api.ts` (read), `lib/efashion-api-write.ts` (write), `lib/efashion-sync.ts` (import), `lib/efashion-reverse-sync.ts` (push), `lib/efashion-analyze.ts` (dry-run), `lib/efashion-prepare.ts` (staging). Auth via cookie session (`lib/efashion-auth.ts`).

### Auth

NextAuth v4, Credentials + JWT (30d). New users = `PENDING` → admin approves. Token carries `id`, `role`, `status`, `company` (`lib/auth.ts`). Types: `types/next-auth.d.ts`.

### i18n

next-intl, cookie `bj_locale` (default `fr`). Locales: fr, en, de, es, it, ar (RTL). Messages: `messages/[locale].json`. Auto-translations: DeepL Free (500K chars/month) + Claude AI (`lib/claude.ts`).

### Styling

**Tailwind CSS v4** — no `tailwind.config.js`. Theme tokens in `app/globals.css` inside `@theme inline {}`. Dark mode via `.admin-dark` class on root. Dark mode overrides for hardcoded colors (bg-white, text-[#1A1A1A], etc.) are centralized as `.admin-dark .class` rules at the bottom of `globals.css` — add new overrides there when introducing new hardcoded color values.

### Key Prisma enums

`ProductStatus` (OFFLINE|ONLINE|ARCHIVED|SYNCING), `SaleType` (UNIT|PACK), `OrderStatus` (PENDING|PROCESSING|SHIPPED|DELIVERED|CANCELLED), `UserRole` (ADMIN|CLIENT), `UserStatus` (PENDING|APPROVED|REJECTED), `PfsSyncStatus`, `ImportDraftStatus`, `ImportJobStatus`. Full definitions in `prisma/schema.prisma`.

`StripeWebhookEvent` model exists for webhook deduplication (idempotency check before processing).

---

## Regles de travail

- **Auto-maintenance** : mettre a jour CLAUDE.md apres chaque tache si nouvelle convention/endpoint/env var.
- **Parallelisation** : lancer des sous-agents en parallele quand les sous-taches sont independantes.
- **Resume** : fournir un resume des changements + guide de test a la fin de chaque tache.

## Commandes

```bash
npm run dev / build / start / lint
npx prisma db push && npx prisma generate   # Apres modif schema, redemerrer dev server d'abord
npx prisma studio
npx tsx scripts/create-admin.ts / generate-translations.ts / seed.ts / encrypt-secrets.ts
npm run clear:products
```

## Variables d'environnement

**Obligatoires** : `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`, `NEXT_PUBLIC_R2_URL`

**Configurables via paramètres admin** (env var = fallback, admin UI prend priorité) : `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFY_EMAIL`, `EASY_EXPRESS_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `DEEPL_API_KEY`, `PFS_EMAIL`, `PFS_PASSWORD`, `EFASHION_EMAIL`, `EFASHION_PASSWORD`

## Versions critiques

| Lib | Version | Contrainte |
|-----|---------|-----------|
| Next.js | 16.1.6 | `params` = `Promise` (await). `revalidateTag("tag", "default")` = 2 args |
| Prisma | 5.22.0 | PAS v7 (breaking changes) |
| NextAuth | v4 | PAS v5. JWT + Credentials |
| Zod | 4.3.6 | `.issues` PAS `.errors` |
| Tailwind | v4 | No config file. Theme in `globals.css` `@theme inline {}` |
| React | 19.2.3 | |

Autres : Stripe 20.4.1, Recharts, bcryptjs (12 rounds), pdfkit, exceljs, @anthropic-ai/sdk, playwright, nodemailer, DeepL (HTTP direct).
`serverExternalPackages: ["pdfkit", "sharp", "exceljs"]` dans `next.config.ts`. Path alias: `@/*` → `./*`.

## Gotchas critiques

### Rendering & UI Components
- **`ssr: false`** interdit dans Server Components → wrapper `"use client"`
- **`PublicSidebar.tsx`** = header public (PAS `Navbar.tsx`)
- **Badges** : toujours `badge badge-*` (success/warning/error/neutral/info/purple). Jamais inline
- **Dropdowns** : toujours `CustomSelect`, jamais `<select>` natif
- **UI context** : `useConfirm()` de ConfirmDialog, `useToast()` de Toast — pas de default import
- **Fonts** : `var(--font-poppins)` headings, `var(--font-roboto)` body
- **Admin dark mode** : prefer `bg-bg-primary`, `text-text-primary`, `border-border`. Hardcoded colors (`bg-white`, `text-[#1A1A1A]`, `border-[#E5E5E5]`, etc.) are auto-overridden via `.admin-dark` CSS rules in `globals.css`. For Recharts/inline styles, use CSS variables (`var(--color-bg-primary)`, `var(--color-text-primary)`, etc.)
- **Admin forms** : blocs `bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]`
- **Mobile-first** : touch targets min 44px, `prefers-reduced-motion` respecte
- **Error boundaries** : exist per segment (`(admin)`, `(client)`, `(auth)`) in addition to root `error.tsx`

### Product & Variant Data
- **`ProductStatus`** : OFFLINE | ONLINE | ARCHIVED | SYNCING — ne jamais supprimer un ARCHIVED
- **`Color.patternImage`** prioritaire sur `Color.hex` pour le rendu
- **groupKey** : toujours `colorId + sub-colors tries` pour identifier couleurs. Jamais `colorId` seul ni `variantTempId`. Helper: `variantGroupKeyFromState()`
- **Couleurs completes** : toujours afficher TOUTES les couleurs d'une composition, jamais juste la principale
- **PACK** : `colorId` = null, couleurs dans `PackColorLine[]`. `unitPrice` = `computeTotalPrice(v)`, jamais set manuellement. `packQuantity >= 1`
- **UNIT** : max 1 taille. Tailles = description du contenu, pas selection client
- **handleMultiColorChange** : un seul `onChange` avec `Set<string>`, jamais `updateVariant` en boucle
- **PendingSimilar** : verifier a la creation produit
- **OrderItem.sizesJson** : preferer sur `OrderItem.size` (string legacy)

### Images (Cloudflare R2)
- **Stockage** : toutes les images uploadées sont sur **Cloudflare R2** (pas de stockage local). Client S3-compatible dans `lib/r2.ts`
- **Images produit** : `processProductImage()` → WebP 3 tailles (large/medium/thumb) → upload R2. Utiliser `getImageSrc(path, size)` pour dériver les URLs publiques. Max 5 images par couleur
- **DB paths** : le format reste `/uploads/products/abc.webp` en BDD. `getImageSrc()` préfixe automatiquement avec `NEXT_PUBLIC_R2_URL`
- **Helpers R2** : `uploadToR2()`, `downloadFromR2()`, `deleteFromR2()`, `moveInR2()`, `listR2Keys()` — tous dans `lib/r2.ts`
- **PFS image sync** : `DELETE /catalog/products/{id}/image` avec body `{ color, slot }`. Upload = POST multipart (JPEG uniquement, pas WebP). Logs détaillés via `[PFS Images]` prefix

### SEO
- **Schema.org JSON-LD** on product pages (`Product` schema) and homepage (`Organization` + `WebSite` schema)

### Encryption (secrets en BDD)
- **`lib/encryption.ts`** : AES-256-GCM. Clé maître = `ENCRYPTION_KEY` (env var, base64 32 bytes)
- **`SENSITIVE_KEYS`** dans encryption.ts = liste des clés SiteConfig chiffrées. Toute nouvelle clé sensible doit y être ajoutée
- **Écriture** : `encryptIfSensitive(key, value)` avant `prisma.siteConfig.upsert()`
- **Lecture** : `decryptIfSensitive(key, value)` après lecture BDD. Compatible migration progressive (valeurs en clair retournées telles quelles)
- **Migration** : `npx tsx scripts/encrypt-secrets.ts` — chiffre les valeurs existantes, idempotent

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

### eFashion Paris sync
- **API type** : GraphQL (`wapi.efashion-paris.com/graphql`) + REST for images
- **Auth** : Cookie-based (`auth-token` JWT, 7 days). In-memory cache in `efashion-graphql.ts`
- **IDs** : `Int` (not String UUID like PFS). `efashionProductId` on Product model
- **`vendu_par`** : "couleurs" = UNIT, "assortiment" = PACK
- **Descriptions** : `texte_fr` / `texte_uk` (not per-language array)
- **Photos** : REST `GET /api/product-photos/{id}`. Upload via FormData POST
- **Tailles** : Packs (p1-p12 slots) ou Déclinaisons (d1_FR-d12_FR)
- **Pagination** : `skip` + `take` (not page/per_page). No `hasMore`, use `total`
- **`productsPage`** returns `items` (not `products`)
- **Categories** : `label` field (not `nom`), hierarchical tree
- **Mapping** : `EfashionMapping` table (separate from `PfsMapping`)

### Logging
- **Never use `console.log/warn/error`** in server-side code — use `import { logger } from "@/lib/logger"` instead
- Logger outputs JSON in production (for log aggregators), human-readable format in development
