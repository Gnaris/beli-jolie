# API eFashion Paris - Documentation

> **Note**: Field names verified via GraphQL introspection (March 2026) **and real API testing (April 2026)**. Many names and types differ from original API docs.
> **IMPORTANT**: `productsPage` uses `FilterProduitInput!` (not separate args). `createProduit` only accepts 4 fields. Many mutations return `Boolean!` (no sub-selection).
> **TESTED**: Sections marked with (TESTED) have been verified by creating real products on the API.

> Base URL: `https://wapi.efashion-paris.com` | GraphQL: `https://wapi.efashion-paris.com/graphql`
> Frontend: `https://wholesaler.efashion-paris.com` | CDN shooting: `https://shooting.efashion-paris.com`
> Type: **GraphQL** (introspection ouverte) + REST (images/fichiers) | Auth: **Cookie-based** (Bearer token fallback)
> Env: `EFASHION_EMAIL`, `EFASHION_PASSWORD`

---

## 1. Auth — `mutation login`

```graphql
mutation {
  login(email: "...", password: "...", rememberMe: true) {
    user {
      id_vendeur
      email
      nomBoutique
      siret
      tva
      mel
      jetons
    }
    message
  }
}
```

**Cookie-based**: le serveur set un cookie HTTP-only de session. Toutes les requetes suivantes: `credentials: "include"`.
**Bearer fallback**: si un token est retourne, utiliser `Authorization: Bearer {token}` avec `credentials: "omit"`.

**Verifier session**: `query { me { id_vendeur email nomBoutique } }` ou `query { checkAuth() }`.
**Logout**: `mutation { logout() }`.

---

## 2. Lister produits — `query productsPage`

**Type du filtre** : `FilterProduitInput!` (un seul argument `filter`, tout est dedans y compris `skip`/`take`)

```graphql
query ($filter: FilterProduitInput!) {
  productsPage(filter: $filter) {
    items {
      id_produit
      id_vendeur
      date_produit
      reference
      reference_base
      marque
      collection
      categorie
      id_categorie
      prix
      promotion
      poids
      visible
      supprimer
      id_couleur
      couleur
      stock_value
      stock_renseigne
      liaison
      vendu_par              # "couleurs" | "assortiment"
      id_pack
      id_declinaison
      id_collection
      id_vendeur_marque
      id_provenance
      provenance
      prixReduit
      premel
      nb_photos
    }
    total
  }
}
# Variables:
# { "filter": { "id_vendeur": 2017, "skip": 0, "take": 50, "statut": "EN_VENTE", "orderBy": "dateModification", "orderDir": "DESC" } }
```

**ATTENTION** : `items` retourne des `ProduitListItem` (pas `Produit`). Les champs sont differents du detail produit.
**Pagination**: `skip` + `take` dans le filter (pas de page/per_page). Pas de `hasMore` — utiliser `total`.
**Statuts** (enum `StatutProduit`): `EN_VENTE`, `HORS_LIGNE`, `RUPTURE`, `TOUS`.
**vendu_par**: `"couleurs"` (=UNIT) ou `"assortiment"` (=PACK) — PAS "UNIT"/"PACK".

---

## 3. Detail produit — `query produit`

```graphql
query {
  produit(id: Int!) {
    id_produit
    reference
    reference_base
    id_categorie
    id_vendeur
    id_declinaison
    id_pack
    id_collection
    id_provenance
    vendu_par
    prix
    prixReduit
    poids
    visible
    supprimer
    selection
    main
    nb_photos
    qteMini
    dimension
    dateCreation
    dateModification
    premel
  }
}
```

---

## 4. Descriptions — `query produitDescription`

```graphql
query {
  produitDescription(id_produit: Int!) {
    id_produit
    texte_fr
    texte_uk
    instructions
    commentaires
  }
}
```

**Note**: Retourne un seul objet (pas un array par langue). `texte_fr` = description francaise, `texte_uk` = description anglaise.

---

## 5. Stocks — `query produitStocks`

```graphql
query {
  produitStocks(id_produit: Int!) {
    id_produit
    id_couleur
    taille
    value           # quantite en stock
  }
}
```

---

## 6. Compositions — `query produitCompositions`

```graphql
query {
  produitCompositions(id_produit: Int!, lang: "fr") {
    # Compositions materiaux du produit
  }
}
```

---

## 7. Couleurs produit — `query couleursProduitByProduitId`

```graphql
query {
  couleursProduitByProduitId(id_produit: Int!) {
    id_couleur_produit
    couleur {
      couleur_FR
      couleur_EN
      defaut
    }
    # Couleurs associees au produit
  }
}
```

**Note**: Retourne `id_couleur_produit` (pas `id_couleur`). Les infos couleur sont dans l'objet nested `couleur { couleur_FR couleur_EN defaut }` — pas de champs plats `nom`/`hex`/`image`.

**Couleurs vendeur** (toutes les couleurs du vendeur):
```graphql
query {
  couleursByVendeur(id_vendeur: Int!) {
    id_couleur
    nom
    hex
    image
  }
}
```

**Couleurs par defaut** (referentiel global):
```graphql
query { allCouleursDefaut() { id_couleur nom hex } }
```

---

## 8. Referentiels

### Categories (arbre)
```graphql
query { categoriesTree(lang: "fr") { id_categorie label children { id_categorie label } } }
```

**Note**: Le champ s'appelle `label` (pas `nom`) pour les noeuds de l'arbre de categories.

### Collections
```graphql
query { collections(lang: "fr") { id_collection nom } }
```

### Compositions master
```graphql
query { compositionsMaster(lang: "fr", search: "coton") { id nom } }
```

### Caracteristiques (par categorie)
```graphql
query { caracteristiques(lang: "fr", id_categorie: Int) { id nom valeurs } }
```

### Packs (grilles de tailles)
```graphql
query {
  packsByVendeur(id_vendeur: Int!) {
    id_pack
    titre
    p1 p2 p3 p4 p5 p6 p7 p8 p9 p10 p11 p12    # 12 slots de tailles
    vendeur { id_vendeur }
  }
}
```

### Declinaisons (gammes de tailles)
```graphql
query {
  declinaisonsByVendeur(idVendeur: Int!) {
    id_declinaison
    titre
    tailles
  }
}
```

---

## 9. Creer produit — `mutation createProduit` (TESTED)

**ATTENTION** : `CreateProduitInput` n'accepte que 4 champs ! Tous les autres (vendu_par, poids, visible, etc.) doivent etre sets via `updateProduit` apres creation.

```graphql
mutation CreateProduit($input: CreateProduitInput!) {
  createProduit(input: $input) {
    id_produit
    reference
  }
}
```

**Variables** :
```json
{
  "input": {
    "id_vendeur": 2017,
    "id_categorie": 160103,
    "reference": "MON-PRODUIT-DORE",
    "prix": 8.90
  }
}
```

> **PIEGE** : `createProduit` retourne `id_produit` en tant que **String** ! Il faut faire `parseInt(result.createProduit.id_produit, 10)` avant de l'utiliser dans d'autres mutations, sinon erreur `Int cannot represent non-integer value`.

### Procedure complete apres creation

```
1. createProduit           → obtenir id_produit (parseInt !)
2. updateProduit           → poids, vendu_par, visible, reference_base,
                             id_vendeur_marque, id_pack, id_declinaison,
                             id_collection, id_provenance, id_couleur_liee
3. updateProduitCouleursProduit → assigner la couleur
4. saveProduitStocks       → definir le stock par couleur/taille
5. saveProduitDescription  → description FR/EN
6. saveProduitCompositions → composition materiaux
7. POST /api/upload-product-photo → photo (REST)
```

---

## 10. Modifier produit — `mutation updateProduit` (TESTED)

```graphql
mutation UpdateProduit($input: UpdateProduitInput!) {
  updateProduit(input: $input) {
    id_produit
  }
}
```

**Variables** (tous les champs sauf `id_produit` sont optionnels) :
```json
{
  "input": {
    "id_produit": 3556146,
    "poids": 0.025,
    "vendu_par": "couleurs",
    "visible": true,
    "reference_base": "MON-PRODUIT",
    "id_vendeur_marque": 3228,
    "id_pack": 12744,
    "id_declinaison": 11096,
    "id_collection": 3,
    "id_provenance": 1,
    "id_couleur_liee": 3556146,
    "main": true
  }
}
```

**Champs acceptes** : `id_produit` (obligatoire), `id_categorie`, `id_declinaison`, `id_pack`, `id_collection`, `id_provenance`, `id_vendeur_marque`, `id_couleur_liee`, `reference`, `reference_base`, `vendu_par`, `prix`, `prixReduit`, `poids`, `visible`, `main`.

**Champs NON acceptes** : `liaison` (lecture seule), `qteMini` (lecture seule), `supprimer` (utiliser `softDeleteProduits`).

---

## 11. Descriptions produit — `mutation saveProduitDescription` (TESTED)

**Retourne `Boolean!`** — pas de sous-selection `{ success }`.

```graphql
mutation SaveProduitDescription($input: SaveProduitDescriptionInput!) {
  saveProduitDescription(input: $input)
}
```

**Variables** :
```json
{
  "input": {
    "id_produit": 3556146,
    "texte_fr": "Description francaise...",
    "texte_uk": "Description anglaise...",
    "instructions": "Instructions d'entretien...",
    "commentaires": "Notes internes..."
  }
}
```

> Le champ anglais s'appelle `texte_uk` (pas `texte_en`).

---

## 12. Stocks — `mutation saveProduitStocks` (TESTED)

```graphql
mutation SaveProduitStocks($input: SaveProduitStocksInput!) {
  saveProduitStocks(input: $input)
}
```

**Variables** :
```json
{
  "input": {
    "id_produit": 3556146,
    "items": [
      { "id_couleur": 78, "taille": "TU", "value": 60 }
    ]
  }
}
```

> **PIEGE** : le champ s'appelle **`items`** (PAS `stocks`). Utiliser `stocks` donne l'erreur : `Field "stocks" is not defined by type "SaveProduitStocksInput"`.

---

## 13. Compositions — `mutation saveProduitCompositions` (TESTED)

```graphql
mutation SaveProduitCompositions($input: SaveProduitCompositionsInput!) {
  saveProduitCompositions(input: $input)
}
```

**Variables** :
```json
{
  "input": {
    "id_produit": 3556146,
    "items": [
      {
        "id_composition": 64,
        "id_composition_localisation": 4,
        "value": 100
      }
    ]
  }
}
```

> **PIEGE** : le champ s'appelle **`items`** (PAS `compositions`). Meme pattern que les stocks.

Pour trouver les IDs de composition disponibles, lire ceux d'un produit existant :
```graphql
query {
  produitCompositions(id_produit: 3552861, lang: "fr") {
    id_composition           # ex: 64 (Acier)
    id_composition_localisation  # ex: 4 (famille: Produit)
    value                    # ex: 100 (pourcentage)
    famille                  # ex: "Produit"
    libelle                  # ex: "Acier"
  }
}
```

---

## 14. Couleurs produit — `mutation updateProduitCouleursProduit` (TESTED)

```graphql
mutation UpdateProduitCouleursProduit($input: UpdateProduitCouleursInput!) {
  updateProduitCouleursProduit(input: $input)
}
```

**Variables** :
```json
{
  "input": {
    "id_produit": 3556146,
    "ids_couleur_efashion": [78]
  }
}
```

> **PIEGE** : le champ s'appelle **`ids_couleur_efashion`** (PAS `couleurs`). Utiliser `couleurs` donne l'erreur : `Field "couleurs" is not defined by type "UpdateProduitCouleursInput"`.
> Cette mutation **remplace** toutes les couleurs du produit (pas un ajout).

---

## 15. Caracteristiques — `mutation updateProduitCaracteristiques`

```graphql
mutation {
  updateProduitCaracteristiques(input: {
    id_produit: Int!
    caracteristiques: [...]
  }) {
    success
  }
}
```

---

## 16. Promotions — `mutation updateProduitPromotion`

```graphql
mutation {
  updateProduitPromotion(input: {
    id_produit: Int!
    prixReduit: Float
    # Autres champs promo
  }) {
    success
  }
}
```

**Promo globale**:
```graphql
mutation {
  applyGlobalPromotion(id_vendeur: Int!, pourcentage: Float!, force: Boolean) {
    success
  }
}
```

---

## 17. Visibilite / Suppression — Mutations batch

**Toutes retournent `Boolean!`** — pas de sous-selection.

```graphql
# Activer/desactiver la visibilite
mutation { setProduitsVisible(ids: [Int!]!, visible: Boolean!) }

# Supprimer (soft delete)
mutation { softDeleteProduits(ids: [Int!]!) }

# Publier un brouillon
mutation { publishBrouillon(id_produit: Int!, id_vendeur: Int!) { success } }

# Dupliquer
mutation { duplicateProduit(id_produit: Int!) { id_produit } }

# Dupliquer avec nouvelle couleur
mutation { duplicateWithNewColor(idProduit: Int!, couleurId: Int!, couleurName: String!) { id_produit } }
```

---

## 18. Packs (grilles tailles) — CRUD

```graphql
# Creer
mutation { createPack(input: { id_vendeur: Int!, titre: String!, p1: String, p2: String, ... p12: String }) { id_pack } }

# Modifier
mutation { updatePack(input: { id_pack: Int!, titre: String, p1: String, ... }) { id_pack } }
```

---

## 19. Declinaisons (gammes tailles) — CRUD

```graphql
mutation { createDeclinaison(input: { idVendeur: Int!, titre: String!, tailles: [String!]! }) { id_declinaison } }
mutation { updateDeclinaison(input: { id_declinaison: Int!, titre: String, tailles: [String!] }) { id_declinaison } }
```

---

## 20. Commandes (Orders) — Lecture

```graphql
query {
  commandes(page: Int, limit: Int, filters: {
    statut: String
    dateFrom: String
    dateTo: String
    # Autres filtres
  }) {
    commandes {
      id_commande
      id_commande_name
      id_commande_groupe
      statut
      montantTotal
      montantApresRemise
      montantCA
      poids
      nb_colis
      dateCommande
      dateExpedition
      acheteur { id nom prenom email }
      lignes {
        id_produit
        reference
        prix
        quantites         # q1-q12 (quantites par taille)
        declinaisons      # d1-d12 (noms de tailles)
      }
      remises { type valeur }
      adresseLivraison { ... }
      adresseFacturation { ... }
    }
    total
  }
}

# Detail commande
query { commandeById(id: Int!) { ... } }
```

---

## 21. Images — REST Endpoints (TESTED)

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| POST | `/api/upload-product-photo` | `FormData` | Upload photo produit |
| GET | `/api/product-photos/{id}` | — | Lire les photos d'un produit |
| POST | `/api/upload-product-photos-bulk-zip` | `FormData` (ZIP file) | Upload bulk (ZIP) |
| POST | `/api/product-photo/delete` | JSON `{ id_produit, filename }` | Supprimer photo |
| POST | `/api/product-photo/rotate` | JSON `{ id_produit, filename, angle }` | Rotation photo |
| POST | `/api/product-photos/reorder` | JSON `{ id_produit, order: [...] }` | Reordonner photos |
| GET | `/api/product-photos/batch?ids=1,2,3` | — | Batch get photos |
| GET | `/api/product-photos/{id}/original/{filename}` | — | Photo originale |

Toutes les requetes REST: cookie auth (`Cookie: auth-token=<jwt>`).

### Upload photo (TESTED — PIEGES CRITIQUES)

```
POST https://wapi.efashion-paris.com/api/upload-product-photo
Cookie: auth-token=<jwt>
Content-Type: multipart/form-data

FormData:
  - "productId": "3556146"        ← CHAMP ID: "productId" (PAS "id_produit")
  - "photos": <fichier.jpg>       ← CHAMP FICHIER: "photos" (PAS "file")
```

**Reponse succes** (HTTP 201) :
```json
{
  "success": true,
  "message": "1 photo(s) uploadee(s) avec succes",
  "photos": ["/uploads/products/2017/Produits/accueil/3556146-c.jpg"],
  "nbPhotos": 1
}
```

**Reponse echec** (HTTP 201 aussi !) :
```json
{ "success": false, "message": "Erreur lors de l'upload: Identifiant produit invalide" }
```

> **PIEGES** :
> - Champ fichier = `"photos"` — utiliser `"file"` donne HTTP 400 `Unexpected field - file`
> - Champ ID = `"productId"` — utiliser `"id_produit"` donne HTTP 201 avec `success: false`
> - Le statut HTTP est **201 meme en cas d'echec** — toujours verifier `json.success`
> - Format accepte : **JPEG uniquement**
> - URL complete des photos : prefixer avec `https://wapi.efashion-paris.com`

### Exemple en code (TypeScript)

```typescript
const formData = new FormData();
formData.append("productId", String(productId));
formData.append("photos", new File([jpegBuffer], "photo.jpg", { type: "image/jpeg" }));

const res = await fetch("https://wapi.efashion-paris.com/api/upload-product-photo", {
  method: "POST",
  headers: { Cookie: authCookie },
  body: formData,
});

const json = await res.json();
if (!json.success) throw new Error(json.message); // Ne PAS se fier au status HTTP !
// json.photos[0] = "/uploads/products/2017/Produits/accueil/3556146-c.jpg"
```

### Lire les photos d'un produit (TESTED)

```
GET https://wapi.efashion-paris.com/api/product-photos/{id_produit}
Cookie: auth-token=<jwt>
```

**Reponse** :
```json
{ "success": true, "photos": ["/uploads/products/2017/...jpg"], "nbPhotos": 1 }
```

---

## 22. Autres REST Endpoints

### Facturation
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/upload-invoice` | Upload facture |
| GET | `/api/invoices/{vendeur}/{id}` | Telecharger facture |

### Lookbooks
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/upload-lookbook-banniere` | Upload banniere lookbook |
| POST | `/api/upload-lookbook-fiche` | Upload fiche lookbook |

### Images generales
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/upload-image` | Upload image generale |
| POST | `/api/delete-image` | Supprimer image |

### Google Places (proxy)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/places/autocomplete?input=...&types=address&components=country:fr&language=fr` | Autocomplete adresse |
| GET | `/api/places/details?place_id=...&fields=address_components&language=fr` | Detail adresse |

---

## 23. Shipping — `mutation generateLabelEasy`

```graphql
mutation {
  generateLabelEasy(input: {
    id_commande: Int!
    # Details colis, transporteur, etc.
  }) {
    trackingNumber
    labelUrl
  }
}
```

**Transporteurs supportes**: Chronopost, DHL, FedEx, UPS, GLS, DPD, GPX, La Poste, CEVA Logistics, Easy Express.

---

## 24. Acheteurs (Buyers)

```graphql
query { searchBuyers(term: String!) { id nom prenom email } }
query { blockedBuyers() { id nom prenom email } }
mutation { blockBuyer(input: { buyerId: Int!, reason: String }) { success } }
mutation { unblockBuyer(id: Int!) { success } }
```

---

## 25. Codes promo & Remises

```graphql
mutation { createCodePromo(input: { id_vendeur: Int!, code: String!, ... }) { id } }
mutation { updateCodePromo(input: { id: Int!, ... }) { id } }
mutation { createRemise(input: { ... }) { id } }
mutation { updateRemise(input: { ... }) { id } }
mutation { sendPromoEmail(input: { ... }) { success } }
```

---

## 26. Vendeur (Profil) — Mutations

```graphql
mutation { updateVendeur(input: { id_vendeur: Int!, nomBoutique: String, ... }) { id_vendeur } }
mutation { updateVendeurData(input: { id_vendeur: Int!, ... }) { id_vendeur } }
```

---

## 27. Shooting Service — REST

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/shootings/analyze-excel` | Analyser fichier Excel |
| POST | `/shootings/get-caracteristiques` | Caracteristiques par categorie |
| POST | `/shootings/get-reference-data` | Donnees reference |
| POST | `/shootings/get-composition-autocomplete` | Autocomplete composition |
| POST | `/shootings/save-mel-choice` | Sauver choix MEL |
| POST | `/shootings/save-mel-draft` | Sauver brouillon MEL |
| GET | `/shootings/mel-draft` | Recuperer brouillon |
| DELETE | `/shootings/mel-draft/{id}` | Supprimer brouillon |
| DELETE | `/shootings/mel-draft-by-reference/{ref}` | Supprimer par reference |
| DELETE | `/shootings/mel-drafts` | Supprimer tous brouillons |
| POST | `/shootings/check-references-exists-batch` | Verifier references |
| GET | `/shootings/my-shootings?page=&limit=` | Lister shootings |
| GET | `/shootings/shooting/{id}` | Detail shooting |
| GET | `/shootings/download-photos/{id}` | Telecharger photos |
| POST | `/shootings/product/{id}/delete` | Supprimer produit shooting |
| PUT | `/shootings/product/{id}` | Modifier produit shooting |

---

## 28. Admin eFashion — Mutations speciales

```graphql
mutation { adminEfpLogin(email: String!, password: String!) { token } }
mutation { adminEfpImpersonate(sellerId: Int!) { success } }
mutation { adminEfpClearImpersonation() { success } }
```

---

## 29. Liaison des variantes couleur (TESTED)

eFashion traite chaque couleur comme un **produit separe**. Un produit avec 3 couleurs (Dore, Argent, Noir) = **3 entrees `produit`** distinctes.

### Champs de liaison

| Champ | Lecture/Ecriture | Description |
|-------|-----------------|-------------|
| `liaison` | Lecture seule | ID du produit principal (dans `productsPage` items) |
| `id_couleur_liee` | Ecriture (`updateProduit`) | Definir le lien vers le produit principal |
| `reference_base` | Ecriture (`updateProduit`) | Reference commune (ex: `A2348` pour toutes les couleurs) |
| `main` | Ecriture (`updateProduit`) | `true` pour le produit principal |

### Procedure pour creer un produit multi-couleurs

```
1. Creer produit 1: ref="ABC-DORE"   → id=100 (principal)
2. Creer produit 2: ref="ABC-ARGENT" → id=101
3. Creer produit 3: ref="ABC-NOIR"   → id=102

4. Sur chaque produit: reference_base="ABC"
5. Sur produit 2: id_couleur_liee=100
6. Sur produit 3: id_couleur_liee=100
```

**Resultat** : les 3 produits auront `liaison: 100` dans le listing.

> **Note** : `liaison` n'est PAS un champ de `UpdateProduitInput`. Pour ecrire la liaison, utiliser `id_couleur_liee`.

---

## 30. IDs de reference — Beli & Jolie (TESTED)

### Vendeur et marque

| Attribut | ID | Valeur |
|----------|----|--------|
| `id_vendeur` | 2017 | Beli & Jolie |
| `id_vendeur_marque` | 3228 | Beli & Jolie |

### Attributs produit standard

| Attribut | ID | Valeur | Utilisation |
|----------|----|--------|-------------|
| `id_pack` | 12744 | Pack "1" → `[1,0,0,...,0]` | Produits vendus a l'unite |
| `id_declinaison` | 11096 | Grille de tailles par defaut | Taille unique (TU) |
| `id_collection` | 3 | Toutes les saisons | Saison |
| `id_provenance` | 1 | Chine | Pays d'origine |
| `id_composition` | 64 | Acier (`id_composition_localisation=4`) | Composition 100% |

### Categories principales

| Categorie | `id_categorie` |
|-----------|----------------|
| Bracelets | 160103 |
| Colliers | 160104 |
| Piercings | 160105 |
| Parures | 160109 |
| Pendentifs | 160110 |

### Couleurs courantes

| Couleur | `id_couleur` |
|---------|--------------|
| Argent | 22 |
| Cognac | 24 |
| Noir | 59 |
| Dore | 78 |
| Bleu roi | 92 |

---

## 31. Resume des pieges (TESTED)

| Mutation/Endpoint | Piege | Correct | Incorrect |
|-------------------|-------|---------|-----------|
| `createProduit` | Retourne `id_produit` en String | `parseInt(id, 10)` | Utiliser directement |
| `saveProduitStocks` | Nom du champ array | `items` | `stocks` |
| `saveProduitCompositions` | Nom du champ array | `items` | `compositions` |
| `updateProduitCouleursProduit` | Nom du champ couleurs | `ids_couleur_efashion` | `couleurs` |
| `updateProduit` | Liaison | `id_couleur_liee` | `liaison` |
| `declinaisonsByVendeur` | Nom du parametre | `idVendeur` (camelCase) | `id_vendeur` |
| Upload photo | Champ fichier | `photos` | `file` |
| Upload photo | Champ ID | `productId` | `id_produit` |
| Upload photo | Status HTTP | Verifier `json.success` | Se fier au status 201 |

---

## Differences majeures avec PFS

| Aspect | PFS | eFashion Paris |
|--------|-----|----------------|
| **Type API** | REST (JSON) | **GraphQL** + REST (images) |
| **Auth** | OAuth2 Bearer token | **Cookie session** (Bearer fallback) |
| **Base URL** | `wholesaler-api.parisfashionshops.com/api/v1` | `wapi.efashion-paris.com/graphql` |
| **Pagination** | `page` + `per_page` | **`skip` + `take`** |
| **IDs produit** | String UUID (`pro_xxx`) | **Int** (`id_produit`) |
| **Variants** | Endpoint dedie `/variants` | **Stocks + couleurs = queries separees** |
| **Images** | Multipart sur endpoint REST | **REST separe** (`/api/upload-product-photo`) |
| **Tailles** | Dans les variants | **Packs (12 slots)** ou **Declinaisons** |
| **Statut** | READY_FOR_SALE/DRAFT/ARCHIVED | **`visible` boolean** + `supprimer` |
| **Prix PACK** | `price_eur_ex_vat` par variant | **`prix` sur produit** |
| **Descriptions** | Inline dans produit (5 langues) | **Query separee** `produitDescription` |
| **Compositions** | Inline dans checkReference | **Query separee** `produitCompositions` |
| **Couleurs** | Reference string (GOLDEN, etc.) | **Int `id_couleur`** avec nom/hex |

---

## URLs externes

| URL | Usage |
|-----|-------|
| `https://wapi.efashion-paris.com/graphql` | API principale (GraphQL) |
| `https://wapi.efashion-paris.com/api/*` | REST (images, factures, etc.) |
| `https://wholesaler.efashion-paris.com` | Back-office vendeur (Vue 3 SPA) |
| `https://shooting.efashion-paris.com` | Service shooting photos |
| `https://www.efashion-paris.com` | Site public |
| `https://knowledge.efashion-paris.com/vendors` | Base de connaissances vendeurs |
| `https://landingpage.efashion-paris.com` | Landing pages / CGU |

---

## Notes techniques

- **Introspection GraphQL ouverte** : schema complet accessible sans auth via `{ __schema { types { name fields { name } } } }`
- **132 queries** et **150+ mutations** disponibles dans le schema
- **Paiement** : HiPay BEU avec gestion UBO (beneficiaire effectif)
- **Vendeur = Seller** : le systeme est organise autour du vendeur (`id_vendeur`), chaque vendeur a sa boutique
- **MEL** = Mise En Ligne (publication produit), workflow de preparation avant mise en vente
- **Premel** = Pre-mise en ligne (brouillon avant shooting/publication)
- **Jetons** = credits/tokens du vendeur pour les services eFashion
