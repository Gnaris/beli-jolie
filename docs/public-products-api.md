# API publique produits — Beli & Jolie

Endpoint pour récupérer le catalogue produit depuis l'extérieur.

**Réservé à `beliandjolie.com`.** Un appel sur `issyma.fr` ou tout autre domaine renvoie `404`.

## Authentification

Un seul header à ajouter à chaque appel :

```
X-API-Key: kebab
```

Sans header, ou avec une autre valeur → `401 Unauthorized`.

## GET `/api/public/products`

Liste paginée des produits.

### Query params (tous optionnels)

| Paramètre   | Type   | Défaut | Description                                                       |
|-------------|--------|--------|-------------------------------------------------------------------|
| `page`      | int    | `1`    | Numéro de page (démarre à 1).                                     |
| `perPage`   | int    | `50`   | Produits par page. Plafond : `200`.                               |
| `reference` | string | —      | Filtre exact sur la référence (ex : `BJ-1234`).                   |
| `status`    | string | —      | Filtre : `ONLINE`, `OFFLINE`, `ARCHIVED`, `SYNCING`. Sinon tous.  |

### Exemples

```bash
# Tous les produits, page 1
curl -H "X-API-Key: kebab" https://beliandjolie.com/api/public/products

# Un produit précis
curl -H "X-API-Key: kebab" "https://beliandjolie.com/api/public/products?reference=BJ-1234"

# Uniquement les produits en ligne, 100 par page
curl -H "X-API-Key: kebab" "https://beliandjolie.com/api/public/products?status=ONLINE&perPage=100"
```

### Réponse

```json
{
  "page": 1,
  "perPage": 50,
  "total": 8234,
  "hasMore": true,
  "products": [
    {
      "reference": "BJ-1234",
      "status": "ONLINE",
      "name": "Bague acier or fine",
      "description": "…",
      "category": "Bague",
      "subCategories": ["Chevalière", "Éternité"],
      "manufacturingCountry": "Chine",
      "dimensions": {
        "length": 20,
        "width": 10,
        "height": 5,
        "diameter": null,
        "circumference": null
      },
      "composition": [
        { "name": "Acier inoxydable", "percent": 100 }
      ],
      "colors": [
        {
          "colorId": "cku42x…",
          "name": "Or",
          "hex": "#D4AF37",
          "imageUrl": "https://beliandjolie.com/uploads/beliandjolie/motifs-couleurs/or.jpg",
          "variants": [
            {
              "sku": "BJ-1234_OR_UNIT_1",
              "saleType": "UNIT",
              "packQuantity": null,
              "price": 4.20,
              "stock": 12,
              "weightKg": 0.02,
              "sizes": [{ "name": "TU", "quantity": 1 }]
            }
          ]
        }
      ]
    }
  ]
}
```

### Champs

- `status` : état du produit dans l'admin (`ONLINE`, `OFFLINE`, `ARCHIVED`, `SYNCING`).
- `dimensions` : en millimètres, `null` si non renseigné.
- `composition[].percent` : pourcentage (ex : `100` pour 100 %).
- `colors[].imageUrl` : URL absolue de l'image représentant la couleur (motif prioritaire, sinon 1ʳᵉ photo).
- `colors[].hex` : peut être `null` si la couleur est représentée uniquement par un motif.
- `variants[].saleType` : `UNIT` (pièce unique) ou `PACK` (paquet).
- `variants[].packQuantity` : nombre de pièces par paquet (`null` pour `UNIT`).
- `variants[].price` : prix HT en euros.
- `variants[].weightKg` : poids en kilogrammes.

## Codes de statut

| Code | Cas                                                                 |
|------|---------------------------------------------------------------------|
| 200  | OK                                                                  |
| 401  | Header `X-API-Key` manquant ou incorrect                            |
| 404  | Appel depuis un autre domaine que `beliandjolie.com`                |
