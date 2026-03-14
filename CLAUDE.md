# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Guide de travail complet** : voir `.claude/skill.md`
> **Mémoire projet** : voir `.claude/memory/MEMORY.md`
> **Thème printemps** : voir `.claude/memory/theme-printemps.md`

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
EASY_EXPRESS_API_KEY="<bearer token Easy-Express>"
EE_SENDER_COMPANY="..."
EE_SENDER_SHOP_NAME="..."
EE_SENDER_SIRET="..."
EE_SENDER_EMAIL="..."
EE_SENDER_PHONE="..."
EE_SENDER_MOBILE="..."
EE_SENDER_STREET="..."
EE_SENDER_CITY="..."
EE_SENDER_POSTAL_CODE="..."
EE_SENDER_COUNTRY="FR"
GMAIL_USER="..."
GMAIL_APP_PASSWORD="..."
NOTIFY_EMAIL="..."
```

## Architecture

### Route Groups
The app uses three Next.js route groups with separate layouts:

| Group | Path | Who can access |
|---|---|---|
| `(auth)` | `/connexion`, `/inscription` | Unauthenticated only (redirects if logged in) |
| `(admin)` | `/admin/*` | ADMIN role only |
| `(client)` | `/espace-pro/*`, `/panier/*` | CLIENT role only |

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
  └── ProductColor[]          (one per color variant)
        ├── SaleOption[]       (UNIT and/or PACK, max 2 per color)
        │     └── unitPrice, weight, stock, discountType, discountValue
        └── ProductImage[]     (max 5, shared between UNIT+PACK of same color)
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
  └── Easy-Express (eeTrackingId?, eeLabelUrl?)
```

### File Storage
- **Kbis documents** → `private/uploads/kbis/` (outside `/public`, served via `/api/admin/kbis/[filename]` with ADMIN auth check)
- **Product images** → `public/uploads/products/` (publicly accessible, served directly)

### Server Actions
All mutations go through Server Actions in `app/actions/`. Each action calls `requireAdmin()` or `requireAuth()` (verifies session server-side) before doing anything. Actions call `revalidatePath()` to bust the Next.js cache.

### Styling Conventions
- **Tailwind CSS v4** — no `tailwind.config.js`; theme tokens are defined in `app/globals.css` inside `@theme inline {}`
- **Spring theme palette** (mars 2026) — see `.claude/memory/theme-printemps.md` for full palette
- Primary CTA: `#C2516A` (rose), surface: `#FEFAF6` (ivory), text: `#1C1018` (plum), accent: `#7A9E87` (sage)
- Fonts via CSS variables: `var(--font-poppins)` for headings, `var(--font-roboto)` for body — reference them as `font-[family-name:var(--font-poppins)]` in Tailwind classes
- Reusable CSS utilities: `.btn-primary`, `.btn-outline`, `.field-input`, `.container-site`, `.section-title`, `.shadow-spring`, `.gradient-spring`

### Zod Validation
Use `.issues` not `.errors` when accessing ZodError details — `.errors` does not exist on the TypeScript type in this version.

### Key Libraries
- **Prisma 5.22.0** (not v7 — v7 has breaking changes incompatible with this project)
- **NextAuth 4** (not v5)
- **Zod 3**
- `bcryptjs` (12 salt rounds) for password hashing
- `pdfkit` for PDF generation — requires `serverExternalPackages: ["pdfkit"]` in `next.config.ts`
- `nodemailer` for transactional email (Gmail App Password)

### Easy-Express v3 Integration
- Base URL: `https://easy-express.fr`
- Auth: `Authorization: Bearer <EASY_EXPRESS_API_KEY>`
- Flow: `POST /api/v3/shipments/rates` → transactionId → `POST /api/v3/shipments/checkout`
- Prices in **centimes** → divide by 100 for euros
- Minimum weight: 1 kg (`Math.max(1, weightKg)`)
- transactionId expires quickly — use immediately after /rates
