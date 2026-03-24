# API Paris Fashion Shop - Documentation Produits

> **Dernière vérification live** : 2026-03-24
> **Total produits actifs** : ~9 252 (93 pages de 100)
> **Tests exhaustifs TESTAPI01** : 2026-03-24 (variants, tailles, catégories, genres, familles)

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

**Catégories Beli Jolie observées (scan complet 2026-03-24 — 18 catégories) :**
| Catégorie FR | Produits | ID PFS |
|---|---|---|
| Boucles d'oreilles | 2 797 | `a045J000003KWwDQAW` |
| Colliers | 1 596 | `a045J000003KWwNQAW` |
| Bracelets | 1 503 | `a045J000003KWwIQAW` |
| Bagues | 1 447 | `a045J000003KWw8QAG` |
| Parures de bijoux | 981 | `a045J00000BO0vRQAT` |
| Lots avec présentoir | 456 | `a04AZ000001JiJ3YAK` |
| Pendentifs | 156 | `a04AZ000001KcELYA0` |
| Chaînes de cheville | 137 | `a04AZ000001KcGYYA0` |
| Porte-clés | 45 | `a04W5000006vKzdIAE` |
| Piercings | 43 | `a04AZ000001KgMBYA0` |
| Présentoirs et rangements nus | 41 | `a045J00000BO0uaQAD` |
| Broches | 25 | `a045J000003KYeuQAG` |
| Lunettes | 10 | `a0458000002fIViAAM` |
| Sacs | 7 | `a04AZ000001L60cYAC` |
| Accessoires de cheveux | 3 | `a0458000002fITUAA2` |
| Boîtes & Pochettes | 2 | `a04AZ000001L61LYAS` |
| Matériaux bijoux | 2 | `a04W5000005rWN5IAM` |
| Gants | 1 | `a04AZ000001hpKSYAY` |

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
- **Tailles :** 98% des produits ont `sizes = "TU"`. ~40 produits ont des tailles de bague (`"52;53;54;55"` ou `"52;53;54;55;56"`). 1 produit a des tailles en mm (`"70;75;80"`). 169 produits ont `size_details_tu` non vide (taille physique d'une bague/bracelet vendu comme TU)
- **Statuts possibles dans la réponse :** `"READY_FOR_SALE"` (en vente), `"DRAFT"` (brouillon), `"NEW"` (créé mais jamais publié), `"ARCHIVED"` — le filtre query `status=ACTIVE` retourne les produits en `READY_FOR_SALE`

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

### 4. Créer un produit (TESTÉ - FONCTIONNEL)

#### `POST /catalog/products`

> Crée un ou plusieurs produits. Le body utilise un wrapper `data` contenant un **array** de produits.

**Headers :** `Authorization: Bearer {token}`, `Content-Type: application/json`

**Body :**
```json
{
  "data": [
    {
      "reference": "T999VS1",
      "reference_code": "T999VS1",
      "gender": "WOMAN",
      "gender_label": "Femme",
      "brand_name": "Beli & Jolie",
      "family": "a035J00000185J7QAI",
      "category": "a045J000003KWwDQAW",
      "season_name": "PE2026",
      "label": {
        "fr": "Nom du produit",
        "en": "Product name",
        "de": "Produktname",
        "es": "Nombre del producto",
        "it": "Nome del prodotto"
      },
      "description": {
        "fr": "Description FR",
        "en": "Description EN",
        "de": "Description DE",
        "es": "Description ES",
        "it": "Description IT"
      },
      "material_composition": "ACIERINOXYDABLE",
      "country_of_manufacture": "CN"
    }
  ]
}
```

**Champs obligatoires :**
| Champ | Type | Description |
|-------|------|-------------|
| `reference` | string | Référence produit (ex: `T999VS1`) |
| `reference_code` | string | Même valeur que `reference` — **obligatoire sinon erreur "Référence non valide"** |
| `gender` | string | `"WOMAN"` |
| `gender_label` | string | `"Femme"` — label FR du genre |
| `brand_name` | string | `"Beli & Jolie"` — doit correspondre exactement au nom de la marque PFS |
| `family` | string | ID de la famille (ex: `a035J00000185J7QAI` = WOMAN/FASHIONJEWELRY) |
| `category` | string | ID de la catégorie (ex: `a045J000003KWwDQAW` = Boucles d'oreilles) |
| `season_name` | string | Référence ou label FR de la collection (ex: `"PE2026"` ou `"Printemps/Été 2026"`) |
| `label` | object | Noms multilingues `{fr, en, de, es, it}` — les 5 langues PFS |
| `description` | object | Descriptions multilingues `{fr, en, de, es, it}` |
| `material_composition` | string | **String** avec la référence du matériau (ex: `"ACIERINOXYDABLE"`) — ⚠️ le format array crash en 500 (bug PFS) |
| `country_of_manufacture` | string | Code ISO pays (ex: `"CN"`) |

**Réponse 200 (succès) :**
```json
{
  "resume": { "products": 1, "errors": 0 },
  "data": [{
    "id": "pro_57fc702bb74fef655d0200a54b4d",
    "reference": "T999VS1",
    "brand_id": "a01AZ00000314QgYAI",
    "family_id": "...",
    "category_id": "...",
    "collection": { "id": "...", "reference": "PE2026", "labels": {...} },
    "material_composition": [{ "id": "...", "reference": "ACIERINOXYDABLE", "value": 100 }],
    "country_id": "a0y5800000DX9bKAAT"
  }]
}
```

**Réponse 200 (avec erreurs de validation) :**
```json
{
  "resume": { "products": 0, "errors": 1 },
  "data": [{
    "errors": {
      "gender_label": ["Genre non valide."],
      "brand_name": ["Marque non valide."],
      "reference_code": ["Référence non valide."],
      "season_name": ["Collection non valide."],
      "material_composition": ["Composition non valide."]
    },
    "error_fields": ["gender_label", "brand_name", ...]
  }]
}
```

**Notes importantes :**
- Le produit est créé avec le statut `"NEW"` (pas DRAFT ni READY_FOR_SALE)
- `material_composition` doit être une **string** (référence), pas un array d'objets — l'array crash en 500
- `reference` et `reference_code` doivent tous les deux être présents avec la même valeur
- La suppression d'un produit ne libère pas sa référence — il faut renommer la référence avant de supprimer si on veut la réutiliser
- Batch : on peut envoyer plusieurs produits dans le tableau `data`

---

### 5. Modifier le statut de produits (TESTÉ - FONCTIONNEL)

#### `PATCH /catalog/products/batch/updateStatus`

**Headers :** `Authorization: Bearer {token}`, `Content-Type: application/json`

**Body :**
```json
{
  "data": [
    { "id": "pro_xxx", "status": "READY_FOR_SALE" }
  ]
}
```

**Statuts disponibles :**
| Statut PFS | Message retourné | Équivalent BJ | Prérequis |
|------------|-----------------|---------------|-----------|
| `READY_FOR_SALE` | "Le produit a été mis en vente" | ONLINE | Au moins 1 variant + 1 image par couleur |
| `DRAFT` | "Le produit a été rédigé" | OFFLINE | Aucun |
| `NEW` | "Le produit a été restauré" | — | Aucun |
| `ARCHIVED` | "Le produit a été archivé" | ARCHIVED | Aucun |
| `DELETED` | — | — | Non testé (irréversible sur la référence) |

**Erreur si prérequis manquants :**
```json
{
  "errors": [{
    "id": "pro_xxx",
    "message": "Échec de la mise en vente du produit.",
    "issues": {
      "variant": "Il n'y a pas de déclinaison rattachée à ce produit",
      "SILVER": "Aucune image pour la couleur Argent"
    }
  }]
}
```

**Mapping BJ → PFS :**
| BJ `ProductStatus` | PFS status |
|---------------------|-----------|
| `ONLINE` | `READY_FOR_SALE` |
| `OFFLINE` | `DRAFT` |
| `ARCHIVED` | `ARCHIVED` |
| `SYNCING` | Ne pas synchroniser |

---

### 6. Modifier un produit (TESTÉ - FONCTIONNEL — vérifié 2026-03-22)

#### `PATCH /catalog/products/{id}`

> Modifie les données textuelles d'un produit existant (label, description, composition...).

**Headers :** `Authorization: Bearer {token}`, `Content-Type: application/json`

**Body complet (tous les champs modifiables) :**
```json
{
  "data": {
    "brand_name": "Beli & Jolie",
    "gender_label": "Femme",
    "family": "a035J00000185J7QAI",
    "category": "a045J000003KWwDQAW",
    "reference_code": "T999VS1",
    "label": {
      "fr": "Nouveau nom",
      "en": "New name",
      "de": "Neuer Name",
      "es": "Nuevo nombre",
      "it": "Nuovo nome"
    },
    "description": {
      "fr": "Nouvelle description",
      "en": "New description"
    },
    "season_name": "PE2026",
    "country_of_manufacture": "CN",
    "material_composition": [
      { "id": "ACIERINOXYDABLE", "value": 85 },
      { "id": "LAITON", "value": 15 }
    ],
    "lining_composition": [
      { "id": "COTON", "value": 100 }
    ]
  }
}
```

**⚠️ Important :** le wrapper est `{ data: { ... } }` (objet), pas `{ data: [ ... ] }` (array) comme pour POST.

**Champs modifiables testés (2026-03-22 + 2026-03-24) :**
| Champ | Fonctionne | Type | Notes |
|-------|-----------|------|-------|
| `label` | ✅ | `{lang: string}` | Peut modifier une seule langue ou toutes (fr/en/de/es/it) |
| `description` | ✅ | `{lang: string}` | Idem |
| `category` | ✅ | `string` | ID PFS de la catégorie (ex: `"a045J000003KWwIQAW"`) — **changeable à n'importe quelle catégorie (même cross-genre, ex: KID → WOMAN)** |
| `family` | ✅ | `string` | ID PFS de la famille (ex: `"a035J00000185J7QAI"`) — changeable indépendamment du genre |
| `gender_label` | ✅ | `string` | Label FR du genre : `"Femme"`, `"Homme"`, `"Enfant"`, `"Lifestyle & plus"` — **⚠️ Le genre n'est pas validé par rapport à la famille : on peut avoir genre=MAN avec famille=WOMAN/FASHIONJEWELRY (incohérence acceptée par PFS)** |
| `country_of_manufacture` | ✅ | `string` | Code ISO pays (ex: `"TR"`, `"CN"`) |
| `season_name` | ✅ | `string` | Référence collection (ex: `"PE2026"`) — ⚠️ doit exister sur PFS sinon 422 |
| `material_composition` | ✅ | `string` ou `array` | **String** : référence unique (ex: `"ACIERINOXYDABLE"`). **Array** : `[{id: "REF", value: pourcentage}]` — fonctionne sur PATCH (contrairement à POST qui crash en 500). PFS auto-résout les références (ex: `"LAITON"` → `"BRASS"`) |
| `lining_composition` | ✅ | `array` | Format `[{id: "REF", value: pourcentage}]` — composition de doublure. Même format que material_composition array |
| `default_color` | ✅ | `string` | Référence couleur (ex: `"GOLDEN"`, `"SILVER"`) — change aussi l'image DEFAULT automatiquement |
| `brand_name` | ✅ | `string` | Doit correspondre au nom exact de la marque PFS (`"Beli & Jolie"`) |
| `reference_code` | ✅ | `string` | Référence produit — ⚠️ ne modifie pas la `reference` affichée, seulement le `reference_code` interne |

**Réponse 200 :** retourne le produit complet mis à jour dans `{ data: {...} }` (même format que `checkReference`).

**Réponse 422 (validation) :**
```json
{
  "message": "Validation errors",
  "errors": [{ "message": "Collection non valide.", "columns": ["season_name"] }]
}
```

**Notes (2026-03-24) :**
- On peut envoyer un seul champ ou plusieurs à la fois — les champs non envoyés restent inchangés
- `material_composition` en array sur PATCH résout automatiquement les références (ex: `LAITON` → `BRASS`, `ACIERINOXYDABLE` → ID interne) — **ceci fonctionne sur PATCH mais crash en 500 sur POST**
- `season_name` doit être une collection existante sur PFS — utiliser la référence exacte (ex: `"PE2026"`, pas `"AH2026"` si elle n'existe pas)
- **Changement catégorie possible à tout moment** : un produit peut passer de KID/ACCESSORIES/GLOVES → WOMAN/FASHIONJEWELRY/RINGS → WOMAN/CLOTHES/TOPS sans erreur
- **Les variants existants ne sont pas supprimés lors d'un changement de catégorie** : un produit peut avoir des variants ITEM TU (bijoux) + ITEM XS/S/M (vêtements) en même temps
- **Genre et famille décorrélés** : PFS n'impose pas que `gender_label` soit cohérent avec la `family` — anomalie possible à éviter côté BJ

---

### 7. Upload d'image (TESTÉ - FONCTIONNEL)

#### `POST /catalog/products/{id}/image`

> Upload une image pour un produit. Supporte le multipart/form-data ET l'URL distante.

**Méthode 1 : Upload fichier (multipart/form-data)**

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `image` | file | oui | Fichier image (JPEG/JPG/PNG **uniquement**, pas de WebP) |
| `slot` | integer | oui | Position de l'image (1, 2, 3...) |
| `color` | string | oui | Référence couleur (ex: `"GOLDEN"`, `"SILVER"`) |

**⚠️ Le champ fichier s'appelle `image` (pas `file`).**

```
POST /catalog/products/{id}/image
Content-Type: multipart/form-data

image: [fichier JPEG]
slot: 1
color: GOLDEN
```

**Méthode 2 : URL distante (JSON)**

```json
{
  "image_url": "https://example.com/image.jpg",
  "slot": 2,
  "color": "SILVER"
}
```

**Réponse 200 :**
```json
{
  "success": true,
  "image_path": "https://static.parisfashionshops.com/.../image.jpg"
}
```

**Notes :**
- La première image uploadée pour une couleur définit automatiquement `default_color` du produit
- Les images WebP ne sont **pas acceptées** — convertir en JPEG avant upload
- `slot` est un entier (position de l'image), commençant à 1
- L'image est hébergée sur le CDN PFS (`static.parisfashionshops.com`)
- Pour READY_FOR_SALE, chaque couleur ayant un variant doit avoir au moins 1 image

---

### 8. Créer des variants (TESTÉ - FONCTIONNEL — vérifié 2026-03-24)

#### `POST /catalog/products/{id}/variants`

> Ajoute des variants (déclinaisons) à un produit. Batch supporté (plusieurs variants en un seul appel).

**Headers :** `Authorization: Bearer {token}`, `Content-Type: application/json`

**Format ITEM (unité) :**
```json
{
  "data": [{
    "type": "ITEM",
    "color": "GOLDEN",
    "size": "TU",
    "price_eur_ex_vat": 5.0,
    "stock_qty": 100,
    "weight": 0.05
  }]
}
```

**Format ITEM avec taille de bague :**
```json
{
  "data": [
    { "type": "ITEM", "color": "GOLDEN", "size": "52", "price_eur_ex_vat": 3.5, "weight": 0.03, "stock_qty": 100 },
    { "type": "ITEM", "color": "GOLDEN", "size": "53", "price_eur_ex_vat": 3.5, "weight": 0.03, "stock_qty": 100 },
    { "type": "ITEM", "color": "SILVER", "size": "52", "price_eur_ex_vat": 3.5, "weight": 0.03, "stock_qty": 100 }
  ]
}
```

**Format ITEM avec taille vêtements :**
```json
{
  "data": [
    { "type": "ITEM", "color": "RED", "size": "XS", "price_eur_ex_vat": 8.0, "weight": 0.3, "stock_qty": 100 },
    { "type": "ITEM", "color": "RED", "size": "S",  "price_eur_ex_vat": 8.0, "weight": 0.3, "stock_qty": 100 },
    { "type": "ITEM", "color": "BLUE", "size": "T38", "price_eur_ex_vat": 8.0, "weight": 0.3, "stock_qty": 100 },
    { "type": "ITEM", "color": "BLUE", "size": "T40", "price_eur_ex_vat": 8.0, "weight": 0.3, "stock_qty": 100 }
  ]
}
```

**Format PACK mono-couleur :**
```json
{
  "data": [{
    "type": "PACK",
    "color": "GOLDEN",
    "size": "TU",
    "packs": [{ "color": "GOLDEN", "size": "TU", "qty": 12 }],
    "price_eur_ex_vat": 4.0,
    "stock_qty": 100,
    "weight": 0.5
  }]
}
```

**Format PACK mono-couleur avec taille de bague :**
```json
{
  "data": [
    {
      "type": "PACK", "color": "GOLDEN", "size": "52",
      "packs": [{ "color": "GOLDEN", "size": "52", "qty": 12 }],
      "price_eur_ex_vat": 3.2, "stock_qty": 50, "weight": 0.36
    },
    {
      "type": "PACK", "color": "GOLDEN", "size": "53",
      "packs": [{ "color": "GOLDEN", "size": "53", "qty": 12 }],
      "price_eur_ex_vat": 3.2, "stock_qty": 50, "weight": 0.36
    }
  ]
}
```

**Format PACK multi-couleurs (TESTÉ 2026-03-24) :**
```json
{
  "data": [{
    "type": "PACK",
    "color": "GOLDEN",
    "size": "TU",
    "packs": [
      { "color": "GOLDEN", "size": "TU", "qty": 6 },
      { "color": "SILVER", "size": "TU", "qty": 6 }
    ],
    "price_eur_ex_vat": 5.0,
    "stock_qty": 30,
    "weight": 0.5
  }]
}
```
→ PFS génère automatiquement `sku_suffix = "GOLDEN_SILVER_TU"` (concaténation des couleurs)

**Champs communs :**
| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `type` | string | oui | `"ITEM"` (unité) ou `"PACK"` (lot) |
| `price_eur_ex_vat` | number | oui | Prix unitaire HT en EUR — ⚠️ pas `price`, pas `price_sale` |
| `stock_qty` | number | oui | Quantité en stock |
| `weight` | number | oui | Poids en kg |

**Champs ITEM :**
| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `color` | string | oui | Référence couleur PFS (ex: `"GOLDEN"`, `"SILVER"`, `"RED"`) |
| `size` | string | oui | Taille (ex: `"TU"`, `"52"`, `"XS"`, `"T38"`) — voir section Tailles |
| `size_details_tu` | string | non | Taille effective si size=TU (ex: `"40"` pour une bague TU de tour 40mm) — **⚠️ accepté dans la création mais NON stocké dans /variants** (retourne `""`) |

**Champs PACK :**
| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `color` | string | oui | Couleur principale (référence PFS) — influence le `sku_suffix` |
| `size` | string | oui | Taille principale — doit correspondre à celle dans `packs[]` |
| `packs` | array | oui | Lignes de couleur/taille : `[{ color, size, qty }]` |
| `packs[].color` | string | oui | Référence couleur (ex: `"GOLDEN"`) |
| `packs[].size` | string | oui | Taille (ex: `"TU"`, `"52"`) |
| `packs[].qty` | number | oui | Quantité pour cette ligne |

**⚠️ Important pour PACK :**
- Les champs `color` et `size` de niveau racine doivent correspondre à la première ligne de `packs[]`
- `pieces` dans la réponse GET = somme des `qty` (ex: GOLDEN qty=6 + SILVER qty=6 → pieces=12)
- `price_sale.total` = `price_sale.unit.value × pieces`
- `sku_suffix` auto-généré : `"COLOR1_COLOR2_SIZE"` (couleurs séparées par `_`, tout en majuscules)
- Pour PACK de bague : 1 variant par (couleur × taille) : `[{color: "GOLDEN", size: "52", qty: 12}]`

**Réponse 200 (succès) :**
```json
{
  "resume": { "products": 3, "errors": 0 },
  "data": [
    { "id": "pro_xxx", "type": "ITEM", "color": "GOLDEN", "size": "52", ... },
    { "id": "pro_yyy", "type": "ITEM", "color": "GOLDEN", "size": "53", ... }
  ]
}
```

---

### 9. Modifier des variants en batch (TESTÉ - FONCTIONNEL — vérifié 2026-03-22)

#### `PATCH /catalog/products/variants`

> **Clé : utiliser `variant_id` (PAS `id`).** Avec le champ `id`, l'API retourne 200 mais `updated: 0`. Avec `variant_id`, la modification fonctionne correctement.
>
> **Rate limit : 30 appels/minute.**

**Body complet (tous les champs modifiables) :**
```json
{
  "data": [
    {
      "variant_id": "pro_variant_xxx",
      "price_eur_ex_vat": 7.5,
      "stock_qty": 500,
      "weight": 0.12,
      "custom_suffix": "special-edition",
      "star": true,
      "is_active": false,
      "discount_type": "PERCENT",
      "discount_value": 10
    }
  ]
}
```

**Champs modifiables testés (2026-03-22) :**
| Champ | Type | Fonctionne | Notes |
|-------|------|-----------|-------|
| `variant_id` | string | **obligatoire** | Identifiant unique du variant (ex: `"pro_c33dcc49..."`) |
| `price_eur_ex_vat` | number | ✅ | Prix unitaire HT en euros |
| `stock_qty` | number | ✅ | Quantité en stock |
| `weight` | number | ✅ | Poids en kg (ex: `0.15`) |
| `custom_suffix` | string | ✅ | Suffixe personnalisé du variant. `""` pour supprimer |
| `star` | boolean | ✅ | Marquer comme variant favori/vedette |
| `is_active` | boolean | ✅ | Activer/désactiver le variant (alternative à `setAvailability`) |
| `discount_type` | string\|null | ✅ | `"PERCENT"` ou `"AMOUNT"`, `null` pour supprimer |
| `discount_value` | number\|null | ✅ | Valeur de la remise, `null` pour supprimer |
| `discounted_price_eur_ex_vat` | number | ⚠️ | **Ignoré** quand utilisé seul (`updated: 0`). `null` crash en 500. `0` retourne 200 mais sans effet. **Utiliser `discount_type`/`discount_value` à la place** |

**Réponse 200 :**
```json
{
  "message": "Déclinaisons mises à jour avec succès",
  "data": {
    "resume": { "product_items": { "updated": 1, "total": 1 }, "errors": 0 },
    "errors": []
  }
}
```

**Effet des discounts (vérifié) :**
- `discount_type: "PERCENT", discount_value: 20` sur un prix de 11€ → `price_sale: 8.80€`, `price_before_discount: 11€`
- `discount_type: "AMOUNT", discount_value: 2` sur un prix de 11€ → `price_sale: 9€`, `price_before_discount: 11€`
- `discount_type: null, discount_value: null` → supprime le discount, `price_sale = price_before_discount`

**Batch multi-variants :** on peut envoyer plusieurs variants dans le même appel (testé avec 2 variants simultanés).

**Bugs connus :**
- `discounted_price_eur_ex_vat` seul → `updated: 0` (ignoré par l'API). Ce champ du Swagger ne fonctionne pas en pratique.
- `discounted_price_eur_ex_vat: null` → crash 500 (Server Error)

**Solution alternative : DELETE + POST** (si PATCH ne suffit pas, e.g. changer la couleur/type)
```
DELETE /catalog/products/variants/{variant_id}
POST /catalog/products/{product_id}/variants
{ "data": [{ ... }] }
```

---

### 10. Activer/désactiver des variants (TESTÉ - FONCTIONNEL)

Deux endpoints disponibles :

#### a) Par variant individuel : `PATCH /catalog/products/variants/{variant_id}/setAvailability`

**Body :** (pas de wrapper `data`)
```json
{ "enable": true }
```

**Réponse 200 :** `{ "success": true }`

**⚠️ Uniquement PATCH** (POST retourne 405). Pas de wrapper `data` (retourne 422).

#### b) En batch : `PATCH /catalog/products/variants/batch/setAvailability`

**Body :**
```json
{
  "data": [
    { "id": "pro_variant_xxx", "enable": true },
    { "id": "pro_variant_yyy", "enable": false }
  ]
}
```

**⚠️ Le champ s'appelle `enable` (pas `is_active`).**

**Réponse 200 :** `{ "success": true }`

---

### 11. Supprimer un variant (TESTÉ - FONCTIONNEL)

#### `DELETE /catalog/products/variants/{variant_id}`

**Headers :** `Authorization: Bearer {token}`

**Réponse 200 :** `{ "success": true }`

**Note :** les images associées à la couleur du variant ne sont pas supprimées automatiquement.

---

### 12. Supprimer une image (TESTÉ - NON FONCTIONNEL)

#### `DELETE /catalog/products/{id}/image`

> **Crash en 500** — la suppression d'images via API ne fonctionne pas. Il faut passer par le frontend PFS.

---

### 13. Référentiels / Attributs (TESTÉ - FONCTIONNEL)

> `GET /catalog/attributes/{type}` — retourne la liste complète des valeurs possibles pour chaque attribut PFS.

| Endpoint | Count | Clé principale | Structure |
|----------|-------|----------------|-----------|
| `/catalog/attributes/collections` | 9 | `reference` (PE2026, AH2025...) | `id`, `reference`, `labels` (5 langues) |
| `/catalog/attributes/categories` | 347 | `id` | `id`, `family` (id), `labels`, `gender` |
| `/catalog/attributes/colors` | 142 | `reference` (GOLDEN, SILVER...) | `reference`, `value` (hex), `image`, `labels` |
| `/catalog/attributes/compositions` | 114 | `reference` (ACIERINOXYDABLE...) | `id`, `reference`, `labels` |
| `/catalog/attributes/countries` | 238 | `reference` (ISO: FR, CN, TR...) | `reference`, `labels`, `preview` (flag SVG) |
| `/catalog/attributes/families` | 29 | `id` | `id`, `labels`, `gender` |
| `/catalog/attributes/genders` | 4 | `reference` (MAN/WOMAN/KID/SUPPLIES) | `reference`, `labels` (5 langues) |
| `/catalog/attributes/sizes` | ~50 | `reference` (TU, S, M, L...) | `reference` uniquement (pas de labels multilingues) |

**Genres complets (testé 2026-03-24) :**
| Référence | FR | EN | ES | DE | IT |
|---|---|---|---|---|---|
| `WOMAN` | Femme | Woman | Mujer | Damen | Donna |
| `MAN` | Homme | Man | Hombre | Herren | Uomo |
| `KID` | Enfant | Kids | Niños | Kinder | Bambino |
| `SUPPLIES` | Lifestyle & plus | Lifestyle & more | Lifestyle & más | Lifestyle & Merh | Lifestyle & altro |

**Familles WOMAN :** Bijoux Fantaisie (`a035J00000185J7QAI`), Vêtements, Lingerie, Chaussures, Accessoires, Maroquinerie, Beauté, Grandes tailles
**Familles MAN :** Bijoux (`a03AZ000004JlRLYA0`), Vêtements, Maroquinerie, Chaussures, Accessoires, Sous-vêtements, Beauté
**Familles KID :** Bijoux Fantaisie (`a035J00000NACDzQAP`), Accessoires (`a03AZ000001KjT8YAK`), Montres, Sacs à dos, Vêtements, Fille, Garçon, Jouets, Bébé, Maroquinerie
**Familles SUPPLIES :** Emballages, Matériel boutique, Uniformes professionnels, Fête et Décorations, Lifestyle

**Usage pour le reverse sync :**
- `colors.reference` = valeur à passer dans `color` lors du POST variant ou `default_color` du PATCH product
- `compositions.reference` = valeur à passer dans `material_composition` du POST/PATCH product
- `categories.id` = valeur à passer dans `category` du POST/PATCH product
- `collections.reference` = valeur à passer dans `season_name` du POST/PATCH product
- `countries.reference` = valeur à passer dans `country_of_manufacture`

---

## Tailles (Sizes) — Référence complète (testé 2026-03-24)

> **27 catégories testées exhaustivement sur TESTAPI01** — ITEM, PACK, multi-couleurs, toutes tailles.

### Endpoint `/catalog/attributes/sizes`

Retourne les tailles de référence PFS (`reference` uniquement, pas de labels) :

```
TU           ← Taille Unique (bijoux standard, écharpes, sacs...)
XXS, XS, S, M, L, XL, XXL, XXXL, 4XL, 5XL, 6XL   ← Vêtements standard
XS/S, S/M, M/L, L/XL, XL/XXL, XXL/XXXL (et variantes avec tiret)  ← Tailles doubles
T24→T34 (pairs) ← Jeans, enfants
T36, T38, T40, T42, T44, T46, T48, T50, T52, T54, T56, T58, T60, T62, T64, T66, T68  ← Tailles FR femme
```

**⚠️ Important :** PFS accepte des tailles HORS de cette liste si elles suivent un pattern reconnu (numérique pur, alpha+numérique type "85A"). La seule catégorie explicitement refusée : format **UK** (`UK6`, `UK7` → `"Taille non valide"`).

### Règles de validation PFS (découvertes par tests)

| Pattern | Exemple | Accepté | Note |
|---------|---------|---------|------|
| Valeur fixe de la liste | `TU`, `XS`, `S/M` | ✅ | Standard |
| Numérique pur | `36`, `52`, `80`, `100` | ✅ | Tour de doigt, pointure EU, diamètre mm, longueur cm |
| Numérique + lettre majuscule | `85A`, `90B`, `95C` | ✅ | Bonnets lingerie |
| T + numérique pair | `T34`, `T36`...`T68` | ✅ | Tailles françaises |
| Alpha + `/` + Alpha | `XS/S`, `M/L` | ✅ | Tailles chevauchantes |
| Alpha + `-` + Alpha | `XS-S`, `M-L` | ✅ | Variante avec tiret |
| `UK` + numérique | `UK6`, `UK7` | ❌ | **Refusé** : "Taille non valide" |

### Contrainte SKU doublon (⚠️ critique)

PFS génère automatiquement le `sku_suffix = "COLOR_SIZE"`. **Si ce SKU existe déjà sur le produit, la création échoue silencieusement** (HTTP 200 mais `resume: {products: 0, errors: 1}`). Il faut supprimer l'ancien variant avant d'en créer un nouveau avec les mêmes couleur+taille.

### Tailles par catégorie — Résultats tests exhaustifs (2026-03-24)

#### Bijoux Fantaisie WOMAN (12 catégories : Boucles, Bagues, Colliers, Bracelets, Parures, Pendentifs, Chaînes de cheville, Piercings, Broches, Porte-clés, Lots, Présentoirs)
| Taille | ITEM | PACK | Notes |
|--------|------|------|-------|
| `TU` | ✅ | ✅ | Standard bijoux |
| `52`, `53`, `54`, `55`, `56` | ✅ | ✅ | Tour de doigt (bagues) |
| `70`, `75`, `80` | ✅ | ✅ | Diamètre mm (créoles) |
| Tout numérique (85, 90, 100...) | ✅ | ✅ | PFS ne bloque aucun chiffre |

#### Écharpes / Foulards (WOMAN)
| Taille | ITEM | PACK |
|--------|------|------|
| `TU` | ✅ | ✅ |
| `S`, `M`, `L` | ✅ | — (non testé) |

#### Ceintures (WOMAN)
| Taille | ITEM | Notes |
|--------|------|-------|
| `T34`, `T36`, `T38`, `T40`, `T42`, `T44` | ✅ | Tailles FR |
| `XS`, `S`, `M`, `L`, `XL` | ✅ | |
| `TU` | ✅ | |
| `70`, `80`, `90`, `100`, `110` | ✅ | Longueur en cm |

#### Chapeaux / Gants / Accessoires / Parfums / Beauté
| Taille | ITEM | PACK |
|--------|------|------|
| `TU` | ✅ | ✅ |
| `S`, `M`, `L` | ✅ | — |
| `36`, `37`, `38`, `39`, `40`, `41`, `42` | ✅ | — (tour de tête/pointure gant) |

#### Lunettes (KID + toutes catégories)
| Taille | ITEM | Notes |
|--------|------|-------|
| `TU` | ✅ | |
| `50`, `52`, `54`, `56`, `58` | ✅ | Largeur monture (mm) |

#### Sacs / Maroquinerie (Reporters, Sacs à main...)
| Taille | ITEM | PACK |
|--------|------|------|
| `TU` | ✅ | ✅ |
| `S`, `M`, `L` | ✅ | — |

#### Vêtements (Tops, Soirées, Boxers, Manteaux KID — toutes catégories vêtements)
| Taille | ITEM | PACK |
|--------|------|------|
| `XS`, `S`, `M`, `L`, `XL`, `XXL` | ✅ | ✅ |
| `XXXL`, `4XL`, `5XL`, `6XL` | ✅ | — |
| `T34`, `T36`, `T38`, `T40`, `T42`, `T44`, `T46`, `T48`, `T50`, `T52` | ✅ | — |
| `XS/S`, `S/M`, `M/L`, `L/XL`, `XL/XXL` | ✅ | — |
| `TU` | ✅ | — |
| PACK multi-taille `[S×2, M×2, L×2]` | — | ✅ |

#### Lingerie / Soutiens-gorge
| Taille | ITEM | Notes |
|--------|------|-------|
| `85A`, `85B`, `85C`, `90A`, `90B`, `90C`, `95B`, `95C` | ✅ | Format `{tour_de_poitrine}{bonnet}` |
| `XS`, `S`, `M`, `L`, `XL` | ✅ | |
| `TU` | ✅ | |
| `36`, `38`, `40`, `42`, `44` | ✅ | Tailles FR |

#### Chaussures (Mocassins, Mules, Talons — toutes catégories chaussures)
| Taille | ITEM | PACK | Notes |
|--------|------|------|-------|
| `36`, `37`, `38`, `39`, `40`, `41`, `42` | ✅ | ✅ | EU femme |
| `43`, `44`, `45`, `46` | ✅ | — | EU homme |
| `20`, `21`, `22`, `23`, `24`, `25`, `26`, `27`, `28`, `29`, `30` | ✅ | — | EU enfant |
| `TU` | ✅ | — | |
| `UK6`, `UK7` | ❌ | ❌ | **Refusé** : "Taille non valide" |

### Champ `size_details_tu` (produit + variant)

Présent sur 169 produits Beli Jolie quand `size = "TU"` mais la pièce a une taille physique mesurable :

| Valeur observée | Signification | Catégories |
|----------------|---------------|-----------|
| `"36"`, `"38"`, `"40"` | Tour de doigt en mm (bague TU de taille fixe) | Bagues |
| `"40"` | Tour de poignet ou diamètre | Bracelets, Boucles d'oreilles |
| `"null"` (string) | Bug PFS : valeur mal renseignée | — |

**⚠️ Non modifiable via API :** le champ `size_details_tu` est accepté dans le body de création de variant mais **n'est pas stocké** — retourne `""` via `/variants`. C'est une donnée en lecture seule côté back-office PFS.

### Logique de variant par catégorie (résumé)

#### Bijoux (TU)
```
ITEM GOLDEN/TU + ITEM SILVER/TU
PACK GOLDEN:[TU×12] + PACK SILVER:[TU×12]
sku_suffix: "GOLDEN_TU", "SILVER_TU"
```

#### Bagues (tailles 52-56)
```
ITEM GOLDEN/52, GOLDEN/53, GOLDEN/54, GOLDEN/55
ITEM SILVER/52, SILVER/53, SILVER/54, SILVER/55
PACK GOLDEN:[52×12], PACK GOLDEN:[53×12] ...
sku_suffix: "GOLDEN_52", "SILVER_53"
```
→ 2 couleurs × 4 tailles = **8 ITEM + 8 PACK = 16 variants**

#### Vêtements (XS/S/M/L/XL ou T36/T38/T40)
```
ITEM RED/XS, RED/S, RED/M, RED/L, RED/XL
ITEM BLUE/T36, BLUE/T38, BLUE/T40
PACK RED:[S×5]         ← mono-taille
PACK BLACK:[S×2,M×2,L×2]  ← multi-taille
sku_suffix: "RED_XS", "BLUE_T38", "BLACK_S"
```

#### Lingerie (bonnets)
```
ITEM BLACK/85A, BLACK/85B, BLACK/85C, BLACK/90B ...
WHITE/85A, WHITE/85B ...
sku_suffix: "BLACK_85A", "WHITE_90B"
```

#### Chaussures EU
```
ITEM BLACK/36, BLACK/37, BLACK/38 ... BLACK/42
PACK BLACK:[38×1]
sku_suffix: "BLACK_36", "BLACK_38"
```

#### PACK multi-couleurs (toutes catégories)
```json
{
  "type": "PACK", "color": "GOLDEN", "size": "TU",
  "packs": [
    { "color": "GOLDEN", "size": "TU", "qty": 6 },
    { "color": "SILVER", "size": "TU", "qty": 6 }
  ]
}
```
→ `pieces=12`, `sku_suffix="GOLDEN_SILVER_TU"`, `price_total = price_unit × 12`

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

---

## Mapping Beli Jolie → PFS (Push / Sync inverse)

### IDs de référence (constants)
| Entité | ID PFS | Reference |
|--------|--------|-----------|
| Brand (Beli & Jolie) | `a01AZ00000314QgYAI` | — |
| Family (Bijoux fantaisie) | `a035J00000185J7QAI` | `WOMAN/FASHIONJEWELRY` |
| Collection PE2026 | `a0cZ50k09p2mpLdIHG` | `PE2026` |

### Catégories connues
| Catégorie FR | ID PFS | Reference PFS |
|-------------|--------|---------------|
| Boucles d'oreilles | `a045J000003KWwDQAW` | `WOMAN/FASHIONJEWELRY/EARRINGS` |
| Bracelets | `a045J000003KWwIQAW` | — |
| Bagues | — | `WOMAN/FASHIONJEWELRY/RINGS` |
| Colliers | — | `WOMAN/FASHIONJEWELRY/NECKLACES` |
| Parures | — | — |

> Les IDs de catégorie manquants doivent être récupérés depuis `listProducts` en cherchant un produit de cette catégorie.

### Mapping des champs BJ → PFS

| Donnée BJ | Champ PFS | Endpoint | Notes |
|---|---|---|---|
| `Product.reference` | `reference` + `reference_code` | POST create | Les deux doivent être identiques |
| `Product.name` | `label.fr` | POST/PATCH | |
| `ProductTranslation.{en,de,es,it}` | `label.{en,de,es,it}` | POST/PATCH | PFS supporte 5 langues (pas ar, zh) |
| `Product.description` | `description.fr` | POST/PATCH | |
| `Category` | `category` (ID) | POST create | Mapper catégorie BJ → ID PFS |
| `ProductComposition.material.reference` | `material_composition` (string) | POST create | Référence matériau PFS (ex: `"ACIERINOXYDABLE"`) |
| `ProductColor.saleType` | `type` (ITEM/PACK) | POST variants | UNIT→ITEM, PACK→PACK (⚠️ PACK crash) |
| `Color.pfsReference` / détection | `color` (string) | POST variants | Référence couleur PFS (ex: `"GOLDEN"`) |
| `ProductColor.unitPrice` | `price_eur_ex_vat` | POST variants | Prix HT — identique BJ et PFS |
| `ProductColor.stock` | `stock_qty` | POST variants | |
| `ProductColor.weight` | `weight` | POST variants | En kg |
| `ProductColorImage` → JPEG | `image` (file) + `slot` + `color` | POST image | Convertir WebP → JPEG avant upload |
| `ProductStatus` | `status` | PATCH batch | ONLINE→READY_FOR_SALE, OFFLINE→DRAFT, ARCHIVED→ARCHIVED |

### Stratégie de push recommandée

1. **`checkReference/{ref}`** — vérifier si le produit existe déjà sur PFS
2. Si **n'existe pas** → `POST /catalog/products` pour créer + `POST .../variants` pour chaque variant ITEM + `POST .../image` pour chaque image (WebP→JPEG)
3. Si **existe** → comparer les données :
   - `PATCH /catalog/products/{id}` pour label/description/default_color/category/country/material_composition(array)/lining_composition
   - `PATCH /catalog/products/variants` avec `variant_id` pour modifier prix/stock/weight/discount/custom_suffix/star/is_active
   - `POST .../variants` pour les nouveaux variants / `DELETE .../variants/{id}` pour les supprimés
   - `POST .../image` pour les images (à chaque sync — pas de comparaison fiable)
   - `PATCH .../batch/updateStatus` si le statut a changé
4. **Ordre important :** produit → variants → images → statut (READY_FOR_SALE nécessite variants + images)

### Limitations connues (bugs PFS — mise à jour 2026-03-22)
- **`material_composition` en array sur POST** : crash 500 — utiliser une string (référence unique) pour la création. **Sur PATCH, l'array `[{id, value}]` fonctionne** et supporte la composition multiple (testé 2026-03-22)
- **PATCH variants avec `id`** : retourne 200 mais `updated: 0` — **utiliser `variant_id`** à la place (testé et fonctionnel)
- **`discounted_price_eur_ex_vat`** : champ du Swagger ignoré par l'API (`updated: 0`). `null` crash en 500. Utiliser `discount_type`/`discount_value` à la place
- **DELETE image** : crash 500 — pas possible via API
- **Suppression produit** : ne libère pas la référence — renommer d'abord si on veut la réutiliser
- **PACK format `sizes` imbriqué** : crash — utiliser le format plat `{ color, size, qty }` dans `packs`
- **Rate limit variants** : 30 appels/minute sur `PATCH /catalog/products/variants`

### Produit de test créé
- **Référence :** `T999VS1`
- **ID PFS :** `pro_57fc702bb74fef655d0200a54b4d`
- **Statut :** `DRAFT` (mis en DRAFT après tests)
- **Variants :** ITEM GOLDEN + ITEM SILVER + PACK GOLDEN + PACK SILVER + PACK GOLDEN+SILVER
- **Images :** 2 GOLDEN + 2 SILVER
