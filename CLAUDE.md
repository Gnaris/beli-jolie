# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Mémoire projet** : voir `.claude/memory/MEMORY.md`
> **Architecture complète** : voir `.claude/memory/project-architecture.md`
> **Endpoints API** : voir `.claude/memory/api-endpoints.md`
> **Design monochrome** : voir `.claude/memory/design-monochrome.md`
> **Préférences utilisateur** : voir `.claude/memory/feedback-preferences.md`
> **API Paris Fashion Shop** : voir `API_DOCUMENTATION.md`

---

## Règles de travail obligatoires

### Auto-maintenance de CLAUDE.md
Après chaque tâche terminée, vérifier si CLAUDE.md doit être mis à jour (nouveau système, nouvelle convention, nouvelle env var, nouveau endpoint, etc.). Si oui, le mettre à jour immédiatement.

### Parallélisation via sous-agents
Quand une tâche peut être découpée en sous-tâches indépendantes, **toujours** lancer plusieurs sous-agents en parallèle pour accélérer le travail. Ne jamais faire séquentiellement ce qui peut être fait en parallèle. Les agents spécialisés (Designer, Front-End, Back-End, SEO, Hackeur Éthique) doivent être sollicités dès que leur domaine est concerné — ne pas hésiter à les invoquer pour obtenir des résultats plus optimaux.

### Validation par 3 testeurs IA (obligatoire après chaque tâche)
Après chaque tâche terminée, lancer **3 sous-agents testeurs** en parallèle. Chacun a un angle de test différent :

1. **Testeur Fonctionnel** — Vérifie que le code fait exactement ce qui était demandé, pas de régression, les cas limites sont gérés, les données sont correctes.
2. **Testeur UI/UX** — Vérifie le responsive (mobile/tablette/desktop), l'accessibilité (ARIA, touch targets 44px, contraste), les animations, la cohérence visuelle avec le design system monochrome.
3. **Testeur Technique** — Vérifie le lint (`npm run lint`), la compatibilité TypeScript, les imports corrects, les conventions Prisma/NextAuth/Zod, la performance (pas de N+1, pas de re-renders inutiles).

**Règle de consensus** : si **au moins un** testeur signale un problème, il produit un rapport détaillé. Le problème doit être corrigé, puis **les 3 testeurs repassent** jusqu'à ce que tous soient d'accord (aucun désaccord). On ne passe à la tâche suivante que quand les 3 testeurs valident.

---

## Commands

```bash
# Development
npm run dev          # Start dev server on localhost:3000
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint check

# Database
npx prisma db push           # Push schema changes to MySQL (no migrations)
npx prisma generate          # Regenerate Prisma client (required after schema changes)
npx prisma studio            # Open Prisma Studio GUI

# Scripts
npx tsx scripts/create-admin.ts        # Crée le compte admin défini dans .env (ADMIN_EMAIL / ADMIN_PASSWORD)
npx tsx scripts/generate-translations.ts  # Batch-generate missing translations for all entities
npx tsx scripts/seed.ts                # Seed database with sample data (dev only)
npm run clear:products                 # Delete all products + related data (dev only)
```

> **After `prisma db push`**: restart the dev server — it locks the generated `.dll` file and `generate` will fail otherwise.

## Environment

Copy `.env.example` to `.env`:
```
DATABASE_URL="mysql://root@localhost:3306/beli_jolie"
NEXTAUTH_SECRET="<random base64 string>"
NEXTAUTH_URL="http://localhost:3000"
ADMIN_EMAIL="..."
ADMIN_PASSWORD="..."
EASY_EXPRESS_API_KEY="<bearer token Easy-Express>"
EE_SENDER_COMPANY / EE_SENDER_SHOP_NAME / EE_SENDER_SIRET / EE_SENDER_EMAIL
EE_SENDER_PHONE / EE_SENDER_MOBILE / EE_SENDER_STREET / EE_SENDER_CITY
EE_SENDER_POSTAL_CODE / EE_SENDER_COUNTRY="FR"
GMAIL_USER / GMAIL_APP_PASSWORD / NOTIFY_EMAIL
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ANTHROPIC_API_KEY
DEEPL_API_KEY
PFS_EMAIL / PFS_PASSWORD              # Paris Fashion Shop (marketplace B2B)
```

## Architecture

### Route Groups
The app uses three Next.js route groups plus direct public routes:

| Group | Path | Who can access |
|---|---|---|
| `(auth)` | `/connexion`, `/inscription` | Unauthenticated only (redirects if logged in) |
| `(admin)` | `/admin/*` | ADMIN role only |
| `(client)` | `/espace-pro/*`, `/panier/*`, `/commandes/*`, `/favoris` | CLIENT role (APPROVED) only |
| *(direct)* | `/produits/*`, `/collections/*`, `/categories` | Public (or guest via `bj_access_code` cookie) |

Route protection is handled **twice**: in `middleware.ts` (edge, fast) and in each group `layout.tsx` (server-side fallback).

**Middleware extras:**
- **Maintenance mode**: checks `/api/site-status`; admins and auth routes bypass it
- **Guest access**: `bj_access_code` cookie allows unauthenticated browsing of public product/collection pages
- **Admin redirects**: logged-in admins accessing `/espace-pro` or `/panier` are redirected to `/admin` (unless preview mode `bj_admin_preview=1`)

### Auth Flow
- **NextAuth v4** with Credentials provider + JWT strategy (30-day tokens)
- Token enriched with `id`, `role`, `status`, `company` in `lib/auth.ts`
- New registrations default to `role=CLIENT, status=PENDING` — an admin must approve before they can log in
- PENDING/REJECTED users get a 401-style error at sign-in even with correct credentials
- Types extended in `types/next-auth.d.ts`

### Product Data Model
Products have a nested structure — read this before touching product code:
```
Product
  ├── ProductColor[]          (one row per variant — flat, includes saleType/price/stock)
  │     ├── saleType: UNIT | PACK
  │     ├── unitPrice, weight, stock, discountType, discountValue, size, packQuantity
  │     ├── ProductColorSubColor[]  (optional sub-colors, e.g. Doré → Rouge, Noir)
  │     └── ProductColorImage[]     (max 5 per variant, linked via productColorId)
  ├── ProductTranslation[]    (locale: "en"|"ar"|"zh"|"de"|"es"|"it" — auto-translated name+description)
  ├── ProductSimilar[]        (M2M self-relation for "you may also like")
  ├── PendingSimilar[]        (deferred similar links — resolved when target product is created)
  ├── ProductComposition[]    (material + percentage, e.g. 85% acier)
  ├── ProductTag[]            (tags for search)
  └── RestockAlert[]          (client alerts when out-of-stock variant is restocked)
```
- `Color` model has optional `patternImage` (leopard, camouflage, etc.) — takes priority over hex
- `ProductStatus` enum: `OFFLINE` | `ONLINE` | `ARCHIVED` (archived = invisible but preserved for order history)
- Prices are **computed on the fly**, not stored: `totalPrice = UNIT ? unitPrice : unitPrice × packQuantity`, then discount applied
- **Multi-color variants**: two variants can share the same main `colorId` (e.g. "Doré/Argenté/Or Rose" and "Doré/Argenté/Or Rose/Vert/Jaune"). They are distinguished by their sub-colors via a `groupKey` = `colorId::orderedSubColorNames` (**order matters**: "Doré/Rouge" ≠ "Rouge/Doré"). First selected color = main, rest = sub-colors in selection order. `ProductColorImage.productColorId` links images to the specific variant. The admin form's `ColorImageState` uses `groupKey` (not `colorId` or `variantTempId`) — variants with the same color+sub-colors selection in the same order (e.g. UNIT + PACK) share the same image group. Helper: `variantGroupKeyFromState()` exported from `ColorVariantManager.tsx`.

### Order Data Model
```
Order
  ├── OrderItem[]             (snapshot produit au moment de la commande)
  ├── status: OrderStatus     (PENDING → PROCESSING → SHIPPED → DELIVERED | CANCELLED)
  ├── orderNumber: BJ-YYYY-XXXXXX
  ├── carrier info (carrierId, carrierName, carrierPrice)
  ├── TVA (tvaRate, subtotalHT, tvaAmount, totalTTC)
  ├── Payment (stripePaymentIntentId, paymentStatus: pending|paid|failed)
  └── Easy-Express (eeTrackingId?, eeLabelUrl?)
```

### File Storage
| Type | Path | Access |
|------|------|--------|
| Product images | `public/uploads/products/` | Public (direct) |
| Collection images | `public/uploads/collections/` | Public (direct) |
| Color patterns | `public/uploads/patterns/` | Public (direct) |
| Kbis documents | `private/uploads/kbis/` | ADMIN via `/api/admin/kbis/[filename]` |
| Invoices | `private/uploads/invoices/` | ADMIN or owner client via API |

### Image Processing (`lib/image-processor.ts`)
All image uploads (manual and bulk import) pass through `processProductImage()`:
- Auto-rotates based on EXIF orientation, then converts to **WebP** in 3 sizes: large (1200px, q90), medium (800px, q82), thumb (400px, q80)
- DB stores only the large path (e.g. `/uploads/products/abc.webp`); medium/thumb are `_md.webp` / `_thumb.webp` on disk
- Use `getImageSrc(storedPath, "thumb"|"medium"|"large")` to derive the correct URL for display

### Additional DB Models
- **`Favorite`** — user saves products; `@@unique([userId, productId])`
- **`SiteConfig`** — key/value store (e.g. `min_order_ht`); managed via `/admin/parametres`
- **`PasswordResetToken`** — 1-hour tokens for the forgot-password flow; `used` flag prevents replay
- **`ProductTranslation`** — auto-generated translations stored per `[productId, locale]`; locales: `fr` (default), `en`, `ar`, `zh`, `de`, `es`, `it`
- **`LoginAttempt`** — logs every login attempt (email, ip, success); indexed by email+date, ip+date
- **`AccountLockout`** — progressive lockout per email (11 levels: 1min → permanent); `lib/security.ts`
- **`RegistrationLog`** — anti-spam: logs IP/email/phone/siret per registration; 3h cooldown enforced
- **`ImportJob`** — tracks bulk import history (products + images); linked to user
- **`ImportDraft`** — stores error rows from bulk import for manual resolution (type: PRODUCTS or IMAGES); linked to admin
- **`RestockAlert`** — client subscribes to out-of-stock variant; notified when restocked
- **`AccessCode`** — guest browsing via `bj_access_code` cookie; includes `prefillFirstName/LastName/Company/Email/Phone` for pre-filling registration; tracks first/last access + navigation views; admin-set expiry
- **`Catalog`** / **`CatalogProduct`** — shareable product catalogs via unique token (published/draft); admin creates catalogs to share with clients via public links; product entries can override color/image
- **`TranslationQuota`** — tracks monthly character usage per translation provider (`provider` + `monthYear`); `@@unique([provider, monthYear])`
- **`CategoryTranslation`** / **`SubCategoryTranslation`** / **`ColorTranslation`** / **`CompositionTranslation`** — auto-translated names per locale (same pattern as `ProductTranslation`)

### Internationalisation (i18n)
- **next-intl** with cookie-based locale (`bj_locale`, 1-year TTL); default `fr`
- RTL locales: `ar`
- Message files in `messages/[locale].json`
- Server action `setLocale()` in `app/actions/client/locale.ts` switches locale + revalidates layout
- `ProductTranslation` table stores AI-generated product name/description per locale
- **Translation engine**: DeepL Free API (500K chars/month, key ends with `:fx`); quota tracked via `TranslationQuota` model
- **AI description generation**: Anthropic Claude Sonnet (`lib/claude.ts` + `/api/admin/products/generate-ai`) — generates product name/description from category, tags, compositions and images
- Auto-translated entities: products, categories, subcategories, colors, compositions

### Admin Preview Mode
Admins can browse the public site as a logged-in visitor via cookie `bj_admin_preview=1` (8h TTL).
Actions: `enableAdminPreview()` / `disableAdminPreview()` in `app/actions/admin/preview-mode.ts`.

### Server Actions
All mutations go through Server Actions in `app/actions/`. Each action calls `requireAdmin()` or `requireAuth()` (verifies session server-side) before doing anything. Actions call `revalidatePath()` or `revalidateTag(tag, "default")` to bust the Next.js cache.

### Bulk Import (`lib/import-processor.ts`)
- Excel/JSON import via `/admin/produits/importer` — preview (dry-run) → confirm → background processing (`ImportJob`)
- Multi-color variants use "/" as separator in Excel (e.g. "Doré/Argenté/Or Rose")
- Image filenames use "," as separator (since "/" is forbidden in filenames): `REF_COULEUR1,COULEUR2_POSITION.ext`
- Color matching is accent-insensitive via `normalizeColorName()` — strips accents + lowercases
- Quick-create endpoint `/api/admin/products/import/quick-create` allows creating missing categories/colors/compositions from the preview screen
- Product search API: `GET /api/admin/products/search?q=xxx&fields=catalog` — used by CatalogEditor and similar products picker (max 20 results, admin auth required)

### Styling Conventions
- **Tailwind CSS v4** — no `tailwind.config.js`; theme tokens are defined in `app/globals.css` inside `@theme inline {}`
- **Monochrome dashboard theme** (mars 2026) — see `.claude/memory/design-monochrome.md` for full palette
- Admin palette: primary `#1A1A1A` (dark), surface `#F7F7F8` (light gray), text `#1A1A1A`, status-accent `#22C55E` (green for success)
- Public palette: accent gold `#D4AF37` (light `#FDF6E3`, dark `#B8960C`)
- **Admin dark mode**: `.admin-dark` class on root — inverts colors/shadows across the admin panel (defined in `globals.css`)
- Status: success `#22C55E`, warning `#F59E0B`, error `#EF4444`, info `#3B82F6`
- Fonts via CSS variables: `var(--font-poppins)` for headings, `var(--font-roboto)` for body — reference them as `font-[family-name:var(--font-poppins)]` in Tailwind classes
- Reusable CSS utilities: `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.field-input`, `.field-label`, `.container-site`, `.card`, `.card-hover`, `.badge-success`, `.badge-warning`, `.badge-error`, `.badge-neutral`, `.badge-info`, `.stat-card`, `.table-header`, `.table-row`, `.sidebar-item`, `.sidebar-active`, `.page-title`, `.page-subtitle`
- Variant form utilities: `.drawer-variant-container`, `.variant-drawer`, `.variant-input`, `.variant-select`, `.bulk-variant-bar`
- Scroll-reveal classes: `.reveal`, `.reveal-up`, `.reveal-down`, `.reveal-left`, `.reveal-right`, `.reveal-zoom`, `.reveal-blur` + `.stagger-1` through `.stagger-8`
- Animations: `.animate-fadeIn`, `.animate-slideIn`, `.animate-float`, `.animate-shimmer`, `.animate-cart-bounce`, and many more keyframes in `globals.css`
- Misc utilities: `.no-scrollbar` (hides scrollbars), `.checkbox-custom`, `.section-title`
- Admin forms: split into separate blocks with `bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]` — always use CSS variable classes (`bg-bg-primary`, `text-text-primary`, `border-border`, `bg-bg-secondary`, `text-text-secondary`) for dark mode compatibility, never hardcode `bg-white` or `text-[#1A1A1A]` in admin components

### Key Components
- **Public header**: `PublicSidebar.tsx` (NOT `Navbar.tsx`) — logo, functional search bar, nav links, cart
- **Admin mobile**: `AdminMobileNav.tsx` — hamburger + slide-in drawer with all nav links
- **3D Hero**: `JewelryScene.tsx` loaded via `JewelrySceneLoader.tsx` (client wrapper for `ssr: false`)
- **Product form**: `ProductForm.tsx` — 4 separate blocks (fiche produit, mots-clés, dimensions, composition)
- **Live client tracking**: `LiveClientsTracker.tsx` — real-time view of connected clients at `/admin/suivi`
- **Cart modal**: `CartModal.tsx` — admin can peek at a client's current cart
- **Reusable UI**: `ConfirmDialog.tsx` (replaces window.confirm), `CustomSelect.tsx` (searchable select), `Toast.tsx`, `ColorSwatch.tsx` (single/multi-color swatch with patternImage support — renders camembert pie chart for multi-color variants)
- **Import history**: `ImportHistoryClient.tsx` — view past import jobs at `/admin/produits/importer/historique`

### Rate Limiting (`lib/rate-limit.ts`)
In-memory IP-based rate limiter used on sensitive endpoints: `forgot-password` (3/h), `reset-password` (10/h), `report-error` (3/15min). Usage: `rateLimit(key, maxAttempts, windowMs)` returns `{ success, remaining }`.

### Security Layer (`lib/security.ts`)
- **Login brute force**: progressive lockout after 3 failures — 11 levels (1min → 48h → permanent)
- **Registration anti-spam**: 3h cooldown per IP/phone/siret/email via `RegistrationLog`
- **Admin unlock**: `app/actions/admin/unlockAccount.ts` — reset lockout for a given email
- **Client unlock request**: `app/api/auth/unlock-request/` — client can request unlock via email

### Password Reset Flow
- Client: `POST /api/auth/forgot-password` → creates `PasswordResetToken`, sends email with link
- Link: `/reinitialiser-mot-de-passe?token=xxx` → `POST /api/auth/reset-password`
- Admin password reset: via `/admin/parametres` → `AdminPasswordResetButton` sends email to admin address

### Caching Layer
`lib/cached-data.ts` centralises all `unstable_cache` calls. Available cached functions:
- `getCachedSiteConfig(key)` — per-key cache (5min TTL, tag: `site-config`)
- `getCachedCategories/Collections/Colors/Tags` — reference data (5min)
- `getCachedProductCount` — total product count (5min)
- `getCachedBestsellerRefs(limit)` — top selling references (10min)
- `getCachedAdminWarnings()` — admin sidebar warning counts (5min, tags: products/categories/colors/tags/compositions)
- `getCachedDashboardStats()` — 11 aggregate queries for admin dashboard (5min, tags: orders/products/users)

When adding new cached data: use `unstable_cache` from `next/cache`, always provide a unique cache key array and relevant tags. Call `revalidateTag(tag, "default")` (2 args required in Next.js 16) in server actions that modify the underlying data.

### Responsive & Accessibility Conventions
- **Mobile-first**: always start from smallest breakpoint, add `sm:`/`md:`/`lg:` for larger screens
- **Touch targets**: minimum 36×36px (ideally 44×44px) for all interactive elements — use `w-9 h-10` or larger on buttons
- **`prefers-reduced-motion`**: all animations are disabled via a global `@media` rule in `globals.css`
- **ARIA**: add `aria-label` on icon-only buttons, `aria-pressed` on toggles, `role="combobox"` on search inputs

### Important Gotchas
- **Next.js 16 `params`**: route `params` is a `Promise` — must be `await`ed: `const { id } = await params;`
- **`revalidateTag`** requires 2 arguments in Next.js 16: `revalidateTag("tag-name", "default")`
- `ssr: false` with `next/dynamic` is NOT allowed in Server Components → use a `"use client"` wrapper
- Zod v4: use `.issues` not `.errors` when accessing ZodError details
- `PublicSidebar.tsx` is the actual visible header on public pages, not `Navbar.tsx`
- `getCachedSiteConfig(key)` creates a unique cache entry per key — do NOT use a shared cache key for parameterised queries
- Password strength rules (8 chars, 1 uppercase, 1 digit) must be enforced identically in registration AND password reset (both client and server)
- Admin layout and auth layout use `getCachedSiteConfig` — never query `prisma.siteConfig` directly in layouts
- `lib/security.ts` must be called in auth flow — never bypass lockout checks
- `ProductStatus.ARCHIVED` products must remain in DB for order history — never delete, only archive
- `PendingSimilar` links are auto-resolved — when creating a product, check for pending similar refs matching the new product's reference
- `Color.patternImage` takes priority over `Color.hex` when rendering — always check patternImage first
- `UserActivity.cartAddsCount`/`favAddsCount` are session counters sent by HeartbeatTracker — reset on disconnect
- **Never group/display color variants by `colorId` alone** — always use `groupKey` (colorId + ordered sub-color names, **order matters**). Keying by `colorId` merges variants with different sub-colors; keying by `variantTempId` prevents UNIT/PACK image sharing. See `variantGroupKeyFromState()` in `ColorVariantManager.tsx`

### Key Libraries
- **Next.js 16.1.6** (App Router, Server Components)
- **React 19.2.3**
- **Prisma 5.22.0** (NOT v7 — v7 has breaking changes incompatible with this project)
- **NextAuth 4** (NOT v5)
- **Zod 4.3.6**
- **Stripe 20.4.1** (payments: card + bank transfer)
- **Three.js 0.183.2** (3D jewelry animation)
- **Recharts 3.8.0** (admin charts)
- `bcryptjs` (12 salt rounds) for password hashing
- `pdfkit` for PDF generation — requires `serverExternalPackages: ["pdfkit", "sharp", "exceljs"]` in `next.config.ts`
- `exceljs` for Excel import/export in bulk import
- `@anthropic-ai/sdk` for AI product description generation (`lib/claude.ts`)
- DeepL Free API for translations (`lib/translate.ts`) — no npm package, direct HTTP calls
- `nodemailer` for transactional email (Gmail App Password)

### Path Alias
`@/*` maps to `./*` (tsconfig.json) — use `import { foo } from "@/lib/bar"` everywhere.

### next.config.ts Highlights
- **Security headers**: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS preload, Referrer-Policy, Permissions-Policy
- **Image optimization**: AVIF/WebP, 30-day cache TTL, specific device sizes
- **Static asset caching**: `/uploads/:path*` cached 1 year (immutable)

### Paris Fashion Shop (PFS) — Marketplace B2B
- **API Base URL**: `https://wholesaler-api.parisfashionshops.com/api/v1`
- **Doc complète**: voir `API_DOCUMENTATION.md` à la racine
- **Auth**: `POST /oauth/token` avec `PFS_EMAIL`/`PFS_PASSWORD` → Bearer JWT
- **Brand ID**: `a01AZ00000314QgYAI` (obligatoire dans toutes les requêtes)
- **Endpoint principal testé**: `GET /catalog/listProducts?page=N&per_page=100&brand={id}&status=ACTIVE`
- **~9 251 produits actifs** (au 2026-03-21), paginés par 100
- **Variants inline**: `listProducts` retourne les variants avec couleur (labels + hex), prix, stock, images
- **Images CDN**: `https://static.parisfashionshops.com/...` — retirer `?image_process=resize,w_450` pour full-size
- **Langues**: fr, en, de, es, it (pas ar ni zh → à générer via DeepL)
- **API instable**: prévoir retry + backoff + headers réalistes (Cloudflare)
- **Objectif**: import PFS → Beli Jolie (les produits BJ n'ont pas de ref, PFS = source de vérité)

### Easy-Express v3 Integration
- Base URL: `https://easy-express.fr`
- Auth: `Authorization: Bearer <EASY_EXPRESS_API_KEY>`
- Flow: `POST /api/v3/shipments/rates` → transactionId → `POST /api/v3/shipments/checkout`
- Prices in **centimes** → divide by 100 for euros
- Minimum weight: 1 kg (`Math.max(1, weightKg)`)
- +5€ margin added to Easy-Express prices
- transactionId expires quickly — use immediately after /rates
- Fallback: hardcoded Colissimo/Chronopost rates by country/weight

### Stripe Integration
- PaymentIntent: card + bank_transfer (fallback card only)
- Webhook events: `payment_intent.succeeded`, `.processing`, `.payment_failed`
- Bank transfer flow: `awaiting_transfer` → webhook confirmation → Easy-Express + PDF + email
- Stripe Customer created if not exists, stored in `user.stripeCustomerId`

### TVA Rules
- France: 20%
- DOM-TOM: 0%
- EU + valid VAT (VIES): 0% (reverse charge)
- EU without VAT: 20%
- Non-EU: 0%
