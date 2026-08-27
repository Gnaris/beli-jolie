# PFS Mobile API — `admin.parisfashionshops.com`

> API interne utilisée par l'appli mobile officielle **« PFS - Back Office Grossiste »** (Play Store: `com.parisfashionshops.brand`, éditeur FASHION SHOPS). Distincte de l'API wholesaler (`wholesaler-api.parisfashionshops.com`, voir `docs/pfs-api.md`) qu'on utilise pour l'import/audit.
>
> **Documentation non officielle** reconstruite par reverse-engineering via [HTTP Toolkit](https://httptoolkit.com/) + émulateur Android Studio le 2026-08-01. Tout ce qui suit peut casser sans préavis si PFS met à jour l'appli — à vérifier périodiquement si on dépend d'un endpoint.

## Contexte / pourquoi cette doc

Bug racine côté PFS : quand un vendeur crée un produit via l'appli mobile, la synchro `admin` ↔ `wholesaler` est incomplète sur `material_composition` → l'API wholesaler renvoie `[]` alors que la compo est bien saisie côté admin. On a implémenté un fallback dans `lib/pfs-admin-api.ts` qui relit la compo côté admin en secours.

**Autres bugs PFS potentiellement contournables via cette API** : à explorer si de futurs symptômes similaires apparaissent (stock, images, tags, etc.).

## Base URL

| Élément | Valeur |
|---------|--------|
| Origin | `https://admin.parisfashionshops.com` |
| API métier | `https://admin.parisfashionshops.com/api/v1` |
| Endpoint auth | `https://admin.parisfashionshops.com/api/auth/seller` (⚠ **pas** dans `/api/v1`) |
| CDN images | `https://admin.parisfashionshops.com/paris/images/...` |
| Stack serveur | PHP 7.4.30 (via `X-Powered-By`), Cloudflare devant |
| Techno appli | Flutter (Dart/3.3), pas de certificate pinning observé (mitmable sans Frida) |

## Authentification

### `POST /api/auth/seller` — login

**Body** :
```json
{
  "username": "<email PFS>",
  "password": "<mot de passe PFS>",
  "AemikSEAUID": "AemikWeb3_PFSBKOFFICE"
}
```

Note : `username` et non `email`. `AemikSEAUID` est un identifiant fixe d'app cliente exigé sur toutes les requêtes admin — c'est probablement un identifiant Aemik SEA (framework maison), à passer tel quel.

**Réponse (200)** :
```json
{
  "Response": {
    "Date": 1785543799,
    "Status": "SUCCEEDED",
    "Code": 0,
    "Message": {
      "Id": 1751,
      "Uid": "a071t000000SWBiAAO",
      "Uts": 1785543799,
      "Token": "c0e8b716e9aedbe5035b7ff6bab70872",
      "Name": "MEIHUA LIN",
      "Email": "princesse.fcenter@gmail.com",
      "FirstName": "MEIHUA",
      "LastName": "LIN",
      "Status": "ACTIVE",
      "Role": "OWNER",
      "Language": "FR",
      "AccountId": "a001t000005E7KrAAK",
      "AccountType": "WHOLESALER",
      "AccountCode": "93PRINCESSEX41487",
      "AccountName": "PRINCESSE",
      "AccountStatus": "VALIDATED",
      "Ranking": "SILVER",
      "Siret": "43450618400044",
      "EORIUK": "FR43450618400044"
    }
  }
}
```

- **Token à réutiliser** : `Response.Message.Token` — chaîne hex courte (32 caractères).
- **Cookie parallèle** : `PHPSESSID` renvoyé en `Set-Cookie` avec TTL 7 j. Le Bearer semble avoir la même durée, à vérifier. Notre implémentation cache 6 h par sécurité.

### Requêtes suivantes

Header obligatoire : `Authorization: Bearer <Token>`.
Body : toutes les POST embarquent `{"AemikSEAUID": "AemikWeb3_PFSBKOFFICE", ...}` en plus des paramètres métier. Un body sans `AemikSEAUID` est probablement refusé (non testé).

### Enveloppe standard des réponses

Toutes les réponses métier suivent :
```json
{ "Response": { "Date": <unix>, "Status": "SUCCEEDED" | "FAILED", "Code": 0, "Message": <payload> } }
```

## Endpoints observés (via HTTP Toolkit)

### Dashboard (écran d'accueil de l'appli)

| Endpoint | Body | Sert à |
|----------|------|--------|
| `POST /api/v1/order/getsm` | `{AemikSEAUID}` | Liste commandes récentes |
| `POST /api/v1/products/states` | `{AemikSEAUID}` | Compteurs de produits par état |
| `POST /api/v1/charts/LineChartAndOrder` | `{AemikSEAUID}` | Chart commandes (ligne) |
| `POST /api/v1/charts/catalog` | `{AemikSEAUID}` | Chart catalogue |
| `POST /api/v1/charts/customer` | `{AemikSEAUID}` | Chart clients |

### Produits

| Endpoint | Body | Sert à |
|----------|------|--------|
| `POST /api/v1/product/GetProductsYin` | `{AemikSEAUID, ...filters?}` | Liste produits du compte |
| `POST /api/v1/product/get/{pfsProductId}` | `{AemikSEAUID}` | Détail produit (canonical) |
| `POST /api/v1/single/app/Productgetbyid/{pfsProductId}` | `{AemikSEAUID}` | Détail produit (vue mobile — payload identique à `product/get`) |
| `POST /api/v1/product/save/{pfsProductId}` | `{AemikSEAUID, ...changes}` | Enregistrer produit |
| `POST /api/v1/product/images/{pfsProductId}` | `{AemikSEAUID}` | Métadonnées images |
| `POST /api/v1/stocks/byIdm/{pfsProductId}` | `{AemikSEAUID}` | Stocks par variante |

**Note** — l'`{pfsProductId}` est l'ID interne PFS (format `pro_306373f22f72a93f8b3165d0e2f8`), pas la référence texte (`WF92E`). Se retrouve via l'endpoint wholesaler `pfsCheckReference` (`.product.id`) ou en base locale (`Product.pfsProductId`).

### Attributs / dictionnaires

| Endpoint | Body | Sert à |
|----------|------|--------|
| `POST /api/v1/attributes/composition` | `{AemikSEAUID, Category: "<Salesforce Uid>"}` | Matières dispo pour cette catégorie |
| `POST /api/v1/attributes/collection` | `{AemikSEAUID, ...}` | Collections dispo |
| `POST /api/v1/single/app/Categorylist` | `{AemikSEAUID}` | Toutes les catégories |
| `POST /api/v1/single/app/Familylist` | `{AemikSEAUID}` | Toutes les familles |

Le `Category` du dictionnaire compositions est le `CategoryId__c` renvoyé dans le produit (Salesforce Uid, ex `a045J00000BO0vRQAT`). Filtrer par catégorie car les matières applicables varient (JEWELRY vs CLOTH vs LEATHER_GOODS, etc.).

## Format des données clés

### Produit brut (`/product/get/{id}` ou `/single/app/Productgetbyid/{id}`)

Extrait des champs pertinents (le payload complet fait ~100 champs Salesforce en `PascalCase__c`) :

```json
{
  "Id": "pro_306373f22f72a93f8b3165d0e2f8",
  "OwnerId": "00558000000PngJAAS",
  "Name": "Parures de bijoux en acier inoxydable",
  "Reference__c": "WF92E",
  "Status__c": "READY_FOR_SALE",

  "Brand__c": "a01AZ00000314QgYAI",
  "BrandName__c": "Beli & Jolie",
  "BrandSeo__c": "beli-jolie",

  "CategoryId__c": "a045J00000BO0vRQAT",
  "Category_FR__c": "Parures de bijoux",
  "Family__c": "a035J00000185J7QAI",
  "Family_FR__c": "Bijoux Fantaisie",
  "FamilySEO__c": "bijoux-fantaisie",

  "Gender__c": "WOMAN",
  "Collection__c": "AH2026",
  "CollectionLabelFR__c": "Automne/Hiver 2026/2027",
  "CollectionId__c": "a0crTE39ZJIQZmYzpz",
  "Season__c": null,

  "Label_FR__c": "Parures de bijoux en acier inoxydable",
  "Label_EN__c": "Stainless steel jewelry sets",
  "Label_DE__c": "Schmucksets aus Edelstahl",
  "Label_ES__c": "Conjuntos de joyas de acero inoxidable",
  "Label_IT__c": "Set di gioielli in acciaio inossidabile",

  "Description_FR__c": "Parures de bijoux en acier inoxydable, hypoallergénique et résistant à l'eau.",
  "Description_EN__c": "Stainless steel jewelry sets, hypoallergenic and water-resistant.",
  "Description_DE__c": "Schmucksets aus Edelstahl, hypoallergen und wasserfest.",
  "Description_ES__c": "Conjuntos de joyas de acero inoxidable, hipoalergénicos y resistentes al agua.",
  "Description_IT__c": "Set di gioielli in acciaio inossidabile, ipoallergenici e resistenti all'acqua.",

  "Composition_1__c": "ACIERINOXYDABLE",
  "Composition_1_Percentage__c": "100.0000",
  "Composition_2__c": null,
  "Composition_2_Percentage__c": null,
  "Composition_3__c": null,
  "Composition_3_Percentage__c": null,
  "Composition_4__c": null,
  "Composition_4_Percentage__c": null,
  "Composition_5__c": null,
  "Composition_5_Percentage__c": null,
  "Lining_1__c": null,
  "Lining_2__c": null,
  "Lining_Percentage_1__c": null,
  "Lining_Percentage_2__c": null,

  "MadeIn__c": "CN",
  "Colors__c": "BLUE;MULTICOLOR;PINK;WHITE",
  "DefaultColor__c": "WHITE",
  "Sizes__c": null,
  "Big_Size__c": null,

  "Max_Price__c": "14.2000",
  "Min_Price__c": "14.2000",
  "MinimumOrder__c": "80.0000",
  "PackCount__c": "0.0000",
  "ItemCount__c": "1.0000",
  "ActiveCount__c": "4.0000",
  "InStock__c": "4",
  "DiscountMax__c": null,
  "HasPromo__c": null,

  "Image__c": "/paris/images/femme/beli-jolie/parures-de-bijoux/pro_306373f22f72a93f8b3165d0e2f8/parures-de-bijoux-en-acier-inoxydable_blanc_6a6cbe44edaf7.jpg",
  "Images__c": "{\"DEFAULT\":\"https://static.parisfashionshops.com/...blanc.jpg\",\"BLUE\":[...],\"PINK\":[...]}",

  "Origin__c": "CREATE",
  "New__c": "1",
  "VIP__c": "0",
  "VendorCatalogOnly__c": "0",
  "OnSaleDate__c": "2026-07-31 17:25:00",
  "CreatedDate": "2026-07-31 17:24:25",
  "LastModifiedDate": "2026-07-31 17:29:05",
  "SystemModstamp": "2026-07-31 17:25:00",

  "Account__c": "a001t000005E7KrAAK",
  "Account_Name__c": "PRINCESSE",
  "Account_Auto_Number__c": "41487",
  "VendorName__c": "PRINCESSE",
  "VendorSEO__c": "princesse",
  "SEOKey__c": "beli-jolie-parures-de-bijoux-en-acier-inoxydable_6a6cbe291a00d",
  "SEOKey_EN__c": "beli-jolie-stainless-steel-jewelry-sets_6a6cbe291a026",
  "zohoId__c": "426944754894",
  "zohoSync__c": "0"
}
```

**Slots composition** : 5 max (`Composition_1__c` à `Composition_5__c` + pourcentages). Chaque slot contient soit `null` soit un code stable type `"ACIERINOXYDABLE"`, `"COTTON"`, `"SILVER"`, `"PEARL"`… Les codes sont **identiques** entre l'API admin et l'API wholesaler (même source Salesforce sous-jacente).

**Slots doublure** : 2 (`Lining_1__c` / `Lining_2__c`), même principe.

### Dictionnaire compositions (`/attributes/composition`)

```json
{
  "Response": {
    "Status": "SUCCEEDED",
    "Message": [
      {
        "Id": 111,
        "Uid": "a0zW5000000YvezIAC",
        "Name": "Stainless steel",
        "Code": "ACIERINOXYDABLE",
        "Categories": ["JEWELRY"],
        "LabelFR": "Acier inoxydable",
        "LabelEN": "Stainless steel",
        "LabelDE": "Rostfreier Stahl",
        "LabelES": "Acero inoxidable",
        "LabelIT": "Acciaio inossidabile"
      },
      ...
    ]
  }
}
```

- **`Uid`** = identifiant Salesforce, identique à l'`id` retourné par l'API wholesaler (`pfsGetCompositions`).
- **`Code`** = code stable stocké dans les `Composition_N__c` du produit. C'est aussi ce qu'attend notre BDD locale dans `Composition.pfsCompositionRef` (après backfill via `scripts/backfill-composition-refs.ts`).
- **`Categories`** = domaines où la matière est disponible : `CLOTH`, `LEATHER_GOODS`, `JEWELRY`, `ACCESSORIES`, `SHOE`, `SUPPLIES`.

**Codes observés (dictionnaire JEWELRY complet, 2026-08-01)** :
`METAL`, `CALFSKIN_FEMALE`, `CERAMIC`, `GLASS`, `OTHER`, `PVC`, `STEEL`, `WOOD`, `PLASTIC`, `FABRIC`, `CANVAS`, `CUIR`, `SILICONE`, `SHELL`, `CRYSTAL`, `MOTHER_OF_PEARL`, `PEARL`, `ROCK`, `SILVER_PLATED`, `GOLD_PLATED`, `RESIN`, `RHODIUM`, `RHINESTONE`, `SILVER` (= Argent 925), `ACIERINOXYDABLE`, `PIERRENATURELLE`, `PERLEDUCULTURE`.

## Différences avec l'API wholesaler

| Aspect | Wholesaler (`wholesaler-api.`) | Admin (`admin.`) |
|--------|-------------------------------|------------------|
| Public visé | Grossistes qui revendent | Vendeurs qui gèrent leur back-office |
| Auth | OAuth `/oauth/token` (email/password → access_token) | Bearer session `/api/auth/seller` (username/password → Token court) |
| Verbe dominant | GET | POST (même pour lecture) |
| Casing champs | snake_case (`material_composition`) | PascalCase Salesforce (`Composition_1__c`) |
| Structure compo | Array `[{id, reference, percentage, labels}]` | 5 slots `Composition_N__c` + `Composition_N_Percentage__c` |
| Chargement dict compositions | `GET /catalog/attributes/compositions` (toutes en 1 appel) | `POST /attributes/composition` (filtre obligatoire par `Category`) |
| Dictionnaire matières | Champ `reference` (code stable) | Champ `Code` (même valeur) + `Uid` (identifiant Salesforce) |
| Cert pinning | ? | Absent (mitmable sans Frida) |
| Bug connu | Renvoie `[]` OU une compo stale pour compo saisie via mobile | Source de vérité |

## Notre implémentation

- Module client : `lib/pfs-admin-api.ts`.
- Auth Bearer + cache token par tenant (Map) — TTL 6 h.
- Dictionnaire compo caché par tenant × catégorie — TTL 1 h.
- Helper haut niveau : `pfsAdminFetchMaterialComposition(pfsProductId)` → renvoie un array au format compatible `checkRef.material_composition` (drop-in replacement).
- **Mobile prioritaire (2026-08-27)** : on lit systématiquement l'API admin d'abord ; le wholesaler ne sert que de fallback si mobile est vide ou HS. Avant cette date on faisait l'inverse (mobile en fallback quand wholesaler vide), ce qui laissait un angle mort quand wholesaler renvoyait une compo stale ≠ mobile (cas produit issyma 375).
- Consommateurs :
  - `lib/pfs-import.ts` — `approveAndImportPfsProduct` remplace `detail.material_composition` par la compo mobile si elle est non vide.
  - `lib/pfs-verify.ts` — remplace `checkRef.product.material_composition` par la compo mobile avant comparaison.
  - `lib/pfs-verify-apply.ts` — même substitution via helper `preferMobileComposition` (exporté pour test) + `resolvePfsCompositionsToLocal` pour matérialiser les ProductComposition en base sur pull auto.

## Reproduire une capture (pour audit / debug futur)

1. Installer Android Studio + créer un AVD Pixel avec image **Google APIs** (pas « Google Play » — rootable requis pour le cert HTTP Toolkit).
2. Installer [HTTP Toolkit](https://httptoolkit.com/) sur Windows.
3. HTTP Toolkit → onglet Intercept → **Android Device via ADB** → autorise le cert sur l'émulateur.
4. Sur l'émulateur : télécharger l'APK depuis APKPure/APKMirror (search `com.parisfashionshops.brand`) → drag-and-drop dans la fenêtre émulateur → login PFS.
5. Faire les actions à observer (ouvrir un produit, éditer, etc.). HTTP Toolkit capture toutes les requêtes.
6. **Via MCP** (bonus) : ajouter le serveur MCP HTTP Toolkit à Claude Code (`claude mcp add http-toolkit -- 'C:\Users\<user>\AppData\Local\Programs\HTTP Toolkit\resources\httptoolkit-mcp.cmd'`) — Claude peut alors interroger directement les captures (`events_list`, `events_get-response-body`, etc.) sans copier-coller.

**Certificate pinning** — pas observé en 2026-08. Si un futur update ajoute du pinning, il faudra passer par Frida (via l'intercepteur « Android App via Frida » d'HTTP Toolkit, requiert un émulateur/device rooté).
