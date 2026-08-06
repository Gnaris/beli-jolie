# API publique produits — Beli & Jolie

Un seul endpoint pour lire le catalogue.

**Réservé à `beliandjolie.com`.** Un appel sur `issyma.fr` ou tout autre domaine renvoie `404`.

## Authentification

Un header obligatoire :

```
X-API-Key: kebab
```

Sans header ou avec une autre valeur → `401 Unauthorized`.

---

## Deux modes d'appel

L'endpoint est le même : `GET https://beliandjolie.com/api/public/products`.

| Mode                  | Header à ajouter                     | Réponse                          |
|-----------------------|--------------------------------------|----------------------------------|
| **1 produit précis**  | `X-Product-Reference: BJ-1234`       | `{ "product": {...} }` ou `404`  |
| **Liste paginée**     | (aucun header supplémentaire)        | `{ page, totalPages, products }` |

### Mode 1 — Récupérer un seul produit

```bash
curl -H "X-API-Key: kebab" \
     -H "X-Product-Reference: BJ-1234" \
     https://beliandjolie.com/api/public/products
```

Réponse :
```json
{ "product": { "reference": "BJ-1234", "status": "En ligne", ... } }
```

Si la référence n'existe pas → `404 Not Found`.

### Mode 2 — Liste paginée

```bash
# Page 1 (50 produits par défaut)
curl -H "X-API-Key: kebab" https://beliandjolie.com/api/public/products

# Page 2, 100 par page
curl -H "X-API-Key: kebab" \
  "https://beliandjolie.com/api/public/products?page=2&perPage=100"

# Filtrer par statut (voir table plus bas)
curl -H "X-API-Key: kebab" \
  "https://beliandjolie.com/api/public/products?status=brouillon"
```

Query params (tous optionnels) :

| Paramètre | Type   | Défaut | Description                                                     |
|-----------|--------|--------|------------------------------------------------------------------|
| `page`    | int    | `1`    | Numéro de page                                                   |
| `perPage` | int    | `50`   | Produits par page. Max `200`.                                    |
| `status`  | string | —      | `en-ligne`, `hors-ligne`, `brouillon`, `archive`, `synchronisation` |

---

## Comment parcourir toutes les pages

Chaque réponse contient `page`, `totalPages` et `hasMore`. Boucle simple :

```javascript
let page = 1;
let all = [];
while (true) {
  const res = await fetch(
    `https://beliandjolie.com/api/public/products?page=${page}&perPage=200`,
    { headers: { "X-API-Key": "kebab" } }
  );
  const data = await res.json();
  all = all.concat(data.products);
  if (!data.hasMore) break;
  page++;
}
console.log(`Récupéré ${all.length} produits sur ${data.total}`);
```

Ou en cURL, page par page :
```bash
curl -H "X-API-Key: kebab" "https://beliandjolie.com/api/public/products?page=1&perPage=200"
curl -H "X-API-Key: kebab" "https://beliandjolie.com/api/public/products?page=2&perPage=200"
# … jusqu'à ce que hasMore = false
```

---

## Statuts produit

| Retour API              | Filtre `?status=`      | Signification                                     |
|-------------------------|------------------------|---------------------------------------------------|
| `"En ligne"`            | `en-ligne`             | Visible sur la boutique                           |
| `"Hors ligne"`          | `hors-ligne`           | Caché volontairement                              |
| `"Brouillon"`           | `brouillon`            | Fiche incomplète (manque prix, photo, poids…)     |
| `"Archivé"`             | `archive`              | Fin de vie, gardé pour l'historique               |
| `"En synchronisation"`  | `synchronisation`      | Rafraîchissement en cours (état passager)         |

---

## Structure d'une réponse liste

```json
{
  "page": 1,
  "perPage": 50,
  "total": 8234,
  "totalPages": 165,
  "hasMore": true,
  "products": [
    {
      "reference": "BJ-1234",
      "status": "En ligne",
      "name": "Bague acier or fine",
      "description": "…",
      "category": "Bague",
      "subCategories": ["Chevalière", "Éternité"],
      "manufacturingCountry": "Chine",
      "dimensions": {
        "length": 20, "width": 10, "height": 5,
        "diameter": null, "circumference": null
      },
      "composition": [
        { "name": "Acier inoxydable", "percent": 100 }
      ],
      "colors": [
        {
          "name": "Or",
          "imageUrls": [
            "https://beliandjolie.com/uploads/beliandjolie/produits/BJ-1234/or-1.webp",
            "https://beliandjolie.com/uploads/beliandjolie/produits/BJ-1234/or-2.webp",
            "https://beliandjolie.com/uploads/beliandjolie/produits/BJ-1234/or-3.webp"
          ],
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

En **Mode 1** (header `X-Product-Reference`), la réponse est exactement le même objet mais dans un champ `product` (singulier) au lieu d'un tableau `products`.

### Champs

- `dimensions` : en millimètres, `null` si non renseigné.
- `composition[].percent` : pourcentage (`100` = 100 %).
- `colors[].imageUrls` : **liste** de toutes les photos de la couleur (URLs absolues sur `beliandjolie.com`, prêtes à télécharger).
- `variants[].saleType` : `UNIT` (pièce unique) ou `PACK` (paquet).
- `variants[].price` : prix HT en euros.
- `variants[].weightKg` : poids en kilogrammes.

## Codes de statut

| Code | Cas                                                                 |
|------|---------------------------------------------------------------------|
| 200  | OK                                                                  |
| 401  | Header `X-API-Key` manquant ou incorrect                            |
| 404  | Autre domaine que `beliandjolie.com`, ou référence introuvable      |
