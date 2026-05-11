# Ankorstore API — Documentation validée

> **Statut : à jour au 2026-05-12, validée par tests réels en production.**
> Base URL : `https://www.ankorstore.com/api/v1`
> Format : JSON:API ([spec officielle](https://api-spec.ankorstore.com))
> Spec OpenAPI complète : [github.com/ankorstore/api-docs](https://github.com/ankorstore/api-docs)
> Dernier export local : `docs/ankorstore-spec-2026-05.yaml` (pull `ankorstore/00632`, 17 749 lignes)

Ce document remplace l'ancienne version basée sur une doc obsolète. Il est rédigé pour qu'un développeur ou Claude puisse reprendre l'intégration sans tâtonner : on y trouve les **payloads exacts validés en réel**, les **pièges qui font perdre des heures**, et les **erreurs commises pendant l'intégration** (avec leur explication).

---

## ⚠️ TL;DR — les 5 pièges qui m'ont fait perdre du temps

Si tu reprends cette intégration, lis cette section **en premier**. Ces pièges sont tous documentés ailleurs dans ce fichier mais ils tuent quiconque ne les voit pas venir.

1. **Le wrapper d'ajout de produit n'est pas `data: [...]` mais `products: [...]`.**
   Le wrapper `{ data: [...] }` est silencieusement accepté (HTTP 200) mais `totalProductsCount` reste à 0. L'opération suivante part en `skipped` sans aucune erreur explicite. Le code legacy de `lib/ankorstore-api-write.ts:ankorstoreAddProductsToOperation` utilise `data: [...]` — il faut le corriger.

2. **Les attributs `operationType` et `callbackUrl` sont en camelCase, requis tous les deux.**
   Pas `type` (rejeté avec « *The member attributes cannot have a type field* »). Pas `operation_type` (rejeté avec « *The field operation_type is not a supported attribute* »). Pas d'omission de `callbackUrl` (rejeté avec « *The callback url field is required* »). Et oui, c'est obligatoire même si on poll l'opération nous-même : on peut mettre une URL bidon comme `https://example.com/...`.

3. **À l'intérieur du tableau `products`, en revanche, tout est en snake_case** :
   `external_id`, `vat_rate`, `made_in_country`, `wholesale_price`, `retail_price`, `unit_multiplier`, `main_image`, `stock_quantity`, `is_always_in_stock`. La spec et l'API sont cohérentes : opérations = camelCase, produits/variantes = snake_case.

4. **Pour supprimer un produit entier, il faut lister explicitement toutes ses variantes par SKU.**
   Sans cette liste, l'API renvoie quand même `succeeded` mais ne supprime rien (faux positif silencieux). C'est le piège le plus traître. Le bon payload : `attributes.variants = [{ sku }, { sku }, …]` même quand on veut supprimer tout.

5. **L'API GET `/products/{id}?include=productVariants` est en retard sur l'état réel.**
   On peut supprimer une variante (validé sur le tableau de bord en quelques secondes) et continuer à la lire via GET pendant plusieurs minutes. Pour valider une suppression, regarder le tableau de bord Ankorstore, pas l'API GET.

---

## 1. Authentification (OAuth2 Client Credentials)

```http
POST https://www.ankorstore.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=…&client_secret=…&scope=*
```

Réponse :
```json
{ "access_token": "eyJ…", "token_type": "Bearer", "expires_in": 3600 }
```

- Token valide **1 heure**, rafraîchir 5 min avant expiration.
- Header sur toutes les requêtes : `Authorization: Bearer {token}`
- Côté code : `lib/ankorstore-auth.ts` (cache token en mémoire + buffer 5 min).
- Credentials lus depuis `SiteConfig.ankors_client_id` / `ankors_client_secret` (chiffrés).

**Rate limits Ankorstore** : 600 req/min, 24 000/h, 288 000/jour. Sur 401 réponse, invalider le token et réessayer une fois (le code de `lib/ankorstore-api.ts` le fait déjà).

---

## 2. Headers obligatoires

```http
Accept: application/vnd.api+json
Content-Type: application/vnd.api+json     # pour POST/PATCH avec body
Authorization: Bearer {token}
```

Le `Content-Type` est crucial : sans lui, l'API peut rejeter le payload avec `415 Unsupported Media Type`. Ne pas envoyer de `Content-Type` quand il n'y a pas de body (GET).

---

## 3. Conventions JSON:API à connaître

Ankorstore suit la spec JSON:API stricte ([documentée ici](https://api-spec.ankorstore.com)) :

- **Resources** : tout objet de l'API a `type`, `id`, `attributes`, et parfois `relationships`.
- **Inclusion** : `?include=productVariants` ramène les variantes dans `included[]` à côté de `data`. Bien utiliser le **bon nom de relation** :
  - `/products?include=productVariant` (singulier) pour la liste de produits
  - `/products/{id}?include=productVariants` (pluriel !) pour un produit seul — **piège**, ce n'est pas le même nom.
- **Filtrage** : `?filter[sku]=…`, `?filter[archived]=true`, `?filter[skuOrName]=…`.
- **Pagination** : curseur, pas offset. `?page[limit]=50&page[after]={lastId}`.

---

## 4. Cycle de vie d'un produit — workflows complets validés

Tous les workflows ci-dessous ont été testés en réel sur la boutique Ankorstore de Beli & Jolie le 2026-05-11. Les requêtes et réponses sont copiées des vrais tests.

### 4.1. Créer un produit (import)

**Étape 1** — Créer une opération d'import.

```http
POST /api/v1/catalog/integrations/operations
Content-Type: application/vnd.api+json
```
```json
{
  "data": {
    "type": "catalog-integration-operation",
    "attributes": {
      "operationType": "import",
      "source": "other",
      "callbackUrl": "https://example.com/ankorstore-callback"
    }
  }
}
```

Réponse `201 Created` :
```json
{
  "data": {
    "id": "1f14d83b-4a1d-690c-b5ca-668ae241dd43",
    "type": "catalog-integration-operation",
    "attributes": { "status": "created", "operationType": "import", … }
  }
}
```

> **Pièges 1 et 2 du TL;DR** : `operationType` en camelCase, `callbackUrl` requis, mettre `source: "other"` quand pas Shopify/WooCommerce/Prestashop.

---

**Étape 2** — Ajouter les produits à l'opération.

```http
POST /api/v1/catalog/integrations/operations/{operationId}/products
Content-Type: application/vnd.api+json
```

⚠️ Le wrapper est `products: [...]`, **pas** `data: [...]` :

```json
{
  "products": [
    {
      "id": "TEST-DELETE-1778536346855",
      "type": "catalog-integration-product",
      "attributes": {
        "external_id": "TEST-DELETE-1778536346855",
        "name": "Produit de test API",
        "description": "Description du produit (min 30 caractères obligatoires)…",
        "currency": "EUR",
        "vat_rate": 20,
        "unit_multiplier": 1,
        "wholesale_price": 10,
        "retail_price": 20,
        "made_in_country": "FR",
        "main_image": "https://picsum.photos/seed/abc/600/600",
        "images": [
          { "order": 1, "url": "https://picsum.photos/seed/abc/600/600" }
        ],
        "variants": [
          {
            "sku": "TEST-DELETE-1778536346855_ROUGE_M",
            "stock_quantity": 5,
            "is_always_in_stock": false,
            "wholesale_price": 10,
            "retail_price": 20,
            "original_wholesale_price": 10,
            "options": [
              { "name": "color", "value": "Rouge" },
              { "name": "size", "value": "M" }
            ]
          }
        ]
      }
    }
  ]
}
```

Réponse `200 OK` :
```json
{ "meta": { "totalProductsCount": 1 } }
```

> **Si `totalProductsCount: 0` revient sans aucune erreur HTTP**, c'est que ton payload est invalide silencieusement (probablement le wrapper `data:` à la place de `products:` — Piège 1).

**Champs requis sur chaque variante** (la spec est trompeuse, elle dit qu'ils peuvent être hérités du parent — en pratique l'opération échoue si on ne les met pas) :
- `wholesale_price`
- `retail_price`
- `original_wholesale_price` ⚠️ découvert par tâtonnement, **pas documenté dans la spec**

**Champs requis au niveau produit** :
- Au moins 1 entrée dans `images` (sinon `invalid_field: At least 1 image is required to create an active product`).
- `description` ≥ 30 caractères.

**Tags autorisés** (enum strict) :
`tags_fresh_product`, `tags_frozen_product`, `tags_organic`, `tags_handmade`, `tags_eco_friendly`, `tags_zero_waste`, `tags_cruelty_free`, `tags_bestseller`, `tags_vegan`, `tags_contains_alcohol`.

**Options de variante** (enum strict) : `color`, `size`, `material`, `style`.

---

**Étape 3** — Démarrer l'opération.

```http
PATCH /api/v1/catalog/integrations/operations/{operationId}
Content-Type: application/vnd.api+json
```
```json
{
  "data": {
    "id": "{operationId}",
    "type": "catalog-integration-operation",
    "attributes": { "status": "started" }
  }
}
```

⚠️ **Sans `attributes.status = "started"`** l'API renvoie `403 Forbidden — Status of the operation cannot be updated from [created] to [created]`. Le code legacy de `lib/ankorstore-api-write.ts:ankorstoreStartOperation` envoie un PATCH sans attributes, ce qui marche peut-être encore mais à corriger pour être explicite.

---

**Étape 4** — Poller jusqu'à fin de l'opération.

```http
GET /api/v1/catalog/integrations/operations/{operationId}
```

Statuts terminaux : `succeeded`, `partially_failed`, `failed`, `skipped` (rajouter `skipped` à ta liste de statuts terminaux — non documenté comme tel mais c'est ce que tu obtiens quand l'opération démarre sans produits).

À l'état `succeeded`, lire les résultats :

```http
GET /api/v1/catalog/integrations/operations/{operationId}/results
```

Réponse :
```json
{
  "data": [
    {
      "id": "…",
      "type": "catalog-integration-result",
      "attributes": {
        "externalProductId": "TEST-DELETE-1778536346855",
        "status": "success",
        "failureReason": null,
        "issues": []
      }
    }
  ]
}
```

> ⚠️ **L'API ne renvoie PAS le `ankorstoreProductId` dans `/results`** — uniquement `externalProductId`. Pour récupérer le `ankorstoreProductId`, il faut faire un appel additionnel après création (voir Étape 5).

En cas d'échec, le `failureReason` est `validation_error` ou `internal_error`. `issues[]` contient les détails par champ :
```json
{
  "issues": [
    { "field": "variants[0].retailPrice", "reason": "required_field", "message": "This value should not be blank." },
    { "field": "images", "reason": "invalid_field", "message": "At least 1 image is required to create an active product." }
  ]
}
```

---

**Étape 5** — Récupérer le `ankorstoreProductId`.

L'API ne le retourne pas dans `/results`. On le retrouve via le SKU de la première variante :

```http
GET /api/v1/product-variants?filter[sku]={SKU}&include=product
```

```json
{
  "data": [
    {
      "id": "1f14d83b-4e43-6c3e-a398-668ae241dd43",
      "attributes": { "sku": "…", "stockQuantity": 5, … },
      "relationships": {
        "product": { "data": { "id": "1f14d83b-4a1d-690c-b5ca-668ae241dd43", "type": "product" } }
      }
    }
  ]
}
```

> ⚠️ **Délai d'indexation** : il peut s'écouler 3 à 30 secondes entre `succeeded` et la disponibilité de la variante via ce filtre. Prévoir une boucle de retry (3 s, puis 5 s × 5).

---

### 4.2. Modifier un produit (update)

Même workflow que création, mais `operationType: "update"`. On peut envoyer le produit complet — l'API gère :

- Variantes existantes (matchées par SKU) → mises à jour
- Nouvelles variantes (SKU jamais vu) → créées
- Variantes anciennes pas re-listées → **PAS supprimées** (ne pas compter là-dessus pour faire du nettoyage)

Test validé le 2026-05-11 : sur un produit existant à 2 variantes (Rouge/M, Bleu/M), un update avec 3 variantes (les 2 existantes + Vert/L) ajoute Vert/L et met à jour les prix/stock/images des autres en une seule opération. Durée typique : 6 à 13 secondes.

Option utile : `data.attributes.updateFields = ["stock", "prices"]` au niveau de l'opération restreint la mise à jour à ces champs (utile pour pousser uniquement les stocks sans toucher au reste). Si on l'omet ou qu'on met `[]` avec `source: "other"`, **tous les champs** sont mis à jour.

---

### 4.3. Supprimer une variante seule

Endpoint dédié, démarrage automatique (pas besoin de PATCH started) :

```http
POST /api/v1/catalog/integrations/operations/delete
Content-Type: application/vnd.api+json
```
```json
{
  "source": "other",
  "callbackUrl": "https://example.com/ankorstore-callback",
  "products": [
    {
      "type": "catalog-integration-product",
      "attributes": {
        "external_id": "TEST-DELETE-1778536346855",
        "variants": [
          { "sku": "TEST-DELETE-1778536346855_ROUGE_M" }
        ]
      }
    }
  ]
}
```

Réponse `201 Created` (l'opération démarre toute seule) :
```json
{ "data": { "id": "…", "attributes": { "status": "started", "operationType": "delete", … } } }
```

Puis poller `/operations/{id}` jusqu'à `succeeded`. Validé le 2026-05-11 : la variante Rouge a disparu du tableau de bord Ankorstore en quelques secondes, les autres variantes (Bleu, Vert) et le produit lui-même sont restés intacts.

> ⚠️ Le `archivedAt` lisible sur la variante avant suppression était à `null`. Après suppression, **la variante n'est plus retournée par `GET /products/{id}?include=productVariants`** (à terme — délai d'indexation), au lieu d'être marquée `archivedAt: <date>`. C'est une vraie suppression, pas un archivage.

---

### 4.4. Supprimer un produit entier

Même endpoint, mais on liste **toutes les variantes** par SKU. ⚠️ Sans cette liste, l'API renvoie `succeeded` mais ne fait rien (Piège 4 — testé le 2026-05-11, le produit est resté visible).

```json
{
  "source": "other",
  "callbackUrl": "https://example.com/ankorstore-callback",
  "products": [
    {
      "type": "catalog-integration-product",
      "attributes": {
        "external_id": "TEST-DELETE-1778536346855",
        "variants": [
          { "sku": "TEST-DELETE-1778536346855_ROUGE_M" },
          { "sku": "TEST-DELETE-1778536346855_BLEU_M" },
          { "sku": "TEST-DELETE-1778536346855_VERT_L" }
        ]
      }
    }
  ]
}
```

Récupérer la liste des SKU au préalable :
```http
GET /api/v1/products/{ankorstoreProductId}?include=productVariants
```

→ lire `included[].attributes.sku` pour chaque variante.

Validé le 2026-05-11 : durée < 5 s côté API, suppression visible sur le tableau de bord après quelques secondes.

> Le code legacy de `lib/ankorstore-api-write.ts:ankorstoreDeleteProduct` envoie un payload de delete avec `variants: []` (tableau vide) — **ça ne supprime rien**. À corriger pour aller chercher les SKU avant.

---

## 5. Endpoints de lecture utiles

### 5.1. Lister les produits

```http
GET /api/v1/products?include=productVariant&page[limit]=50&page[after]={lastId}
```

⚠️ Pour la liste, l'include est `productVariant` (singulier). Pour le détail, `productVariants` (pluriel). C'est asymétrique, dommage mais c'est l'API.

`page[limit]` est plafonné à 50 côté serveur (sinon 400). Pagination par curseur (cursor-based) : `page[after]` = id du dernier produit de la page précédente.

### 5.2. Récupérer un produit avec ses variantes

```http
GET /api/v1/products/{productId}?include=productVariants
```

### 5.3. Chercher des produits / variantes

```http
GET /api/v1/products?filter[skuOrName]=mon-terme&page[limit]=10
GET /api/v1/product-variants?filter[sku]=SKU1,SKU2&include=product
GET /api/v1/product-variants?filter[archived]=true
GET /api/v1/product-variants?filter[productId][]=ID1&filter[productId][]=ID2
```

Le filtre `archived` est en lecture seule — on ne peut pas l'utiliser pour archiver (passer par l'opération `delete`).

### 5.4. PATCH stock et prix (variante existante)

```http
PATCH /api/v1/product-variants/{variantId}/stock
```
```json
{ "data": { "id": "{variantId}", "type": "product-variants",
            "attributes": { "stockQuantity": 100, "isAlwaysInStock": false } } }
```

```http
PATCH /api/v1/product-variants/{variantId}/prices
```
```json
{ "data": { "id": "{variantId}", "type": "product-variants",
            "attributes": { "wholesalePrice": 1500, "retailPrice": 3000 } } }
```

⚠️ Les prix dans `/prices` sont en **centimes** (entiers), contrairement aux prix dans `/operations/.../products` qui sont en **euros** (flottants). Pas la même API, pas la même unité — l'erreur classique.

---

## 6. Historique des tests (2026-05-11) — erreurs et corrections

Cette section documente le parcours réel pour intégrer cette API. Tout dev qui reprend le sujet doit pouvoir comprendre **pourquoi** le code est comme il est.

### Essais successifs lors de la création d'un produit factice :

| # | Erreur reçue | Cause | Correction |
|---|---|---|---|
| 1 | `400 — The member attributes cannot have a type field.` | J'envoyais `attributes.type = "import"` (mauvais nom du champ) | Renommer en `attributes.operationType` |
| 2 | `422 — The callback url field is required.` | Le champ `callbackUrl` n'était pas dans le payload | Ajouter `callbackUrl: "https://example.com/..."` même si on poll |
| 3 | `403 — Status of the operation cannot be updated from [created] to [created].` | Mon PATCH started ne contenait pas `attributes.status` | Ajouter `attributes: { status: "started" }` |
| 4 | `status: "skipped"` (avec `totalProductsCount: 0`) | J'avais ajouté le produit avec `data: [...]` au lieu de `products: [...]` | Renommer le wrapper en `products: [...]` |
| 5 | `status: "skipped"` (encore) | J'avais essayé tous les attributs produit en camelCase | Repasser tous les attributs produit en snake_case |
| 6 | `status: "failed"` + `validation_error` | Pas de prix sur les variantes, pas d'image principale | Ajouter `wholesale_price`/`retail_price`/`original_wholesale_price` par variante + `main_image` + `images[]` au produit |
| 7 | `400 — Include path productVariant is not allowed.` | Mon GET du produit utilisait `include=productVariant` (singulier) | Pour `/products/{id}`, utiliser `include=productVariants` (pluriel) |
| 8 | Suppression renvoie `succeeded` mais le produit reste visible | Le payload de delete n'incluait pas la liste des SKU des variantes | Ajouter `attributes.variants = [{sku},...]` même pour supprimer le produit entier |
| 9 | Variante toujours listée dans GET après suppression validée | Délai d'indexation côté API GET (alors que le tableau de bord est à jour) | Ne pas se fier au GET pour valider ; vérifier visuellement ou attendre |

### Conclusion

Cette intégration est **fragile** parce que l'API accepte beaucoup d'erreurs silencieusement (HTTP 200 mais rien ne se passe). Toujours :
1. Lire la réponse `meta.totalProductsCount` après `POST /products` pour vérifier que ton produit a bien été pris en compte.
2. Vérifier que `status: "succeeded"` ET que `processedProductsCount === totalProductsCount`.
3. Lire `/results` pour récupérer les `issues[]` quand `status === "failed"` ou `partially_failed`.
4. Pour les suppressions de produit entier, ne pas oublier de fournir les SKU des variantes.
5. Pour les validations visuelles, regarder le tableau de bord Ankorstore en plus de l'API.

---

## 7. État du code de Beli & Jolie au 2026-05-12

À la date de cette doc, l'intégration Ankorstore du site **n'a jamais publié de produit en vrai** — on l'a découvert pendant les tests. Le code des fichiers ci-dessous est basé sur l'ancien format de l'API et **doit être corrigé** avant toute mise en production :

| Fichier | Corrections nécessaires |
|---|---|
| `lib/ankorstore-api-write.ts:ankorstoreCreateCatalogOperation` | Renommer `attributes.type` → `attributes.operationType`. Ajouter `attributes.callbackUrl`. |
| `lib/ankorstore-api-write.ts:ankorstoreAddProductsToOperation` | Renommer le wrapper `{ data: [...] }` → `{ products: [...] }`. Le reste du payload est OK (snake_case). |
| `lib/ankorstore-api-write.ts:ankorstoreStartOperation` | Ajouter `attributes: { status: "started" }` dans le body du PATCH. |
| `lib/ankorstore-api-write.ts:ankorstoreDeleteProduct` | Utiliser `POST /operations/delete` (endpoint dédié, démarre tout seul). Fournir la liste des SKU des variantes pour supprimer un produit entier. |
| `lib/ankorstore-api.ts:ankorstoreGetProduct` | Pour `/products/{id}`, utiliser `include=productVariants` (pluriel). |
| `lib/ankorstore-api.ts:ankorstoreSearchProducts` | Pour `/products`, utiliser `include=productVariant` (singulier — inchangé) |
| `lib/ankorstore-publish.ts` (et `ankorstore-update.ts`, `ankorstore-refresh.ts`) | Vérifier que `wholesale_price`, `retail_price`, et **`original_wholesale_price`** sont bien envoyés sur chaque variante. La spec parle d'héritage depuis le parent mais l'API exige les 3. |
| `lib/ankorstore-publish.ts` | Vérifier qu'il y a toujours au moins 1 image (`main_image` + `images[]`) — sinon `validation_error: At least 1 image is required`. |

À faire en plus :
- **Récupérer le `ankorstoreProductId` après création** : l'API ne le renvoie pas dans `/results`. Faire un `GET /product-variants?filter[sku]={firstSku}&include=product` avec retry sur l'indexation.
- **Considérer `skipped` comme un statut terminal** dans le polling. Aujourd'hui le code ne le traite probablement pas.

---

## 8. Script de test (`scripts/ankorstore-test.ts`)

Script Node/tsx autonome qui permet de tester l'API en réel sur la boutique configurée. **Ne le supprime pas** — il est utile pour valider tout changement futur de l'intégration avant de toucher au code de prod.

Commandes :
```bash
npx tsx scripts/ankorstore-test.ts create              # crée un produit factice "TEST À SUPPRIMER"
npx tsx scripts/ankorstore-test.ts inspect             # lit l'état actuel (delay possible)
npx tsx scripts/ankorstore-test.ts update              # ajoute une variante + change prix/stock/images
npx tsx scripts/ankorstore-test.ts delete-variant SKU  # supprime une variante seule
npx tsx scripts/ankorstore-test.ts delete-product      # supprime le produit (avec liste SKU automatique)
npx tsx scripts/ankorstore-test.ts cleanup             # cherche et supprime tous les produits TEST-DELETE-*
npx tsx scripts/ankorstore-test.ts clean               # juste le fichier d'état local
```

L'identifiant du produit créé est stocké dans `scripts/.ankorstore-test-state.json` (gitignored) pour chaîner les étapes. Le script utilise les identifiants Ankorstore chiffrés dans `SiteConfig` (déchiffrés via `lib/encryption.ts`).

⚠️ **Effets réels sur le compte Ankorstore** : ce script publie et supprime **de vrais produits**. Toujours :
- Préfixer les SKU/external_id de produits factices par `TEST-DELETE-` (le scan `cleanup` se base dessus).
- Nettoyer avec `cleanup` après chaque session de test.
- Ne pas le lancer sur un compte production sans s'être assuré que la boutique est en pause / non visible.

---

## 9. Sources de vérité

- **Doc rendue** : https://ankorstore.github.io/api-docs/
- **Spec OpenAPI** (la vérité absolue) : https://github.com/ankorstore/api-docs — sous-dossier `pull/ankorstore/{numéro}/public.yaml`. Le dernier numéro = la dernière version publiée. Au 2026-05-12 : `pull/ankorstore/00632/public.yaml`.
- **Convention JSON:API d'Ankorstore** : https://api-spec.ankorstore.com
- **Export local** : `docs/ankorstore-spec-2026-05.yaml` (à régénérer périodiquement en téléchargeant le dernier `pull/ankorstore/NNNNN/public.yaml`).

Pour mettre à jour cet export :
```bash
# Trouver le dernier numéro disponible
gh api repos/ankorstore/api-docs/contents/pull/ankorstore --jq '.[].name' | tail -1
# Télécharger
curl -sS "https://raw.githubusercontent.com/ankorstore/api-docs/main/pull/ankorstore/{NUMERO}/public.yaml" \
  -o docs/ankorstore-spec-{ANNEE}-{MOIS}.yaml
```

---

## 10. Glossaire rapide

| Terme | Signification |
|---|---|
| `external_id` | Identifiant que **toi** tu choisis pour ton produit (souvent = `Product.reference` côté Beli & Jolie). Sert à retrouver ton produit lors des updates et deletes. |
| `ankorstoreProductId` | UUID assigné par Ankorstore après création. Stocké dans `Product.ankorsProductId`. |
| `ankorsVariantId` | UUID assigné par Ankorstore à chaque variante. Stocké dans `ProductColor.ankorsVariantId`. |
| `operation` | Une opération asynchrone d'import / update / delete. A un id UUID, des produits associés, un statut, des résultats par produit. |
| `skipped` | Statut terminal d'une opération qui a été démarrée sans produit (silencieusement). |
| `Brand Dashboard` | Le tableau de bord Ankorstore que voit la marque : `https://www.ankorstore.com/brand-dashboard`. C'est là qu'on valide visuellement les opérations. |
