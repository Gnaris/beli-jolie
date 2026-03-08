# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npx tsx scripts/create-admin.ts   # Create admin@belijolie.fr / Admin2025!
```

> **After `prisma db push`**: restart the dev server — it locks the generated `.dll` file and `generate` will fail otherwise.

## Environment

Copy `.env.example` to `.env`:
```
DATABASE_URL="mysql://root@localhost:3306/beli_jolie"
NEXTAUTH_SECRET="<random base64 string>"
NEXTAUTH_URL="http://localhost:3000"
```

## Architecture

### Route Groups
The app uses three Next.js route groups with separate layouts:

| Group | Path | Who can access |
|---|---|---|
| `(auth)` | `/connexion`, `/inscription` | Unauthenticated only (redirects if logged in) |
| `(admin)` | `/admin/*` | ADMIN role only |
| `(client)` | `/espace-pro/*` | CLIENT role only |

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

### File Storage
- **Kbis documents** → `private/uploads/kbis/` (outside `/public`, served via `/api/admin/kbis/[filename]` with ADMIN auth check)
- **Product images** → `public/uploads/products/` (publicly accessible, served directly)

### Server Actions
All mutations go through Server Actions in `app/actions/admin/`. Each action calls `requireAdmin()` (verifies session server-side) before doing anything. Actions call `revalidatePath()` to bust the Next.js cache.

### Styling Conventions
- **Tailwind CSS v4** — no `tailwind.config.js`; theme tokens are defined in `app/globals.css` inside `@theme inline {}`
- Color palette: `#2C2418` (dark brown text), `#8B7355` (gold CTA), `#B8A48A` (muted gold), `#F7F3EC` (cream bg), `#EDE8DF` (beige), `#D4CCBE` (borders)
- Fonts via CSS variables: `var(--font-poppins)` for headings, `var(--font-roboto)` for body — reference them as `font-[family-name:var(--font-poppins)]` in Tailwind classes
- Reusable CSS utilities: `.btn-primary`, `.btn-outline`, `.field-input`, `.container-site`, `.section-title`

### Zod Validation
Use `.issues` not `.errors` when accessing ZodError details — `.errors` does not exist on the TypeScript type in this version.

### Key Libraries
- **Prisma 5.22.0** (not v7 — v7 has breaking changes incompatible with this project)
- **NextAuth 4** (not v5)
- **Zod 3**
- `bcryptjs` (12 salt rounds) for password hashing
