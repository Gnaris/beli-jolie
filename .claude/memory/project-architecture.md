---
name: Project Architecture
description: Complete architecture reference - route groups, data models, file storage, middleware, integrations, dependencies
type: reference
---

# Architecture Complète

## Stack Technique

| Outil | Version | Usage |
|-------|---------|-------|
| Next.js | 16.1.6 | Framework React (App Router, Server Components) |
| React | 19.2.3 | UI |
| NextAuth | 4.24.13 | Auth (JWT + Credentials, 30j) |
| Prisma | 5.22.0 | ORM MySQL (**pas v7** — breaking changes) |
| Tailwind CSS | 4 | Styles (config dans `globals.css`, pas de `tailwind.config.js`) |
| Zod | 4.3.6 | Validation (`.issues` pas `.errors` pour ZodError) |
| Stripe | 20.4.1 | Paiements (carte + virement bancaire) |
| PDFKit | 0.17.2 | Génération PDF (`serverExternalPackages` dans next.config) |
| Nodemailer | 7.0.13 | Email (Gmail App Password) |
| Recharts | 3.8.0 | Graphiques admin |
| bcryptjs | 3.0.3 | Hash mots de passe (12 rounds) |

## Route Groups & Protection

```
(auth)    → /connexion, /inscription         → Non-authentifié uniquement
(admin)   → /admin/*                         → Rôle ADMIN uniquement
(client)  → /espace-pro, /panier, /commandes → Rôle CLIENT (APPROVED)
public    → /, /produits, /categories, /collections → Connecté (redirige sinon)
```

Protection double : `middleware.ts` (edge) + chaque `layout.tsx` (server-side fallback).

## Pages (31 total)

### Publiques (connecté requis)
- `/` — Accueil : hero 3D Three.js, carousels (réassort, nouveautés, bestsellers), collections
- `/produits` — Catalogue infinite scroll avec filtres
- `/produits/[id]` — Détail produit (variantes couleur, images, add-to-cart)
- `/categories` — Navigation par catégories/sous-catégories
- `/collections` — Liste des collections
- `/collections/[id]` — Détail collection

### Auth
- `/connexion` — Login (email/password)
- `/inscription` — Inscription B2B (company, SIRET, Kbis)

### Client (CLIENT + APPROVED)
- `/espace-pro` — Dashboard client (infos compte, stats commandes)
- `/favoris` — Produits favoris
- `/panier` — Panier d'achat
- `/panier/commande` — Checkout (adresse, transporteur, paiement Stripe)
- `/commandes` — Liste commandes + tracking
- `/commandes/[id]` — Détail commande + facture

### Admin (9 sections)
- `/admin` — Dashboard (stats, comptes en attente)
- `/admin/utilisateurs` + `/[id]` — Gestion clients (approve/reject, Kbis)
- `/admin/produits` + `/nouveau` + `/[id]/modifier` — CRUD produits
- `/admin/commandes` + `/[id]` — Gestion commandes (statut, Easy-Express, factures)
- `/admin/collections` + `/nouveau` + `/[id]/modifier` — CRUD collections
- `/admin/categories` — CRUD catégories/sous-catégories
- `/admin/couleurs` + `/[id]/modifier` — Bibliothèque couleurs
- `/admin/compositions` + `/[id]/modifier` — Bibliothèque compositions
- `/admin/mots-cles` — Gestion tags/mots-clés

## Modèle de Données Prisma (MySQL)

### Utilisateurs
```
User (id, email, password, firstName, lastName, company, phone, siret[unique],
      kbisPath, address, vatNumber, stripeCustomerId, role[CLIENT], status[PENDING])
  → Cart (1:1), ShippingAddress[] (1:N), Order[] (1:N), Favorite[] (1:N)
```

### Produits (structure imbriquée)
```
Product (id, reference[unique], name, description, categoryId, isBestSeller,
         dimensions: length/width/height/diameter/circumference en mm)
  → ProductColor[] (variantes couleur)
      → SaleOption[] (UNIT et/ou PACK, max 2 par couleur)
          → unitPrice, weight, stock, discountType, discountValue, size, packQuantity
      → ProductImage[] (max 5, partagées UNIT+PACK même couleur)
  → ProductComposition[] (matériaux avec pourcentage)
  → ProductTag[] (mots-clés recherche)
  → ProductSimilar[] (produits similaires, bidirectionnel)
  → SubCategory[] (M2M), Collection[] (via CollectionProduct)
```

### Commandes
```
Order (id, orderNumber[BJ-YYYY-XXXXXX], userId, status[PENDING→PROCESSING→SHIPPED→DELIVERED|CANCELLED])
  → OrderItem[] (snapshots: productName, productRef, colorName, saleType, unitPrice, quantity, lineTotal)
  Shipping: shipLabel/firstName/LastName/Company/Address1/2/ZipCode/City/Country
  Client snapshot: clientCompany/Email/Phone/Siret/VatNumber
  Carrier: carrierId, carrierName, carrierPrice
  TVA: tvaRate, subtotalHT, tvaAmount, totalTTC
  Payment: stripePaymentIntentId[unique], paymentStatus[pending|paid|failed]
  Shipping: eeTrackingId, eeLabelUrl
  Admin: invoicePath
```

### Autres modèles
- `Category` (id, name[unique], slug) → `SubCategory[]`
- `Color` (id, name[unique], hex?)
- `Composition` (id, name[unique])
- `Tag` (id, name[unique])
- `Collection` (id, name, image?) → `CollectionProduct[]` (position, colorId override)
- `Cart` → `CartItem[]` (saleOptionId, quantity)
- `ShippingAddress` (label, address fields, isDefault)
- `Favorite` (userId + productId unique)

## Stockage Fichiers

| Type | Chemin | Accès |
|------|--------|-------|
| Images produits | `public/uploads/products/` | Public (direct) |
| Images collections | `public/uploads/collections/` | Public (direct) |
| Kbis clients | `private/uploads/kbis/` | ADMIN via `/api/admin/kbis/[filename]` |
| Factures | `private/uploads/invoices/` | ADMIN ou client propriétaire via API |

## Composants Clés (43 total)

### Layout
- `PublicSidebar.tsx` — Header public (logo, recherche fonctionnelle, nav, panier)
- `ClientSidebar.tsx` — Sidebar espace client
- `Navbar.tsx` — Barre navigation (non utilisée sur pages publiques, PublicSidebar est le vrai header)
- `Footer.tsx` — Pied de page
- `AdminMobileNav.tsx` — Header mobile admin + drawer navigation

### Accueil
- `HeroBanner.tsx` — Bannière hero landing page
- `ProductCarousel.tsx` — Carousel produits réutilisable
- `CollectionsGrid.tsx` — Grille collections
- `BrandInfoSection.tsx` — Section marque

### Produits
- `ProductCard.tsx` — Carte produit
- `ProductDetail.tsx` — Page détail (variantes, images, add-to-cart)
- `ProductsInfiniteScroll.tsx` — Scroll infini catalogue
- `SearchFilters.tsx` — Filtres sidebar catalogue

### Admin
- `ProductForm.tsx` — Formulaire création/édition produit (4 blocs séparés)
- `ColorVariantManager.tsx` — Gestion variantes couleur + images + options vente
- `ImageDropzone.tsx` — Upload images drag-drop
- `CollectionProductManager.tsx` — Gestion produits dans collection
- `OrderStatusActions.tsx` — Actions statut commande + Easy-Express
- `InvoiceUpload.tsx` — Upload facture PDF

## Intégrations Externes

### Easy-Express v3 (Livraison)
- Base: `https://easy-express.fr`
- Auth: `Bearer <EASY_EXPRESS_API_KEY>`
- Flux: `/api/v3/shipments/rates` → transactionId → `/api/v3/shipments/checkout`
- Prix en centimes → diviser par 100
- Poids minimum: 1 kg (`Math.max(1, weightKg)`)
- +5€ marge sur prix Easy-Express
- transactionId expire vite — utiliser immédiatement

### Stripe (Paiements)
- PaymentIntent avec carte + virement bancaire (fallback carte seule)
- Webhook: `payment_intent.succeeded/processing/failed`
- Virement bancaire: statut `awaiting_transfer` → confirmation via webhook → Easy-Express + PDF
- Customer Stripe créé si inexistant

### TVA
- France: 20%
- DOM-TOM: 0%
- EU + numéro TVA valide (VIES): 0% (autoliquidation)
- EU sans numéro TVA: 20%
- Hors-UE: 0%

### Gmail (Notifications)
- `nodemailer` avec App Password Gmail
- Notifications admin: nouvelle inscription (avec Kbis), nouvelle commande (avec PDF)

## Variables d'Environnement

```
DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL
ADMIN_EMAIL, ADMIN_PASSWORD
EASY_EXPRESS_API_KEY, EE_SENDER_* (COMPANY, SHOP_NAME, SIRET, EMAIL, PHONE, MOBILE, STREET, CITY, POSTAL_CODE, COUNTRY)
GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_EMAIL
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
```
