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

### Validation par 9 testeurs IA (TRÈS IMPORTANT — obligatoire après chaque tâche)
**TRÈS IMPORTANT** : Après chaque tâche terminée, lancer **9 sous-agents testeurs** en parallèle (3 équipes × 3 testeurs). Chaque testeur reçoit un **brief du Rédacteur** qui reformule précisément la demande originale de l'utilisateur, les critères d'acceptation, et ce que chaque testeur doit vérifier de son côté. Le Rédacteur doit s'assurer que chaque testeur comprend parfaitement les besoins de l'utilisateur pour que chacun puisse vérifier indépendamment si la demande est **entièrement** satisfaite.

**TRÈS IMPORTANT** : À chaque prompt envoyé aux testeurs, inclure la mention **« TRÈS IMPORTANT »** pour souligner la criticité de la vérification, même si la tâche semble simple ou évidente.

#### Équipe 1 — Testeurs Fonctionnels (3 testeurs)
1. **Testeur Fonctionnel A (Cas nominal)** — Vérifie que le code fait exactement ce qui était demandé, que le comportement attendu est respecté dans le scénario principal, et que les données sont correctes.
2. **Testeur Fonctionnel B (Cas limites)** — Vérifie les edge cases : données vides, valeurs nulles, listes très longues, caractères spéciaux, permissions insuffisantes, doublons, et toute situation inhabituelle.
3. **Testeur Fonctionnel C (Régressions)** — Vérifie qu'aucune fonctionnalité existante n'a été cassée par les changements, que les flux adjacents fonctionnent toujours, et que les données existantes restent intactes.

#### Équipe 2 — Testeurs UI/UX (3 testeurs)
4. **Testeur UI/UX A (Responsive)** — Vérifie le rendu sur mobile (320px–480px), tablette (768px–1024px) et desktop (1280px+). Grilles, overflow, textes tronqués, images déformées.
5. **Testeur UI/UX B (Accessibilité)** — Vérifie les attributs ARIA, les touch targets (min 44px), le contraste des couleurs, la navigation clavier, le focus visible, et le support RTL (arabe).
6. **Testeur UI/UX C (Cohérence visuelle)** — Vérifie la conformité avec le design system monochrome (palette, fonts Poppins/Roboto, badges `badge badge-*`, CSS utilities existantes), les animations, les transitions, et le dark mode admin.

#### Équipe 3 — Testeurs Techniques (3 testeurs)
7. **Testeur Technique A (Lint & TypeScript)** — Exécute `npm run lint`, vérifie la compatibilité TypeScript stricte, les imports corrects, et l'absence d'erreurs de compilation.
8. **Testeur Technique B (Conventions & Architecture)** — Vérifie les conventions Prisma/NextAuth/Zod, l'utilisation de `requireAdmin()`/`requireAuth()`, les `revalidateTag` à 2 args, les `getCached*`, et le respect de l'architecture documentée.
9. **Testeur Technique C (Performance & Sécurité)** — Vérifie l'absence de requêtes N+1, de re-renders inutiles, de failles OWASP (XSS, injection, IDOR), et que `lib/security.ts` est utilisé dans les flux d'auth.

#### Rôle du Rédacteur (TRÈS IMPORTANT)
**TRÈS IMPORTANT** : Avant de lancer les 9 testeurs, le **Rédacteur** doit :
1. **Reformuler** la demande originale de l'utilisateur de manière claire et précise
2. **Lister les critères d'acceptation** : qu'est-ce qui doit fonctionner pour que la demande soit considérée comme 100% satisfaite ?
3. **Rédiger un brief personnalisé** pour chaque testeur, adapté à son angle de test, en incluant systématiquement : la demande utilisateur, les fichiers modifiés, les points spécifiques à vérifier
4. **Inclure « TRÈS IMPORTANT »** dans chaque brief envoyé aux testeurs

#### Règle de consensus (TRÈS IMPORTANT)
**TRÈS IMPORTANT** : Si **au moins un** testeur sur les 9 signale un problème, il produit un rapport détaillé. Le problème doit être corrigé, puis **les 9 testeurs repassent** jusqu'à ce que **tous** soient d'accord (zéro désaccord). On ne passe à la tâche suivante que quand les 9 testeurs valident unanimement que la demande de l'utilisateur est **entièrement** satisfaite.

### Résumé et guide de test (obligatoire après chaque tâche)
À la fin de chaque tâche terminée, fournir :
1. **Résumé des changements** — Liste concise de tout ce qui a été fait (fichiers créés/modifiés, fonctionnalités ajoutées, corrections apportées).
2. **Guide de test détaillé** — Étapes numérotées et précises que l'utilisateur peut suivre pour tester manuellement chaque aspect de la tâche :
   - Pré-requis (serveur lancé, données à préparer, etc.)
   - Scénarios à tester (cas nominal, cas limites, erreurs)
   - Ce qu'il faut vérifier visuellement (responsive, animations, etc.)
   - Comportement attendu à chaque étape

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
  │     ├── unitPrice, weight, stock, discountType, discountValue, size, packQuantity, pfsVariantId?
  │     ├── ProductColorSubColor[]  (optional sub-colors, e.g. Doré → Rouge, Noir)
  │     └── ProductColorImage[]     (max 5 per variant, linked via productColorId)
  ├── ProductTranslation[]    (locale: "en"|"ar"|"zh"|"de"|"es"|"it" — auto-translated name+description)
  ├── ProductSimilar[]        (M2M self-relation for "you may also like")
  ├── PendingSimilar[]        (deferred similar links — resolved when target product is created)
  ├── ProductComposition[]    (material + percentage, e.g. 85% acier)
  ├── ProductTag[]            (tags for search)
  └── RestockAlert[]          (client alerts when out-of-stock variant is restocked)
```
- `Color` model has optional `patternImage` (leopard, camouflage, etc.) — takes priority over hex. Also has `pfsColorRef` (PFS color reference like "GOLDEN")
- `Category` model has `pfsCategoryId` (PFS category ID for reverse sync)
- `Composition` model has `pfsCompositionRef` (PFS composition reference like "ACIERINOXYDABLE")
- `ManufacturingCountry` model has `pfsCountryRef` (PFS country ISO code like "CN", "TR")
- `Season` model has `pfsSeasonRef` (PFS collection reference like "PE2026", "AH2025")
- `Product` has `manufacturingCountryId` (FK → ManufacturingCountry), `seasonId` (FK → Season)
- `Product` has `pfsSyncStatus` (null|"pending"|"synced"|"failed"), `pfsSyncError` (error message), `pfsSyncedAt` (last successful sync)
- `ProductStatus` enum: `OFFLINE` | `ONLINE` | `ARCHIVED` | `SYNCING` (archived = invisible but preserved for order history; SYNCING = PFS sync in progress, becomes ONLINE after images downloaded)
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
| Email attachments | `private/uploads/email-attachments/` | Internal (sent via nodemailer) |

### Image Processing (`lib/image-processor.ts`)
All image uploads (manual and bulk import) pass through `processProductImage()`:
- Auto-rotates based on EXIF orientation, then converts to **WebP** in 3 sizes: large (1200px, q90), medium (800px, q82), thumb (400px, q80)
- DB stores only the large path (e.g. `/uploads/products/abc.webp`); medium/thumb are `_md.webp` / `_thumb.webp` on disk
- Use `getImageSrc(storedPath, "thumb"|"medium"|"large")` to derive the correct URL for display
- **Manual rotation**: `POST /api/admin/products/images/rotate` rotates all 3 variants (large/md/thumb) 90° clockwise via sharp; returns `cacheBuster` to force browser refresh

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
- **`SentEmail`** — admin-sent emails history (toEmail, subject, htmlBody, attachments JSON, userId?, adminId); indexed by userId/toEmail/sentAt
- **`TranslationQuota`** — tracks monthly character usage per translation provider (`provider` + `monthYear`); `@@unique([provider, monthYear])`
- **`CategoryTranslation`** / **`SubCategoryTranslation`** / **`ColorTranslation`** / **`CompositionTranslation`** / **`ManufacturingCountryTranslation`** / **`SeasonTranslation`** — auto-translated names per locale (same pattern as `ProductTranslation`)
- **`ManufacturingCountry`** — pays de fabrication (`name` unique, `isoCode` unique optional, `pfsCountryRef` optional); admin CRUD at `/admin/pays`
- **`Season`** — saisons/collections (`name` unique, `pfsSeasonRef` unique optional); admin CRUD at `/admin/saisons`

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
- Reusable CSS utilities: `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.field-input`, `.field-label`, `.container-site`, `.card`, `.card-hover`, `.badge-success`, `.badge-warning`, `.badge-error`, `.badge-neutral`, `.badge-info`, `.badge-purple`, `.stat-card`, `.table-header`, `.table-row`, `.sidebar-item`, `.sidebar-active`, `.page-title`, `.page-subtitle`
- **Badge convention (OBLIGATOIRE)**: tout badge de statut DOIT utiliser la classe de base `badge` + une variante : `<span className="badge badge-success">Texte</span>`. La classe `badge` apporte le padding, le border-radius pill, le dot clignotant coloré et la bordure. Variantes : `badge-success` (vert), `badge-warning` (ambre, pulse rapide), `badge-error` (rouge), `badge-neutral` (gris), `badge-info` (bleu), `badge-purple` (violet, pour PACK/SHIPPED). **Ne JAMAIS** utiliser de styles inline pour des badges de statut — toujours `badge badge-*`
- Variant form utilities: `.drawer-variant-container`, `.variant-drawer`, `.variant-input`, `.variant-select`, `.bulk-variant-bar`
- Scroll-reveal classes: `.reveal`, `.reveal-up`, `.reveal-down`, `.reveal-left`, `.reveal-right`, `.reveal-zoom`, `.reveal-blur` + `.stagger-1` through `.stagger-8`
- Animations: `.animate-fadeIn`, `.animate-slideIn`, `.animate-float`, `.animate-shimmer`, `.animate-cart-bounce`, and many more keyframes in `globals.css`
- Misc utilities: `.no-scrollbar` (hides scrollbars), `.checkbox-custom`, `.section-title`
- Admin forms: split into separate blocks with `bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]` — always use CSS variable classes (`bg-bg-primary`, `text-text-primary`, `border-border`, `bg-bg-secondary`, `text-text-secondary`) for dark mode compatibility, never hardcode `bg-white` or `text-[#1A1A1A]` in admin components

### Key Components
- **Public header**: `PublicSidebar.tsx` (NOT `Navbar.tsx`) — logo, functional search bar, nav links, cart
- **Admin mobile**: `AdminMobileNav.tsx` — hamburger + slide-in drawer with all nav links
- **3D Hero**: `JewelryScene.tsx` loaded via `JewelrySceneLoader.tsx` (client wrapper for `ssr: false`)
- **Product form**: `ProductForm.tsx` — 4 separate blocks (fiche produit, mots-clés, dimensions, composition). Includes unsaved changes guard (`beforeunload` + global link click interception → `ConfirmDialog`)
- **Live client tracking**: `LiveClientsTracker.tsx` — real-time view of connected clients at `/admin/suivi`
- **Cart modal**: `CartModal.tsx` — admin can peek at a client's current cart
- **Reusable UI**: `ConfirmDialog.tsx` (replaces window.confirm), `CustomSelect.tsx` (searchable select), `Toast.tsx`, `ColorSwatch.tsx` (single/multi-color swatch with patternImage support — renders camembert pie chart for multi-color variants)
- **Import history**: `ImportHistoryClient.tsx` — view past import jobs at `/admin/produits/importer/historique`
- **PFS Sync**: `/admin/pfs` — synchronize products from Paris Fashion Shop marketplace
- **Admin email compose**: `ComposeEmailDrawer.tsx` — Gmail-style drawer (bottom-right, minimizable) with rich text editor, file attachments, client autocomplete. Context via `EmailComposeProvider` + `useEmailCompose()`. Trigger from anywhere via `SendEmailButton` component. API: `POST /api/admin/emails/send`, `GET /api/admin/emails` (history), `GET /api/admin/users/search` (autocomplete)

### PFS Sync System (`lib/pfs-auth.ts`, `lib/pfs-api.ts`, `lib/pfs-sync.ts`)
- **Token management** (`lib/pfs-auth.ts`): in-memory cache with auto-refresh 10 min before expiration
- **API client** (`lib/pfs-api.ts`): wraps 3 tested endpoints with retry + exponential backoff
  - `pfsListProducts(page)` — paginated product list (buggy weight/pieces — use /variants)
  - `pfsCheckReference(ref)` — composition, description, collection, country
  - `pfsGetVariants(id)` — correct weight, packQuantity, total price
- **Sync processor** (`lib/pfs-sync.ts`): maps PFS → BJ data model, creates/updates products
  - `findOrCreateColor/Category/Composition` check `PfsMapping` first, then DB, then auto-create
  - Orphaned mapping cleanup: if a mapping points to a deleted entity, it's auto-removed
  - Downloads images from CDN → WebP with fallback (base ref → versioned ref)
  - Image download: 15s timeout, retry with 3s→6s→12s backoff, min 1KB size check
  - Supports resume via `lastPage` in `PfsSyncJob`
  - **Prices**: PFS and BJ prices are identical (no markup transformation)
  - **Reference versioning**: PFS refs end with "VS1"/"VS2" (e.g. "A200VS3") → stripped to base "A200" for BJ
  - **Primary color detection**: `detectDefaultColorRef()` matches `DEFAULT` image key to a color variant, or uses `default_color` from checkReference
  - **2-pipeline architecture**: product data creation (batches of 10) runs separately from image downloading (background pool of 15 concurrent tasks)
  - Products created as `SYNCING` status → automatically set to `ONLINE` after images downloaded
  - **Playwright fallback** for stubborn image downloads: single Chromium browser, up to 5 browser contexts with diverse fingerprints (different User-Agents, viewports, locales, timezones), lazy-initialized, closed at end of sync via `closePlaywright()`
  - **Page-level parallelism**: fetches 10 API pages simultaneously (1000 products per wave)
- **Pre-validation flow** (2-step sync):
  1. `POST /api/admin/pfs-sync/analyze` — SSE streaming dry-run: scans PFS products in parallel (10 pages at a time), detects missing categories/colors/compositions
  2. Admin reviews & edits names/hex/patterns in UI → `POST /api/admin/pfs-sync/create-entities` creates them + saves `PfsMapping`
  3. `POST /api/admin/pfs-sync` — actual sync starts (entities already exist)
- **API routes**: `POST /api/admin/pfs-sync` (start), `GET /api/admin/pfs-sync` (status), `POST /api/admin/pfs-sync/resume` (resume failed), `POST /api/admin/pfs-sync/analyze` (dry-run SSE), `POST /api/admin/pfs-sync/create-entities` (create validated entities), `POST /api/admin/pfs-sync/retry` (retry failed products by reference), `POST /api/admin/pfs-sync/cancel` (cancel running sync + reset SYNCING products to OFFLINE)
- **Dual console UI**: `/admin/pfs` displays two live consoles — product creation logs + image download logs with stats header (completed/active/pending/failed)
- **DB models**: `PfsSyncJob` tracks progress (dual logs: `productLogs` + `imageLogs` + `imageStats` in `logs` JSON field); `Product.pfsProductId` links to PFS product ID; `PfsMapping` remembers PFS name → BJ entity associations across syncs
- **Prepare & Review flow** (`lib/pfs-prepare.ts`): 2-step staged import — `PfsPrepareJob` scans PFS products → creates `PfsStagedProduct` entries (status: PREPARING → READY) → admin reviews/edits variants, images, compositions in `/admin/pfs/historique/[id]` → approves → `approveStagedProduct()` creates the real `Product` in DB. Staged products store `variants`, `compositions`, `translations`, `imagesByColor` as JSON. On approve, FK integrity is verified (category + colors re-resolved if deleted between prepare and approve).

### PFS Reverse Sync — BJ → PFS (`lib/pfs-api-write.ts`, `lib/pfs-reverse-sync.ts`)
- **Full auto**: every `createProduct`, `updateProduct`, `archiveProduct`, `unarchiveProduct`, `bulkUpdateProductStatus`, `updateVariantQuick`, `bulkUpdateVariants` triggers a non-blocking push to PFS via `triggerPfsSync(productId)`
- **Write API client** (`lib/pfs-api-write.ts`): wraps all PFS write endpoints (create/update product, create/update/delete variants, upload image, update status, AI translations) with retry + backoff
- **Reverse sync logic** (`lib/pfs-reverse-sync.ts`): loads BJ product → translates name/description via PFS AI (`POST /ai/translations`) → creates or updates on PFS → syncs variants (create/update/delete, `is_active: false` if stock=0) → converts WebP → JPEG and uploads images → syncs status (ONLINE→READY_FOR_SALE, OFFLINE→DRAFT, ARCHIVED→ARCHIVED)
- **Non-blocking**: `triggerPfsSync()` is fire-and-forget. Updates `Product.pfsSyncStatus` in DB: `null` (never synced), `"pending"` (in progress), `"synced"` (success), `"failed"` (error with message in `pfsSyncError`)
- **Prices**: BJ and PFS prices are identical — no markup transformation applied
- **Image conversion**: WebP → JPEG via sharp before upload (PFS rejects WebP)
- **PFS AI translations**: `pfsTranslate(name, description)` calls `POST /ai/translations` — returns fr/en/de/es/it translations. Used automatically during reverse sync for product labels/descriptions sent to PFS.
- **Entity mapping required**: `Color.pfsColorRef` (PFS color reference like "GOLDEN"), `Category.pfsCategoryId` (PFS category ID), `Composition.pfsCompositionRef` (PFS composition reference like "ACIERINOXYDABLE"). Entities without PFS mapping are skipped.
- **Entity mapping uniqueness**: each PFS ref can only be linked to ONE BJ entity (enforced in server actions + create-entities endpoint). Mapping UI disables already-used PFS refs.
- **Auto-fill mapping on entity creation**: when `POST /api/admin/pfs-sync/create-entities` creates colors/categories/compositions during pre-validation, PFS refs (`pfsColorRef`, `pfsCategoryId`, `pfsCompositionRef`) are stored automatically — no need for manual mapping afterwards.
- **Variant tracking**: `ProductColor.pfsVariantId` stores the PFS variant ID for updates/deletes. New variants are created on PFS and ID stored back. Variants with stock=0 are set `is_active: false` on PFS.
- **PFS attributes API**: `GET /api/admin/pfs-sync/attributes` — fetches available PFS colors/categories/compositions/countries/collections for mapping in admin UI
- **Mapping admin UI**: `/admin/pfs/mapping` — 5-tab page (Couleurs, Catégories, Compositions, Pays, Saisons) to link BJ entities to PFS equivalents. Already-used refs are disabled in dropdowns.
- **Server actions for mapping**: `updateColorPfsRef()`, `updateCategoryPfsId()`, `updateCompositionPfsRef()`, `updateManufacturingCountryPfsRef()`, `updateSeasonPfsRef()` — set PFS references on existing entities (with uniqueness check)
- **Quick-create with PFS mapping**: `createColorQuick()`, `createCategoryQuick()`, `createCompositionQuick()` accept optional PFS reference params

### Real-Time Product Updates (SSE)
- **Event emitter** (`lib/product-events.ts`): in-memory pub/sub via `globalThis` singleton (shared across server actions + API routes)
- **SSE endpoint**: `GET /api/products/stream` — streams `ProductEvent` objects to connected clients; heartbeat every 30s; auto-cleanup on disconnect
- **Single product fetch**: `GET /api/products/[id]/live` — returns a product in the same shape as the listing API (used by SSE clients to refresh card data)
- **Client hook**: `useProductStream()` in `hooks/useProductStream.ts` — auto-reconnects after 5s on disconnect
- **Integration**: `ProductsInfiniteScroll.tsx` listens to SSE and updates cards in real-time with animations (`animate-live-pop` for new/refreshed, `animate-live-pulse` for updates, fade-out for removed)
- **Event types**: `PRODUCT_ONLINE`, `PRODUCT_OFFLINE`, `PRODUCT_UPDATED`, `STOCK_CHANGED`, `BESTSELLER_CHANGED`
- **Emitters**: `createProduct`, `updateProduct`, `bulkUpdateProductStatus`, `archiveProduct`, `updateVariantQuick`, `bulkUpdateVariants`, `refreshProduct` all call `emitProductEvent()` after their DB mutations
- **Important**: uses `globalThis` to share the listener Set — do NOT use module-level `const` (Next.js may create separate module instances for server actions vs API routes)

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
- `getCachedCategories/Collections/Colors/Tags/ManufacturingCountries/Seasons` — reference data (5min)
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
- **Color change on variant groups**: `handleMultiColorChange` accepts a `Set<string>` of tempIds and applies the color patch in a **single** `onChange` call. Never call `updateVariant` in a loop — each call uses the same stale `variants` reference, causing only the last variant to be updated
- **Never group/display color variants by `colorId` alone** — always use `groupKey` (colorId + ordered sub-color names, **order matters**). Keying by `colorId` merges variants with different sub-colors; keying by `variantTempId` prevents UNIT/PACK image sharing. See `variantGroupKeyFromState()` in `ColorVariantManager.tsx`
- **Always display the FULL color composition** — whenever showing a color (variants, images, swatches), display ALL colors in the composition (e.g. "Blanc, Rouge, Jaune"), never just the main color name alone. Use `ColorSwatch` with `subColors` segments for multi-color variants. This applies everywhere: PFS review, edit modals, product detail, image grouping headers.

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
- `playwright` for PFS image download fallback (Chromium headless, multi-context fingerprinting)

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
