# API eFashion Paris — Documentation

> **Statut** : 🚧 EN COURS DE REVERSE-ENGINEERING — chantier mai 2026.
> Endpoints :
> - **GraphQL** : `POST https://wapi.efashion-paris.com/graphql` (lectures + petites mutations)
> - **REST** : `https://wapi.efashion-paris.com/shootings/*` (workflow création/édition produits)
> - **REST** : `https://wapi.efashion-paris.com/api/upload-product-photo` + `/api/product-photos/batch` (photos)
> - **REST** : `https://wapi.efashion-paris.com/translate` + `/translate/detect` (traduction interne)
>
> Front vendeur : `https://wholesaler.efashion-paris.com`
> ID vendeur Beli & Jolie : **2017**
> Identifiants : `SiteConfig.efashion_email` / `efashion_password` (À CRÉER, chiffrés via `SENSITIVE_KEYS`)

⚠️ **Différences majeures avec PFS** :
- API **mixte** : GraphQL ET REST sur le même serveur — pas un seul protocole.
- Création produit = workflow « **shooting** » multi-étapes (pas une simple mutation `create`).
- **1 couleur = 1 "produit" côté eFashion** (un produit BJ avec 3 couleurs → 3 lignes côté eux, liées par `reference_base`).
- Modèle français : `id_produit`, `id_vendeur`, `id_couleur`, `id_declinaison`, `prix`, etc.

---

## 1. Auth — mutation `Login`

```graphql
mutation Login($email: String!, $password: String!, $rememberMe: Boolean!) {
  login(email: $email, password: $password, rememberMe: $rememberMe) {
    user { id_vendeur email nomContact nomBoutique siret tva mel }
    message
  }
}
```

**Réponse observée** :
```json
{"data":{"login":{"user":{"id_vendeur":2017,"email":"beliandjolie@gmail.com","nomContact":"CHEN","nomBoutique":"Beli & Jolie","siret":"43450618400036","tva":"43450618400036","mel":"1"},"message":"Connexion réussie"}}}
```

**Mécanisme de session** : pas de token dans la réponse JSON. Le serveur pose un **cookie httpOnly Secure** (filtré du HAR par Chrome pour la sécurité), réutilisé automatiquement par toutes les requêtes suivantes vers `wapi.efashion-paris.com`. Indices :
- `Access-Control-Allow-Credentials: true` côté serveur
- `Access-Control-Expose-Headers: Set-Cookie`
- `Origin: https://wholesaler.efashion-paris.com` requis côté client

→ **Côté Node.js, on devra utiliser un client HTTP qui maintient un cookie jar** entre requêtes (ex: `tough-cookie` + `node-fetch`, ou `axios` + `axios-cookiejar-support`).

❓ À déterminer : TTL du cookie ? Mécanisme de refresh ? Heartbeat nécessaire ?

---

## 2. Endpoint GraphQL — les opérations identifiées

### 2.1. Lectures

| Opération | Description | Variables clés |
|-----------|-------------|----------------|
| `me` / `GetVendeurGeneralInfo` | Info vendeur connecté | aucune |
| `totalProduitsVendeur(id_vendeur)` | Compte **TOUS** les produits-couleurs (tous statuts) | `id_vendeur:2017` → **18 783** |
| `productsPage(filter)` | Liste paginée des produits-couleurs avec filtres | `id_vendeur, take, skip, orderBy, orderDir, includePremel, premelFilter, reference?, statut?` |
| `ProduitStocks(id_produit)` | Stock détaillé d'un produit-couleur | `id_produit` |
| `categoriesTree(lang)` | Arbre catégories sur 3 niveaux | `lang:"fr"` |
| `provenances(lang)` | Pays d'origine | `lang:"fr"` |
| `GetVendeurMarquesByVendeur(id_vendeur)` | Marques du vendeur (BJ = 3228) | `id_vendeur` |
| `GetCollections` | Liste collections (saisons) | aucune |
| `CouleursByVendeur` / `GetCouleursByVendeur(id_vendeur)` | Couleurs validées par le vendeur | `id_vendeur` |
| `GetAllCouleursDefaut` | Bibliothèque officielle eFashion | aucune |
| `GetDeclinaison(id)` | Détail d'une déclinaison (= ensemble de tailles : `titre`, `d1_FR..d12_FR`) | `id` (ex: 11096 = "TU") |
| `GetDeclinaisonsByVendeur(id_vendeur)` | Déclinaisons disponibles | `id_vendeur` |
| `GetAllPacks` / `GetPacksByVendeur` | Packs (= quantité par pack, ex: 12744 = ?) | `id_vendeur` |
| `GetProductAcheteurUrl` | URL publique côté acheteur d'un produit | `id_produit` |
| `chiffreAffaireParJour` / `chiffreAffaireMois` / `Dashboard` | KPIs dashboard | (hors scope V1) |

### 2.2. Mutations

| Mutation | Effet | Variables |
|----------|-------|-----------|
| `Login` | Connexion (cookie de session) | `email, password, rememberMe` |
| `UpdateProduit(input)` | Modifier champs basiques + **visible** (ONLINE/OFFLINE) | `input{id_produit, visible?, prix?, poids?, ...}` |
| `UpsertProduitStock(id_produit, id_couleur, value, taille)` | Mise à jour stock pour 1 (couleur, taille) | retourne juste la valeur |
| `SaveProduitStocks(input)` | Mise à jour stock en **batch** | `input{id_produit, items:[{id_couleur, value, taille}]}` |
| `AddCouleurToVendeur(input)` | Ajouter une couleur (de la biblio officielle) au catalogue vendeur | `{id_vendeur, id_couleur}` |

❌ **Pas observé** : mutation `createProduit` directe. La création passe par le workflow shootings REST (voir §3).

---

## 3. Workflow CRÉATION d'un produit (système « shooting »)

eFashion organise la création autour d'un objet **`shooting`** (= séance photo / lot de produits). 2 options proposées :
- **Studio** : eFashion photographie pour vous (`melOption: "studio"`).
- **Upload** : vous fournissez vos propres photos (`melOption: "upload"`). ✅ **Confirmé par la cliente (mai 2026) : Beli & Jolie utilise toujours `melOption: "upload"` — option studio ignorée dans l'intégration V1.**

### Étape par étape (observée pour la création de `TESTPRODUIT7845`)

**1. Récupérer les référentiels nécessaires au formulaire** :
- `POST /shootings/get-reference-data` (vide) → `{marques, categories, sousCategories, collections, packs, declinaisons, couleurs, provenances, ...}`
- `POST /shootings/get-caracteristiques` body=`{idCategorie:"160102"}` → caractéristiques disponibles pour cette catégorie (ex: "Acier", "Or", "Plaqué or", etc.)
- `POST /shootings/get-composition-autocomplete` body=`{term:"A", idString:""}` → autocomplete matières
- `GET  /shootings/mel-draft` → contenu actuel du brouillon (peut être vide)

**2. (optionnel) Auto-traduction des descriptions** :
- `POST /translate/detect` body=`{text:"..."}` → langue source
- `POST /translate` body=`{text, sourceLang, targetLangs}` → traductions

**3. Vérifier que la référence n'existe pas déjà** :
- `POST /shootings/check-references-exists-batch` body=`{references:[{reference, venduPar}]}` → `[{reference, exists:false}]`

**4. Sauver le brouillon** :
- `POST /shootings/save-mel-draft` body :
```json
{
  "dataSource": "form",
  "references": [{
    "id": "1779353534590",            // ID client temporaire
    "reference": "TESTPRODUIT",
    "marque": "3228",                  // id_vendeur_marque (Beli & Jolie)
    "poids": "0.03",
    "categorie": "160102",             // id_categorie feuille
    "categorieLibelle": "Accessoires",
    "sousCategorieLibelle": "Bijoux",
    "sousSousCategorieLibelle": "Boucles d'oreilles",
    "venduPar": "couleurs",            // "couleurs" | "tailles"
    "collection": "3",                 // id_collection
    "paysOrigine": "1",                // id_provenance (1 = Chine)
    "taillePaquet": "11096",           // id_declinaison
    "quantitePaquet": "12744",         // id_pack
    "stock": "",
    "prix": "50",
    "prixReduit": "",
    "dateRemise": "2027-02-10",
    "pourcentageRemise": "2",
    "dimensions": "",
    "minimumCommande": "",
    "couleurs": [
      {"id":22, "nom":"Argent", "isMain":true},
      {"id":1590, "nom":"Bicolore", "isMain":false},
      // ...
    ],
    // + descriptions multilangues, compositions, caractéristiques, etc.
  }]
}
```
**Réponse** : `{success:true, productIds:[3664450, 3664451, 3664452, 3664453, 3664454]}` — **1 productId par couleur** (5 couleurs → 5 productIds), liés par `reference_base="TESTPRODUIT"`.

**5. Choisir le mode (upload soi-même OU studio)** :
- `POST /shootings/save-mel-choice` body :
```json
{
  "melOption": "upload",      // "upload" | "studio"
  "dataSource": "form",
  "shootAllColors": false,
  "references": [/* enrichi avec id base = "db-{productId}" */]
}
```
**Réponse** : `{success:true, shootings:[{id:194632, category:"16", totalPieces:5}]}` → un nouveau shooting est créé.

**6. Upload des photos** :
- `POST /api/upload-product-photo` (multipart) :
```
Content-Type: multipart/form-data; boundary=---...
photos: [fichier JPG]
productId: 3664454
```
**Réponse** : `{success:true, photos:["/uploads/products/2017/Produits/accueil/3664454-c.jpg"], nbPhotos:1}`.

**Naming convention photos** : `/uploads/products/{idVendeur}/Produits/accueil/{idProduit}-c.jpg` (et `-d.jpg`, `-g.jpg`, `-h.jpg`, `-b.jpg` pour les différents angles).

Plusieurs uploads possibles par productId. Format observé : JPEG. Acceptent probablement PNG aussi (à confirmer).

---

## 4. Workflow MODIFIER un produit déjà créé

### 4.1. Modification "complète" (champs + couleurs + descriptions + compositions)
- `PUT /shootings/product/{id_produit}` (REST) avec body complet :
```json
{
  "reference": "TESTPRODUIT7845",
  "idVendeurMarque": 3228,
  "poids": "0.5",
  "idCategorie": "160304",
  "venduPar": "tailles",
  "idCollection": "2",
  "idProvenance": "11",
  "idDeclinaison": 11096,
  "idPack": null,
  "prix": "75",
  "prixReduit": null,
  "couleurs": [{"id":22}, {"id":1590}, {"id":1412}, {"id":3}, {"id":69}, {"id":66}],
  "couleurPrincipaleId": 22,
  "compositions": [{"id":60, "localisationId":4, "percentage":100}],
  "caracteristiques": [],
  "descriptionFr": "Test edit description",
  "descriptionEn": "Test edit description",
  "descriptionIt": "...",
  "descriptionEs": "...",
  "descriptionZh": null,
  "stock": null,
  "dateRemise": "2027-02-10",
  "pourcentageRemise": 2
}
```
**Réponse** : `{success:true, message:"Produit modifié avec succès"}`.

### 4.2. Modification ciblée (champs basiques + visibility)
- GraphQL `mutation UpdateProduit({input:{id_produit, visible?, ...}})` → cf. §2.2.

### 4.3. Stock seul
- GraphQL `mutation UpsertProduitStock(id_produit, id_couleur, value, taille)` OU `mutation SaveProduitStocks(input)` pour le batch.

---

## 5. Workflow SUPPRIMER un produit

- `POST /shootings/product/{id_produit}/delete` (body vide).
- **Réponse** : `{success:true, message:"Produit(s) supprimé(s) avec succès"}`.

✅ **Test mai 2026 (suite session test exhaustive)** : c'est un **HARD DELETE**, pas un soft delete. Le produit-couleur disparaît complètement du listing — même avec `premelFilter:"tous"`, on ne le retrouve plus. Donc impossible de le « ressusciter » côté API. Pour réintroduire une couleur supprimée, il faut passer par la modification globale du produit (PUT avec la couleur dans `couleurs[]`), ce qui re-créera un nouveau `id_produit`.

⚠️ Conséquence pratique : ne pas confondre **suppression d'une couleur d'un produit** (= delete d'1 productId, laisse les autres couleurs vivantes) et **suppression d'un produit** (= delete de tous les productIds du même `reference_base`).

---

## 6. Le compte exact des produits — réponse à la question des 18 783

**Confirmation par observation** :

| Source | Valeur | Filtre |
|--------|--------|--------|
| `totalProduitsVendeur(id_vendeur:2017)` | **18 783** | aucun filtre — TOUS les produits-couleurs (tous statuts) |
| `productsPage(filter:{premelFilter:"en_ligne"}).total` | **9 291** | uniquement les produits-couleurs **en ligne** |

✅ **Conclusion** :
- Chez eFashion, **1 couleur = 1 ligne produit** (cf. §3 : `save-mel-draft` retourne 5 `productIds` pour 1 ref × 5 couleurs).
- Le **catalogue BJ ≈ 9 000 produits** → ≈ 9 000 « produits-couleurs en ligne » côté eFashion → cohérent avec **9 291** observés.
- Les **18 783 − 9 291 = 9 492** = produits-couleurs hors ligne (brouillons, archivés, supprimés en soft, etc.).
- ⚠️ Vocabulaire : la cliente parlait de « variantes » — chez eFashion ce ne sont pas des variantes au sens BJ (couleur+taille), mais des **« produits-couleurs »** (1 par couleur, peu importe les tailles).

→ **Pas de stock fantôme** à réconcilier. Stratégie de liaison V1 : matching par `reference_base` ou bouton « Lier manuellement » façon Ankorstore.

---

## 7. Modèle Product (champs renvoyés par `productsPage.items`)

```typescript
{
  id_produit: number,          // ID unique eFashion (1 par couleur)
  id_vendeur: number,          // 2017 pour BJ
  date_produit: ISO string,
  reference: string,           // "A2415-DORÉ" (incluant suffixe couleur)
  reference_base: string,      // "A2415" (sans suffixe — partagé entre les couleurs du même produit)
  marque: string,              // "Beli & Jolie"
  id_vendeur_marque: number,   // 3228
  collection: string,          // libellé "Toutes les saisons"
  id_collection: number,       // 3
  categorie: string,           // libellé "Boucles d'oreilles"
  id_categorie: number,        // 160102 (feuille de l'arbre)
  prix: number,                // 6.5 (€ TTC ? HT ? à vérifier)
  prixReduit: number | null,
  promotion: any,
  poids: number,               // kg (0.09 = 90g)
  visible: boolean,            // false = OFFLINE, true = ONLINE
  supprimer: boolean,          // soft delete
  id_couleur: number,          // 78 = Doré
  couleur: string,             // "Doré"
  stock_value: number | null,
  stock_renseigne: boolean,
  liaison: number,             // ID de groupement (= id_produit en général)
  vendu_par: "couleurs" | "tailles",
  id_pack: number,             // 12744
  id_declinaison: number,      // 11096 = TU
  id_provenance: number,       // 1 = Chine
  provenance: string,          // "Chine"
  premel: string,              // "0" ?
  nb_photos: number,
  id_shooting: number,         // 194374 (shooting d'origine)
  finalisation: string,        // "1"
  prestationValeur: any,
  dateFinalisation: ISO date,
  id_couleur_liee: number,
  main: boolean                // true = couleur principale du regroupement
}
```

---

## 8. Filtres `productsPage`

```typescript
{
  id_vendeur: number,                                    // OBLIGATOIRE
  take: number,                                          // pagination
  skip: number,
  orderBy: "dateCreation" | ...,
  orderDir: "ASC" | "DESC",
  includePremel: boolean,
  premelFilter: "en_ligne" | "brouillon" | "supprime" | ...,  // états observés à compléter
  reference: string,                                     // filtre par référence (partiel)
  statut: "EN_VENTE" | "HORS_LIGNE" | "RUPTURE"          // statut commercial
}
```

⚠️ Anomalie observée : `take:10` retourne **24 items** (et `take:100` → 199 items). Probablement parce que le serveur compte les "produits principaux" (`main:true`) mais retourne aussi les couleurs liées (`id_couleur_liee`). Pagination à valider avant de l'utiliser dans un loop.

---

## 9. Photos — endpoint séparé

### Récupérer les photos d'un lot de produits
- `GET /api/product-photos/batch?productIds=...` → `{photosByProduct: {id1: ["/uploads/..."], id2: [...]}}`
- URL relative au CDN eFashion. Préfixe complet à vérifier (`https://cdn.efashion-paris.com/...` ?).

### Uploader une photo
- `POST /api/upload-product-photo` (multipart, voir §3.6).

---

## 10. Référentiels (= annexes pour notre intégration)

| Réf | Source | Notes |
|-----|--------|-------|
| **Catégories** | `query categoriesTree(lang)` ou `POST /shootings/get-reference-data` (`categories` + `sousCategories`) | Arbre 3 niveaux. ID feuille obligatoire pour create. Ex: `160102` = Femme > Accessoires > Bijoux > Boucles d'oreilles |
| **Marques** | `GetVendeurMarquesByVendeur` ou `get-reference-data.marques` | BJ = `{id:3228, label:"Beli & Jolie", defaut:true}` |
| **Collections (= saisons)** | `GetCollections` ou `get-reference-data.collections` | Ex: `{id:3, label:"Toutes les saisons"}` |
| **Provenances (= pays origine)** | `GetProvenances(lang)` | Ex: `{id:1, libelle:"Chine"}`. **Pas un code ISO** — c'est un ID interne |
| **Couleurs (biblio officielle)** | `GetAllCouleursDefaut` | Master list — ex: `{id:22}=Argent, {id:78}=Doré, {id:1590}=Bicolore, {id:1412}=blanc/doré, {id:301}=...` |
| **Couleurs vendeur (déjà validées)** | `CouleursByVendeur(id_vendeur)` | Sous-ensemble validé par BJ |
| **Ajouter une couleur** | `AddCouleurToVendeur({id_vendeur, id_couleur})` | Promotion de la biblio vers le catalogue vendeur |
| **Déclinaisons (= tailles groupées)** | `GetDeclinaisonsByVendeur` ; détail via `GetDeclinaison(id)` | Ex: `id:11096` → `{titre:"TU", d1_FR:"TU"}` |
| **Packs (= quantité par paquet)** | `GetAllPacks` / `GetPacksByVendeur` | Ex: `id:12744` = ? (à inspecter) |
| **Compositions (matières)** | `POST /shootings/get-composition-autocomplete` body=`{term}` | Autocomplete. Ex: `{id:60, label:"?"}` (à valider) |
| **Caractéristiques** | `POST /shootings/get-caracteristiques` body=`{idCategorie}` | Spécifique à la catégorie. Ex: pour `160102` (Boucles d'oreilles) → "Acier", "Or", "Plaqué or", etc. |

→ **Côté BJ**, on aura besoin d'ajouter dans le modèle Prisma (équivalent des champs `pfs*` existants) :
```
Color.efashionColorId       Int?          // id_couleur (de la biblio eFashion)
Size.efashionDeclinaisonId  Int?          // id_declinaison (ensemble)
Size.efashionDeclinaisonField String?     // "d1_FR" .. "d12_FR" (champ exact)
Category.efashionCategorieId Int?         // id_categorie feuille
Country.efashionProvenanceId Int?         // id_provenance
Collection.efashionCollectionId Int?      // id_collection (saison)
Composition.efashionId       Int?
HsCode → non utilisé chez eFashion (à vérifier)
```

Pas de référentiel "famille" / "genre" comme chez PFS — eFashion utilise un arbre catégories à 3 niveaux qui contient déjà la hiérarchie genre > famille > catégorie.

---

## 11. Inventaire des fonctionnalités

| # | Fonction | Endpoint | Statut |
|---|----------|----------|--------|
| 1 | Connexion + session cookie | `mutation Login` (GraphQL) | ✅ Capturé |
| 2 | Info vendeur | `query me` | ✅ |
| 3 | Total produits | `query totalProduitsVendeur` | ✅ |
| 4 | Liste produits paginée | `query productsPage(filter)` | ✅ |
| 5 | Stock d'un produit | `query ProduitStocks(id_produit)` | ✅ |
| 6 | Lire tous les référentiels | `categoriesTree`, `provenances`, `GetCollections`, `GetVendeurMarquesByVendeur`, `GetCouleursByVendeur`, `GetAllCouleursDefaut`, `GetDeclinaisonsByVendeur`, `GetAllPacks`, `GetPacksByVendeur` | ✅ |
| 7 | Créer un produit (workflow shooting) | `get-reference-data` + `get-caracteristiques` + `get-composition-autocomplete` + `check-references-exists-batch` + `save-mel-draft` + `save-mel-choice` + `upload-product-photo` | ✅ |
| 8 | Modifier un produit (complet) | `PUT /shootings/product/{id}` | ✅ |
| 9 | Mettre online/offline | `mutation UpdateProduit({visible})` | ✅ |
| 10 | Mettre à jour stock (1 variante) | `mutation UpsertProduitStock` | ✅ |
| 11 | Mettre à jour stock (batch) | `mutation SaveProduitStocks` | ✅ |
| 12 | Supprimer un produit | `POST /shootings/product/{id}/delete` | ✅ |
| 13 | Ajouter une couleur au catalogue vendeur | `mutation AddCouleurToVendeur` | ✅ |
| 14 | Upload photo | `POST /api/upload-product-photo` (multipart) | ✅ |
| 15 | Lister les photos d'un produit | `GET /api/product-photos/batch` | ✅ |
| 16 | Lister les shootings | `GET /shootings/my-shootings` | ✅ |
| 17 | Détail d'un shooting | `GET /shootings/shooting/{id}` | ✅ |
| 18 | Traduction texte | `POST /translate/detect` + `POST /translate` | ✅ (option : on peut utiliser leur traducteur ou DeepL maison) |
| 19 | Lister commandes / acheteurs | (hors scope V1) | ❌ |

---

## 12. Synchronisation continue (resync / refresh / update)

Comme on n'a pas d'identifiant unique par variante visible côté API (à part `id_produit` qui correspond à **(produit, couleur)**), la stratégie sera :

### Mapping local ↔ eFashion
```
Product (BJ) ←→ N×eFashion produits (1 par couleur)
ProductColor (BJ) ←→ 1 eFashion produit (id_produit, id_couleur, id_pack, id_declinaison)
VariantSize (BJ) ←→ Stock entry chez eFashion (via taille string dans UpsertProduitStock)
```

Champs Prisma à ajouter :
```
Product.efashionReferenceBase   String?       // "A2415" (partagé entre couleurs)
Product.efashionLastSyncSnapshot Json?
ProductColor.efashionProductId  Int?          // 1 ID par couleur
```

### Diff snapshot (équivalent PFS)
- Stocker l'état envoyé à la dernière sync dans `Product.efashionLastSyncSnapshot`.
- Diff vs état cible → ne pousser que les changements (UpdateProduit pour visibilité + champs, UpsertProduitStock pour stock, etc.).
- Reset snapshot quand le produit est ré-importé from scratch.

### Force resync
Bouton ↻ comme pour PFS → renvoie tout en bloc, ignore le snapshot.

### Première publication
Workflow shooting complet (§3) — coûteux en appels (~10 requêtes), à grouper en batch si possible (`save-mel-draft` accepte un tableau `references[]`).

### Suppression locale → eFashion
Soft-delete chez eFashion via `POST /shootings/product/{id}/delete`. Pas de callback async observé → tout synchrone.

---

## 13. Plan d'intégration (V1)

```
lib/efashion-client.ts        # HTTP client avec cookie jar (tough-cookie + node-fetch)
lib/efashion-auth.ts          # login + heartbeat session
lib/efashion-api.ts           # queries (read) GraphQL
lib/efashion-api-write.ts     # mutations GraphQL
lib/efashion-shootings.ts     # workflow REST shootings (save-mel-draft, save-mel-choice, etc.)
lib/efashion-photos.ts        # upload + lecture photos
lib/efashion-publish.ts       # première publication via shooting
lib/efashion-update.ts        # mise à jour ciblée (diff snapshot)
lib/efashion-refresh.ts       # rebuild complet (créer nouveau + delete ancien)
lib/efashion-sync-diff.ts     # types + diffSnapshots()
lib/efashion-annexes.ts       # référentiels (cache 60min)

app/actions/admin/marketplace-publish.ts   # étendre {efashion: boolean}
app/actions/admin/marketplace-refresh.ts   # idem
app/actions/admin/marketplace-resync.ts    # idem
app/api/admin/efashion-publish|refresh|resync/route.ts

Schema Prisma — ajouter :
  Product.efashionReferenceBase  String?
  Product.efashionLastSyncSnapshot Json?
  ProductColor.efashionProductId Int?
  Color.efashionColorId         Int?
  Size.efashionDeclinaisonId    Int?
  Size.efashionDeclinaisonField String?  // d1_FR | d2_FR | ...
  Category.efashionCategorieId  Int?
  Country.efashionProvenanceId  Int?
  Collection.efashionCollectionId Int?
  Composition.efashionId        Int?
  HsCode → pas utilisé chez eFashion

UI :
  - 3ᵉ case « eFashion Paris » dans la modale Save produit
  - 3 badges marketplaces (PFS / Ankorstore / eFashion) côté liste produits + page modifier
  - Modale « Lier à un produit eFashion existant » (filet de sécurité comme Ankorstore)
  - Toggle kill switch dans Paramètres > Marketplaces
  - SiteConfig keys (à ajouter aux `SENSITIVE_KEYS` pour les credentials) :
    efashion_email, efashion_password, efashion_enabled,
    efashion_price_markup_type/value/rounding
```

**Markup prix** : ✅ **Confirmé cliente (mai 2026)** — même mécanique que PFS/Ankorstore. SiteConfig keys `efashion_price_markup_type/value/rounding` + UI Paramètres > Marketplaces > eFashion. Format observé : `prix` semble être un prix de gros HT (6,50 € pour une boucle d'oreille). À confirmer en testant un produit dont on connaît la marge attendue.

**Mode synchrone vs async** : tout est synchrone (pas de callback Ankorstore-style observé). Plus simple à intégrer.

**Mode prudent pour première création** : ✅ **Confirmé cliente (mai 2026)** — au Lot 4, le push de création passera d'abord sur **1 seul produit** (vérifié manuellement chez eFashion) avant d'activer le bouton pour le reste du catalogue. Filet anti-catastrophe.

---

## 14. Trous restants à combler

| # | Trou | Action |
|---|------|--------|
| 1 | TTL du cookie de session + refresh | Surveiller en prod / tester un long polling |
| 2 | Format prix : TTC ou HT ? | Demander à eFashion ou tester avec un produit dont on connaît le prix |
| 3 | Préfixe CDN photos (`https://...`) | Inspecter le HTML du front eFashion |
| 4 | Endpoints autorisés pour `melOption`, `premelFilter`, `statut` | Documenter au fur et à mesure |
| 5 | ~~Suppression hard vs soft~~ | ✅ **Résolu (mai 2026)** : c'est un **hard delete**. Cf. §5. |
| 6 | Limite d'appels par minute / RateLimit | Pas observé — à monitorer en prod |
| 7 | Webhooks entrants (commandes, retours) | Aucun observé — à confirmer auprès d'eFashion |
| 8 | ~~Format image accepté (JPEG/PNG/WebP)~~ | ✅ **Résolu (mai 2026)** : JPEG est OBLIGATOIRE. Test envoi WebP brut → eFashion l'accepte mais peut ne pas convertir correctement. **Toujours convertir en JPEG via sharp avant upload** (c'est ce que fait déjà `lib/efashion-photos.ts`). |
| 9 | Comportement pagination `productsPage` (take=10 → 24 items) | À comprendre avant d'écrire un loop full-catalog |
| 10 | Introspection GraphQL ? | Tester `{ __schema { types { name } } }` — si activé, gain énorme pour découvrir le reste du schéma |

---

## 15. Sécurité

- Identifiants à chiffrer en BDD via `lib/encryption.ts` (`SENSITIVE_KEYS += ["efashion_email", "efashion_password"]`).
- Mot de passe vendeur **présent en clair** dans les HAR de capture → conseil de **changer le mot de passe** une fois le chantier terminé. Ne jamais committer un HAR.
- Cookie de session à protéger côté serveur — pas exposé au client BJ.
- Origin `https://wholesaler.efashion-paris.com` requis côté CORS → on enverra `Origin: https://wholesaler.efashion-paris.com` depuis notre Node.js.

---

## 16. Historique des sessions de capture

| Date | Fichier | Couverture | Notes |
|------|---------|-----------|-------|
| 2026-05-21 (1) | `Downloads/wholesaler.efashion-paris.com.har` (118 Ko, 8 entries) | Login + dashboard | Insuffisant |
| 2026-05-21 (2) | Idem fichier remplacé (8.6 Mo, 315 entries) | Login + listing + filtrage + CRUD complet (create draft, upload photo, edit, delete) | **Base solide pour V1** |
| 2026-05-21 (3) | `Downloads/wholesaler.efashion-paris.com(2).har` (324 Ko, 27 entries) | Live edit description + compositions + caractéristiques + réorganisation/suppression photos | **Mutations + endpoints photo manquants identifiés** |
| 2026-05-21 (4) | `Downloads/couleur.har` (193 Ko, 4 entries) | Page bibliothèque couleurs | **API liste couleurs maîtres exposée (contrairement à ce que je pensais)** |
| 2026-05-21 (5) | `Downloads/provenance.har` (7 entries) | Page formulaire produit | **`get-reference-data` retourne TOUT en 1 requête** |

### Refonte annexes (mai 2026)

`lib/efashion-annexes.ts` utilise maintenant `/shootings/get-reference-data` comme source principale + 2 queries GraphQL pour la liste master des couleurs.
- **Avant** : 5 requêtes (categoriesTree, GetProvenances, GetCollections, GetDeclinaisonsByVendeur + N GetDeclinaison(id), GetAllCouleursDefaut + GetCouleursByVendeur)
- **Après** : **2 requêtes en parallèle** (`get-reference-data` REST + `allCouleursDefaut` GraphQL pour master colors + hex via `couleursByVendeur`)

**Bonus** : champs ajoutés à `EfashionAnnexes` :
- `packs: EfashionPack[]` — quantités de pack (1, 12…) avec id requis pour `id_pack` lors des shootings
- `compositions: Array<{id, label}>` — liste complète **pré-chargée** (190 items), en plus de l'autocomplete

**Lexique confirmé cliente (mai 2026)** :
- BJ « Saison » ↔ eFashion `collections` (id 1 = Printemps/Été, id 2 = Automne/Hiver, id 3 = Toutes les saisons)
- BJ « Pays » ↔ eFashion `provenances` (id 1 = Chine, id 22 = Albanie, etc.)

### Couleurs eFashion — la liste EST exposée (correction)

J'avais initialement dit que l'API n'exposait pas la liste master des couleurs. C'est faux :
- `query allCouleursDefaut` → liste maître complète (~milliers de couleurs, juste id + FR + EN, sans hex)
- `query couleursByVendeur(id_vendeur)` → sous-ensemble du catalogue vendeur, avec hex
- `mutation addCouleurToVendeur(id_vendeur, id_couleur)` → ajoute une couleur de la master au catalogue vendeur

L'EfashionMappingPicker color mode est maintenant un vrai picker avec swatches hex, recherche, suggestions par nom FR, et **ajout automatique au catalogue vendeur** quand on choisit une couleur pas encore activée.

### Nouvelles mutations GraphQL identifiées (live edit produit publié)

- `query produitDescription(id_produit)` → `{texte_fr, texte_uk, texte_it, texte_es, texte_zh, instructions, commentaires}` ⚠️ **`texte_uk` = anglais** (pas EN — différent du shooting `descriptionEn`)
- `mutation saveProduitDescription(input)` → écrit la description dans les 5 langues
- `query produitCompositions(id_produit, lang)` → liste compositions actuelles avec `id_composition_localisation` (4 = Produit)
- `mutation saveProduitCompositions(input)` → écrit la liste complète
- `query produitCaracteristiqueIds(id_produit)` → liste IDs caractéristiques
- `mutation updateProduitCaracteristiques(input{id_produit, id_categorie, ids_caracteristiques})` → écrit la liste
- `mutation updateProduit(input)` étendu avec : `reference_base`, `id_vendeur_marque`, `id_provenance`, `id_collection`, `id_declinaison`, `id_pack`, `id_categorie` (en plus de visible/prix/poids déjà connus)

### Nouveaux endpoints REST photo

- `GET /api/product-photos/{idProduit}` → liste photos d'un produit
- `POST /api/product-photos/reorder` body=`{productId, positions:["c","z-1",...]}` → réordonne. Suffixe `c` = principale, `z-N` = secondaires
- `POST /api/product-photo/delete` body=`{productId, filename}` → supprime une photo précise

→ Tous ces wrappers sont implémentés dans `lib/efashion-api-write.ts` et `lib/efashion-photos.ts`. La sync ciblée (Lot 3) peut maintenant pousser **descriptions/compositions/caractéristiques/photos** en plus de visible/prix/poids/stock, sans repasser par le lourd `PUT /shootings/product/{id}` (utilisé en pratique uniquement à la modification massive après création).

---

## 17. Avancement du chantier

### ✅ Lot 1 — Connexion + lecture (2026-05-21)

**Fichiers créés** :
- `lib/efashion-client.ts` — cookie jar in-memory + `efashionFetch()` + `efashionGraphql()`
- `lib/efashion-auth.ts` — `ensureEfashionSession()` + `testEfashionCredentials()`
- `lib/efashion-api.ts` — `efashionGetMe()` + `efashionGetTotalProducts()` + `efashionListProducts()` + `efashionGetConnectionStatus()`
- `__tests__/lib/efashion-client.test.ts` — 11 tests Vitest (parsing Set-Cookie, jar, CORS headers, GraphQL wrapper, expiry)

**Fichiers étendus** :
- `lib/encryption.ts` — `SENSITIVE_KEYS += "efashion_email" + "efashion_password"`
- `lib/cached-data.ts` — `getCachedEfashionCredentials()` + `getCachedHasEfashionConfig()` + `getCachedEfashionEnabled()`
- `app/actions/admin/site-config.ts` — `updateEfashionCredentials()` + `toggleEfashionEnabled()` + `validateEfashionCredentials()` + extension `MarketplaceMarkupSettings.efashion`
- `app/(admin)/admin/parametres/page.tsx` — chargement config eFashion dans `MarketplacesTab`
- `components/admin/settings/MarketplaceConfig.tsx` — 3ᵉ carte « eFashion Paris » avec toggle, email/password, bouton « Tester la connexion » (affiche le nom de la boutique + ID vendeur), markup prix HT, grid passé en `xl:grid-cols-3`

**Tests pour la cliente** :
1. Aller dans `/admin/parametres?tab=marketplaces` → la carte « eFashion Paris » apparaît à côté de PFS et Ankorstore.
2. Saisir email + mot de passe → cliquer **Tester la connexion** → toast vert « Bienvenue Beli & Jolie (vendeur n°2017) ».
3. Cliquer **Sauvegarder** → cache 5min côté serveur, identifiants chiffrés en BDD.
4. Toggle **Activer la sync eFashion** ON/OFF persiste après reload.
5. Le statut **Connecté** reste affiché après reload une fois les identifiants sauvés.

### ✅ Lot 2 — Liaison manuelle (2026-05-21)

**Schéma Prisma étendu** (à pousser : `npx prisma db push && npx prisma generate`) :
- `Product.efashionReferenceBase` (String?) + `Product.efashionLastSyncSnapshot` (Json?) + `Product.efashionLastRefreshedAt` (DateTime?) + index
- `ProductColor.efashionProductId` (Int?) + index
- `Color.efashionColorId` (Int?) — mapping biblio
- `Size.efashionDeclinaisonId` (Int?) + `Size.efashionDeclinaisonField` (String?) — déclinaison + champ d1_FR..d12_FR
- `Category.efashionCategorieId` (Int?) — id catégorie feuille
- `ManufacturingCountry.efashionProvenanceId` (Int?) — id provenance
- `Season.efashionCollectionId` (Int?)
- `Composition.efashionId` (Int?)
- Enum `MarketplaceJobTarget` += `EFASHION`
- `MarketplaceRefreshJob.efashionOutcome` (Json?)

**Server actions** : `app/actions/admin/efashion.ts`
- `previewEfashionMatchByReference(productId, referenceBase?)` → recherche les lignes eFashion correspondantes + pré-mapping auto par nom de couleur normalisé.
- `linkEfashionProductManually(productId, referenceBase, links[])` → écrit en BDD, reset snapshot pour forcer un full resync, remplit `Color.efashionColorId` au passage.
- `removeEfashionMatch(productId)` → délie tout côté local (n'appelle pas eFashion).

**UI** : `components/admin/products/LinkEfashionProductModal.tsx`
- Auto-chargement au montage avec la référence de base déduite du produit.
- Une dropdown par couleur locale, déduplication automatique (impossible d'assigner la même ligne eFashion 2 fois).
- Suggestions auto par matching insensible aux accents.

**Badges / boutons** dans `MarketplaceStatusButtons.tsx` :
- 3ᵉ section « eFashion Paris » : badge vert si lié, bouton lier, bouton délier, bouton resync ↻ (Lot 3).
- Modale de confirmation pour la resync.

### ✅ Lot 3 — Modifications ciblées (2026-05-21)

**Libs** :
- `lib/efashion-api-write.ts` : `updateProduit`, `upsertProduitStock`, `saveProduitStocks`, `addCouleurToVendeur`.
- `lib/efashion-sync-diff.ts` : snapshot + diff (champs `visible/prix/poids` + stock par taille).
- `lib/efashion-pricing.ts` : application du markup (équivalent PFS).
- `lib/efashion-update.ts` : orchestrateur. Construit le snapshot cible, diff vs `efashionLastSyncSnapshot`, applique le delta.

**Worker** : `lib/marketplace-queue-worker.ts` — branche `runEfashionJob` dans `processJob`.
**Queue** : `MarketplaceJobTarget` étendu, sérialiseur/désérialiseur mis à jour pour la nouvelle valeur "efashion".

### ✅ Lot 4 — Création complète (workflow shooting) (2026-05-21)

**Libs** :
- `lib/efashion-shootings.ts` : wrappers REST pour tous les endpoints `/shootings/*` (getReferenceData, getCaracteristiques, getCompositionAutocomplete, checkReferencesExist, saveMelDraft, saveMelChoice, putShootingProduct, deleteShootingProduct, listMyShootings).
- `lib/efashion-photos.ts` : upload multipart vers `/api/upload-product-photo` (lit le fichier depuis `public/uploads/...`).
- `lib/efashion-publish.ts` : orchestrateur 1ʳᵉ publication. **Validation préalable stricte** — si une couleur, taille, catégorie, pays, saison ou composition n'a pas son mapping eFashion, on échoue AVANT le 1er appel à eFashion avec la liste exhaustive de ce qu'il faut renseigner.

**Worker** : `runEfashionJob` dispatche entre `efashionPublishProduct` (si pas lié) et `efashionUpdateProductInPlace` (si déjà lié).

⚠️ **Pré-requis cliente avant test publish** :
- Renseigner manuellement les `efashion*Id` sur les bibliothèques (Color, Size, Category, ManufacturingCountry, Season, Composition).
  - **Color.efashionColorId** : se remplit automatiquement quand on lie un produit via Lot 2.
  - Les autres : à renseigner via Prisma Studio (`npx prisma studio`) ou par UI dédiée (pas implémentée dans ce lot).

### ✅ Lot 5 — Suppression (2026-05-21)

**Libs** :
- `lib/efashion-shootings.ts` : `deleteShootingProduct` (POST `/shootings/product/{id}/delete`).
- `app/actions/admin/marketplace-delete.ts` : `deleteProductsOnEfashion(items)` — boucle synchrone (eFashion n'a pas de callback).

**UI** : extension de `AdminProductsTable.tsx`
- Délégation candidates eFashion = toutes les `(productId, efashionProductId)` des couleurs liées.
- 3ᵉ checkbox « Supprimer aussi sur eFashion Paris » dans la modale de confirmation de delete (bulk + single).
- Toast résultat (succès complet, partiel, ou erreur).

### ✅ Lot 6 — UI mapping bibliothèques (2026-05-21)

**Lib & actions** :
- `lib/efashion-annexes.ts` : charge depuis l'API eFashion les listes maîtres (catégories arbre 3 niveaux, provenances, collections, déclinaisons + leurs champs d1..d12). Cache 1 h, tag `efashion-annexes`. Compositions : autocomplete uniquement (pas pré-chargée).
- `app/actions/admin/efashion-mappings.ts` : 6 server actions update + `loadEfashionAnnexes` + `searchEfashionCompositionsAction` + `refreshEfashionAnnexes`.

**Composant** : `components/admin/EfashionMappingControl.tsx`
- Un bouton + une modale unique réutilisée pour les 6 types d'entités.
- Mode `category` / `country` / `season` : liste filtrable plate (catégories aplaties en "Top > Parent > Feuille", seules les feuilles sont retenues).
- Mode `size` : déclinaison + champ (2 niveaux dans la même modale).
- Mode `composition` : autocomplete (tape 2-3 lettres).
- Mode `color` : input manuel (l'API eFashion n'expose pas la liste master — le mapping se fait automatiquement via la liaison produit du Lot 2).

**Intégration UI** : un nouveau bouton « eFashion : … » apparaît à côté de la colonne PFS dans :
- `/admin/categories` (3ᵉ colonne)
- `/admin/tailles` (à côté du sélecteur PFS)
- `/admin/pays` (3ᵉ colonne)
- `/admin/saisons` (3ᵉ colonne)
- `/admin/compositions` (3ᵉ colonne)

**Cache process-level** : 1 seul fetch des annexes pour tous les sélecteurs de la page (`ensureAnnexes()` partagé).

**Tests cliente** :
1. Allez dans `/admin/saisons` → vous verrez un bouton « eFashion : — » par ligne → cliquez → la modale charge la liste des collections eFashion → cliquez sur une → toast vert + le bouton devient vert avec l'ID.
2. Idem pour /admin/pays, /admin/categories, /admin/compositions (autocomplete), /admin/tailles (2 étapes : déclinaison puis taille).
3. Une fois 1 catégorie + 1 pays + 1 saison + 1 composition + 1 taille mappés sur le produit que vous testez → vous pourrez tester un publish from scratch (Lot 4) sans message d'erreur de mapping manquant.

### Récapitulatif des champs (rappel)

| Champ Prisma | Où le renseigner |
|-------|-----|
| `Color.efashionColorId` | Auto au Lot 2 (liaison produit) OU Couleurs > eFashion (bouton) |
| `Size.efashionDeclinaisonId` + `efashionDeclinaisonField` | Tailles > eFashion (bouton 2-étapes) |
| `Category.efashionCategorieId` | Catégories > eFashion (liste plate de feuilles) |
| `ManufacturingCountry.efashionProvenanceId` | Pays > eFashion (liste plate) |
| `Season.efashionCollectionId` | Saisons > eFashion (liste plate) |
| `Composition.efashionId` | Compositions > eFashion (autocomplete) |

---

## 18. Session de test exhaustive (mai 2026) — apprentissages et corrections

Cette section consolide ce qui a été découvert pendant une session de test end-to-end où on a appliqué toutes les opérations du workflow eFashion sur un seul produit (création → ajout/réorg/suppression de photos → changement de couleur principale → renommage → changement catégorie/poids/saison/pays/prix/déclinaison/composition → ajout de couleur → mise en rupture → suppression de couleur). Scripts de référence dans `scripts/efashion-test-*.ts`.

### 18.1. Bug corrigé : `dateRemise` plafonné par MySQL

**Symptôme** : `save-mel-draft` retournait `HTTP 400 ER_TRUNCATED_WRONG_VALUE: Incorrect datetime value: '2099-12-31 00:00:00.000' for column produits_remises.date_remise`.

**Cause** : `lib/efashion-publish.ts` envoyait `dateRemise: "2099-12-31"`. La colonne MySQL côté eFashion est en TIMESTAMP (range max = **2038-01-19**), donc toute date au-delà est rejetée.

**Fix appliqué** : remplacé par `"2037-12-31"` — placeholder « pas de remise » safe et lointain.

**Implication code de prod** : si on saisit un jour une vraie `dateRemise` côté UI BJ, il faudra valider que l'année ≤ 2037 avant d'envoyer à eFashion (sinon échec silencieux à la publication).

### 18.2. Faits validés

#### Création produit
- `melOption: "upload"` confirmé (option studio jamais utilisée).
- `save-mel-draft` retourne 1 `productId` par couleur — l'ordre du tableau `couleurs` correspond à l'ordre des `productIds` renvoyés (les uploads photo s'appuient là-dessus, voir `efashion-publish.ts`).
- Marque BJ : `id_vendeur_marque = 3228` (à hardcoder pour le compte vendeur 2017).
- L'API `/shootings/check-references-exists-batch` permet de prévalider une référence avant `save-mel-draft`.

#### Ajout d'une couleur après création
✅ **Découverte importante** : envoyer un `PUT /shootings/product/{id}` avec une **nouvelle couleur dans `couleurs[]`** crée **automatiquement** un nouveau `id_produit` pour cette couleur (avec son propre stock, ses propres photos, etc.). Pas besoin d'endpoint séparé « ajouter une couleur ».
- À chaque ajout de couleur via PUT → lire le listing via `productsPage` pour récupérer le nouvel `id_produit` (filtrer par `id_couleur` de la nouvelle couleur).

#### Renommage de référence
- `PUT /shootings/product/{id}` avec un nouveau `reference` propage le renommage à **toutes les couleurs liées** (même `reference_base`).
- eFashion ajoute automatiquement le suffixe couleur : `TEST-EF-X` → `TEST-EF-X-MOUTARDE`, `TEST-EF-X-TURQUOISE`, etc.

#### Quels champs sont « par groupe » vs « par couleur »
| Champ | Par groupe (1 PUT propage à tous) | Par couleur (1 PUT par id_produit) |
|---|---|---|
| `id_categorie` | ✅ | |
| `id_collection` (saison) | ✅ | |
| `id_provenance` (pays) | ✅ | |
| `id_declinaison` | ✅ | |
| `id_pack` | ✅ | |
| `prix` | ✅ | |
| `couleurs[]` | ✅ | |
| `couleurPrincipaleId` | ✅ | |
| `compositions[]` | ✅ | |
| `caracteristiques[]` | ✅ | |
| `descriptionFr/En/It/Es/Zh` | ✅ | |
| `dateRemise`, `pourcentageRemise` | ✅ | |
| **`poids`** | | ✅ **(propre à chaque id_produit !)** |
| **stock (par taille)** | | ✅ **(propre à chaque id_produit)** |
| **photos** | | ✅ **(propre à chaque id_produit)** |

→ **Conséquence pratique pour le worker de sync** : un seul `PUT` global suffit pour les champs « par groupe ». Pour `poids` et le stock, il faut **boucler sur les `id_produit` de chaque couleur**.

#### Composition Cuivre
- ID composition « CUIVRE » = **77** (utile pour les tests).

#### Description multilingue
- Le PUT `/shootings/product/{id}` accepte directement `descriptionFr/En/It/Es/Zh`.
- Pas besoin de passer par la mutation GraphQL `saveProduitDescription` quand on fait un PUT global (utilisée seulement pour des modifs ciblées hors PUT).

### 18.3. Photos — comportements observés

- **Upload** (`/api/upload-product-photo`) : multipart, accepte plusieurs photos en 1 requête. Toujours convertir WebP → JPEG via sharp avant envoi (eFashion attend du JPEG).
- **Numérotation** : 1ʳᵉ photo uploadée = `c.jpg` (principale), suivantes = `z-1.jpg`, `z-2.jpg`, etc.
- **Réorganisation** (`/api/product-photos/reorder`) : eFashion **ne renomme PAS les fichiers** — il échange leur contenu en interne. Le GET `/api/product-photos/{id}` continue à renvoyer la liste avec les mêmes suffixes (`c, z-1, z-2`) mais le visuel à chaque position change.
- **Suppression** (`/api/product-photo/delete`) : eFashion **renumérote automatiquement** les photos restantes après suppression. Si on supprime `c.jpg`, ce qui était `z-1.jpg` devient le nouveau `c.jpg`, et `z-2.jpg` devient `z-1.jpg`. Bonne info pour ne pas se reposer sur une numérotation stable.

### 18.4. Stocks — particularités

- `saveProduitStocks` et `upsertProduitStock` retournent **`boolean`** (pas la valeur). Les types dans `lib/efashion-api-write.ts` sont à corriger pour `upsertProduitStock` (déclaré `Promise<number | string>`, en réalité `Promise<boolean>`).
- **Source de vérité du stock** : `productsPage.items[].stock_value` + `stock_renseigne` (pas le shooting endpoint !).
- ⚠️ `/shootings/shooting/{id}` renvoie `couleurs_stocks[].tailleStocks[].stock = null` même quand le stock est explicitement à 0 ou positif. Ce champ n'est pas authoritative. **Ne jamais l'utiliser pour lire l'état du stock**.
- `stock_value = 0` + `stock_renseigne = true` = **rupture explicite** (différent de `stock_value = null` + `stock_renseigne = false` qui veut dire « stock pas renseigné », donc inconnu).
- Les stocks sont stockés **par (couleur, taille)** — il faut envoyer 1 entrée par taille de la déclinaison pour mettre une couleur entière en rupture.

### 18.5. Suppression d'une couleur

- `POST /shootings/product/{id_produit}/delete` supprime **uniquement le productId ciblé** (= 1 couleur). Les autres couleurs du `reference_base` restent vivantes.
- C'est un **hard delete**, le productId disparaît du listing même avec `premelFilter:"tous"`.
- Pour supprimer un produit entier multi-couleurs, il faut faire 1 `delete` par couleur.

### 18.6. Scripts de test disponibles

Tous ces scripts ont été utilisés pendant la session et restent dans `scripts/efashion-test-*.ts` pour servir de référence ou être réutilisés :

| Script | Action |
|---|---|
| `efashion-test-create.ts` | Crée un produit complet au hasard depuis les annexes |
| `efashion-test-upload-photos.ts` | Uploade N photos par couleur (WebP→JPEG via sharp) |
| `efashion-test-add-photo.ts` | Ajoute 1 photo de plus à une couleur existante |
| `efashion-test-swap-photos.ts` | Échange 2 positions de photos (test réordonnancement) |
| `efashion-test-delete-photo.ts` | Supprime 1 photo nommée |
| `efashion-test-set-main-color.ts` | Change la couleur principale (via PUT) |
| `efashion-test-rename-reference.ts` | Renomme la référence d'un produit |
| `efashion-test-change-category-weight.ts` | Change catégorie + poids d'une couleur |
| `efashion-test-set-outofstock.ts` | Met une couleur en rupture (stock=0 partout) |
| `efashion-test-mega-update.ts` | Modif groupée : saison, pays, prix, déclinaison, composition, ajout couleur, descriptions |
| `efashion-test-delete-color.ts` | Supprime 1 couleur d'un produit |
| `efashion-test-inspect.ts` | Lit l'état complet d'un produit (listing + photos par couleur) |
| `efashion-test-find-other.ts` | Liste tous les produits préfixés « TEST » du vendeur |
| `efashion-test-check-stock.ts` | Lit les stocks via l'endpoint shooting (rappel : non-authoritative) |
