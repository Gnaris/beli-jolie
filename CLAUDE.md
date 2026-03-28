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
| `(admin)` | `/admin/*` | ADMIN role |
| `(client)` | `/espace-pro/*`, `/panier/*`, `/commandes/*`, `/favoris` | CLIENT (APPROVED) |
| *(direct)* | `/produits/*`, `/collections/*`, `/categories` | Public / guest (`bj_access_code` cookie) |

Protection: `middleware.ts` (edge) + group `layout.tsx` (server fallback). Middleware also handles maintenance mode and admin preview (`bj_admin_preview=1` cookie).

### Key layers

- **Server actions** (`app/actions/admin/`, `app/actions/client/`) — all mutations. `requireAdmin()` / `requireAuth()` obligatoire.
- **API routes** (`app/api/`) — webhooks (Stripe, heartbeat), SSE streams, file-serving, PFS sync endpoints.
- **Lib** (`lib/`) — business logic: `pfs-*.ts` (PFS sync ecosystem), `stripe.ts`, `easy-express.ts`, `cached-data.ts`, `security.ts`, `image-processor.ts`.
- **Components** — `components/admin/` (backoffice), `components/client/` (espace-pro), `components/pfs/` (PFS mapping UI), `components/ui/` (shared primitives), `components/home/` (landing page).

### Data flow

Prisma ORM → Server Actions + API routes. Cache via `unstable_cache` dans `lib/cached-data.ts`. Invalidation: `revalidateTag(tag, "default")` (2 args obligatoires Next 16).

### Product model

`Product` → `ProductColor[]` (variantes UNIT ou PACK) → images, sizes, sub-colors, pack color lines. Pricing: UNIT = `unitPrice` direct, PACK = calculé via `computeTotalPrice()`.

### PFS sync (bidirectional)

`lib/pfs-reverse-sync.ts` (local→PFS push), `lib/pfs-sync.ts` (PFS→local import), `lib/pfs-api.ts` (read), `lib/pfs-api-write.ts` (write). Auth via `lib/pfs-auth.ts` (token cache).

### Auth

NextAuth v4, Credentials + JWT (30d). New users = `PENDING` → admin approves. Token carries `id`, `role`, `status`, `company` (`lib/auth.ts`). Types: `types/next-auth.d.ts`.

### i18n

next-intl, cookie `bj_locale` (default `fr`), RTL for `ar`. Messages: `messages/[locale].json`. Auto-translations: DeepL Free (500K chars/month) + Claude AI (`lib/claude.ts`).

### Styling

**Tailwind CSS v4** — no `tailwind.config.js`. Theme tokens in `app/globals.css` inside `@theme inline {}`. Dark mode via `.admin-dark` class on root. Dark mode overrides for hardcoded colors (bg-white, text-[#1A1A1A], etc.) are centralized as `.admin-dark .class` rules at the bottom of `globals.css` — add new overrides there when introducing new hardcoded color values.

### Key Prisma enums

`ProductStatus` (OFFLINE|ONLINE|ARCHIVED|SYNCING), `SaleType` (UNIT|PACK), `OrderStatus` (PENDING|PROCESSING|SHIPPED|DELIVERED|CANCELLED), `UserRole` (ADMIN|CLIENT), `UserStatus` (PENDING|APPROVED|REJECTED), `PfsSyncStatus`, `ImportDraftStatus`, `ImportJobStatus`. Full definitions in `prisma/schema.prisma`.

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

**Obligatoires** : `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`

**Configurables via paramètres admin** (env var = fallback, admin UI prend priorité) : `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFY_EMAIL`, `EASY_EXPRESS_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `DEEPL_API_KEY`, `PFS_EMAIL`, `PFS_PASSWORD`

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

### Images
- **Images produit** : `processProductImage()` → WebP 3 tailles (large/medium/thumb). Utiliser `getImageSrc(path, size)` pour dériver. Max 5 images par couleur
- **PFS image sync** : `DELETE /catalog/products/{id}/image` avec body `{ color, slot }`. Upload = POST multipart (JPEG uniquement, pas WebP). Logs détaillés via `[PFS Images]` prefix

### Encryption (secrets en BDD)
- **`lib/encryption.ts`** : AES-256-GCM. Clé maître = `ENCRYPTION_KEY` (env var, base64 32 bytes)
- **`SENSITIVE_KEYS`** dans encryption.ts = liste des clés SiteConfig chiffrées. Toute nouvelle clé sensible doit y être ajoutée
- **Écriture** : `encryptIfSensitive(key, value)` avant `prisma.siteConfig.upsert()`
- **Lecture** : `decryptIfSensitive(key, value)` après lecture BDD. Compatible migration progressive (valeurs en clair retournées telles quelles)
- **Migration** : `npx tsx scripts/encrypt-secrets.ts` — chiffre les valeurs existantes, idempotent

### Caching & Security
- **`getCachedSiteConfig(key)`** : cache unique par key. Toujours `getCached*` + `revalidateTag(tag, "default")`
- **Security** : `lib/security.ts` obligatoire dans auth. Lockout progressif jamais bypasse. 3h cooldown inscription
- **Server actions** : `requireAdmin()` / `requireAuth()` obligatoire

### Real-Time & Integrations
- **SSE temps réel** : `lib/product-events.ts` via `globalThis` singleton (pas module-level). Hook client: `useProductStream()`
- **Easy-Express** : prix en centimes (÷100), poids min 1kg, +5€ marge, transactionId expire vite
- **PFS live image sync** : `applyLiveImageChanges()` dans `app/actions/admin/pfs-live-sync.ts`. Logs `[IMG_SYNC]` et `[DnD]` cote client
