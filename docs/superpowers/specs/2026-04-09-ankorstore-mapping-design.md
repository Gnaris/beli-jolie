# Ankorstore Product Mapping — Design Spec

**Date:** 2026-04-09
**Scope:** Mapping only (no sync). Store credentials, fetch Ankorstore catalog, auto-match by reference, manual review for exceptions.

---

## 1. Data Model

### Prisma Schema Changes

**Product** — new fields:
```prisma
ankorsProductId    String?    @unique   // UUID produit Ankorstore
ankorsMatchedAt    DateTime?            // Date du matching
```

**ProductColor** — new field:
```prisma
ankorsVariantId    String?    @unique   // UUID variante Ankorstore
```

### Credentials (SiteConfig key-value)

| Key | Chiffre | Description |
|-----|---------|-------------|
| `ankors_client_id` | Non | OAuth2 Application ID |
| `ankors_client_secret` | Oui | OAuth2 Application Secret |
| `ankors_enabled` | Non | Toggle "true"/"false" |

`ankors_client_secret` ajoute a `SENSITIVE_KEYS` dans `lib/encryption.ts`.

---

## 2. Auth & API Client

### `lib/ankorstore-auth.ts`

Meme pattern que `pfs-auth.ts` :
- `getAnkorstoreToken()` — POST `/oauth/token` (client_credentials grant), cache en memoire avec timestamp d'expiration, refresh 5 min avant expiry.
- `getAnkorstoreHeaders()` — retourne `{ Authorization: "Bearer ...", Accept: "application/vnd.api+json" }`.
- `invalidateAnkorstoreToken()` — vide le cache sur 401, retry une fois.
- Source credentials : `getCachedAnkorstoreCredentials()` depuis SiteConfig (dechiffre via `decryptIfSensitive`).

### `lib/ankorstore-api.ts`

Client read-only :
- `ankorstoreFetchAllProducts()` — pagination cursor-based (`page[limit]=50`, `page[after]=uuid`). Include `productVariant`. Retourne un tableau de tous les produits avec leurs variantes. ~180 requetes pour 9000 produits, ~1 min.
- `ankorstoreFetchProduct(id: string)` — detail d'un produit avec variantes.
- `ankorstoreSearchVariants(filter: { sku?: string, skuOrName?: string })` — `GET /product-variants?filter[sku]=XXX`.

Rate limits respectes : 600 req/min max. Retry avec exponential backoff sur 429/5xx.

---

## 3. Auto-Matching Logic

### `lib/ankorstore-match.ts`

**Extraction de reference depuis un produit Ankorstore :**

Strategie en cascade (premiere qui match gagne) :
1. **SKU variante** : format `{reference}_{couleur}` → split sur `_`, prendre le premier segment
2. **Nom produit** : format `{titre} - {reference}` → split sur ` - `, prendre le dernier segment
3. **Description** : chercher `Référence : {reference}` via regex

**Matching produit :**
```
Pour chaque produit Ankorstore :
  1. Extraire la reference (cascade ci-dessus)
  2. Chercher Product ou reference == extracted (case-insensitive, trimmed)
  3. Si match unique → status "matched"
  4. Si match multiple → status "ambiguous"
  5. Si pas de match ou pas de reference extraite → status "unmatched"
```

**Matching variantes (dans un produit deja matche) :**
```
Pour chaque variante Ankorstore du produit :
  1. Parser le SKU : {reference}_{couleur} → extraire la partie couleur
  2. Comparer (normalise) avec les noms de couleur des ProductColor du produit BJ
  3. Si match → associer ankorsVariantId
  4. Sinon → laisser non-associe (revue manuelle possible plus tard)
```

**Type de retour :**
```typescript
interface MatchResult {
  ankorstoreProductId: string;
  ankorstoreProductName: string;
  ankorstoreVariants: { id: string; sku: string; name: string }[];
  extractedReference: string | null;
  status: "matched" | "ambiguous" | "unmatched";
  bjProductId?: string;        // si matched
  bjProductName?: string;      // si matched
  variantMatches: {
    ankorstoreVariantId: string;
    productColorId: string | null;
  }[];
}

interface MatchReport {
  matched: number;
  ambiguous: number;
  unmatched: number;
  results: MatchResult[];
}
```

---

## 4. Server Actions

### `app/actions/admin/ankorstore.ts`

| Action | Description |
|--------|-------------|
| `updateAnkorstoreCredentials(clientId, clientSecret)` | Sauve dans SiteConfig (chiffre) |
| `validateAnkorstoreCredentials(clientId, clientSecret)` | Teste OAuth2 → `{ valid, error? }` |
| `toggleAnkorstoreEnabled(enabled)` | Toggle `ankors_enabled` |
| `runAnkorstoreAutoMatch()` | Fetch tout le catalogue Ankorstore, execute le matching, retourne `MatchReport` |
| `confirmAnkorstoreMatch(ankorstoreProductId, bjProductId)` | Associe manuellement un produit |
| `removeAnkorstoreMatch(bjProductId)` | Dissocie un produit (remet `ankorsProductId` a null) |
| `confirmAnkorstoreVariantMatch(ankorstoreVariantId, productColorId)` | Associe manuellement une variante |

Toutes les actions utilisent `requireAdmin()`.

---

## 5. Admin UI

### Route : `/admin/ankorstore`

Page dans `app/(admin)/admin/ankorstore/page.tsx` (server component) + `AnkorstoreMappingClient.tsx` (client component).

### Etat 1 — Non configure

Si pas de credentials :
- Formulaire : client_id + client_secret
- Bouton "Tester la connexion"
- Toggle activer/desactiver
- Style : meme layout que MarketplaceConfig.tsx (section PFS)

### Etat 2 — Dashboard (configure + active)

**Header stats :**
- Produits Ankorstore : X
- Matches : Y (badge-success)
- A revoir : Z (badge-warning)
- Non matches : W (badge-error)

**Bouton "Lancer le matching automatique"** → declenche `runAnkorstoreAutoMatch()`, affiche une barre de progression.

**3 onglets :**

**Onglet "Matches"** (default) :
- Tableau pagine (50/page) : nom BJ | reference | nom Ankorstore | variantes matchees | date | bouton "Dissocier"
- Barre de recherche par reference ou nom

**Onglet "A revoir"** :
- Liste des produits Ankorstore ambigus ou non-matches
- Chaque ligne : image + nom + SKU Ankorstore
- Champ de recherche produit BJ (recherche par reference ou nom)
- Bouton "Associer" pour confirmer le match

**Onglet "Non matches"** :
- Produits Ankorstore sans correspondance
- Meme interface que "A revoir" (recherche manuelle + association)

---

## 6. Navigation Admin

Ajouter un lien "Ankorstore" dans le menu admin sidebar, sous la section marketplace (a cote de PFS).

---

## 7. Hors scope (futur)

- Sync stock BJ → Ankorstore
- Sync prix BJ → Ankorstore
- Push SKU BJ vers Ankorstore (`PATCH /product-variants/{id}`)
- Reception commandes Ankorstore (webhooks)
- Sync images
- Creation de produits sur Ankorstore depuis BJ
