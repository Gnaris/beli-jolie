# API Paris Fashion Shop - Documentation Produits

> **Dernière vérification live** : 2026-03-21
> **Total produits actifs** : ~9 251 (93 pages de 100)

## Configuration Générale

- **Base URL** : `https://wholesaler-api.parisfashionshops.com/api/v1`
- **Frontend URL** : `https://parisfashionshops.com`
- **CDN images** : `https://static.parisfashionshops.com`
- **Langues supportées** : fr, en, de, es, it
- **Pagination** : paramètres `page` et `per_page` (max 100 par page)
- **Brand ID Beli & Jolie** : `a01AZ00000314QgYAI` (obligatoire dans listProducts)
- **Env vars** : `PFS_EMAIL`, `PFS_PASSWORD`

---

## Authentification

### `POST /oauth/token`

**Headers :**
| Header | Valeur |
|--------|--------|
| `Content-Type` | `application/json` |

**Body :**
```json
{
  "email": "string",
  "password": "string"
}
```

**Réponse 200 :**
```json
{
  "access_token": "string (JWT RS256)",
  "token_type": "Bearer",
  "expires_at": "2026-03-21 03:23:25",
  "wholesaler_id": "a001t000005E7KrAAK"
}
```

**Utilisation du token :**
- Toutes les requêtes suivantes nécessitent le header `Authorization: Bearer {access_token}`
- Le token expire — le champ `expires_at` indique la date d'expiration
- Prévoir un buffer de ~10 minutes avant `expires_at` pour rafraîchir le token
- **Testé et fonctionnel** le 2026-03-21

---

## Endpoints Produits

---

### 1. Lister les produits (TESTÉ - FONCTIONNEL)

#### `GET /catalog/listProducts`

**Query Parameters :**
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `page` | number | oui | Numéro de page (commence à 1) |
| `per_page` | number | oui | Nombre de produits par page (max 100) |
| `brand` | string | **oui** | ID de la marque — `a01AZ00000314QgYAI` pour Beli & Jolie |
| `reference` | string | non | Filtrer par référence produit |
| `status` | string | oui | Statut du produit : `"ACTIVE"` |

**Headers :** `Authorization: Bearer {token}`

**Pagination :**
- Page vide = `{"data": []}` (pas de champ `total` ou `last_page`)
- Il faut paginer jusqu'à recevoir un tableau vide
- ~9 251 produits actifs au 2026-03-21 (93 pages de 100)

**Réponse 200 (données réelles observées) :**
```json
{
  "data": [
    {
      "id": "pro_171bb9106d9fe1b4e5af0ae10db6",
      "reference": "T198VS1",
      "brand": { "id": "a01AZ00000314QgYAI", "name": "Beli & Jolie" },
      "gender": "WOMAN",
      "family": "a035J00000185J7QAI",
      "category": {
        "id": "a045J000003KWwDQAW",
        "labels": {
          "fr": "Boucles d'oreilles",
          "en": "Earrings",
          "de": "Ohrringe",
          "es": "Pendientes",
          "it": "Orecchini"
        }
      },
      "labels": {
        "fr": "Boucles d'oreilles créoles en acier inoxydable",
        "en": "Stainless steel hoop earrings",
        "de": "Ohrringe aus Edelstahl",
        "es": "Pendientes de aro de acero inoxidable",
        "it": "Orecchini a cerchio in acciaio inossidabile"
      },
      "colors": "GOLDEN;SILVER",
      "sizes": "TU",
      "size_details_tu": "",
      "unit_price": 4,
      "creation_date": "2026-03-20T18:40:59.000000Z",
      "status": "READY_FOR_SALE",
      "is_star": 0,
      "count_variants": 4,
      "images": {
        "DEFAULT": "https://static.parisfashionshops.com/.../image.jpg?image_process=resize,w_450",
        "GOLDEN": ["https://static.parisfashionshops.com/.../image_dore.jpg?image_process=resize,w_450"],
        "SILVER": ["https://static.parisfashionshops.com/.../image_argent.jpg?image_process=resize,w_450"]
      },
      "flash_sales_discount": null,
      "variants": [
        {
          "id": "pro_94eceac60bc3ee628eedf43e23e3",
          "sku_suffix": null,
          "type": "ITEM",
          "custom_suffix": "",
          "pieces": 1,
          "price_sale": {
            "unit": { "value": 4.2, "currency": "EUR" },
            "total": { "value": 0, "currency": "EUR" }
          },
          "price_before_discount": {
            "unit": { "value": 4.2, "currency": "EUR" },
            "total": { "value": 4.2, "currency": "EUR" }
          },
          "discount": null,
          "item": {
            "color": {
              "id": 61,
              "reference": "GOLDEN",
              "value": "#C4A647",
              "image": null,
              "labels": { "fr": "Doré", "de": "Golden", "en": "Golden", "es": "Dorado", "it": "Dorato" }
            },
            "size": "TU"
          },
          "is_active": true,
          "is_star": null,
          "in_stock": true,
          "stock_qty": 1000,
          "weight": 0,
          "creation_date": null
        },
        {
          "id": "pro_3ef627503a93794918c889c264a8",
          "type": "PACK",
          "pieces": 1,
          "price_sale": { "unit": { "value": 4, "currency": "EUR" } },
          "packs": [
            {
              "color": {
                "id": 61,
                "reference": "GOLDEN",
                "value": "#C4A647",
                "labels": { "fr": "Doré", "en": "Golden" }
              },
              "sizes": [{ "id": "pac_13f02c215199dbf578f4f11dcf4f", "size": "TU", "qty": 12 }]
            }
          ],
          "is_active": true,
          "in_stock": true,
          "stock_qty": 1000,
          "weight": 0
        }
      ]
    }
  ]
}
```

**Catégories observées :**
- Boucles d'oreilles, Bagues, Parures de bijoux, Colliers, Piercings, Bracelets, Pendentifs, Lots avec présentoir, Porte-clés

**Notes importantes (découvertes lors des tests) :**
- Le champ `status` dans la réponse est `"READY_FOR_SALE"` (pas `"ACTIVE"` — `ACTIVE` est uniquement pour le filtre query)
- Les **variants sont inclus inline** dans `listProducts` — pas besoin d'appeler `/products/{id}/variants` séparément
- Les variants ITEM ont un objet `item.color` avec les labels multilingues + hex
- Les variants PACK ont un tableau `packs[].color` + `packs[].sizes[].qty`
- Les images sont disponibles avec `?image_process=resize,w_450` — retirer ce suffix pour l'image full-size
- Le champ `colors` est un string séparé par `;` (ex: `"GOLDEN;SILVER"`)
- `unit_price` = prix de base, mais le vrai prix est dans `variants[].price_sale.unit.value`
- `price_before_discount` présent quand il y a eu une remise

---

### 2. Détails d'un produit (NON TESTÉ)

#### `GET /catalog/products/{id}`

> Potentiellement utile pour `material_composition` et `description` qui ne sont pas dans `listProducts`.

**Path Parameters :**
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `id` | string | oui | ID du produit |

**Headers :** `Authorization: Bearer {token}`

**Réponse 200 (d'après reverse engineering) :**
```json
{
  "data": {
    "material_composition": [
      { "id": "string", "percentage": 0 }
    ],
    "collection": { "reference": "string" },
    "country_of_manufacture": "string",
    "size_details_tu": "string",
    "label": { "fr": "string", "en": "string", "es": "string", "it": "string", "de": "string" },
    "description": { "fr": "string", "en": "string", "es": "string", "it": "string", "de": "string" }
  }
}
```

---

### 3. Variants d'un produit (PROBABLEMENT INUTILE)

#### `GET /catalog/products/{id}/variants`

> Les variants sont déjà inclus dans `listProducts` avec plus de détails. Cet endpoint est probablement redondant.

---

### 4-9. Endpoints d'écriture (NON TESTÉS — pour push futur)

Les endpoints suivants existent pour la synchronisation BJ → PFS (push) :

| # | Endpoint | Méthode | Usage |
|---|----------|---------|-------|
| 4 | `/catalog/products` | POST | Créer un produit |
| 5 | `/catalog/products/batch/updateStatus` | PATCH | Batch status (READY_FOR_SALE / DELETED) |
| 6 | `/catalog/products/{id}` | PATCH | Modifier un produit |
| 7 | `/catalog/products/{id}/image` | POST | Upload image (JPEG, multipart) |
| 8 | `/catalog/products/variants` | PATCH | Modifier stock variants |
| 9 | `/catalog/products/variants/batch/setAvailability` | PATCH | Activer/désactiver variants |

> Ces endpoints ne sont pas encore testés. Ils seront documentés quand on implémentera le push BJ → PFS.

---

## Mapping PFS → Beli Jolie

| PFS (listProducts) | Beli Jolie | Notes |
|---|---|---|
| `reference` | `Product.reference` | Source de vérité |
| `id` | `Product.pfsProductId` (à créer) | Pour re-sync |
| `labels.fr` | `Product.name` | |
| `labels.{en,de,es,it}` | `ProductTranslation` | 4 langues gratuites ! |
| `category.labels.fr` | `Category.name` | Match ou création |
| `variants[].type` ITEM/PACK | `ProductColor.saleType` UNIT/PACK | |
| `variants[].item.color.reference` | `Color` | Match par nom normalisé |
| `variants[].item.color.value` | `Color.hex` | |
| `variants[].item.color.labels` | `ColorTranslation` | |
| `variants[].price_sale.unit.value` | `ProductColor.unitPrice` | |
| `variants[].stock_qty` | `ProductColor.stock` | |
| `variants[].weight` | `ProductColor.weight` | |
| `variants[].packs[].sizes[].qty` | `ProductColor.packQuantity` | Pour type PACK |
| `images.{COLOR_REF}` | `ProductColorImage` | Télécharger + WebP |
