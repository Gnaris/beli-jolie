# API Faire — Documentation

> **Statut** : 🚧 EN COURS DE REVERSE-ENGINEERING — chantier juin 2026. Auth simple confirmée en réel le 2026-06-12.
> Source officielle : `https://developers.faire.com/docs` (portail verrouillé, accès brand connecté requis).
> Sources complémentaires : doc archivée `faire.github.io/external-api-v2-docs`, code source `hotglue/tap-faire`, exemples Chilkat, guides Celigo / Extensiv, Faire Help Center, Postman public.
>
> Base URL **v2** : `https://www.faire.com/external-api/v2/`
> Base URL **v1** : `https://www.faire.com/api/v1/` — ⚠️ **DEPRECATED 15 décembre 2025, ne plus utiliser**.
> Identifiants : `SiteConfig.faire_api_key` (mode clé simple — **recommandé, validé en réel**) ou OAuth si plusieurs marques — chiffrés via `SENSITIVE_KEYS`.

## ⚠️ TL;DR — ce qui marche réellement (confirmé 2026-06-12)

1. **L'auth simple suffit** : un seul header `X-FAIRE-ACCESS-TOKEN: {clé}` sur **toutes** les requêtes. Pas d'OAuth, pas de refresh, pas de token endpoint. La clé est générée côté brand depuis le portail Faire (Settings → Integrations).
2. **Endpoint racine** : `https://www.faire.com/external-api/v2/`. Tout ce qui est sous `/api/v1/...` est mort.
3. **Instance EU** : `https://www.faire.com/eu/external-api/v2/` répond mais le catalogue est partagé avec l'instance US (même brand_id, même produits).
4. **Limites `limit` strictes** : `/products?limit=N` exige `10 ≤ N ≤ 250`. `/orders?limit=N` exige `10 ≤ N ≤ 50`. Hors plage = HTTP 400 explicite.
5. **Réponse vide** = `{"page":1,"limit":10,"products":[]}`. **`/products` ne liste QUE les actifs** — les DRAFT ne sont jamais retournés par GET liste. Pour retrouver un brouillon il faut connaître son `p_xxx`.
6. **Cloudflare devant** : un `User-Agent` réaliste est requis sinon HTTP 403 challenge HTML.
7. **Rate-limiting strict** : 429 dès 3-4 PATCH variant consécutifs sans pause. Prévoir backoff (≥ 1 s entre 2 PATCH variant).
8. **Encodage UTF-8** : utiliser `--data-binary @file.json` (curl) ou body brut UTF-8 ; les accents `é à è —` passent. Forcer `Content-Type: application/json; charset=utf-8`.

## Endpoints External API v2 (liste officielle confirmée doc Faire 2026-06-12)

### Auth
- Header unique : `X-FAIRE-ACCESS-TOKEN: {clé}` sur toutes les routes.

### Brands
- `GET /brands/profile` — profil de la marque connectée (devise, marchés).

### Products (catalogue)
- `GET  /products` — liste paginée (actifs seulement)
- `POST /products` — créer un produit (avec variants, images, taxonomy, made_in_country, measurements)
- `GET  /products/{product_id}` — détail produit
- `PATCH /products/{product_id}` — modifier (peut contenir `images[]`, `prices[]`, etc.)
- `DELETE /products/{product_id}` — supprimer
- `DELETE /products/{product_id}/images/{image_id}` — supprimer une image niveau produit
- `GET  /products/reviews` — avis retailers
- `GET  /products/types` — **liste complète des 2 967 `taxonomy_types`** (✨ jamais hardcoder, appeler en temps réel)
- `POST /products/upload-image` — upload multipart (alternative aux URL publiques)

### Product Variants
- `POST /products/{product_id}/variants` — ajouter une variante
- `PATCH /products/{product_id}/variants/{variant_id}` — modifier (measurements, images, lifecycle_state)
- `DELETE /products/{product_id}/variants/{variant_id}` — supprimer variante
- `DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}` — supprimer image variante
- `PATCH /products/{product_id}/variant-option-sets` — modifier les axes (Color, Size…)

### Product Prices (batch)
- `PATCH /product-prices/by-product-variant-ids`
- `PATCH /product-prices/by-skus`

⚠ **Format pour les prix EUR** (confirmé en réel) :
```json
{"prices": [{
  "geo_constraint": { "country_group": "EUROPEAN_UNION" },
  "wholesale_price": { "amount_minor": 1500, "currency": "EUR" },
  "retail_price":    { "amount_minor": 3500, "currency": "EUR" }
}]}
```
⚠ **Cohérence inter-variantes obligatoire** : Faire refuse de modifier les prix sur une seule variante isolément (« You cannot change the currencies or geographic regions for a single variant's prices… »).

✅ **Format fiable pour propager les prix EUR à toutes les variantes** : `PATCH /products/{id}` avec un body `variants[]` qui contient explicitement chaque `id` variant + son `prices[]`. Ce format marche à 100% (testé sur jupe v2 le 2026-06-12 soir). Format alternatif avec `prices[]` au niveau racine produit est INCONSTANT (a marché sur T-shirt, n'a PAS marché sur jupe — éviter). Alternative officielle : endpoints batch `PATCH /product-prices/by-skus` / `by-product-variant-ids`.
⚠ **Pays valides pour `country` (alpha-3)** : USA, CAN, GBR, AUS uniquement. Pour l'EU, utiliser `country_group: "EUROPEAN_UNION"`. Autres groupes probables (à confirmer) : `UNITED_KINGDOM`, `NORTH_AMERICA`, `AUSTRALIA`.

### Inventory (stock)
- `GET   /product-inventory/by-product-variant-ids`
- `PATCH /product-inventory/by-product-variant-ids`
- `GET   /product-inventory/by-skus`
- `PATCH /product-inventory/by-skus`
- `PATCH /products/variants/inventory-levels/by-product-variant-ids` (alias plus ancien, Chilkat)
- `PATCH /products/variants/inventory-levels/by-skus` (alias plus ancien, Chilkat)

⚠ Le `available_quantity` envoyé dans le POST initial est ignoré — toujours suivre d'un PATCH inventory.

### Prepacks (vente par carton multi-couleurs/tailles)
- `GET    /products/{product_id}/prepacks`
- `POST   /products/{product_id}/prepacks`
- `POST   /products/{product_id}/prepacks/batch`
- `GET    /products/{product_id}/prepacks/{prepack_id}`
- `DELETE /products/{product_id}/prepacks/{prepack_id}`

### Orders
- `GET /orders` — liste (limit 10-50)
- `GET /orders/{order_id}` — détail
- `PUT /orders/{order_id}/processing` — accepter / passer en traitement
- `PUT /orders/{order_id}/cancel` — annuler
- `POST /orders/{order_id}/shipments` — créer un envoi (tracking, carrier)
- `POST /orders/{order_id}/items/availability` — déclarer disponibilité / backorder
- `GET /orders/{order_id}/packing-slip/pdf` — bon de livraison PDF

### Retailers
- `GET /retailers/public/{retailer_id}` — infos publiques d'un retailer

### Mode OAuth (apps multi-brands)
Application ID + Secret existent mais réservés aux apps multi-brands. Le token endpoint n'est pas exposé publiquement. Tant qu'on reste sur une seule marque, ne pas implémenter — passer par la clé simple.

### Champs Product confirmés (réponse GET)
- `id`, `brand_id`, `idempotence_token`, `created_at`, `updated_at`
- `name`, `short_description`, `description` (UTF-8 ok)
- `lifecycle_state` (`DRAFT`/`PUBLISHED`/`RETIRED`/`DELETED`)
- `sale_state` (`FOR_SALE`/`NOT_FOR_SALE`)
- `taxonomy_type: { id, name }` (id obligatoire, format `tt_xxxxxxxxxx`)
- `made_in_country` — **ISO alpha-3** (`CHN`, `PRT`, `FRA`, …) pas alpha-2
- `unit_multiplier`, `minimum_order_quantity`, `per_style_minimum_order_quantity`
- `allow_sales_when_out_of_stock`, `preorderable`
- `images[]: { id, url, sequence, tags[] }` (Faire mirror via cdn.faire.com)
- `variants[]` (cf. plus bas)
- `variant_option_sets[]: { name, values[] }`
- `product_attributes[]` (champ encore mystère)

### Champs Variant confirmés
- `id` (`po_xxx`), `product_id`, `created_at`, `updated_at`, `idempotence_token`
- `name`, `sku`, `options[]: { name, value }`
- `lifecycle_state`, `sale_state`
- `orderability_type` (`IMMEDIATE`)
- `wholesale_price_cents`, `retail_price_cents` (devise brand par défaut)
- `prices[]: [{ geo_constraint, wholesale_price, retail_price }]` (multi-marchés)
- `available_quantity` (à pousser via inventory PATCH)
- `images[]` (4-5 max par variante)
- `measurements: { weight, mass_unit, length, width, height, distance_unit }`
  - `mass_unit` ∈ `GRAMS|KILOGRAMS|OUNCES|POUNDS`
  - `distance_unit` ∈ `CENTIMETERS|INCHES|FEET|MILLIMETERS|METERS|YARDS`
  - **Si `weight` est envoyé, `mass_unit` est obligatoire.** Idem `length/width/height` exigent `distance_unit`.

⚠️ **Différences majeures avec les autres marketplaces** :
- Pas de **sandbox public** — tests obligatoirement en compte de marque réel (créer des produits « test ») ou demander un staging à `integrations.support@faire.com`.
- **Profil de marque** à valider manuellement par Faire (logo, bannière, story) **avant** que l'API accepte la publication. Délai humain ~1-2 semaines.
- **Taxonomie figée** : pas d'auto-création de catégories à la volée (contrairement à PFS). Mapping manuel obligatoire.
- **Marge imposée** : `retail_price_cents` ≥ 2 × `wholesale_price_cents`. L'API rejette sinon.
- **Commission Faire** : 15 % + 2.5 % payment fee — confirmé via `payout_costs.commission_bps: 1500` / `payout_fee_bps: 250` dans le payload des commandes. À intégrer dans le calcul de markup côté `lib/marketplace-pricing.ts`.
- **Devise** : USD / EUR / GBP / CAD / AUD — fixée par le profil de marque, **pas** par appel API.

---

## 1. Authentification — deux régimes

### 1.1 Mode clé API simple (recommandé pour démarrer)

Côté marque Faire : **Settings > Integrations > Direct integrations > Generate API key**.
La clé s'envoie ensuite dans un header unique :

```http
X-FAIRE-ACCESS-TOKEN: {api_key}
```

Pas d'expiration documentée — la clé reste valide jusqu'à révocation manuelle. Pas de refresh à gérer.

⚠️ Faire **ne distribue pas systématiquement** de clé API aux apps custom — l'option « Direct integrations » du portail liste des partenaires pré-validés (ShipStation, Shopify, etc.). Si l'onglet n'expose pas de bouton « Generate API key » pour une app maison, il faut passer en OAuth (§1.2) après soumission de l'app à `integrations.support@faire.com`.

### 1.2 Mode OAuth 2.0 (apps custom multi-brands)

Pour une app SaaS ou interne qui doit connecter plusieurs marques. Flow :

1. Construire l'app **d'abord**, puis la soumettre via mail à `integrations.support@faire.com`.
2. Récupérer `applicationId` (client_id) + `applicationSecret` (client_secret) dans le Developer Portal.
3. Redirection OAuth standard côté marque (consent screen Faire).
4. Recevoir un `access_token` (durée à vérifier dans le portail).
5. Headers sur toutes les requêtes :

```http
X-FAIRE-OAUTH-ACCESS-TOKEN: {access_token}
X-FAIRE-APP-CREDENTIALS: {base64(client_id:client_secret)}
```

Confirmé par le code de `tap-faire/client.py` (Meltano hotglue).

### 1.3 Recommandation Beli & Jolie

**Démarrer en mode clé API simple** (§1.1). Si l'option n'est pas exposée dans le portail, basculer en OAuth avec demande à `integrations.support@faire.com`. Côté code : un helper unique `lib/faire-auth.ts` exposant `getFaireAuthHeaders()` qui retourne soit `X-FAIRE-ACCESS-TOKEN` soit le couple OAuth selon la config en BDD.

---

## 2. Headers communs

```http
Accept: application/json
Content-Type: application/json     # pour POST/PATCH avec body
X-FAIRE-ACCESS-TOKEN: {api_key}    # OU les 2 headers OAuth
```

Pas de `Content-Type` sur GET (sinon certains proxies Faire renvoient 415).

---

## 3. Modèle Produit — schéma v2 réel

Tel que confirmé par `tap-faire/streams.py` (schémas JSON canoniques) :

```jsonc
{
  "id": "p_abc123",                          // attribué par Faire, ignoré en POST
  "brand_id": "b_xyz789",                    // attribué automatiquement
  "name": "Bracelet acier inoxydable doré",  // OBLIGATOIRE
  "short_description": "Bracelet 18 cm…",
  "description": "Description longue. HTML / Markdown supportés.",
  "wholesale_price_cents": 750,              // OBLIGATOIRE — entier centimes
  "retail_price_cents": 1500,                // OBLIGATOIRE — ≥ 2× wholesale
  "sale_state": "FOR_SALE",                  // FOR_SALE | NOT_FOR_SALE
  "lifecycle_state": "PUBLISHED",            // DRAFT | PUBLISHED | RETIRED
  "unit_multiplier": 1,                      // packs / by-the-case
  "minimum_order_quantity": 1,               // MOQ produit
  "per_style_minimum_order_quantity": 1,     // MOQ par variante
  "lead_time": { "min_days": 3, "max_days": 7 },
  "country_of_manufacture": "CN",            // ISO alpha-2
  "materials": ["Stainless Steel 316L"],
  "hs_code": "7117.19.00",
  "weight_grams": 30,
  "dimensions": { "length_mm": 180, "width_mm": 5, "height_mm": 3 },
  "variant_option_sets": [
    { "name": "Color", "values": ["Or", "Argent"] },
    { "name": "Size",  "values": ["S", "M"] }
  ],
  "taxonomy_type": { "id": "tt_czw8pmzjrc", "name": "Bracelets" },
  "variants": [ /* cf. §6 */ ],
  "images": [ /* cf. §7 */ ],
  "created_at": "2026-06-12T10:00:00Z",
  "updated_at": "2026-06-12T10:00:00Z"
}
```

**Champ alternatif v2 (Celigo)** : `price.amount_minor` peut remplacer `wholesale_price_cents` dans certaines réponses. Accepter les deux en lecture, n'envoyer que `wholesale_price_cents` en écriture (compatibilité maximale).

---

## 4. Lister produits — `GET /products`

```http
GET /external-api/v2/products?page=1&limit=50&updated_at_min=2026-06-01T00:00:00Z
```

**Params** :

| Param | Type | Description |
|---|---|---|
| `page` | int (1-based) | Pagination. Tableau vide = fin. |
| `limit` | int | ≤ 100 typiquement. |
| `updated_at_min` | ISO 8601 | Sync incrémentale. |
| `include_deleted` | bool | Inclure produits supprimés/retired. |

**Réponse** :
```jsonc
{ "page": 1, "limit": 50, "products": [ /* objets produit complets */ ] }
```

⚠️ **Pas de filtre `?sku=...`** : pour retrouver un produit par référence interne, il faut soit stocker l'ID Faire dès la création (`Product.faireProductId`), soit paginer + filtrer côté client. Le mapping local reste la voie standard (cf. `pfsProductId` / `ankorsProductId`).

---

## 5. Récupérer un produit — `GET /products/{id}`

Retourne le même objet que §3 pour un produit unique. Utilisé par le live-check (équivalent `pfs-live-sync`).

---

## 6. Variantes (Options / SKUs)

### 6.1 Modèle 2 niveaux

```jsonc
"variant_option_sets": [
  { "name": "Color", "values": ["Or", "Argent"] },
  { "name": "Size",  "values": ["S", "M"] }
],
"variants": [
  {
    "sku": "BJ-BRC-001-OR-S",            // OBLIGATOIRE, unique sur la marque
    "idempotence_token": "uuid-1",       // évite les doublons sur POST réessayé
    "name": "Or / S",
    "wholesale_price_cents": 750,        // override le prix produit si défini
    "retail_price_cents": 1500,
    "available_quantity": 24,
    "active": true,
    "images": [ { "url": "https://…/bj001-or.jpg" } ],
    "options": [
      { "name": "Color", "value": "Or" },
      { "name": "Size",  "value": "S" }
    ]
  }
]
```

### 6.2 Création groupée — incluse dans `POST /products`

Le tableau `variants` est posté en même temps que le produit (cf. §8). C'est la voie la plus rapide pour notre cas (création + variantes en une transaction).

### 6.3 Édition séparée des variantes

Endpoints (alignés sur le pattern Faire, à confirmer dans le portail) :

```http
GET    /external-api/v2/products/{product_id}/options          # liste
POST   /external-api/v2/products/{product_id}/options          # ajout
PATCH  /external-api/v2/products/options/{option_id}           # modif
DELETE /external-api/v2/products/options/{option_id}           # suppression
```

### 6.4 PATCH stock + état — endpoint **CONFIRMÉ** (Chilkat)

```http
PATCH /external-api/v2/products/options/inventory-levels
Content-Type: application/json
X-FAIRE-ACCESS-TOKEN: {token}

{
  "inventories": [
    { "sku": "BJ-BRC-001-OR-S", "current_quantity": 24, "discontinued": false, "backordered_until": null },
    { "sku": "BJ-BRC-001-OR-M", "current_quantity": 0,  "discontinued": false, "backordered_until": "2026-07-01T00:00:00Z" },
    { "sku": "BJ-BRC-001-AR-S", "current_quantity": 0,  "discontinued": true,  "backordered_until": null }
  ]
}
```

**Réponse** :
```jsonc
{
  "options": [
    { "id": "po_456", "product_id": "p_abc", "active": true, "name": "Or / S",
      "sku": "BJ-BRC-001-OR-S", "available_quantity": 24,
      "wholesale_price_cents": 750, "retail_price_cents": 1500,
      "updated_at": "2026-06-12T10:00:00Z" }
  ]
}
```

C'est la route à utiliser pour **synchroniser le stock en bulk** (équivalent PATCH stock PFS / Ankorstore). Limite suggérée : ~500 SKU/appel (à confirmer).

---

## 7. Images

### 7.1 Contraintes

| Caractéristique | Valeur |
|---|---|
| Formats | JPEG, PNG (**pas WebP** — comme PFS) |
| Résolution min | 1000 × 1000 (idéal 1500 × 1500) |
| Max par produit | 5 images |
| Fond | Blanc ou « lifestyle » |
| Ordre | Tableau = ordre d'affichage. Première = miniature. |

### 7.2 Voie A — Via URL publique (recommandée)

```jsonc
"variants": [
  {
    "sku": "BJ-BRC-001-OR-S",
    "images": [
      { "url": "https://beliandjolie.com/uploads/produits/BJ001/bj001-or-1.jpg" },
      { "url": "https://beliandjolie.com/uploads/produits/BJ001/bj001-or-2.jpg" }
    ]
  }
]
```

Faire télécharge depuis nos URLs. Pas de multipart. **C'est la voie officielle** documentée dans le template de catalogue. ⚠️ Reconvertir les WebP en JPEG avant exposition via `/api/marketplace-image?path=...` (réutiliser le proxy existant utilisé pour Ankorstore).

### 7.3 Voie B — Upload multipart (fallback)

```http
POST /external-api/v2/products/{product_id}/images
Content-Type: multipart/form-data
```

À utiliser uniquement si les images ne sont pas accessibles publiquement. À confirmer côté portail.

### 7.4 Remplacer / supprimer / réordonner

Envoyer le **tableau `images` complet** dans un `PATCH /products/{id}` ou `PATCH /products/options/{option_id}`. Pas de DELETE individuel documenté.

---

## 8. Créer produit — `POST /products`

```http
POST /external-api/v2/products
Content-Type: application/json
X-FAIRE-ACCESS-TOKEN: {token}

{
  "name": "Bracelet acier inoxydable doré",
  "short_description": "Bracelet 18 cm, acier 316L",
  "description": "…",
  "wholesale_price_cents": 750,
  "retail_price_cents": 1500,
  "lifecycle_state": "DRAFT",             // toujours créer en DRAFT (cf. §10)
  "country_of_manufacture": "CN",
  "materials": ["Stainless Steel 316L"],
  "hs_code": "7117.19.00",
  "weight_grams": 30,
  "taxonomy_type": { "id": "tt_czw8pmzjrc" },
  "variant_option_sets": [
    { "name": "Color", "values": ["Or", "Argent"] }
  ],
  "variants": [
    { "sku": "BJ-BRC-001-OR-TU", "idempotence_token": "…",
      "wholesale_price_cents": 750, "retail_price_cents": 1500,
      "available_quantity": 100, "options": [{ "name": "Color", "value": "Or" }],
      "images": [{ "url": "https://beliandjolie.com/uploads/.../or-1.jpg" }] },
    { "sku": "BJ-BRC-001-AR-TU", "idempotence_token": "…",
      "wholesale_price_cents": 750, "retail_price_cents": 1500,
      "available_quantity": 50, "options": [{ "name": "Color", "value": "Argent" }],
      "images": [{ "url": "https://beliandjolie.com/uploads/.../ar-1.jpg" }] }
  ]
}
```

**Obligatoires** : `name`, `wholesale_price_cents`, `retail_price_cents`, `taxonomy_type.id`, au moins 1 `variant` avec `sku` unique, au moins 1 image (par variant ou produit).

**Recommandés pour passer la validation** : `short_description`, `description`, `lifecycle_state: "DRAFT"` au départ.

**Réponse** : objet produit complet avec `id` Faire + `brand_id` + variantes avec leurs `id` (`po_…`).

---

## 9. Modifier produit — `PATCH /products/{id}`

Partial update — n'envoyer que les champs modifiés. Pattern identique à PFS / Ankorstore (snapshot + diff). Reset du snapshot quand `faireProductId` change.

```http
PATCH /external-api/v2/products/{product_id}
Content-Type: application/json

{
  "name": "Nouveau nom",
  "wholesale_price_cents": 800,
  "description": "Nouvelle description"
}
```

Champs immuables : `id`, `brand_id`, `created_at`. Tout le reste est modifiable.

---

## 10. Publier / archiver / supprimer

Faire distingue **trois états** via `lifecycle_state` + un toggle `sale_state` :

| Action | Méthode | Effet |
|---|---|---|
| **Masquer temporairement** | `PATCH /products/{id}` `sale_state: "NOT_FOR_SALE"` | Produit caché, peut être réactivé. |
| **Publier** | `PATCH /products/{id}` `lifecycle_state: "PUBLISHED"` | Sortie de DRAFT, commandable. |
| **Archiver** | `PATCH /products/{id}` `lifecycle_state: "RETIRED"` | Retiré du catalogue, non commandable. |
| **Supprimer hard** | `DELETE /products/{id}` | À confirmer — Faire encourage `RETIRED` plutôt. |

### Mapping vers `ProductStatus` Beli & Jolie

| BJ | Faire |
|---|---|
| `ONLINE` | `lifecycle_state: PUBLISHED` + `sale_state: FOR_SALE` |
| `OFFLINE` | `lifecycle_state: PUBLISHED` + `sale_state: NOT_FOR_SALE` (ou rester en `DRAFT` si jamais publié) |
| `ARCHIVED` | `lifecycle_state: RETIRED` |
| `SYNCING` | côté Faire toujours `DRAFT` pendant le kickoff |

### Workflow de publication recommandé

1. `POST /products` en `lifecycle_state: "DRAFT"` avec toutes les variantes + images via URLs publiques.
2. Faire valide automatiquement (images ≥ 1000×1000, prix cohérents, catégorie valide…) — délai immédiat à 24 h pour les bijoux fashion.
3. `PATCH /products/{id}` avec `lifecycle_state: "PUBLISHED"`.

---

## 11. Commandes — `GET /orders` + actions

### 11.1 Récupération

```http
GET /external-api/v2/orders?page=1&limit=50&updated_at_min=2026-06-12T00:00:00Z
```

Params optionnels : `excluded_states=PROCESSING`, `excluded_states=DELIVERED`, etc.

### 11.2 Structure (confirmée tap-faire)

```jsonc
{
  "id": "bo_orderabc",
  "display_id": "ORD-12345",
  "state": "NEW",                         // NEW | PROCESSING | SHIPPED | CANCELLED | BACKORDERED | DELIVERED
  "source": "FAIRE",                      // FAIRE | FAIRE_DIRECT
  "retailer_id": "r_xyz",
  "ship_after": "2026-06-13T00:00:00Z",
  "items": [
    { "id": "oi_1", "product_id": "p_abc", "product_option_id": "po_456",
      "product_name": "Bracelet…", "product_option_name": "Or / S",
      "sku": "BJ-BRC-001-OR-S", "quantity": 3, "price_cents": 750,
      "discounts": [], "includes_tester": false }
  ],
  "shipments": [],
  "address": {
    "name": "Boutique XYZ", "company_name": "Boutique XYZ LLC",
    "address1": "123 Main St", "address2": "Suite 200",
    "city": "Brooklyn", "state": "New York", "state_code": "NY",
    "postal_code": "11201", "country": "United States", "country_code": "US",
    "phone_number": "+1-555-1234"
  },
  "payout_costs": {
    "payout_fee_cents": 100, "payout_fee_bps": 250,
    "commission_cents": 300, "commission_bps": 1500
  },
  "created_at": "…", "updated_at": "…"
}
```

### 11.3 Actions sur une commande

```http
POST /external-api/v2/orders/{order_id}/accept
POST /external-api/v2/orders/{order_id}/backorder
  Body: { "items": [{ "id": "oi_1", "available_quantity": 1 }] }
POST /external-api/v2/orders/{order_id}/items/availability
  Body: idem backorder
POST /external-api/v2/orders/{order_id}/ship
  Body: { "shipments": [{ "carrier": "UPS", "tracking_code": "1Z999…",
                          "items": [{ "id": "oi_1", "quantity": 3 }] }] }
POST /external-api/v2/orders/{order_id}/cancel
```

### 11.4 Mapping vers `OrderStatus` Beli & Jolie

| Faire | BJ |
|---|---|
| `NEW`, `PROCESSING`, `BACKORDERED` | `PENDING` |
| `SHIPPED`, `DELIVERED` | `SHIPPED` |
| `CANCELLED` | `CANCELLED` |

---

## 12. Taxonomie — endpoints **internes au portail brand**

⚠️ Aucun endpoint exposé via l'External API (`/external-api/v2/...`) — j'ai testé plus de 40 URLs, toutes 404. La taxonomie est uniquement accessible via **2 endpoints du portail brand** (sur `www.faire.com`, pas `external-api`), confirmés en réel via HAR le 2026-06-12 :

### 12.1 Arbre complet — `GET /api/v2/categories/taxonomy-based`

```http
GET https://www.faire.com/api/v2/categories/taxonomy-based
Referer: https://www.faire.com/brand-portal/my-shop/products/new
Cookie: <session brand>
```

Retourne **472 catégories feuilles** organisées en 10 catégories de niveau 1 (Maison et déco, Femme, Bijoux, Homme, Animaux, etc.). Chaque nœud expose :
- `name` (français) / `english_name` (anglais)
- `path_identifier` (ex: `jewelry|bracelets`, `jewelry|necklaces|beaded_pearl`)
- `sub_categories[]` (arbre récursif)
- `tree_level` (1/2/3)
- `type` (`PRODUCT`)
- `is_product_based`

**⚠ Important** : `path_identifier` ≠ `taxonomy_type.id`. Le `path_identifier` sert à la navigation visuelle du portail, mais ce n'est pas ce qu'on envoie à `POST /products`. Pour le POST il faut le **`taxonomy_type.token`** récupéré via §12.2.

### 12.2 Recherche taxonomy_type.token — `POST /api/search/clean-taxonomy-type-suggestions`

```http
POST https://www.faire.com/api/search/clean-taxonomy-type-suggestions
Content-Type: application/json
Referer: https://www.faire.com/brand-portal/my-shop/products/new
Cookie: <session brand>

{"query":"Bracelet"}
```

Réponse (extrait validé) :
```jsonc
{
  "suggested_clean_taxonomy_type": [
    {
      "taxonomy_type_clean_name": "Bracelets",
      "category_breadcrumbs": [{"categories": ["Bijoux", "Bracelets"]}],
      "taxonomy_types": [
        { "token": "tt_az2kjm4b24", "name": "Bracelet",
          "clean_name": "Bracelets", "target_customer": "ADULT_UNISEX",
          "target_customer_display_name": "Adultes • unisexe" },
        { "token": "tt_czw8pmzjrc", "name": "Bracelets",
          "clean_name": "Bracelets", "target_customer": "ALL_CUSTOMERS",
          "target_customer_display_name": "Tous les clients" }
      ]
    }
  ]
}
```

**Le champ `token` = `taxonomy_type.id` à mettre dans `POST /external-api/v2/products`**.

### 12.3 Format des IDs — `tt_xxxxxx` (PAS `tx_xxx`)

Le préfixe canonique est **`tt_`** suivi de 10 caractères alphanumériques (ex: `tt_czw8pmzjrc`). L'erreur 400 de l'API confirme : *« Taxonomy type id {bad_id} is not valid »*.

### 12.4 Accès depuis Beli & Jolie

Les 2 endpoints ci-dessus sont **internes au portail brand** : ils nécessitent les cookies de session Faire, donc ne sont pas appelables depuis notre backend avec la simple clé API externe. **Options** :

- **Mapping manuel** (recommandé pour démarrer) : l'admin va dans son portail Faire, fait une recherche par mot-clé, copie le `tt_xxxxxx`, le colle dans le champ `Category.faireTaxonomyId` de notre admin. C'est ce que fait l'UI actuelle.
- **Synchronisation périodique** (futur) : capturer un HAR mensuel via DevTools du portail brand, extraire la liste, l'embarquer en seed dans notre code. À envisager si la taxonomie change souvent.

### 12.5 `target_customer` — choisir la bonne variante

Pour une même catégorie, il peut exister plusieurs `taxonomy_types` selon le public cible :
- `ALL_CUSTOMERS` — Tous les clients (souvent le bon choix par défaut)
- `ADULT_UNISEX` — Adultes • unisexe
- `ADULT_WOMEN`, `ADULT_MEN`
- `KIDS_AND_BABY_UNISEX`, `BABY_UNISEX`
- etc.

Choisir celui qui correspond à l'audience de la marque (ex: bijoux Beli & Jolie pour adultes → `ADULT_UNISEX` ou `ALL_CUSTOMERS`).

---

## 13. Webhooks asynchrones

### 13.1 Disponibilité

Faire **supporte les webhooks** (mentionnés dans la doc générale). Endpoint d'abonnement non public dans les sources accessibles — à confirmer via le portail brand. Pattern observé chez les intégrateurs (Extensiv, Sellercloud, Cin7) :

1. Abonnement à un événement via portail ou API d'abonnement.
2. Faire envoie `POST` JSON sur notre URL webhook.
3. Notre endpoint répond `HTTP 200` en ≤ 10 s. Sinon, retry exponentiel.

### 13.2 Événements probables

| Event | Cas d'usage |
|---|---|
| `order.new` / `order.created` | Nouvelle commande à traiter |
| `order.cancelled` | Annulation par le retailer |
| `order.shipped` | Confirmation expédition |
| `order.backordered` | Réponse à notre déclaration de rupture |
| `product.approved` / `product.rejected` | Validation post-publish |
| `inventory.updated` | (si plusieurs systèmes poussent du stock) |

### 13.3 Sécurité

Faire devrait fournir un secret HMAC dans un header (ex : `X-Faire-Signature`). Variable d'env : `FAIRE_WEBHOOK_SECRET` côté Beli & Jolie. À vérifier sur la doc portail au branchement.

### 13.4 Plan B si webhooks indisponibles

Polling : `GET /orders?updated_at_min=…` toutes les 5-10 min via un cron. C'est ce que font Sellercloud et Extensiv.

---

## 14. Pricing — règles précises

- **Format** : entiers en **centimes**, jamais décimal. Devise déterminée par le profil brand.
- **Marge minimale** : `retail_price_cents` ≥ 2 × `wholesale_price_cents`. L'API rejette si la règle n'est pas respectée.
- **Commission Faire** : 15 % (`commission_bps: 1500`) + 2.5 % payment fee (`payout_fee_bps: 250`). À intégrer dans le markup côté `lib/marketplace-pricing.ts` pour calculer un prix net désiré.
- **Faire Direct** : canal de vente direct via le site brand (frais réduits). Pas d'impact API produit.

**Markup à ajouter dans SiteConfig** (cf. `lib/marketplace-pricing.ts`) :
- `faire_price_markup_type` (`percent` | `fixed` | `multiplier`)
- `faire_price_markup_value`
- `faire_price_markup_rounding` (`none` | `up` | `down`)

Optionnellement : `faire_retail_markup_*` séparé du `wholesale`, comme Ankorstore (`ankorstore_wholesale_markup_*` vs `ankorstore_retail_markup_*`), si on veut découpler les deux.

---

## 15. Rate limiting & limites

Aucun chiffre officiel public. Recommandations des intégrateurs et hypothèses raisonnables :

| Limite | Valeur estimée | Source |
|---|---|---|
| Requêtes/min par compte | ~60-100 | Patterns marketplaces standards |
| HTTP 429 | header `Retry-After` attendu | Convention |
| Body JSON max | ~1-2 Mo | Convention |
| Bulk inventory | ~500 SKU/appel | À confirmer |

**Action** : implémenter un token bucket + backoff exponentiel dès le départ (réutiliser le pattern Ankorstore de `lib/ankorstore-api.ts`).

---

## 16. Champs / concepts spécifiques à ne pas oublier

| Concept | Mapping Beli & Jolie |
|---|---|
| **`minimum_order_quantity`** (MOQ produit) | Champ à ajouter ou défaut 1 |
| **`per_style_minimum_order_quantity`** | MOQ par couleur — défaut 1 |
| **`unit_multiplier`** / case pack | À utiliser pour les `SaleType.PACK` (quantité par pack) |
| **`lead_time`** | Calculer depuis stock + délai entrepôt (à définir) |
| **`country_of_manufacture`** | `ManufacturingCountry.isoCode` (déjà mappé pour PFS) |
| **`materials`** | `Composition` (libellé EN à ajouter ou réutiliser `pfsCompositionRef`) |
| **`hs_code`** | `Category.faireHsCode` (à ajouter — `7117.19.00` par défaut pour bijoux acier) |
| **`weight_grams`** / dimensions | À synchroniser depuis `ProductColor` (poids déjà saisi) |
| **Tags / certifications** | « Made in Europe », « eco-friendly » — non applicable à nos produits made-in-CN |
| **Brand profile** | À valider manuellement via portail — étape humaine pré-API |
| **Retours** | Gérés par Faire (Faire Returns) — config via portail, pas API |
| **Taxes** | Faire collecte côté US — rien à faire côté marque |

---

## 17. Pièges connus (à enrichir au fur et à mesure)

1. **API v1 deprecated** : tout endpoint sous `/api/v1/` doit être migré vers `/external-api/v2/`. Référer au guide Celigo « Migrate your Faire API v1 endpoints to v2 ».
2. **Marge 2× obligatoire** : si `retail < 2 × wholesale`, le POST/PATCH est rejeté. À valider côté UI avant push.
3. **Pas de filtre `?sku=…`** sur GET /products : mapping local `faireProductId` obligatoire.
4. **Pas de sandbox public** : tester sur compte brand réel.
5. **Brand profile en attente** : tant que le profil n'est pas validé, les produits restent en DRAFT non publiables.
6. **Taxonomie verrouillée** : impossible de créer une catégorie à la volée — bloquant si une catégorie BJ n'a pas son équivalent Faire.
7. **WebP non supporté** (comme PFS) : convertir en JPEG avant exposition.
8. **`idempotence_token`** sur les POST de variants : indispensable si on retry, sinon doublons.

---

## 18. Plan d'intégration côté Beli & Jolie (résumé)

Sur le pattern PFS / Ankorstore / eFashion :

### Schéma Prisma à ajouter
```prisma
model Product {
  faireProductId          String?   @unique
  faireSyncRequired       Boolean   @default(false)
  faireLastSyncSnapshot   Json?
  faireLastRefreshedAt    DateTime?
}

model ProductColor {
  faireVariantId          String?   @unique
}

model Category {
  faireTaxonomyId         String?
  faireHsCode             String?
}

model Composition {
  faireMaterialLabel      String?   // libellé EN attendu par Faire
}

// Si callback-only (comme Ankorstore) :
model FaireOperation {
  id              String   @id @default(cuid())
  productId       String?
  type            FaireOpType   // PUBLISH | UPDATE | DELETE | INVENTORY
  status          FaireOpStatus // PENDING | DONE | FAILED
  payload         Json
  callbackPayload Json?
  createdAt       DateTime @default(now())
  completedAt     DateTime?
}
```

### Modules `lib/faire-*.ts` (15-18 fichiers, miroir des autres marketplaces)
- `faire-auth.ts` — headers (clé simple ou OAuth)
- `faire-api.ts` — read (list, get, taxonomies)
- `faire-api-write.ts` — write (create, patch, delete, inventory)
- `faire-publish.ts` — publication produit (DRAFT → PUBLISHED)
- `faire-update.ts` — sync incrémentale via snapshot diff
- `faire-refresh.ts` — duplication / rebump createdAt
- `faire-delete.ts` — RETIRED + propagation
- `faire-sync-diff.ts` — comparaison snapshot
- `faire-pricing.ts` — markup + clamp 2× retail
- `faire-sku.ts` — génération SKU `{ref}_{couleur}_{taille}`
- `faire-shape.ts` — validation (champs requis, marge 2×)
- `faire-match.ts` — auto-match produit BJ ↔ produit Faire existant
- `faire-variant-link.ts` — liaison manuelle variantes
- `faire-orders.ts` — récupération + actions accept/ship/backorder/cancel
- `faire-taxonomy.ts` — cache taxonomy (60 min, tag `faire-taxonomy`)
- `faire-list-cache.ts` — cache list catalog
- `faire-description.ts` — formatage description Faire

### Routes API
- `app/api/admin/faire-publish` (POST)
- `app/api/admin/faire-refresh` (POST)
- `app/api/admin/faire-resync` (POST)
- `app/api/admin/faire-operations` (GET poll — si callback-only)
- `app/api/admin/faire-catalog` (GET search)
- `app/api/admin/faire-search` (GET match)
- `app/api/webhooks/faire` (POST callback)
- `app/api/admin/faire-orders` (GET sync)

### Server actions
- `app/actions/admin/faire.ts` — link, unlink, mass-match
- `app/actions/admin/faire-mappings.ts` — taxonomie, compositions, etc.

### UI
- Réutiliser `MarketplaceStatusButtons`, `MarketplaceRefreshWidget`, badges sync.
- Ajouter onglet « Faire » dans `MarketplaceConfig` (paramètres) : clé API, kill switch, markup.
- `MarketplaceMappingSection` étendu pour `Category.faireTaxonomyId`.

### SiteConfig (clés sensibles + markup)
- Chiffrer dans `SENSITIVE_KEYS` : `faire_api_key`, `faire_client_id`, `faire_client_secret`.
- Markup : `faire_price_markup_type`, `_value`, `_rounding`.
- Kill switch : `faire_enabled`.
- Webhook : env `FAIRE_WEBHOOK_SECRET`.

### Drapeaux sync
Réutiliser le pattern existant dans `app/actions/admin/products.ts:updateProduct` et `lib/image-queue.ts` :
- `Product.faireSyncRequired = true` quand champ clé modifié sur produit lié
- `Product.faireSyncRequired = true` quand image ajoutée sur produit lié
- Reset à `false` par `lib/faire-update.ts` / `lib/faire-refresh.ts` succès
- Badge orange « Synchro nécessaire » dans `MarketplaceStatusButtons` et `AdminProductsTable`

### Logs
Convention : `logger.info("[Faire Publish] …", { context })`, `[Faire Update]`, `[Faire Inventory]`, etc.

---

## Sources

- [Faire Developer Portal (accès brand)](https://developers.faire.com/docs)
- [Faire External API v2 — doc archivée](https://faire.github.io/external-api-v2-docs/)
- [hotglue/tap-faire — schémas v2 confirmés (GitLab)](https://gitlab.com/hotglue/tap-faire)
- [Faire — Get All Products (Chilkat PHP)](https://www.example-code.com/phpExt/faire_get_all_products.asp)
- [Faire — Update Inventory Levels (Chilkat)](https://www.example-code.com/phpext/faire_update_inventory_levels.asp)
- [Migrate Faire API v1 → v2 (Celigo)](https://docs.celigo.com/hc/en-us/articles/8649388425627)
- [Faire Integration Overview (Extensiv)](https://help.extensiv.com/366871-faire/1624490-faire-integration-overview)
- [Faire Account Integration (Sellercloud)](https://help.sellercloud.com/omnichannel-ecommerce/faire-account-integration/)
- [Faire Help — Get API key](https://www.faire.com/support/articles/37632363832091)
- [Faire Help — Software integration](https://www.faire.com/support/articles/360037964391)
- [Faire — Postman public collection](https://www.postman.com/docking-module-architect-9509079-141858/faire/overview)
- [hotglue connector Faire](https://hotglue.com/connectors/faire)
