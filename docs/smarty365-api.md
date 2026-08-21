# Smarty365 — intégration transporteur

Alternative à Easy-Express : plateforme française qui exécute les **contrats transporteurs négociés en direct** de la cliente (Colissimo, Chronopost, Mondial Relay, GLS, GPX). Contrairement à Easy-Express (agrégateur white-label), Smarty365 lit une **grille tarifaire pré-établie** au lieu de faire un appel de cotation live.

**Modules** : `lib/smarty365.ts` · `app/actions/admin/shipping.ts` (branchement) · `app/api/carriers/route.ts` (checkout client).

---

## API — bases

- **URL** : `https://www.smarty365.com/api` (pas de sous-domaine `api.smarty365.com`)
- **Auth** : `Authorization: Bearer <JWT>` (le JWT sert d'API key permanente ; payload = `{userId, uuid, iat}`, pas d'`exp` explicite)
- **Format** : REST NestJS, pagination `{data, count, total, page, pageCount}` ou array brut selon endpoints
- **Sandbox** : `sandbox.smarty365.com` est un mirror du site marketing (pas d'API dédiée) — tester en prod avec parcels tests + soft-delete
- **CORS** : ouvert (headers `Access-Control-Allow-Origin: *`)

### Endpoints identifiés
Source : `GET /api-spec.js` (racine du domaine `www.smarty365.com`, protégé par Bearer). Récupérable via `curl -H "Authorization: Bearer $TOKEN" https://www.smarty365.com/api-spec.js` — c'est le fichier JS qui alimente leur Developer Center SPA.

| Endpoint | Rôle |
|---|---|
| `GET /api/user` | Profil compte connecté (userId, tenantId, roleId…) |
| `GET /api/client` | Infos client (shopName, `levelId`, `accountShipping`, `isClearanceSupported`) — le flag `isClearanceSupported` ne bloque PAS les DOM-TOM, cf. bloc DOM-TOM |
| `GET /api/address` | Adresses (types : `billing`, `sender`, `receiver`) |
| `GET /api/pricingRange` | Grille tarifaire (routes + tranches poids + pays) — cotation locale |
| **`POST /api/parcel/rateShipment`** | Cotation officielle multi-transporteurs (à utiliser en remplacement de la lecture manuelle des pricingRange dans une v2) |
| **`POST /api/parcel`** | Crée un bordereau — cf. format ci-dessous. Peut créer simultanément un retour via `returningTransporter`/`returningRoute` |
| `POST /api/parcel/createReturningParcel` | Crée uniquement un bordereau de retour à partir d'un `originTrackingNumber` |
| `GET /api/parcel/{parcelId}` | Détail parcel |
| `GET /api/parcel/trackingNumber/{tn}` | Détail parcel indexé par tracking |
| `GET /api/parcel/label/{parcelId}` | Binary PDF/ZPL |
| `GET /api/parcel/labelUrl/{parcelId}` | `{ url }` public S3 |
| `POST /api/parcel/labels` | Merge de plusieurs labels en 1 PDF (body = array d'ids) |
| `POST /api/parcel/orderLabels` | Labels d'une commande complète (`orderNumber` + `mergeFile`) |
| `GET /api/parcel/traces/{parcelId}?language=fr` | Événements de suivi |
| `POST /api/parcel/batchGetTraces` | Traces batch (par ids ou tracking numbers) |
| `PATCH /api/parcel/:id` | Soft-delete via `{ deletedAt: "ISO" }` (pas d'endpoint `DELETE`) |
| `GET /api/auth/tokenVerify?token={token}` | Vérifie la validité d'un token |
| `GET /api/hsCode-config` · `GET /api/setting/mineHsCodes` | Config codes SH |

---

## POST /api/parcel — format officiel

Source : **doc officielle Smarty365** (`GET https://www.smarty365.com/api-spec.js` avec Bearer token, section `id: "parcel-create"`).

**Champs obligatoires (M)** : `parcels[]`, `senderAddress` (ou `senderAddressId`), `receiverAddress` (ou `receiverAddressId`), `transporter`, `route`.
**Optionnels (O)** : `labelFormat`, `pickupAt`, `returningTransporter`, `returningRoute`, `payByReceiver`.

**⚠ Champs qui n'existent PAS dans la doc et qui font crash 500 côté Smarty365** : `customClearance`, `hasInvoice`, `parcelType`. Les items douaniers vivent uniquement dans `parcels[].items[]`.

```json
{
  "transporter": "CHRONOPOST",
  "route": "CHRONOPOST_18_B2C_SML",
  "parcels": [{
    "weight": 0.8,
    "length": 30,
    "width": 11,
    "height": 10,
    "insuredValue": 100,
    "reference": "K7X9M2PH"
  }],
  "senderAddressId": 1154314,
  "receiverAddress": {
    "firstName": "Julie",
    "lastName": "Payet",
    "company": "",
    "email": "julie@example.fr",
    "phoneNumber": "0612345678",
    "mobileNumber": "0612345678",
    "street": "14 rue X",
    "complement": "",
    "city": "Paris",
    "postalCode": "75001",
    "countryCode": "FR"
  },
  "labelFormat": "pdf"
}
```

### DOM-TOM / hors UE — ajouter `items[]` dans le sous-parcel

**Testé et validé** sur le compte BJ (parcel Réunion `XF147920636FR` créé le 2026-08-21, soft-deleted).

```json
{
  "transporter": "CHRONOPOST",
  "route": "CHRONOPOST_EXPRESS_SML",
  "parcels": [{
    "weight": 1,
    "length": 27,
    "width": 10,
    "height": 11,
    "insuredValue": 100,
    "reference": "REU001",
    "items": [{
      "hscode": "71171900",
      "originCountry": "CN",
      "weight": "1",
      "quantity": "1",
      "value": "100",
      "description": "Bijoux fantaisie"
    }]
  }],
  "senderAddressId": 1154314,
  "receiverAddress": {
    "firstName": "Julie",
    "lastName": "Payet",
    "street": "14 rue Marechal Leclerc",
    "city": "Saint-Denis",
    "postalCode": "97400",
    "countryCode": "RE"
  },
  "labelFormat": "pdf"
}
```

**Piège champs `items[]`** — bien respecter le nommage exact (leur GET renvoie parfois d'autres casings, ne pas se fier à ça) :
- `hscode` (minuscule, PAS `hsCode`)
- `originCountry` (PAS `countryOfOrigin`)
- `value` (PAS `unitPrice` + `totalPrice`)
- `weight`, `quantity`, `value` sont des **strings**, pas des numbers
- Pas besoin de `customClearance: true` — la présence d'`items[]` déclenche automatiquement le mode douanier
- `sendingReason` est auto-inféré (`"SALE_OF_GOODS"` par défaut sur mon test)

Le flag `isClearanceSupported: false` sur `GET /api/client` n'est PAS bloquant pour les envois DOM-TOM — c'était un fausse piste. Le mauvais body suffisait à expliquer les 400 précédents (`Need customs parameters` sans `items[]` / `Cannot read property 'shopName' of undefined` avec les faux champs `customClearance/hasInvoice`).

**Réponse** : **array** de parcels créés (multi-colis possible). Extraire `[0]` :
```json
[{
  "id": 5114159,
  "transporter": "CHRONOPOST",
  "route": "CHRONOPOST_18_B2C_SML",
  "trackingNumber": "XX107768926JB",
  "labelUrl": "https://esendeo-new.s3.eu-west-1.amazonaws.com/production/label/10691/XX107768926JB.pdf",
  "status": "CREATED",
  "shippingFee": 4.93, "fuelTaxFee": 1, "insuranceFee": 0.6, "et": 5.93, "vat": 1.19, "it": 7.12
}]
```

### Points clés
- **`insuredValue` DANS le sous-parcel** — pas à la racine (à la racine il est ignoré silencieusement)
- **`senderAddressId` obligatoire** — résolu via `resolveSenderAddressId()` qui appelle `GET /api/address?limit=50` puis filtre `type === "sender"`. Cache mémoire par tenant, TTL 1h
- **`receiverAddress` inline OK** — pas besoin de créer l'adresse via POST `/api/address` avant
- **PDF S3 public** — l'URL `labelUrl` est signée S3, pas besoin d'Authorization Bearer pour la télécharger (fallback avec Bearer si 401/403)

---

## Cotation — logique locale

Smarty365 n'expose pas d'endpoint `/rates`. La cotation se fait **côté BJ** en filtrant les `pricingRange` (cachés 1h) :

1. Filtre `state === "PUBLISHED"` + `validPeriod` couvre maintenant (`isRangeActive`)
2. Filtre `senderCountryCodes` inclut FR + `receiverCountryCodes` inclut le pays destinataire (`matchesRoute`)
3. Filtre `isPickupPointRoute` retire les routes point relais (cf. plus bas)
4. Pour chaque range restant, trouve la tranche `pricingTable[]` couvrant le poids (`pickPricingRow`, ranges "common" seulement)
5. Applique `applyFuelTax` (taux 20,35 % par défaut)
6. Déduplique par `route.code` en gardant le moins cher

**Format `carrierId`** : `smarty:{TRANSPORTER}:{ROUTE_CODE}` (ex `smarty:CHRONOPOST:CHRONOPOST_SML_CLASSIC`). Helpers : `buildSmarty365CarrierId`, `parseSmarty365CarrierId`, `isSmarty365CarrierId`.

---

## Filtrage points relais

Le tunnel de checkout BJ ne propose pas de widget de sélection de point relais → toutes les routes qui nécessitent un `relayPointId` sont masquées via `isPickupPointRoute(routeCode, transporter)` :
- `RELAY_POINT` (Colissimo Point Relais)
- `POST_OFFICE` (Colissimo Bureau de Poste)
- `RELAY_13H` (Chronopost Relais 13H)
- `_2SP_` / `_2SPEU_` (Chronopost 2Shop)
- **Tout `MONDIAL_RELAY_*`** (100 % point relais chez ce transporteur, même "Home" nécessite un dépôt côté expéditeur)

---

## Assurance obligatoire

**Toujours active**, coût **fondu dans le prix** de port affiché à la cliente (pas de mention séparée). Format :

- **Côté cotation** (`/api/carriers`) : ajoute `subtotalHT × rate/100 €` au prix de la route. La cliente voit "Chrono 35,60 €" au lieu de "34,60 €" + ligne "assurance 1 €"
- **Côté création parcel** (`/api/parcel`) : passe `insuredValue: Math.ceil(subtotalHT)` dans le sous-parcel → Smarty365 assure via Claisy et facture selon leur grille
- **Taux configurable** : `SiteConfig[smarty365_insurance_rate_pct]` (défaut 0,6 % = niveau "public" Claisy). Ajustable via cache `getCachedSmarty365InsuranceRatePct`

Le compte BJ a plusieurs niveaux Claisy visibles dans `insurancePrice.levels` (`public` 0,6 % / `HEXAGONA` / `Starter` / `Gold`). Les niveaux privés (`isPublic: false`) peuvent proposer de meilleurs tarifs — demander à Smarty365 lequel appliquer.

---

## DOM-TOM et international — fonctionnel

Réunion (RE), Antilles (GP, MQ, MF, BL), Guyane (GF), Mayotte (YT), Nouvelle-Calédonie (NC), Polynésie (PF), Wallis (WF), TAAF (TF), St-Pierre (PM), et **tout pays hors UE** nécessitent `parcels[].items[]`.

**Détection automatique côté BJ** — `runSmartyCheckout` (`app/actions/admin/shipping.ts`) construit `customsItems` uniquement si le pays de livraison n'est PAS dans `EU_COUNTRY_CODES` (27 États UE + FR métropole ; DOM-TOM en sont exclus).

### Vérification pré-génération : `checkOrderCustomsReadiness`

Avant d'appeler `createSmarty365Parcel` pour une destination DOM-TOM / hors UE, on lit chaque `OrderItem.productColorId` → `ProductColor.product.hsCodeId`. Si un produit lié n'a pas de code SH → **refus dur** avec liste des références concernées :

> Bordereau bloqué — destination RE nécessite une déclaration douanière.
> Les produits suivants n'ont pas de code SH renseigné :
> • A1720
> • B0501
> Ouvrez chaque produit dans l'admin, onglet Douane, et renseignez son code SH avant de réessayer.

**Ignoré** : items sans `productColorId` (compensations admin non rattachées) — ils tombent sur le fallback global. **Non bloquant** : `Product.countryIsoCode` (pays d'origine) — fallback `CN` reste actif.

### Construction des items — `buildCustomsItemsForOrder`

**1 item Smarty365 par OrderItem** :
- `description` = `OrderItem.productName` (snapshot, tronqué à 100 chars)
- `hscode` = `Product.hsCode.code` (fallback `"71171900"` bijouterie fantaisie)
- `originCountry` = `Product.countryIsoCode` (fallback `"CN"`)
- `quantity` = `OrderItem.quantity` (string)
- `value` = `Math.ceil(OrderItem.lineTotal)` (string, minimum 1)
- `weight` = poids unitaire × quantité (depuis `variantSnapshot.weight`, minimum 0,1 kg)

Fallback ultime (aucun item rattaché à un produit) : 1 item agrégé `{ hscode: "71171900", originCountry: "CN", value: subtotalHT, description: "Bijoux fantaisie" }`.

Message d'erreur `Need customs parameters` renvoyé par Smarty365 → bug appelant qui n'a pas fourni `customsItems` (ne devrait pas arriver en pratique grâce à la détection auto).

---

## Fournisseur actif (Easy-Express vs Smarty365)

- **Réglage** : `SiteConfig[active_shipping_provider]` (`"easy_express"` défaut | `"smarty365"`)
- **Bascule UI** : `components/admin/settings/ActiveShippingProviderSelect.tsx` dans Paramètres → Livraison
- **Lecture** : `getCachedActiveShippingProvider()` (5 min TTL, scope tenant)
- **Résolution par commande** (`resolveProviderForOrder`) : ordre de priorité
  1. `Order.shippingProvider` déjà posé → celui-là
  2. `Order.smartyLabelUrl` ou `Order.eeLabelUrl` déjà posé → provider correspondant
  3. `carrierId` commence par `smarty:` → Smarty365
  4. Sinon → `getCachedActiveShippingProvider()`
- **Chaque commande garde son provider** : bascule = effet uniquement sur les **nouvelles** commandes

---

## Signature HMAC des carriers (anti-fraude)

`lib/carrier-signature.ts` refuse un `transactionId` vide. Comme Smarty365 ne délivre pas de token de cotation, `/api/carriers` génère un jeton synthétique `smarty:v1:{crypto.randomBytes(12).hex}` par requête pour nourrir le HMAC. Le client repasse ce jeton à `/api/payments/create-intent` comme d'habitude — la vérif passe sans changement de `verifyCarrierSignature`.

---

## Champs Prisma

`Order` :
```prisma
smartyParcelId    Int?    // id numérique du parcel Smarty365
smartyTrackingId  String? // trackingNumber (ex "XX107768926JB")
smartyLabelUrl    String? @db.Text // URL S3 du PDF
smartyTransporter String? // "CHRONOPOST" | "COLISSIMO" | ...
smartyRouteCode   String? // "CHRONOPOST_SML_CLASSIC"
shippingProvider  String? // "easy_express" | "smarty365" | null (manuel)
```

`SiteConfig` :
- `smarty365_api_key` (chiffré AES-256-GCM, `SENSITIVE_KEYS`)
- `active_shipping_provider` (clair, valeurs `"easy_express"` | `"smarty365"`)
- `smarty365_insurance_rate_pct` (clair, nombre — défaut 0.6)

---

## Config UI

Paramètres → **Mode de livraison** (`buildLivraisonTile` dans `app/(admin)/admin/parametres/page.tsx`) :
- Carte **Easy-Express** (`EasyExpressApiKeyConfig`)
- Carte **Smarty365** (`Smarty365ApiKeyConfig`) — guide "où trouver mon jeton" + vérif via `validateSmarty365ApiKey` (appelle `/api/user`)
- Carte **Fournisseur actif** (`ActiveShippingProviderSelect`) — dropdown Easy-Express / Smarty365, refuse la bascule si la clé du provider cible n'est pas configurée
- Carte **Marge frais de port** (inchangée, s'applique aux 2 providers)

---

## Tests

`__tests__/lib/smarty365.test.ts` (38 tests) couvre :
- `buildSmarty365CarrierId` / `parseSmarty365CarrierId` / `isSmarty365CarrierId` (roundtrip, route codes avec `:`, mauvais préfixe)
- `pickPricingRow` (bonnes tranches, limites, types "special_areas" ignorés)
- `computeSmartyRangePrice` (fuel tax on/off, taux custom, hors barème)
- `smarty365Rates` (tri prix, filtre pays, filtre EXPIRED, meilleur par route, clé manquante, filtre points relais)
- `isPickupPointRoute` (Colissimo/Chrono/Mondial Relay/Home)
- `createSmarty365Parcel` (format parcels array, senderAddressId, `reference` dans sous-parcel, `insuredValue` arrondi, `customsItems[]` inline, message `Need customs parameters` actionnable, erreurs API)
- `fetchSmarty365Label` (S3 sans header, fallback Bearer)
- `testSmarty365ApiKey`

`__tests__/actions/admin-shipping.test.ts` (15 tests) — bloc `generateShipmentLabel — Smarty365 DOM-TOM check code SH` (3 tests) :
- Refuse la génération DOM-TOM avec message listant les refs sans code SH
- Laisse passer si tous les produits DOM-TOM ont un code SH (items ligne par ligne construits)
- Skip la vérif pour FR / UE (pas de douane → pas de check code SH)

---

## Cleanup parcels de test

Le PATCH soft-delete est le seul moyen (le HTTP `DELETE` n'existe pas) :
```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"deletedAt":"2026-08-21T14:30:00Z"}' \
  https://www.smarty365.com/api/parcel/{id}
```
