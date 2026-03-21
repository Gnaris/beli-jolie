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
- **Attention** : certains champs variants sont incorrects dans `listProducts` — voir endpoint `/variants` pour les valeurs fiables (weight, pieces PACK, total PACK)
- Le champ `state` dans la réponse donne les compteurs globaux : `total`, `active`, `draft`, `for_sale`, `out_of_stock`, `archived`, `deleted`, `star`
- La pagination inclut `meta.current_page`, `meta.last_page`, `meta.from` et `links` (first/last/prev/next)

---

### 2. Vérifier une référence produit (TESTÉ - FONCTIONNEL)

#### `GET /catalog/products/checkReference/{reference}`

> Lookup par référence produit. Retourne les données enrichies (composition, collection, description multilingue, pays de fabrication) qui ne sont **pas** dans `listProducts`.

**Path Parameters :**
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `reference` | string | oui | Référence du produit (ex: `T198VS1`) |

**Headers :** `Authorization: Bearer {token}`

**Réponse 200 (données réelles observées) :**
```json
{
  "exists": true,
  "product": {
    "id": "pro_171bb9106d9fe1b4e5af0ae10db6",
    "brand": { "id": "a01AZ00000314QgYAI", "name": "Beli & Jolie" },
    "gender": { "reference": "WOMAN" },
    "family": { "id": "a035J00000185J7QAI", "reference": "WOMAN/FASHIONJEWELRY" },
    "category": { "id": "a045J000003KWwDQAW", "reference": "WOMAN/FASHIONJEWELRY/EARRINGS" },
    "reference": "T198VS1",
    "label": {
      "fr": "Boucles d'oreilles créoles en acier inoxydable",
      "en": "Stainless steel hoop earrings",
      "de": "Ohrringe aus Edelstahl",
      "es": "Pendientes de aro de acero inoxidable",
      "it": "Orecchini a cerchio in acciaio inossidabile"
    },
    "collection": {
      "id": "a0cZ50k09p2mpLdIHG",
      "reference": "PE2026",
      "labels": {
        "fr": "Printemps/Été 2026",
        "en": "Spring/Summer 2026",
        "de": "Frühjahr/Sommer 2026",
        "es": "Primavera/Verano 2026",
        "it": "Primavera/Estate 2026"
      }
    },
    "material_composition": [
      {
        "id": "a0zW5000000YvezIAC",
        "reference": "ACIERINOXYDABLE",
        "percentage": 100,
        "labels": {
          "fr": "Acier inoxydable",
          "en": "Stainless steel",
          "de": "Rostfreier Stahl",
          "es": "Acero inoxidable",
          "it": "Acciaio inossidabile"
        }
      }
    ],
    "lining_composition": [],
    "country_of_manufacture": "CN",
    "description": {
      "fr": "Boucles d'oreilles créoles en acier inoxydable",
      "en": "Stainless steel hoop earrings",
      "de": "Ohrringe aus Edelstahl",
      "es": "Pendientes de aro de acero inoxidable",
      "it": "Orecchini a cerchio in acciaio inossidabile"
    },
    "status": "READY_FOR_SALE",
    "default_color": "GOLDEN",
    "images": {
      "DEFAULT": "https://static.parisfashionshops.com/.../image.jpg?image_process=resize,w_450",
      "GOLDEN": ["url..."],
      "SILVER": ["url..."]
    },
    "flash_sales_discount": null
  }
}
```

**Données exclusives à cet endpoint (absentes de `listProducts`) :**
- `material_composition[]` — matériaux avec pourcentage et labels multilingues
- `collection` — référence et labels multilingues (ex: PE2026 = Printemps/Été 2026)
- `country_of_manufacture` — pays de fabrication (ex: "CN")
- `description` — description multilingue du produit
- `lining_composition` — composition doublure (vide pour bijoux)
- `default_color` — couleur par défaut du produit
- `family.reference` — catégorie parente (ex: WOMAN/FASHIONJEWELRY)
- `category.reference` — sous-catégorie (ex: WOMAN/FASHIONJEWELRY/EARRINGS)

**Si la référence n'existe pas :** `{ "exists": false }` (à vérifier)

**Cas d'usage :**
- Vérifier si un produit existe sur PFS avant import
- Enrichir les données de `listProducts` avec composition, collection, description
- Récupérer les traductions pour les compositions et collections

---

### 3. Variants d'un produit (TESTÉ - FONCTIONNEL - IMPORTANT)

#### `GET /catalog/products/{id}/variants`

> **Pas redondant !** Cet endpoint retourne des données corrigées par rapport aux variants inline de `listProducts` : le poids réel, le nombre de pièces PACK réel, et le prix total PACK correct.

**Path Parameters :**
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `id` | string | oui | ID du produit (ex: `pro_171bb9106d9fe1b4e5af0ae10db6`) |

**Headers :** `Authorization: Bearer {token}`

**Réponse 200 (données réelles observées) :**
```json
{
  "data": [
    {
      "id": "pro_94eceac60bc3ee628eedf43e23e3",
      "product_id": "pro_171bb9106d9fe1b4e5af0ae10db6",
      "reference": "T198VS1",
      "sku_suffix": "GOLDEN_TU",
      "type": "ITEM",
      "custom_suffix": "",
      "pieces": 1,
      "price_sale": {
        "unit": { "value": 4.2, "currency": "EUR" },
        "total": { "value": 4.2, "currency": "EUR" }
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
      "colors": [
        { "id": 61, "reference": "GOLDEN", "value": "#C4A647", "image": null, "labels": { "fr": "Doré", ... } }
      ],
      "is_active": true,
      "is_star": false,
      "in_stock": true,
      "stock_qty": 1000,
      "weight": 0.09,
      "images": {
        "DEFAULT": "url...",
        "GOLDEN": ["url..."],
        "SILVER": ["url..."]
      }
    },
    {
      "id": "pro_d6a34a3cc58a423a120fb87ee4a4",
      "type": "PACK",
      "sku_suffix": "SILVER_TU",
      "pieces": 12,
      "price_sale": {
        "unit": { "value": 4, "currency": "EUR" },
        "total": { "value": 48, "currency": "EUR" }
      },
      "packs": [
        {
          "color": { "id": 52, "reference": "SILVER", "value": "#A2A2A1", "labels": { "fr": "Argent", ... } },
          "sizes": [{ "id": "pac_c1d82f5715a352bc5e9242cd5ac4", "size": "TU", "qty": 12 }]
        }
      ],
      "colors": [
        { "id": 52, "reference": "SILVER", "value": "#A2A2A1", "labels": { "fr": "Argent", ... } }
      ],
      "is_active": true,
      "in_stock": true,
      "stock_qty": 1000,
      "weight": 0.09,
      "images": { "DEFAULT": "url...", "GOLDEN": ["url..."], "SILVER": ["url..."] }
    }
  ]
}
```

**Corrections par rapport aux variants inline de `listProducts` :**
| Champ | `listProducts` (inline) | `/variants` (dédié) | Impact |
|-------|-------------------------|---------------------|--------|
| `weight` | `0` (toujours) | `0.09` (valeur réelle) | **Critique pour Easy-Express** |
| `pieces` (PACK) | `1` (bug) | `12` (valeur réelle) | **Critique pour packQuantity** |
| `price_sale.total` (PACK) | `0` (bug) | `48` (= 4 × 12) | Cohérence prix |
| `sku_suffix` | `null` | `"GOLDEN_TU"` | Utile pour SKU |
| `product_id` | absent (implicite) | présent | Lien explicite |
| `colors[]` | absent | array dédié par variant | Accès couleurs structuré |
| `is_star` | `null` | `false` | Type cohérent |

**Données par variant :** chaque variant inclut ses propres `images` (toutes les images du produit parent).

**Conclusion : pour l'import, utiliser `/variants` pour `weight`, `pieces` (packQuantity) et `price_sale.total`** — les données inline de `listProducts` sont incorrectes pour ces champs.

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

### Source de données par champ

| Donnée BJ | Source PFS | Endpoint | Notes |
|---|---|---|---|
| `Product.reference` | `reference` | `listProducts` | Source de vérité |
| `Product.pfsProductId` (à créer) | `id` | `listProducts` | Pour re-sync |
| `Product.name` | `labels.fr` | `listProducts` | |
| `ProductTranslation` | `labels.{en,de,es,it}` | `listProducts` | 4 langues gratuites ! |
| `Product.description` | `description.fr` | **`checkReference`** | Absent de `listProducts` |
| `Category.name` | `category.labels.fr` | `listProducts` | Match ou création |
| `ProductComposition` | `material_composition[]` | **`checkReference`** | Matériau + % + labels multilingues |
| `CompositionTranslation` | `material_composition[].labels` | **`checkReference`** | Traductions gratuites |
| `ProductColor.saleType` | `variants[].type` ITEM/PACK | `listProducts` | ITEM→UNIT, PACK→PACK |
| `Color` | `variants[].item.color.reference` | `listProducts` | Match par nom normalisé |
| `Color.hex` | `variants[].item.color.value` | `listProducts` | |
| `ColorTranslation` | `variants[].item.color.labels` | `listProducts` | |
| `ProductColor.unitPrice` | `variants[].price_sale.unit.value` | `listProducts` | |
| `ProductColor.stock` | `variants[].stock_qty` | `listProducts` | |
| `ProductColor.weight` | `variants[].weight` | **`/variants`** | `listProducts` retourne 0 (bug) |
| `ProductColor.packQuantity` | `variants[].pieces` ou `packs[].sizes[].qty` | **`/variants`** | `listProducts` retourne 1 (bug) |
| `ProductColorImage` | `images.{COLOR_REF}` | `listProducts` | Télécharger + WebP |

### Stratégie d'import recommandée

1. **`listProducts`** (paginé) — récupère la liste complète avec prix, stock, couleurs, images, traductions produit/catégorie
2. **`/products/{id}/variants`** — pour chaque produit, récupère le **poids réel** et le **packQuantity réel** (corrige les bugs de `listProducts`)
3. **`checkReference/{ref}`** — optionnel, pour enrichir avec **composition**, **description**, **collection**, **pays de fabrication**
