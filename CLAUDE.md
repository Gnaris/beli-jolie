# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Mémoire projet** : voir `.claude/memory/MEMORY.md`
> **Architecture complète** : voir `.claude/memory/project-architecture.md`
> **Endpoints API** : voir `.claude/memory/api-endpoints.md`
> **Design monochrome** : voir `.claude/memory/design-monochrome.md`
> **Préférences utilisateur** : voir `.claude/memory/feedback-preferences.md`

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

# Admin account
npx tsx scripts/create-admin.ts   # Crée le compte admin défini dans .env (ADMIN_EMAIL / ADMIN_PASSWORD)
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
```

## Architecture

### Route Groups
The app uses three Next.js route groups plus direct public routes:

| Group | Path | Who can access |
|---|---|---|
| `(auth)` | `/connexion`, `/inscription` | Unauthenticated only (redirects if logged in) |
| `(admin)` | `/admin/*` | ADMIN role only |
| `(client)` | `/espace-pro/*`, `/panier/*`, `/commandes/*`, `/favoris` | CLIENT role (APPROVED) only |
| *(direct)* | `/produits/*`, `/collections/*`, `/categories` | Public |

Route protection is handled **twice**: in `middleware.ts` (edge, fast) and in each group `layout.tsx` (server-side fallback).

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
  ├── ProductColor[]          (one per color variant)
  │     ├── SaleOption[]       (UNIT and/or PACK, max 2 per color)
  │     │     └── unitPrice, weight, stock, discountType, discountValue, size, packQuantity
  │     └── ProductImage[]     (max 5, shared between UNIT+PACK of same color)
  ├── ProductTranslation[]    (locale: "en"|"ar"|"zh"|"de"|"es"|"it" — auto-translated name+description)
  ├── ProductSimilar[]        (M2M self-relation for "you may also like")
  ├── ProductComposition[]    (material + percentage, e.g. 85% acier)
  └── ProductTag[]            (tags for search)
```
Prices are **computed on the fly**, not stored: `totalPrice = UNIT ? unitPrice : unitPrice × packQuantity`, then discount applied.

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
| Kbis documents | `private/uploads/kbis/` | ADMIN via `/api/admin/kbis/[filename]` |
| Invoices | `private/uploads/invoices/` | ADMIN or owner client via API |

### Additional DB Models
- **`Favorite`** — user saves products; `@@unique([userId, productId])`
- **`SiteConfig`** — key/value store (e.g. `min_order_ht`); managed via `/admin/parametres`
- **`PasswordResetToken`** — 1-hour tokens for the forgot-password flow; `used` flag prevents replay
- **`ProductTranslation`** — auto-generated translations stored per `[productId, locale]`; locales: `fr` (default), `en`, `ar`, `zh`, `de`, `es`, `it`

### Internationalisation (i18n)
- **next-intl** with cookie-based locale (`bj_locale`, 1-year TTL); default `fr`
- RTL locales: `ar`
- Message files in `messages/[locale].json`
- Server action `setLocale()` in `app/actions/client/locale.ts` switches locale + revalidates layout
- `ProductTranslation` table stores AI-generated product name/description per locale

### Admin Preview Mode
Admins can browse the public site as a logged-in visitor via cookie `bj_admin_preview=1` (8h TTL).
Actions: `enableAdminPreview()` / `disableAdminPreview()` in `app/actions/admin/preview-mode.ts`.

### Server Actions
All mutations go through Server Actions in `app/actions/`. Each action calls `requireAdmin()` or `requireAuth()` (verifies session server-side) before doing anything. Actions call `revalidatePath()` to bust the Next.js cache.

### Styling Conventions
- **Tailwind CSS v4** — no `tailwind.config.js`; theme tokens are defined in `app/globals.css` inside `@theme inline {}`
- **Monochrome dashboard theme** (mars 2026) — see `.claude/memory/design-monochrome.md` for full palette
- Primary: `#1A1A1A` (dark), surface: `#F7F7F8` (light gray), text: `#1A1A1A`, accent: `#22C55E` (green for success/positive)
- Status: success `#22C55E`, warning `#F59E0B`, error `#EF4444`, info `#3B82F6`
- Fonts via CSS variables: `var(--font-poppins)` for headings, `var(--font-roboto)` for body — reference them as `font-[family-name:var(--font-poppins)]` in Tailwind classes
- Reusable CSS utilities: `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.field-input`, `.field-label`, `.container-site`, `.card`, `.card-hover`, `.badge-success`, `.badge-warning`, `.badge-error`, `.badge-neutral`, `.badge-info`, `.stat-card`, `.table-header`, `.table-row`, `.sidebar-item`, `.sidebar-active`, `.page-title`, `.page-subtitle`
- Animations: `.animate-fadeIn` (opacity + translateY), `.animate-slideIn` (opacity + translateX)
- Admin forms: split into separate blocks with `bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]`

### Key Components
- **Public header**: `PublicSidebar.tsx` (NOT `Navbar.tsx`) — logo, functional search bar, nav links, cart
- **Admin mobile**: `AdminMobileNav.tsx` — hamburger + slide-in drawer with all nav links
- **3D Hero**: `JewelryScene.tsx` loaded via `JewelrySceneLoader.tsx` (client wrapper for `ssr: false`)
- **Product form**: `ProductForm.tsx` — 4 separate blocks (fiche produit, mots-clés, dimensions, composition)

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

When adding new cached data: use `unstable_cache` from `next/cache`, always provide a unique cache key array and relevant tags. Call `revalidateTag()` in server actions that modify the underlying data.

### Responsive & Accessibility Conventions
- **Mobile-first**: always start from smallest breakpoint, add `sm:`/`md:`/`lg:` for larger screens
- **Touch targets**: minimum 36×36px (ideally 44×44px) for all interactive elements — use `w-9 h-10` or larger on buttons
- **`prefers-reduced-motion`**: all animations are disabled via a global `@media` rule in `globals.css`
- **ARIA**: add `aria-label` on icon-only buttons, `aria-pressed` on toggles, `role="combobox"` on search inputs

### Important Gotchas
- `ssr: false` with `next/dynamic` is NOT allowed in Server Components → use a `"use client"` wrapper
- Zod v4: use `.issues` not `.errors` when accessing ZodError details
- `PublicSidebar.tsx` is the actual visible header on public pages, not `Navbar.tsx`
- `getCachedSiteConfig(key)` creates a unique cache entry per key — do NOT use a shared cache key for parameterised queries
- Password strength rules (8 chars, 1 uppercase, 1 digit) must be enforced identically in registration AND password reset (both client and server)
- Admin layout and auth layout use `getCachedSiteConfig` — never query `prisma.siteConfig` directly in layouts

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
- `pdfkit` for PDF generation — requires `serverExternalPackages: ["pdfkit"]` in `next.config.ts`
- `nodemailer` for transactional email (Gmail App Password)

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
