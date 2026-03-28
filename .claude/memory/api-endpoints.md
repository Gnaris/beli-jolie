---
name: API Endpoints & Server Actions
description: Complete reference of all API routes, server actions, their methods, auth requirements, and purposes
type: reference
---

# API Routes & Server Actions

## API Routes (app/api/)

### Authentification

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth | Handler universel NextAuth (signin, signout, session, callback) |
| `/api/auth/register` | POST | Public | Inscription B2B (FormData: email, SIRET, password, Kbis PDF) → status=PENDING |

### Produits (Public)

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/products` | GET | Public | Catalogue paginé (20/page) avec filtres: search, category, collection, color, tag, bestseller, new, price range |
| `/api/products/search` | GET | Public | Autocomplete header (8 résultats max), scoring: ref(4pts) > name(3) > category(2) > tags(1) |

### Admin — Produits

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/admin/products/search` | GET | ADMIN | Recherche produits pour sélecteur (12 résultats, exclut un produit donné) |
| `/api/admin/products/images` | POST | ADMIN | Upload image produit → `/public/uploads/products/` (JPG/PNG/WEBP/GIF, max 3MB) |

### Admin — Collections

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/admin/collections/[id]` | GET | ADMIN | Détail collection avec produits |
| `/api/admin/collections/images` | POST | ADMIN | Upload image collection → `/public/uploads/collections/` (max 5MB) |
| `/api/admin/collections/products` | GET | ADMIN | Liste tous les produits pour gestion collection |

### Admin — Commandes

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/admin/commandes/[id]/pdf` | GET | ADMIN | Génère et télécharge le PDF bon de commande |
| `/api/admin/commandes/[id]/label` | GET | ADMIN | Télécharge l'étiquette Easy-Express (PDF) |
| `/api/admin/commandes/[id]/invoice` | GET | ADMIN | Télécharge la facture uploadée |
| `/api/admin/commandes/[id]/invoice` | POST | ADMIN | Upload facture PDF → `/private/uploads/invoices/` |
| `/api/admin/commandes/[id]/invoice` | DELETE | ADMIN | Supprime la facture |

### Admin — Fichiers

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/admin/kbis/[filename]` | GET | ADMIN | Sert les Kbis depuis `/private/uploads/kbis/` (filename sanitisé) |

### Client — Commandes

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/client/commandes/[id]/invoice` | GET | Session | Télécharge facture (vérifie userId = propriétaire) |
| `/api/client/commandes/[id]/bank-details` | GET | Session | Instructions virement bancaire (IBAN, BIC, montant) |

### Panier & Favoris

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/cart/count` | GET | Session (opt) | Nombre d'articles dans le panier (0 si non connecté) |
| `/api/favorites` | GET | CLIENT | Liste des IDs produits favoris |

### Livraison & Validation

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/carriers` | POST | Session | Devis transporteurs via Easy-Express (+5€ marge), fallback hardcodé |
| `/api/vies` | GET | Session | Validation TVA intracommunautaire (API VIES UE) |

### Paiements (Stripe)

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/api/payments/create-intent` | POST | Session | Crée PaymentIntent Stripe (carte + virement bancaire) |
| `/api/payments/webhook` | POST | Signature Stripe | Webhook: payment_intent.succeeded/processing/failed → met à jour commande |

---

## Server Actions (app/actions/)

### Admin — Catégories (`admin/categories.ts`)
- `createCategory(formData)` — Crée catégorie avec slug
- `deleteCategory(id)` — Supprime catégorie
- `createSubCategory(formData)` — Crée sous-catégorie
- `deleteSubCategory(id)` — Supprime sous-catégorie

### Admin — Collections (`admin/collections.ts`)
- `getCollections()` — Liste avec compte produits
- `createCollection(formData)` — Crée collection (nom + image optionnelle)
- `updateCollection(id, formData)` — Met à jour nom/image
- `deleteCollection(id)` — Supprime collection
- `addProductToCollection(collectionId, productId, colorId?)` — Ajoute produit
- `removeProductFromCollection(collectionId, productId)` — Retire produit
- `updateCollectionProductColor(collectionId, productId, colorId)` — Change couleur affichée
- `reorderCollectionProducts(collectionId, items[])` — Réordonne produits

### Admin — Couleurs (`admin/colors.ts`)
- `createColor(formData)` — Crée couleur (nom + hex optionnel)
- `updateColor(id, formData)` — Met à jour couleur
- `deleteColor(id)` — Supprime (vérifie non utilisée)

### Admin — Compositions (`admin/compositions.ts`)
- `createComposition(formData)` — Crée composition
- `updateComposition(id, formData)` — Met à jour
- `deleteComposition(id)` — Supprime (vérifie non utilisée)

### Admin — Commandes (`admin/orders.ts`)
- `updateOrderStatus(orderId, status)` — Change statut (PENDING→PROCESSING→SHIPPED→DELIVERED|CANCELLED)

### Admin — Produits (`admin/products.ts`)
- `createProduct(input: ProductInput)` — Crée produit avec structure imbriquée complète
- `updateProduct(id, input)` — Met à jour (transaction, supprime CartItems obsolètes)
- `deleteProduct(id)` — Supprime (cascade)
- `getAllTags()` — Liste tous les tags
- `createTag(name)` — Upsert tag (lowercase)
- `deleteTag(id)` — Supprime tag

### Admin — Création rapide (`admin/products.ts`)
- `createColorQuick(name, hex?)` — Crée couleur inline
- `createCategoryQuick(name)` — Crée catégorie inline
- `createCompositionQuick(name)` — Crée composition inline
- `createSubCategoryQuick(name, categoryId)` — Crée sous-catégorie inline

### Admin — Utilisateurs (`admin/users.ts`)
- `updateUserStatus(userId, status)` — Approuve/rejette compte
- `deleteUser(userId)` — Supprime utilisateur + commandes (transaction)

### Client — Panier (`client/cart.ts`)
- `getCart()` — Panier complet avec articles
- `getCartCount()` — Nombre total d'articles
- `addToCart(saleOptionId, quantity?)` — Ajoute/incrémente article
- `updateCartItem(cartItemId, quantity)` — Met à jour quantité (supprime si ≤0)
- `removeFromCart(cartItemId)` — Supprime article
- `clearCart()` — Vide le panier
- `getShippingAddresses()` — Adresses de livraison
- `saveShippingAddress(data)` — Crée/met à jour adresse
- `deleteShippingAddress(addressId)` — Supprime adresse

### Client — Favoris (`client/favorites.ts`)
- `toggleFavorite(productId)` — Bascule favori on/off
- `getFavoriteIds()` — IDs des produits favoris

### Client — Commandes (`client/order.ts`)
- `placeOrder(input)` — Passe commande (vérifie PI Stripe, calcule TVA, Easy-Express, PDF, email admin)
- `cancelOrder(orderId)` — Annule commande (si PENDING uniquement)

### Client — Profil (`client/profile.ts`)
- `updateProfile(data)` — Met à jour infos compte
