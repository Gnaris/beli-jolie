# API Paris Fashion Shop - Documentation

> Base URL: `https://wholesaler-api.parisfashionshops.com/api/v1` | CDN: `https://static.parisfashionshops.com`
> Langues: fr, en, de, es, it | ~9 252 produits actifs | Env: `PFS_EMAIL`, `PFS_PASSWORD`

---

## 1. Auth — `POST /oauth/token`

```json
{ "email": "...", "password": "..." }
→ { "access_token": "JWT RS256", "token_type": "Bearer", "expires_at": "...", "wholesaler_id": "..." }
```
Toutes les requetes: `Authorization: Bearer {access_token}`. Refresh 10min avant expiration.

---

## 2. Lister produits — `GET /catalog/listProducts`

**Params**: `page` (1+), `per_page` (max 100), `status=ACTIVE` (requis). Page vide = `{"data": []}`.

Chaque produit contient: `id`, `reference`, `gender`, `family`, `category` (id + labels 5 langues), `labels` (5 langues), `colors` (string "REF1;REF2"), `sizes`, `unit_price`, `status` ("READY_FOR_SALE"), `images` (par couleur), `variants[]` inline.

**Variant ITEM inline**: `{ type: "ITEM", item: { color: { reference, value, labels }, size }, price_sale, stock_qty, weight, is_active }`
**Variant PACK inline**: `{ type: "PACK", packs: [{ color, sizes: [{ size, qty }] }], price_sale, pieces, stock_qty }`

**Bugs inline** (utiliser `/variants` pour valeurs correctes):

| Champ | listProducts | /variants |
|-------|-------------|-----------|
| `weight` | 0 (bug) | valeur reelle |
| `pieces` PACK | 1 (bug) | valeur reelle |
| `price_sale.total` PACK | 0 (bug) | correct |
| `sku_suffix` | null | present |

**Notes**: images avec `?image_process=resize,w_450` → retirer pour full-size. `status` filtre=ACTIVE, reponse=READY_FOR_SALE.

---

## 3. Check reference — `GET /catalog/products/checkReference/{reference}`

Donnees exclusives (absentes de listProducts): `material_composition[]` (ref + % + labels), `collection` (ref + labels), `country_of_manufacture` (ISO), `description` (5 langues), `default_color`, `family.reference`, `lining_composition`.

Si inexistant: `{ "exists": false }`.

---

## 4. Variants — `GET /catalog/products/{id}/variants`

Retourne tous les variants avec valeurs corrigees (weight, pieces, price_sale.total, sku_suffix).
Chaque variant inclut `colors[]` array dedie + `images` du produit parent.

---

## 5. Creer produit — `POST /catalog/products/create`

```json
{ "data": { "reference_code": "T999VS1", "gender_label": "WOMAN",
  "brand_name": "Princesse", "family": "ID_FAMILLE",
  "category": "ID_CATEGORIE", "season_name": "PE2026",
  "label": { "fr": "...", "en": "...", "de": "...", "es": "...", "it": "..." },
  "description": { "fr": "...", "en": "...", "de": "...", "es": "...", "it": "..." },
  "material_composition": [{ "id": "a0zW5000000YvezIAC", "value": "100" }],
  "lining_composition": [], "country_of_manufacture": "CN", "variants": [] } }
```

**Champs**: `reference_code` (reference produit). `gender_label` = reference genre (WOMAN/MAN/KID/SUPPLIES, pas le label FR). `material_composition` = tableau `[{id, value}]`. `brand_name` = nom exact de la marque sur PFS. `variants` = `[]` (variants crees separement).
Reponse: `{ resume: { products, errors }, data: [...] }`. Produit cree en statut `NEW`.

---

## 6. Modifier produit — `PATCH /catalog/products/{id}`

```json
{ "data": { "label": {...}, "description": {...}, "category": "ID", "family": "ID",
  "gender_label": "WOMAN", "season_name": "PE2026", "country_of_manufacture": "CN",
  "material_composition": [{ "id": "ACIERINOXYDABLE", "value": 85 }, { "id": "LAITON", "value": 15 }],
  "default_color": "GOLDEN", "brand_name": "Ma Boutique" } }
```

**Important**: wrapper `{ data: {...} }` (objet, pas array). `material_composition` array fonctionne sur PATCH (contrairement a POST).
Champs partiels OK. Changement categorie possible a tout moment (meme cross-genre). Genre/famille decorreles.

---

## 7. Statut produit — `PATCH /catalog/products/batch/updateStatus`

```json
{ "data": [{ "id": "pro_xxx", "status": "READY_FOR_SALE" }] }
```

| PFS Status | Equiv BJ | Prerequis |
|------------|----------|-----------|
| `READY_FOR_SALE` | ONLINE | min 1 variant + 1 image/couleur |
| `DRAFT` | OFFLINE | aucun |
| `ARCHIVED` | ARCHIVED | aucun |

---

## 8. Upload image — `POST /catalog/products/{id}/image`

**Multipart**: champ `image` (fichier JPEG/PNG, PAS WebP), `slot` (int, position), `color` (ref PFS).
**JSON**: `{ "image_url": "...", "slot": 2, "color": "SILVER" }`.
Premiere image d'une couleur → definit `default_color`. Pour READY_FOR_SALE: chaque couleur doit avoir min 1 image.

---

## 9. Creer variants — `POST /catalog/products/{id}/variants`

**ITEM**: `{ "data": [{ "type": "ITEM", "color": "GOLDEN", "size": "TU", "price_eur_ex_vat": 5.0, "stock_qty": 100, "weight": 0.05 }] }`

**PACK mono**: `{ "data": [{ "type": "PACK", "color": "GOLDEN", "size": "TU", "packs": [{ "color": "GOLDEN", "size": "TU", "qty": 12 }], "price_eur_ex_vat": 4.0, "stock_qty": 100, "weight": 0.5 }] }`

**PACK multi-couleur**: memes champs, `packs` avec plusieurs lignes couleur. `sku_suffix` auto = `COLOR1_COLOR2_SIZE`.

**Regles PACK**: `color`/`size` racine = premiere ligne de packs. `pieces` = somme des qty. Batch supporte.

---

## 10. Modifier variants — `PATCH /catalog/products/variants`

```json
{ "data": [{ "variant_id": "pro_xxx", "price_eur_ex_vat": 7.5, "stock_qty": 500,
  "weight": 0.12, "is_active": false, "discount_type": "PERCENT", "discount_value": 10 }] }
```

**Cle**: utiliser `variant_id` (PAS `id` → retourne updated:0). Rate limit: 30/min.
Champs: `price_eur_ex_vat`, `stock_qty`, `weight`, `custom_suffix`, `star`, `is_active`, `discount_type`/`discount_value`.
Discount: PERCENT|AMOUNT, `null` pour supprimer. `discounted_price_eur_ex_vat` ne fonctionne pas (ignore).

---

## 11. Activer/desactiver variants

**Individuel**: `PATCH .../variants/{id}/setAvailability` → `{ "enable": true }` (pas de wrapper data)
**Batch**: `PATCH .../variants/batch/setAvailability` → `{ "data": [{ "id": "...", "enable": true }] }`

---

## 12. Supprimer variant — `DELETE /catalog/products/variants/{variant_id}`

Reponse: `{ "success": true }`. Les images couleur ne sont pas supprimees.

---

## 13. Supprimer image — `DELETE /catalog/products/{id}/image`

**Body JSON** : `{ "color": "FUCHSIA", "slot": 4 }` — supprime l'image au slot donne pour la couleur.

---

## 14. Referentiels — `GET /catalog/attributes/{type}`

| Type | Count | Cle | Utilisation |
|------|-------|-----|-------------|
| `colors` | 142 | `reference` | variant `color`, product `default_color` |
| `categories` | 347 | `id` | product `category` |
| `compositions` | 114 | `reference` | product `material_composition` |
| `countries` | 238 | `reference` (ISO) | product `country_of_manufacture` |
| `collections` | 9 | `reference` | product `season_name` |
| `families` | 29 | `id` | product `family` |
| `genders` | 4 | `reference` | WOMAN, MAN, KID, SUPPLIES |
| `sizes` | ~50 | `reference` | variant `size` |

---

## 15. AI Translations — `POST /ai/translations`

Traduit name/description → fr/en/de/es/it. Utilise automatiquement dans le reverse sync.

---

## Tailles — Regles de validation

| Pattern | Exemple | Accepte |
|---------|---------|---------|
| Liste fixe | TU, XS-6XL, XS/S, S/M... | oui |
| Numerique pur | 36, 52, 80, 100 | oui |
| Numerique + lettre | 85A, 90B, 95C | oui |
| T + numerique pair | T34-T68 | oui |
| Alpha/Alpha ou Alpha-Alpha | XS/S, M-L | oui |
| UK + numerique | UK6, UK7 | **NON** |

**SKU doublon** (critique): PFS genere `sku_suffix = COLOR_SIZE`. Doublon = rejet silencieux (HTTP 200, errors:1). Verifier `pfsVariantId` avant POST; si existe, PATCH.

**`size_details_tu`**: accepte en POST mais NON stocke (retourne ""). Read-only.

---

## IDs de reference constants

| Entite | ID PFS |
|--------|--------|
| Brand | `a01AZ00000314QgYAI` |
| Family Bijoux fantaisie WOMAN | `a035J00000185J7QAI` |

---

## Categories observees (18)

Boucles d'oreilles (`a045J000003KWwDQAW`), Colliers (`a045J000003KWwNQAW`), Bracelets (`a045J000003KWwIQAW`), Bagues (`a045J000003KWw8QAG`), Parures (`a045J00000BO0vRQAT`), Lots avec presentoir (`a04AZ000001JiJ3YAK`), Pendentifs (`a04AZ000001KcELYA0`), Chaines de cheville (`a04AZ000001KcGYYA0`), Porte-cles (`a04W5000006vKzdIAE`), Piercings (`a04AZ000001KgMBYA0`), Presentoirs nus (`a045J00000BO0uaQAD`), Broches (`a045J000003KYeuQAG`), Lunettes (`a0458000002fIViAAM`), Sacs (`a04AZ000001L60cYAC`), Accessoires cheveux (`a0458000002fITUAA2`), Boites & Pochettes (`a04AZ000001L61LYAS`), Materiaux bijoux (`a04W5000005rWN5IAM`), Gants (`a04AZ000001hpKSYAY`).

---

## Bugs PFS connus

- `material_composition` array sur POST → crash 500 (string OK). Sur PATCH → array OK
- PATCH variants avec `id` → updated:0 (utiliser `variant_id`)
- `discounted_price_eur_ex_vat` seul → ignore. `null` → crash 500. Utiliser `discount_type`/`discount_value`
- DELETE image → fonctionne avec body JSON `{ color, slot }` (methode DELETE avec body)
- Suppression produit ne libere pas la reference
- PACK format sizes imbrique → crash. Utiliser format plat `{ color, size, qty }`
- Rate limit PATCH variants: 30/min
