# Microstore (Dokkr) API — Documentation validée

> **Statut : à jour au 2026-07-30, validée par HAR de production et tests réels A2630.**
> Deux domaines distincts, ne pas confondre :
> - **BOSS / merchant** : `https://api2.dokkr.net` — push produits, orders (session QR, valide ~1 an)
> - **H5 / acheteur (« Station de Transfert d'Images »)** : `https://v2.microstore.app` — upload photos, PATCH images (`pictureStationKey` valide ~7 jours)
> - **CDN / OSS Aliyun** : `https://dcdn.microstore.app` — bucket S3-like pour les binaires image

Microstore n'a pas d'API publique documentée. Toute cette lib a été reverse-engineered à partir de HAR fournis par la cliente. Les 3 HAR de référence :
- `Importation en masse.har` — POST `/api/v3/pictureStations` en bulk
- `Importation manuelle 1 produit.har` — PATCH `/api/goods/{id}` en unitaire
- `Good result.har` + `BAd result.har` (2026-07-30) — comparaison PATCH images (cf. § 5)

Fichiers HAR non versionnés (contiennent tokens STS). Restent chez la cliente dans `C:/Users/chenb/Downloads/`.

---

## ⚠️ TL;DR — les 6 pièges qui coûtent des heures

1. **`mainImages: []` VIDE le carousel principal** — c'est le comportement voulu chez nous. Ne PAS peupler ce champ. Toutes les photos vont dans `imageSetting.skuImage`. Cf. § 5.

2. **La couleur principale a DEUX images dans son SKU** : la brandée (avec badge « RÉFÉRENCE ») ET l'originale sans badge. Les autres couleurs ont 1 image (originale). C'est ce qui donne la fiche produit attendue chez Microstore. Cf. § 5.3.

3. **Pour un PATCH « coverImage seul », OMETTRE `imageSetting` entièrement.** Envoyer `imageSetting: { skuImage: [] }` est REFUSÉ par Microstore avec `HTTP 400 skuImageSetting.skuImage.limit` (vérifié en prod le 2026-07-31 sur A2631/A2632/A2634/W120/W137/A2419/A2419A/A1825/WF92E). Un `skuImage` NON vide, en revanche, réassigne **exactement** la liste fournie pour chaque SKU listé.

4. **Le JPEG est obligatoire pour les uploads OSS** — envoyer du WebP dans un fichier `.JPG` fait échouer silencieusement le badge (l'image passe côté OSS mais le rendu marketing plante). Toujours passer par `prepareMicrostoreJpeg` (`app/actions/admin/microstore-picture-station.ts`).

5. **L'API BOSS ne permet pas d'upload photo ni de delete** — seulement create/update via `POST /goods/import_v1`. Les photos passent par l'API H5 + OSS. Archivage/suppression = manuel dans le back Microstore.

6. **Pas de suppression via API** = pas de refresh non plus. Le bouton « Rafraîchir » ne peut faire qu'un re-push (create ou update).

---

## 1. Authentification

### 1.1 BOSS (session QR code, ~1 an)

Microstore ne fournit ni OAuth ni API key. La console web `web.mc.app` se logue via **QR code type WhatsApp Web** :

1. On génère un `code` client-side : `<pid>&<random>&<timestamp>&<md5>` (algo décodé du bundle JS Microstore).
2. On construit un QR image pointant sur `https://mc2-h5.dokkr.net/?code=...`.
3. L'admin scanne avec l'appli mobile Microstore.
4. On poll `POST api2.dokkr.net/index.php?service=User.QRCodeService.getStrCodeAndCheck` toutes les 1s.
5. Une fois scanné, la réponse contient `key` (`5_XXX`) + `mask_token` (JWT valide ~1 an).

**Code** : `lib/microstore-auth.ts`.
**Stockage** : `SiteConfig.microstore_session_key` (chiffré AES-256-GCM).
**Constantes** :
- `MC_API_BASE = "https://api2.dokkr.net/index.php"`
- `MC_PID = "5-MC"`
- `MC_SECRET = "TIYZ5GuvK2CEzfTHvK4Uw2TGxrkR5UT1"` (secret PUBLIC observable dans le bundle JS Microstore, sert juste de marqueur d'app — pas un vrai secret).
- `MC_QR_ORIGIN = "https://mc2-h5.dokkr.net"`

**Multi-tenant** — cache session **par tenant** (`primedSessionKeyByTenant: Map<tenantId, string>`) + fallback lecture BDD après cache miss. Sans ça, la session d'un tenant fuit vers l'autre (incident faire-auth 15/07/2026).

### 1.2 H5 (« pictureStationKey », ~7 jours)

Pour la **Station de Transfert d'Images**, l'admin génère depuis son back Microstore un lien de partage : `https://microstore.app/s/wuu9t`. Ce lien redirige vers `https://<tenant>.microstore.app/imageTransferStation#/imageTransferStation?shortUrl=wuu9t&key=NBqdsz`.

Le `key` (6 chars alphanumériques, ex : `NBqdsz`) est le **pictureStationKey**. Il se colle dans notre back BJ (`/admin/parametres`, carte Microstore).

**Code d'extraction** : `extractPictureStationKey()` dans `lib/microstore-picture-station.ts`.
Attention : le fetch HTTP doit être en `redirect: "manual"` pour lire le fragment de la Location — sinon `res.url` ne contient pas le `#key=...`.

**Stockage** : `SiteConfig.microstore_picture_station_key` (chiffré). Deux clés compagnons pour l'UI :
- `microstore_picture_station_expires_at` (timestamp ms, non chiffré)
- `microstore_picture_station_short_url` (URL courte affichée, non chiffrée)

**Validation** : `GET https://v2.microstore.app/api/pictureStations/expiredTime?pictureStationKey=...` → renvoie `{ expiredTime: <ms> }`. Si passé, le key est expiré, il faut regénérer côté Microstore.

---

## 2. Endpoints H5 / Picture Station

Base URL : `https://v2.microstore.app`.
Query params systématiquement passés sur tous les endpoints H5 :
- `pictureStationKey=<key>`
- `terminal=h5`
- `bigScreen=true`
- `defaultLang=en` + `lang=fr` (pour les endpoints qui retournent des libellés)

### 2.1 `GET /api/pictureStations/expiredTime`

Valide un `pictureStationKey`. Retourne `{ expiredTime: <ms epoch> }`. Utilisé au moment où l'admin colle son lien.

### 2.2 `GET /api/pictureStations/company`

Retourne les infos de la boutique liée au key :
```json
{ "companyId": 3976, "companyName": "…", "currency": "EUR" }
```
Le `companyId` est **critique** pour construire les OSS keys (préfixe du path S3, cf. § 3).

### 2.3 `GET /api/ossToken`

Retourne des **credentials STS temporaires** pour uploader des binaires sur le CDN Aliyun de Microstore :
```json
{
  "accessKeyId": "STS.abc",
  "accessKeySecret": "…",
  "securityToken": "…",
  "ossRegion": "oss-eu-central-1",
  "ossHost": "https://dcdn.microstore.app",
  "ossBucket": "micro-store-bucket",
  "ossCdnHost": "https://dcdn.microstore.app",
  "ossUploadUrl": "https://dcdn.microstore.app"
}
```

Validité : quelques minutes. **Ne pas cacher** — redemander avant chaque batch d'upload.

### 2.4 `POST https://dcdn.microstore.app` — Upload OSS

Upload direct multipart/form-data vers le bucket. C'est de l'Aliyun OSS PostObject standard ([doc Aliyun](https://help.aliyun.com/document_detail/31988.html)).

**Champs multipart** (dans cet ordre observé dans les HAR) :
```
name                   = <filename original>
key                    = <companyId>/MSH5_<md5>.<EXT>    (extension MAJUSCULE)
policy                 = <base64(policy JSON)>
OSSAccessKeyId         = <accessKeyId>
success_action_status  = 200
signature              = <HMAC-SHA1 base64 du policy>
x-oss-security-token   = <securityToken>
file                   = <binary Blob>
```

**Policy JSON minimale** (validée en HAR) :
```json
{
  "expiration": "2026-07-30T22:03:00.000Z",
  "conditions": [["content-length-range", 0, 20971520]]
}
```
Note : pas de conditions sur `key` ou `bucket`. Microstore reste très permissif.

**Signature** = `HMAC-SHA1(accessKeySecret, base64(policy))` puis base64 le digest.

**Code** : `buildOssObjectKey()`, `buildOssPostPolicy()`, `uploadImageToMicrostoreOss()`.

**URL publique résultante** : `<ossCdnHost>/<ossKey>` (ex : `https://dcdn.microstore.app/3976/MSH5_a349a637...JPG`).

### 2.5 `GET /api/companies/goods/itemRef?itemRef=<REF>`

Cherche un produit Microstore par sa **référence externe** (= `Product.reference` chez BJ). Retourne la fiche complète (voir § 5.1 pour la structure).

Si non trouvé → HTTP 404. Le code retourne `null` dans ce cas (`getMicrostoreGoodsByItemRef()`).

Champs importants dans la réponse :
- `goodsId` (int) — identifiant Microstore du produit
- `skus[]` — chaque SKU (couleur × taille) avec `skuId`, `colorId`, `colorName`, `sizeName`
- `coverImage`, `mainImages[]`, `colorImages[]`, `skus[].imgs[]` — état actuel des images

### 2.6 `PATCH /api/goods/{goodsId}` — Mettre à jour les images

**Endpoint clé** pour l'affichage des photos côté Microstore. Payload JSON :

```json
{
  "coverImage": "https://dcdn.microstore.app/3976/MSH5_XXX.JPG",
  "mainImages": [],
  "imageSetting": {
    "skuImage": [
      { "skuIds": [25061], "images": [".../doré.JPG"] },
      { "skuIds": [25062], "images": [".../argent-brandée.JPG", ".../argent-originale.JPG"] }
    ]
  }
}
```

**Sémantique de chaque champ** — cf. § 5.

### 2.7 `POST /api/v3/pictureStations` — Bulk import photos

Mode « importation en masse » du HAR : un seul appel API pour N produits × N couleurs. Microstore fait le matching côté serveur.

**Query params requis** :
- `importToGoods=true`
- `mixSymbol=mix`
- `importMainToColor=` (vide)
- `defaultLang=en` + `lang=fr`

**Body** :
```json
{
  "pictures": [
    {
      "name": "A2630 Argent 1",
      "fileName": "a2630-argent-1.jpg",
      "image": "https://dcdn.microstore.app/3976/MSH5_XXX.JPG",
      "goodsImageSetting": { "itemRef": "A2630", "colorName": "Argent", "order": 1 }
    },
    ...
  ]
}
```

**Matching Microstore** = `itemRef + colorName` (case-sensitive → attention aux accents). Le `order` détermine la position dans le SKU.

**Réponse** : `{ successCount, failedCount, causes: [] }`.

**Limite connue** : ne peuple pas `coverImage`. Il faut un PATCH `/api/goods/{id}` séparé après pour poser la couverture. Cf. `bulkSendPhotosToMicrostore()` mode bulk.

---

## 3. Upload OSS Aliyun — conventions

### 3.1 Key pattern

`<companyId>/MSH5_<32 hex chars aléatoires>.<EXT MAJUSCULE>`

Exemples : `3976/MSH5_a349a6370ee9af15968afd8eee964bd7.JPG`, `3976/MSH5_bdaff1ba178ce6ff7114f279ee0e83ee.PNG`.

- Le hash est **aléatoire** (pas un hash du contenu). Sert juste à garantir l'unicité dans le bucket.
- Extension **toujours en majuscules** (convention Microstore).
- Fallback `.JPG` si le fichier source n'a pas d'extension.

### 3.2 Formats acceptés

Testés OK : `.JPG`, `.JPEG`, `.PNG`. `.WEBP` accepté par l'OSS **mais** la fiche Microstore n'affiche pas correctement le rendu final (badges de références). **Toujours réencoder en JPEG** avant upload via `prepareMicrostoreJpeg()`.

### 3.3 Sizing

Aucune contrainte OSS observée. Les tailles envoyées côté BJ sont celles de `SIZE_TARGETS.large` (1200 px de long, voir `lib/branded-image.ts`).

---

## 4. Endpoints BOSS / merchant

Base URL : `https://api2.dokkr.net/index.php`.
Format : requêtes POST avec un paramètre `service=` en query string qui route vers l'action. Retour JSON.

### 4.1 `POST /goods/import_v1` — Push produits (create + update)

**Un seul endpoint** pour create ET update. Microstore reconnaît le produit via `item_ref` (= `Product.reference`) et fait un upsert.

**Payload** : format CSV-like `[headers, ...rows]`. En-têtes en anglais (attention : l'export Excel manuel utilise les libellés français). Colonnes dans cet ordre (validé HAR) :

```
item_ref, name, category, remark_package, remark_material, brand, year, season,
unit_number, color, stock, stock_piece, weight, price, product_country, sale, desc
```

**1 ligne par couleur unique** (les PACK sont exclus — Microstore ne référence que les ventes à l'unité).

**Code** : `lib/microstore-products.ts` (`microstoreImportProducts`, `productToMicrostoreApiRows`).

### 4.2 Orders

Endpoint de récupération des commandes marketplace. Cf. `lib/microstore-orders-*.ts` et `app/api/admin/microstore/poll/route.ts`. Non détaillé ici (voir le code).

---

## 5. La structure d'images d'un `goods` Microstore

**C'est LE point critique** de cette intégration. Trois champs coexistent dans la fiche produit Microstore, chacun avec un rôle distinct.

### 5.1 Structure retournée par `GET /api/companies/goods/itemRef`

```json
{
  "goodsId": 10782,
  "itemRef": "A2630",
  "name": "…",

  "coverImage": "https://dcdn.microstore.app/3976/MSH5_a349...JPG",
  "coverImg":   "https://dcdn.microstore.app/3976/MSH5_a349...JPG",

  "mainImages": [],
  "editedMainImages": true,

  "colorImages": [
    { "colorId": 33, "colorName": "Doré",   "images": [".../doré.JPG"] },
    { "colorId": 32, "colorName": "Argent", "images": [".../argent-brandée.JPG", ".../argent-originale.JPG"] }
  ],

  "skus": [
    { "skuId": 25061, "colorId": 33, "colorName": "Doré",
      "img": ".../doré.JPG", "imgs": [".../doré.JPG"], "images": [".../doré.JPG"] },
    { "skuId": 25062, "colorId": 32, "colorName": "Argent",
      "img": ".../argent-brandée.JPG",
      "imgs":   [".../argent-brandée.JPG", ".../argent-originale.JPG"],
      "images": [".../argent-brandée.JPG", ".../argent-originale.JPG"] }
  ]
}
```

### 5.2 Sémantique des champs

| Champ | Rôle | Où c'est affiché |
|---|---|---|
| `coverImage` / `coverImg` | UNE seule image, miniature du produit | Grille/liste dans la vitrine Microstore, résultats de recherche |
| `mainImages[]` | Carousel principal de la fiche | Bandeau du haut de la fiche produit ; **vide dans notre workflow** — la cliente préfère toutes les photos par couleur |
| `colorImages[]` | Regroupement par couleur (lecture seule) | Reflet du contenu de `skuImage`, présenté par couleur dans le back Microstore admin |
| `imageSetting.skuImage[]` | Images attribuées à chaque SKU | Photos qui s'affichent quand le client sélectionne une couleur sur la fiche produit |

Le PATCH côté API n'accepte QUE `coverImage`, `mainImages`, `imageSetting.skuImage`. `colorImages` est dérivé côté serveur Microstore.

### 5.3 Convention BJ → Microstore (validée HAR « Good result.har » 2026-07-30)

Pour un produit BJ avec N couleurs, dont **une principale** (badge « RÉFÉRENCE » activé) :

- **`coverImage`** = version **brandée** de la 1ʳᵉ photo de la couleur principale.
- **`mainImages`** = `[]` **toujours vide** (comportement voulu — sinon Microstore affiche un carousel principal en doublon des images par couleur).
- **`imageSetting.skuImage`** :
  - Couleur **principale** : `[brandée, originale]` — 2 images (la brandée d'abord, l'originale sans badge après).
  - Autres couleurs : `[originale]` — 1 image.

Concrètement pour A2630 (Argent principale + Doré) :

| SKU | colorName | images envoyées |
|---|---|---|
| 25062 (principale) | Argent | brandée `.../a349...JPG`, originale `.../5839...JPG` |
| 25061 | Doré | originale `.../d713...JPG` |

Et `coverImage = .../a349...JPG` (Argent brandée), `mainImages = []`.

### 5.4 Effets de bord du PATCH

- **OMETTRE `imageSetting`** = NO-OP sur les SKU déjà peuplés. C'est le format à utiliser quand on ne veut modifier que `coverImage` (cf. `bulkSendPhotosToMicrostore` : après le POST bulk, on fait un PATCH cover sans `imageSetting`).
- **`imageSetting: { skuImage: [] }`** (avec liste vide) = **REFUSÉ** par Microstore avec `HTTP 400 skuImageSetting.skuImage.limit`. Ne PAS envoyer ce format même si un ancien commentaire de code / une ancienne doc laissait entendre que c'était un no-op.
- **`imageSetting: { skuImage: [{ skuIds: [X], images: [...] }] }`** = **réassigne exactement** la liste pour les SKU listés. Les SKU non listés ne sont pas touchés.
- **`mainImages: []`** = VIDE le carousel principal (Microstore stocke `editedMainImages: true` pour désactiver toute logique de fallback intelligent — donc le carousel restera VRAIMENT vide, sans images de secours).
- **`mainImages: [url1, url2]`** = remplace le carousel par cette liste.

---

## 6. Différence mode mono vs mode bulk

Deux flux distincts côté BJ, pour un même effet final chez Microstore.

### 6.1 Mode mono — `sendProductPhotosToMicrostore(reference)`

Utilisé quand la cliente clique « Envoyer les photos » depuis un produit précis (fiche produit ou carte Station de Transfert dans `/admin/parametres`).

Flux :
1. Charge le produit BJ + variantes UNIT + fichiers image.
2. `GET /api/companies/goods/itemRef` pour récupérer `goodsId` + `skuIds` Microstore.
3. Pour chaque couleur BJ :
   - Upload photo n°1 (avec badge si couleur principale) sur OSS.
   - Si couleur principale : upload photo n°1 encore **une 2ᵉ fois** sans badge (l'originale).
   - Upload photos 2, 3, ... (toutes originales) sur OSS.
   - Collecte les URLs par SKU.
4. **UN seul PATCH** `/api/goods/{id}` avec `coverImage` + `mainImages: []` + `imageSetting.skuImage` complet.

### 6.2 Mode bulk — `bulkSendPhotosToMicrostore(productIds[])`

Utilisé automatiquement après un bulk push produits (`bulkPushProductsToMicrostore`). Beaucoup plus économe en appels API.

Flux :
1. Charge N produits + variantes UNIT + fichiers image.
2. Pour chaque produit × chaque couleur :
   - Upload photo n°1 (avec badge si couleur principale) sur OSS → ajoute une entry dans `pictures`.
   - Si couleur principale : upload aussi l'originale → ajoute une 2ᵉ entry dans `pictures` avec le MÊME `colorName` mais `order: 2` (le POST bulk fait le matching par colorName, donc Microstore ajoutera les 2 photos au SKU Argent).
   - Upload photos 2, 3, ... (toutes originales) → entries `order: N+1`.
3. **UN seul POST** `/api/v3/pictureStations?importToGoods=true` avec tout le catalogue de `pictures[]`.
4. Baisse le flag `microstoreSyncRequired = false` sur les produits ayant réussi.
5. **UN PATCH** `/api/goods/{id}` par produit ensuite pour poser `coverImage` (+ `mainImages: []`, `imageSetting` OMIS). Le POST bulk ne gère pas `coverImage` donc c'est cette 2ᵉ passe qui la pose.

### 6.3 Comparaison

| | Mono | Bulk |
|---|---|---|
| Uploads OSS | Séquentiels dans une boucle | Idem (perf identique, à paralléliser un jour) |
| Appels API Microstore par produit | 1 GET itemRef + 1 PATCH | 1 GET itemRef + 1 PATCH (post-bulk cover) |
| Appels API Microstore globaux (N produits) | N × (1 GET + 1 PATCH) | 1 POST bulk + N × (1 GET + 1 PATCH cover) |
| Nombre d'entries dans le payload principal | 1 par SKU dans `skuImage` | 1 par photo dans `pictures` |
| Matching côté Microstore | via `skuId` explicite | via `itemRef + colorName` |

---

## 7. Pièges validés en réel (résumé)

1. **`mainImages: []` doit rester vide** — sinon Microstore affiche un carousel en doublon des photos par couleur. Cf. investigation 2026-07-30 sur A2630 (comparaison HAR « Good » vs « BAd »).

2. **La couleur principale doit avoir 2 photos dans son SKU** (brandée + originale). Sinon la cliente ne voit qu'une seule version dans son back Microstore et le badge n'est pas discret.

3. **Le POST bulk `/api/v3/pictureStations` matche par `colorName` — case-sensitive et sensible aux accents.** « doré » ≠ « Doré ». Toujours envoyer le nom exact tel qu'il apparaît côté Microstore.

4. **`getMicrostoreGoodsByItemRef` peut renvoyer 404 juste après un `POST /goods/import_v1`.** Microstore prend quelques secondes à indexer un nouveau produit. Prévoir un retry si nécessaire.

5. **Le pictureStationKey expire au bout de ~7 jours.** L'UI affiche un badge « Expire dans X jours » (`components/admin/settings/MicrostorePictureStationCard.tsx`). Sans regen manuelle, tous les upload OSS échouent en 403.

6. **Les creds STS OSS expirent en quelques minutes.** Toujours re-demander avant chaque batch — ne pas cacher.

7. **Multi-tenant** : cache session **par tenant** (`primedSessionKeyByTenant: Map<tenantId, string>` dans `microstore-auth.ts`). Idem pour la Picture Station (`getStoredPictureStation` lit via `SiteConfig` scopé au tenant courant).

8. **Fire-and-forget après push produit** — `pushSingleProductToMicrostore` et `bulkPushProductsToMicrostore` enchaînent l'envoi des photos en `void (async () => {...})()`. La cliente reçoit un toast « produits envoyés » avant même que les photos ne partent. Ne pas oublier de wrapper le fire-and-forget avec `tenantALS.run(tenantId, ...)` si on ajoute un nouveau chemin.

---

## 8. Code — fichiers à connaître

| Fichier | Rôle |
|---|---|
| `lib/microstore-auth.ts` | Login QR code BOSS + cache session par tenant |
| `lib/microstore-client.ts` | Wrapper HTTP BOSS + gestion erreurs `MicrostoreSessionExpiredError` |
| `lib/microstore-products.ts` | Push produits `POST /goods/import_v1` |
| `lib/microstore-picture-station.ts` | Toute la partie H5 + OSS (validation key, upload, PATCH images, bulk import) |
| `lib/microstore-orders-*.ts` | Récupération des commandes marketplace |
| `lib/microstore-stock-deduction.ts` | Déduction stock BJ après commande Microstore |
| `app/actions/admin/microstore-picture-station.ts` | Server actions `saveMicrostorePictureStation`, `sendProductPhotosToMicrostore`, `bulkSendPhotosToMicrostore` |
| `app/actions/admin/microstore-products.ts` | Server actions push produits + chaînage photos |
| `app/api/admin/microstore/*` | Endpoints QR ping/poll et token d'import |
| `components/admin/settings/MicrostorePictureStationCard.tsx` | UI Station de Transfert |
| `components/admin/settings/MicrostoreConnectCard.tsx` | UI login QR |
| `scripts/parse-microstore-har.mjs` | Utilitaire pour re-parser un HAR (dump lisible des requêtes API) |
| `scripts/inspect-microstore.mjs` | Sonde Playwright pour aller regarder l'état d'une fiche H5 |
| `__tests__/lib/microstore-picture-station.test.ts` | 28 tests unitaires — fonctions pures + fetch mocké |

---

## 9. SiteConfig — clés utilisées

| Clé | Chiffré | Rôle |
|---|---|---|
| `microstore_session_key` | ✅ | Session BOSS (JWT `mask_token` + `key`) |
| `microstore_picture_station_key` | ✅ | Key H5 pour la Station de Transfert |
| `microstore_picture_station_expires_at` | ❌ | Timestamp expiration du key (ms epoch) |
| `microstore_picture_station_short_url` | ❌ | URL courte affichée dans l'UI (`https://microstore.app/s/xxxxx`) |
| `microstore_price_markup_type` / `_value` / `_rounding` | ❌ | Cf. § « Marketplace pricing » de `CLAUDE.md` |

**Ne jamais** `prisma.siteConfig.upsert({where:{key}})` — PK composite `(tenantId, key)`. Utiliser `setSiteConfig()`/`unsetSiteConfig()` (`lib/site-config-write.ts`).

---

## 10. Ce qui n'est PAS supporté

- **Upload photo via API BOSS** — les photos passent obligatoirement par l'API H5 + OSS.
- **Suppression via API** — archivage/désactivation reste manuel dans le back Microstore.
- **Refresh** — pas d'endpoint dédié. Un re-push écrase l'existant.
- **PACK** — Microstore ne référence que les ventes à l'unité (UNIT). Les variantes PACK sont exclues (`filterUnitVariantsOnly` dans `lib/microstore-products.ts`).
- **Callback / webhook** — Microstore ne propose pas de webhook côté marchand. Tout est en polling depuis BJ.
