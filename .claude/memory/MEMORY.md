# Beli & Jolie — Mémoire Projet

## Thème actuel : Printemps (mis à jour mars 2026)
Voir `memory/theme-printemps.md` pour la palette complète et les conventions de design.

## Architecture clé
- Next.js 14 App Router avec route groups : `(auth)`, `(admin)`, `(client)`
- Prisma 5.22.0 + MySQL (`beli_jolie`)
- NextAuth v4 (Credentials + JWT 30j)
- Tailwind CSS v4 — config dans `app/globals.css` (pas de `tailwind.config.js`)
- `next.config.ts` : `serverExternalPackages: ["pdfkit"]` (obligatoire pour pdfkit)

## Fichiers importants
- `app/globals.css` — palette CSS + utilitaires (.btn-primary, .btn-outline, .field-input, .shadow-spring, .gradient-spring)
- `components/layout/Navbar.tsx` + `Footer.tsx`
- `components/produits/ProductCard.tsx`, `ProductDetail.tsx`, `SearchFilters.tsx`
- `components/auth/LoginForm.tsx`, `RegisterForm.tsx`
- `app/(auth)/layout.tsx`
- `prisma/schema.prisma`

## Système de panier (ajouté mars 2026)
- Panier persistant en base : modèles `Cart`, `CartItem`, `ShippingAddress` dans schema.prisma
- `User` a `vatNumber String?` (TVA intracommunautaire), `cart Cart?`, `addresses ShippingAddress[]`
- Server actions : `app/actions/client/cart.ts` (addToCart, removeFromCart, updateCartItem, getCart, getCartCount, getShippingAddresses, saveShippingAddress, deleteShippingAddress)
- API routes : `GET /api/cart/count`, `POST /api/carriers` (Easy-Express + fallback), `GET /api/vies?vat=XX...` (VIES EU)
- Pages : `app/(client)/panier/page.tsx` + `app/(client)/panier/commande/page.tsx`
- Composants : `components/panier/CartPageClient.tsx`, `components/panier/CheckoutClient.tsx`
- Navbar affiche badge panier via `useEffect` → `GET /api/cart/count`
- TVA : France 20%, DOM-TOM 0%, EU+vatNumber 0% (autoliquidation), EU sans vatNumber 20%, hors-UE 0%

## Système de commandes (ajouté mars 2026)
- Modèles : `Order`, `OrderItem`, enum `OrderStatus` (PENDING/PROCESSING/SHIPPED/DELIVERED/CANCELLED)
- Numéro commande : `BJ-YYYY-XXXXXX`
- Validation sans paiement (virement) — `app/actions/client/order.ts` → `placeOrder()`
- Email admin à chaque commande : HTML + PDF bon de commande + bordereau Easy-Express
- PDF généré avec pdfkit (`lib/pdf-order.ts`) — spring theme, images produits
- Admin `/admin/commandes` : liste avec filtres + recherche
- Admin `/admin/commandes/[id]` : détail, transitions statut, téléchargements
- Server action : `app/actions/admin/orders.ts` → `updateOrderStatus()`

## Intégration Easy-Express v3
- Base URL : `https://easy-express.fr`
- Auth : `Authorization: Bearer <EASY_EXPRESS_API_KEY>` (pas X-Api-Key)
- Flux en 2 étapes :
  1. `POST /api/v3/shipments/rates` → `transactionId` + liste carriers
  2. `POST /api/v3/shipments/checkout` → `trackingId` + `labelUrl`
- Prix en **centimes** dans la réponse → diviser par 100 pour avoir les euros
- Poids minimum **1 kg** (Math.max(1, weightKg))
- Le `transactionId` expire rapidement → utiliser immédiatement après /rates
- Réponse format : `{ Response: { Code: 200, Message: { transactionId, carriers[] } } }`
- Checkout réponse : `{ Response: { Message: { labels (PDF URL), parcels: [{ tracking }] } } }`
- Carriers fallback (si API échoue) préfixés `fallback_` → pas de checkout EE
- Adresse expéditeur dans `.env` : `EE_SENDER_*` (COMPANY, SIRET, STREET, CITY, POSTAL_CODE, COUNTRY, EMAIL, PHONE, MOBILE)

## Variables d'environnement requises
- `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- `EASY_EXPRESS_API_KEY` — Bearer token Easy-Express
- `EE_SENDER_COMPANY/SHOP_NAME/SIRET/EMAIL/PHONE/MOBILE/STREET/CITY/POSTAL_CODE/COUNTRY`
- `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFY_EMAIL` — notifications commandes

## Conventions mémoire & skill
- Mettre à jour `memory/theme-printemps.md` si la palette change
- Documenter tout nouveau pattern UI dans `memory/ui-patterns.md`
- Si l'utilisateur demande de modifier le skill ou la mémoire, le faire systématiquement
