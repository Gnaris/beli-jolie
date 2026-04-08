# Ankorstore API — Documentation simplifiee

> Base URL : `https://www.ankorstore.com/api/v1`
> Format : JSON:API (toutes les reponses utilisent `data.type`, `data.id`, `data.attributes`, `data.relationships`)
> Spec OpenAPI 3.1.0 — 71 endpoints, 177 schemas

---

## 1. Authentification

**OAuth2 Client Credentials** (machine-to-machine, pas de login utilisateur).

```
POST https://www.ankorstore.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=VOTRE_APP_ID
&client_secret=VOTRE_APP_SECRET
&scope=*
```

Reponse :
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

- Token valide **1 heure**
- Rafraichir 5-10 min avant expiration
- Header sur toutes les requetes : `Authorization: Bearer {token}`

**Rate limits** : 600 req/min, 24 000/h, 288 000/jour.

---

## 2. Headers obligatoires

```
Accept: application/vnd.api+json
Content-Type: application/vnd.api+json    (pour POST/PATCH)
Authorization: Bearer {token}
Idempotency-Key: {uuid}                  (optionnel, evite les doublons)
```

---

## 3. Pagination

Cursor-based (pas offset/limit).

```
GET /products?page[limit]=20&page[after]=uuid-du-dernier
```

Reponse inclut `meta.page.hasMore` et `links.next`.

---

## 4. Catalogue

### 4.1 Lire les produits

```
GET /api/v1/products
GET /api/v1/products/{id}?include=productVariant
```

**Champs Product** :
| Champ | Type | Description |
|-------|------|-------------|
| `name` | string | Nom du produit |
| `description` | string | Description |
| `retailPrice` | int | Prix public conseille (centimes) |
| `wholesalePrice` | int | Prix de gros apres remise (centimes) |
| `originalWholesalePrice` | int | Prix de gros avant remise (centimes) |
| `discountRate` | float | Remise (0 a 1) |
| `unitMultiplier` | int | Unites par lot (ex: carton de 6) |
| `vatRate` | float | TVA |
| `active` | bool | Actif |
| `outOfStock` | bool | En rupture |
| `archived` | bool | Archive |
| `images` | array | `[{order, url}]` |
| `tags` | string[] | Tags (organic, handmade, etc.) |

### 4.2 Lire les variantes

```
GET /api/v1/product-variants
GET /api/v1/product-variants/{id}
```

**Champs ProductVariant** :
| Champ | Type | Description |
|-------|------|-------------|
| **`sku`** | **string** | **SKU de la variante (ton identifiant !)** |
| **`ian`** | **string/null** | **Code-barres EAN** |
| `name` | string | Nom de la variante |
| `retailPrice` | int | Prix public (centimes) |
| `wholesalePrice` | int | Prix de gros (centimes) |
| `availableQuantity` | int/null | Stock disponible |
| `reservedQuantity` | int | Stock reserve |
| `stockQuantity` | int/null | Stock total |
| `isAlwaysInStock` | bool | Toujours en stock |
| `images` | array | Images de la variante |

**Filtres disponibles** :
```
GET /api/v1/product-variants?filter[sku]=MON-SKU-123
GET /api/v1/product-variants?filter[ian]=3760123456789
GET /api/v1/product-variants?filter[id][]=uuid1&filter[id][]=uuid2
GET /api/v1/product-variants?filter[productId][]=uuid-produit
GET /api/v1/product-variants?filter[skuOrName]=recherche
GET /api/v1/product-variants?filter[archived]=false
```

### 4.3 Modifier le stock (unitaire)

```
PATCH /api/v1/product-variants/{id}/stock
```

```json
{
  "data": {
    "type": "product-variants",
    "id": "uuid",
    "attributes": {
      "stockQuantity": 100
    }
  }
}
```

Ou pour "toujours en stock" :
```json
{
  "data": {
    "type": "product-variants",
    "id": "uuid",
    "attributes": {
      "isAlwaysInStock": true
    }
  }
}
```

### 4.4 Modifier les prix (unitaire)

```
PATCH /api/v1/product-variants/{id}/prices
```

```json
{
  "data": {
    "type": "product-variants",
    "id": "uuid",
    "attributes": {
      "wholesalePrice": 1500,
      "retailPrice": 3000
    }
  }
}
```

Les deux champs sont obligatoires (en centimes).

### 4.5 Modifier le stock en masse (max 50)

```
POST /api/v1/operations
```

```json
{
  "atomic:operations": [
    {
      "op": "update",
      "data": {
        "type": "product-variants",
        "id": "uuid-1",
        "attributes": { "stockQuantity": 50 }
      }
    },
    {
      "op": "update",
      "data": {
        "type": "product-variants",
        "id": "uuid-2",
        "attributes": { "isAlwaysInStock": true }
      }
    }
  ]
}
```

---

## 5. Import catalogue en masse (Catalog Integrations)

Pour creer/mettre a jour/supprimer des produits en bulk.

### 5.1 Creer une operation

```
POST /api/v1/catalog/integrations/operations
```

```json
{
  "data": {
    "type": "catalog-integration-operation",
    "attributes": {
      "type": "import",
      "source": "other"
    }
  }
}
```

Types : `import` | `update` | `delete`
Sources : `shopify` | `woocommerce` | `prestashop` | `other`

### 5.2 Ajouter des produits a l'operation

```
POST /api/v1/catalog/integrations/operations/{operationId}/products
```

```json
{
  "data": [
    {
      "id": "mon-id-unique",
      "type": "catalog-integration-product",
      "attributes": {
        "external_id": "BJ-PROD-001",
        "name": "Mon Produit",
        "description": "Description du produit (min 30 caracteres obligatoires)",
        "main_image": "https://...",
        "images": [{"order": 1, "url": "https://..."}],
        "currency": "EUR",
        "vat_rate": 20.0,
        "discount_rate": 0,
        "unit_multiplier": 1,
        "wholesale_price": 15.00,
        "retail_price": 30.00,
        "made_in_country": "FR",
        "tags": ["tags_handmade"],
        "shape_properties": {
          "weight": {"unit_code": "GRM", "amount": 500}
        },
        "variants": [
          {
            "sku": "REF123_ROUGE-BLEU_UNIT_1",
            "ian": "3760123456789",
            "stock_quantity": 100,
            "is_always_in_stock": false,
            "external_id": "BJ-VAR-001",
            "options": [
              {"name": "color", "value": "Rouge/Bleu"},
              {"name": "size", "value": "M"}
            ],
            "images": [{"order": 1, "url": "https://..."}]
          }
        ]
      }
    }
  ]
}
```

**Options de variante** (noms autorises) : `color` | `size` | `material` | `style`

**Tags autorises** : `tags_fresh_product`, `tags_frozen_product`, `tags_organic`, `tags_handmade`, `tags_eco_friendly`, `tags_zero_waste`, `tags_cruelty_free`, `tags_bestseller`, `tags_vegan`, `tags_contains_alcohol`

### 5.3 Lancer l'operation

```
PATCH /api/v1/catalog/integrations/operations/{operationId}
```

### 5.4 Consulter les resultats

```
GET /api/v1/catalog/integrations/operations/{operationId}/results
```

Reponse par produit :
```json
{
  "attributes": {
    "externalProductId": "BJ-PROD-001",
    "status": "success",
    "failureReason": null,
    "issues": []
  }
}
```

Statuts d'operation : `created` → `started` → `succeeded` | `partially_failed` | `failed`

---

## 6. Commandes

### 6.1 Lister les commandes

```
GET /api/v1/orders?include=orderItems.productVariant.product,retailer
```

**Statuts de commande** :
| Statut | Description |
|--------|-------------|
| `ankor_confirmed` | Nouvelle commande, en attente d'action marque |
| `brand_confirmed` | Marque a accepte |
| `shipping_labels_generated` | Etiquettes generees |
| `shipped` | Expediee |
| `received` | Retailer a confirme reception |
| `invoiced` | Facture generee |
| `brand_paid` | Paiement transfere a la marque |
| `rejected` | Marque a refuse |
| `cancelled` | Annulee |

**Champs Order importants** :
- `reference` : numero de commande (pour etiquettes/communication)
- `masterOrderId` : UUID du master order
- `brandNetAmount` / `brandTotalAmount` : montants en centimes
- `shippingMethod` : `"ankorstore"` ou `"custom"`
- `submittedAt` / `shippedAt` / `brandPaidAt` : dates cles
- `shippingOverview.shipToAddress` : adresse de livraison

**Champs OrderItem** :
- `quantity` : quantite commandee
- `multipliedQuantity` : unites reelles (quantity x unitMultiplier)
- `brandUnitPrice` : prix unitaire (centimes)
- `brandAmount` : montant total (centimes)
- Relation : `productOptions` → `ProductOption` (avec `sku` et `ian`)

### 6.2 Accepter une commande

```
POST /api/v1/orders/{orderId}/-actions/transition
```

```json
{
  "data": {
    "type": "brand-validates",
    "attributes": {
      "orderItems": []
    }
  }
}
```

`orderItems` vide = accepter tel quel. Pour modifier des quantites :
```json
{
  "orderItems": [
    {"orderItemId": "uuid", "quantity": 3},
    {"orderItemId": "uuid", "quantity": 0}
  ]
}
```

`quantity: 0` = retirer l'article.

### 6.3 Refuser une commande

```json
{
  "data": {
    "type": "brand-rejects",
    "attributes": {
      "rejectType": "PRODUCT_OUT_OF_STOCK",
      "rejectReason": "Rupture temporaire"
    }
  }
}
```

Raisons de refus : `PRODUCT_OUT_OF_STOCK`, `BRAND_CANNOT_DELIVER_TO_THE_AREA`, `ORDER_ITEMS_PRICES_INCORRECT`, `PREPARATION_TIME_TOO_HIGH`, `OTHER` (+ 8 autres).

---

## 7. Expedition

### 7.1 Demander des devis

```
POST /api/v1/orders/{orderId}/shipping-quotes
```

```json
{
  "data": {
    "type": "shipping-quotes",
    "attributes": {
      "parcels": [
        {
          "length": 30,
          "width": 20,
          "height": 15,
          "distanceUnit": "cm",
          "weight": 2000,
          "massUnit": "g"
        }
      ]
    }
  }
}
```

Contraintes colis : longueur/largeur/hauteur max 274 cm, poids 1-30 000 g.

### 7.2 Confirmer un devis (genere les etiquettes)

```
POST /api/v1/shipping-quotes/{quoteId}/confirm
```

### 7.3 Planifier un enlevement

```
POST /api/v1/orders/{orderId}/ship/schedule-pickup
```

### 7.4 Expedition personnalisee (tracking)

```
POST /api/v1/master-orders/{masterOrderId}/tracking
```

```json
{
  "data": {
    "type": "shipments",
    "attributes": {
      "trackingNumber": "1Z999AA10123456784",
      "trackingLink": "https://...",
      "provider": "ups"
    }
  }
}
```

Transporteurs : `ups`, `dhl`, `dhl_express`, `colissimo`, `chronopost`, `tnt`, `gls`, `dpd`.

---

## 8. Webhooks

### 8.1 Creer un abonnement

```
POST /api/v1/webhook-subscriptions
```

```json
{
  "data": {
    "type": "webhook-subscriptions",
    "attributes": {
      "webhookUrl": "https://ton-site.com/api/ankorstore/webhook",
      "events": [
        "order.brand_created",
        "order.shipped",
        "order.shipment_received",
        "order.brand_paid",
        "order.cancelled"
      ],
      "signingSecret": "ton-secret-hmac"
    }
  }
}
```

### 8.2 Evenements disponibles

| Evenement | Description |
|-----------|-------------|
| `order.brand_created` | Nouvelle commande recue |
| `order.brand_accepted` | Commande acceptee |
| `order.brand_rejected` | Commande refusee |
| `order.shipping_labels_generated` | Etiquettes pretes |
| `order.shipped` | Commande expediee |
| `order.shipment_received` | Reception confirmee |
| `order.shipment_refused` | Reception refusee |
| `order.brand_paid` | Paiement recu |
| `order.cancelled` | Commande annulee |

Evenements catalogue :
- `catalog_operation.created` / `.processing` / `.completed` / `.failed` / `.product_error`

### 8.3 Verification de signature

Header : `X-Ankorstore-Hmac-SHA256`

```typescript
import crypto from "crypto";

function verifyWebhook(body: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

### 8.4 Format du payload webhook

```json
{
  "meta": {
    "event": {
      "id": "event-uuid",
      "type": "order.brand_created",
      "timestamp": 1653381780
    }
  },
  "data": {
    "type": "orders",
    "id": "order-uuid",
    "attributes": { ... }
  }
}
```

---

## 9. Matching produits BJ ↔ Ankorstore

### Le champ cle : `sku` sur ProductVariant

Ankorstore a un champ **`sku`** natif sur chaque variante. C'est la que tu mets ton SKU (`ProductColor.sku` dans BJ).

### Scenario 1 : Nouveaux produits (BJ → Ankorstore)

Tu pousses via Catalog Integration avec ton SKU :

```json
{
  "variants": [
    {
      "sku": "REF123_ROUGE-BLEU_UNIT_1",
      "stock_quantity": 50,
      "options": [{"name": "color", "value": "Rouge/Bleu"}]
    }
  ]
}
```

Quand une commande arrive, l'OrderItem reference un `productVariant` qui a ton `sku` → matching direct.

### Scenario 2 : Produits existants sur Ankorstore (sans SKU BJ)

1. **Lister** toutes les variantes Ankorstore :
```
GET /api/v1/product-variants?page[limit]=50
```

2. **Matcher** par nom/reference/EAN avec tes variantes BJ

3. **Mettre a jour** le SKU via une operation `update` :
```json
{
  "data": {
    "type": "catalog-integration-operation",
    "attributes": { "type": "update", "source": "other" }
  }
}
```
Puis ajouter les produits avec les bons SKU.

### Scenario 3 : Commande entrante → identification variante

```
Webhook order.brand_created
  → GET /api/v1/orders/{id}?include=orderItems.productVariant
    → orderItem.productVariant.sku = "REF123_ROUGE-BLEU_UNIT_1"
      → SELECT * FROM ProductColor WHERE sku = "REF123_ROUGE-BLEU_UNIT_1"
        → Match !
```

### Scenario 4 : Sync stock BJ → Ankorstore

```typescript
// 1. Trouver la variante Ankorstore par SKU
const res = await fetch(
  `${BASE}/product-variants?filter[sku]=${encodeURIComponent(sku)}`,
  { headers }
);
const variant = res.data[0];

// 2. Mettre a jour le stock
await fetch(`${BASE}/product-variants/${variant.id}/stock`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    data: {
      type: "product-variants",
      id: variant.id,
      attributes: { stockQuantity: newQuantity }
    }
  })
});
```

### Resume : comment matcher

| Situation | Methode |
|-----------|---------|
| Nouveau produit | Push via Catalog Integration avec SKU BJ |
| Produit existant sur Ankorstore | Lister variantes → matcher par nom/EAN → update avec SKU BJ |
| Commande entrante | Lire `productVariant.sku` → chercher `ProductColor.sku` en BDD |
| Sync stock | `filter[sku]=XXX` → PATCH stock |
| Sync prix | `filter[sku]=XXX` → PATCH prices |

---

## 10. Erreurs

| Code | Signification |
|------|---------------|
| 400 | Requete invalide (ne pas re-essayer) |
| 401 | Token expire → re-authentifier |
| 403 | Pas les droits |
| 404 | Ressource introuvable |
| 429 | Rate limit → utiliser header `Retry-After` |
| 5xx | Erreur serveur → exponential backoff |

---

## 11. Sandbox / Test

```
POST /api/testing/orders/create
```

Cree une commande de test pour valider le flow sans vrais achats.
