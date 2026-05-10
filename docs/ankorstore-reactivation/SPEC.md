# Réactivation de l'intégration Ankorstore

**Date :** 2026-05-10
**Statut :** Design validé par l'utilisatrice, prêt pour planification

## Contexte

L'intégration Ankorstore a été retirée le 2026-05-02 (commit `c68fe7b`) pour ne pas bloquer la mise en production : tout le code, l'UI, les champs Prisma (`Product.ankorsProductId`, `ProductColor.ankorsVariantId`) et les clés `SiteConfig` (`ankors_*`, `ankorstore_*`) ont été supprimés. La doc API `docs/ankorstore-api.md` a été conservée. Pendant ce temps, PFS a beaucoup évolué : packs multi-couleurs (`PackColorLine`), snapshot diff (`Product.pfsLastSyncSnapshot`), file de progression partagée (`PfsRefreshContext` + `PfsRefreshWidget`), resynchro forcée, file d'attente avec modes `publish` / `refresh` / `resync`.

L'utilisatrice a beaucoup de produits déjà publiés chez Ankorstore (avec une autre version du site ou à la main). Ils doivent pouvoir être **rattachés** au catalogue actuel sans tout re-publier.

## Objectif

Réactiver complètement Ankorstore (push, update, refresh, delete, stock, matching) en miroir de l'UX et de l'architecture PFS d'aujourd'hui, en partageant la file de progression entre les deux marketplaces. Profiter de la réécriture pour corriger les bugs connus (notamment « Could not archive SKUs » au delete).

## Approche retenue

**Approche hybride dominée par la réécriture** (« B + petits éléments de C ») :

- **Réécrits à neuf**, en miroir des fichiers `lib/pfs-*.ts` actuels :
  - client API lecture, client API écriture, publish, refresh, update (avec snapshot diff), sync-diff, server actions, page admin, composants UI
- **Gardés de l'ancien code** (commit `c68fe7b`, récupérés via `git show`) :
  - `lib/ankorstore-auth.ts` — gestion OAuth2 client_credentials avec cache de jeton
  - `lib/ankorstore-match.ts` — extraction de référence / matching SKU

L'API Ankorstore et la doc n'ont pas changé en 8 jours, donc la couche bas niveau (auth + extraction de ref) n'a pas de raison d'être refaite. Tout ce qui touche à la logique métier ou à l'UI passe à la moulinette PFS-style.

## Périmètre

### Inclus

- Création / mise à jour incrémental / refresh complet de produits sur Ankorstore — déclenchés via la même modale au save / refresh que PFS (case à cocher Ankorstore dans la modale partagée). Le routing create vs update se fait à l'intérieur de la server action `publishProductToMarketplaces` selon que `ankorsProductId` existe ou pas.
- Suppression Ankorstore propagée automatiquement à `deleteProduct` / `bulkDeleteProducts` — **différence assumée par rapport à PFS** (PFS reste 100 % local au delete, par décision documentée dans CLAUDE.md). Justification : l'utilisatrice a explicitement demandé (c) que la suppression chez elle archive le produit chez Ankorstore.
- Stock envoyé uniquement via le flux update (donc au save quand la case Ankorstore est cochée), jamais en arrière-plan depuis le tableau rapide variantes.
- Page admin de matching `/admin/ankorstore` (matching automatique par SKU, validation manuelle des suggestions, bouton « Tout valider » avec confirmation).
- Bouton « Lier à un produit existant » sur la fiche produit (recherche dans le catalogue Ankorstore).
- Resynchro forcée par produit (icône ↻, identique à PFS, `forceFullSync: true`).
- Correctifs des bugs delete connus (retry + log clair sur « Could not archive SKUs »).
- Marges configurables : prix de gros + prix public conseillé séparés, avec arrondis (`none` / `up` / `down`).
- TVA par défaut configurable (20 % par défaut).
- Tests unitaires automatisés sur tous les modules métier.

### Exclus

- Sync stock en arrière-plan dès qu'on touche au stock dans le tableau rapide variantes (rejeté en faveur du sync au save)
- Webhook callback côté Ankorstore (la doc le permet, mais on reste sur du polling sync, comme PFS)
- Stripe Connect ou tout autre fournisseur Ankorstore — hors périmètre
- Migration des anciens snapshots depuis l'ancien code (tout sera reconstruit à la première sync)

## UX

### Modale au save / refresh produit

La modale qui apparaît au clic sur « Enregistrer » ou « Rafraîchir » contient désormais **deux cases à cocher** côte à côte :

- ☐ Publier sur **Paris Fashion Shop**
- ☐ Publier sur **Ankorstore**

Les deux cases sont indépendantes. Cocher l'une, l'autre ou les deux. Le widget bas-droite suit les deux flux et affiche par produit l'état de chaque marketplace (« PFS ✓ », « Ankorstore en cours… »).

### Liste produits `/admin/produits`

- À côté du badge PFS, **un nouveau badge Ankorstore** (vert si `ankorsProductId` non null, gris sinon).
- Le bouton « Rafraîchir » (ligne par ligne et bulk) propose les deux cases à cocher.

### Fiche produit `/admin/produits/[id]/modifier`

- Composant `MarketplaceStatusButtons` étendu : le badge vert/gris Ankorstore s'affiche à côté de celui PFS.
- Icône ↻ à côté du badge vert Ankorstore pour la resynchro forcée (identique au mécanisme PFS).
- Bouton **« Lier à un produit existant »** quand `ankorsProductId` est null et `hasAnkorstoreConfig` est true. Au clic, modale avec champ de recherche → appel API Ankorstore → liste de candidats → sélection → confirmation → l'`ankorsProductId` (et chaque `ankorsVariantId` par couleur) est rempli sans rien renvoyer.

### Sidebar admin

- Nouvelle entrée « Ankorstore » sous la rubrique Marketplaces (page `/admin/ankorstore`).

### Page `/admin/ankorstore` (matching de masse)

- Liste tous les produits du site **sans `ankorsProductId`**.
- Bouton « Lancer le matching automatique » → pour chaque produit, on appelle `lib/ankorstore-match.ts` qui cherche par référence/SKU dans le catalogue Ankorstore.
- Affichage en deux colonnes : le produit du site (gauche), le candidat Ankorstore suggéré (droite). Statut « Suggéré ».
- L'utilisatrice **confirme ou refuse chaque match individuellement**, avec aussi un bouton « Tout valider » pour les cas évidents (à utiliser à ses risques).
- Confirmation = remplit `ankorsProductId` + `ankorsVariantId` par couleur, sans push.
- Refus = ignore ce candidat (le produit reste « non lié » et passera par « Publier » plus tard).

### Paramètres > Marketplaces

Nouvelle carte Ankorstore à côté de PFS :

- **Activer la sync Ankorstore** (case à cocher → clé `ankors_enabled`)
- **Identifiants OAuth2** : `client_id` + `client_secret` (chiffrés via `lib/encryption.ts`, ajout aux `SENSITIVE_KEYS`)
- **Bouton « Tester la connexion »** → appel `lib/ankorstore-auth.ts` → ✓ Connecté ou ✗ message d'erreur
- **Marges prix de gros** : type (`percent` / `fixed` / `multiplier`), valeur, arrondi (`none` / `up` / `down`)
- **Marges prix public conseillé** : mêmes options, séparées
- **TVA par défaut** : nombre (20 par défaut)

### Widget de progression bas-droite

- Le `PfsRefreshContext` est renommé en `MarketplaceRefreshContext` (plus générique). Chaque tâche embarque un champ `marketplace: "pfs" | "ankorstore"`.
- Une tâche peut concerner les deux marketplaces simultanément (deux entrées dans la queue, traitées séquentiellement par produit pour éviter de saturer les API).
- Le widget affiche, par produit : `PFS : ✓` / `Ankorstore : en cours…` / `Ankorstore : ✗ erreur`. Couleurs cohérentes avec PFS.
- Fermeture impossible tant que toutes les tâches (PFS + Ankorstore) ne sont pas terminées.

## Données

### Ajouts au schéma Prisma

```
model Product {
  ...
  ankorsProductId        String?  @unique
  ankorsLastSyncSnapshot Json?
  ankorsLastRefreshedAt  DateTime?
  ...
}

model ProductColor {
  ...
  ankorsVariantId String?
  ...
}
```

Le snapshot Ankorstore stocke l'état envoyé à la dernière sync réussie : champs produit (titre, description, fabricant, made_in_country, vat_rate, currency), variantes (sku, options color/size, wholesalePrice, retailPrice, stockQuantity, isActive par `ankorsVariantId`), images (path par color/slot), statut. Reset à `Prisma.DbNull` quand `ankorsProductId` change (publish, refresh, fallback).

### Clés `SiteConfig` ajoutées (chiffrées si sensibles)

| Clé | Type | Chiffrée |
|-----|------|----------|
| `ankors_enabled` | bool (string `"true"`/`"false"`) | non |
| `ankors_client_id` | string | **oui** |
| `ankors_client_secret` | string | **oui** |
| `ankorstore_wholesale_markup_type` | enum string | non |
| `ankorstore_wholesale_markup_value` | number string | non |
| `ankorstore_wholesale_markup_rounding` | enum string | non |
| `ankorstore_retail_markup_type` | enum string | non |
| `ankorstore_retail_markup_value` | number string | non |
| `ankorstore_retail_markup_rounding` | enum string | non |
| `ankorstore_default_vat_rate` | number string | non |

Ajout des deux clés sensibles à `SENSITIVE_KEYS` dans `lib/encryption.ts`. Tag de cache : `ankors-config` / `ankorstore-pricing-config` (révoqué via `revalidateTag(tag, "default")` à chaque save).

## Architecture des fichiers

### Récupérés tels quels du commit `c68fe7b`

- `lib/ankorstore-auth.ts` — OAuth2 + cache de jeton (1h - 5min de marge)
- `lib/ankorstore-match.ts` — extraction de référence et matching SKU

### Réécrits à neuf

- `lib/ankorstore-api.ts` — client lecture (search, get product, list variants), aligné sur les conventions de `lib/pfs-api.ts`
- `lib/ankorstore-api-write.ts` — opérations d'écriture (push, update variants, update stock, delete) avec retry sur les erreurs transitoires (cible : « Could not archive SKUs »)
- `lib/ankorstore-publish.ts` — première publication (création + ajout variantes + upload images + start operation + poll)
- `lib/ankorstore-refresh.ts` — renouvellement complet (création nouveau + soft-delete ancien + remplacement IDs)
- `lib/ankorstore-update.ts` — mise à jour PATCH avec snapshot diff (équivalent `lib/pfs-update.ts`)
- `lib/ankorstore-sync-diff.ts` — types + `diffAnkorstoreSnapshots()`
- `lib/ankorstore-pricing.ts` — calculs de marge wholesale + retail (équivalent `lib/marketplace-pricing.ts` mais double prix)
- `app/actions/admin/ankorstore.ts` — server actions : `pushSingleProductToAnkorstore`, `linkProductToAnkorstore`, `unlinkProductFromAnkorstore`, `runAnkorstoreAutoMatch`, `confirmAnkorstoreMatch`, `removeAnkorstoreMatch`, `resyncProductOnAnkorstore`
- `app/api/admin/ankorstore-publish/route.ts` + `ankorstore-refresh/route.ts` + `ankorstore-resync/route.ts` — routes API consommées par la queue
- `app/(admin)/admin/ankorstore/page.tsx` — page de matching de masse
- `components/admin/ankorstore/AnkorstoreMatchingClient.tsx` — UI de matching (réécrite, conventions admin actuelles)
- `components/admin/ankorstore/LinkAnkorstoreProductModal.tsx` — modale de liaison sur la fiche produit
- `components/admin/settings/AnkorstoreSettings.tsx` — carte Paramètres
- Extension de `components/admin/products/PfsRefreshContext.tsx` → renommé `MarketplaceRefreshContext.tsx` avec champ `marketplace`
- Extension de `components/admin/products/PfsRefreshWidget.tsx` → `MarketplaceRefreshWidget.tsx` (affiche les deux marketplaces)
- Extension de `components/admin/products/MarketplaceStatusButtons.tsx` (ajout badge + icône resync Ankorstore)
- Extension de `components/admin/products/useRefreshMarketplaceDialog.ts` (case Ankorstore dans la modale)
- Extension de `app/actions/admin/marketplace-publish.ts` et `marketplace-refresh.ts` (acceptent `{ pfs, ankorstore }` au lieu de `{ pfs }` seul)

### Tests recréés (5 fichiers)

- `__tests__/lib/ankorstore-pricing.test.ts` — calculs marges wholesale + retail + arrondis
- `__tests__/lib/ankorstore-push-products.test.ts` — format JSON envoyé (titre, description, made_in_country ISO, variantes Unite + Pack par couleur)
- `__tests__/lib/ankorstore-refresh.test.ts` — scénario complet (création + soft-delete ancien)
- `__tests__/lib/ankorstore-description.test.ts` — formatage description (composition + ref)
- `__tests__/lib/ankorstore-update.test.ts` — **nouveau** : snapshot diff, n'envoie que ce qui a changé
- `__tests__/lib/ankorstore-delete-retry.test.ts` — **nouveau** : retry sur « Could not archive SKUs », log d'échec final clair
- (Optionnel) `e2e/ankorstore-sync.spec.ts` — Playwright e2e si on remet le test admin de bout en bout

## Flux fonctionnels

### Publier (première fois)

1. Save fiche produit → modale avec case Ankorstore cochée.
2. `useRefreshMarketplaceDialog` enqueue dans la file partagée avec `mode: "publish"`, `marketplace: "ankorstore"`.
3. Route API `POST /api/admin/ankorstore-publish` → `app/actions/admin/marketplace-publish.ts:publishProductToMarketplaces` → branche Ankorstore → `lib/ankorstore-publish.ts:ankorstorePublishProduct`.
4. Dans `ankorstorePublishProduct` : OAuth2 → create catalog operation (operationType `import`) → POST products → start operation → poll status → succeeded → enregistrement `ankorsProductId` + `ankorsVariantId` par couleur + snapshot initial.
5. Le widget affiche `Ankorstore : ✓`.

### Mettre à jour (incrémental)

1. Save fiche produit. Si produit complet et Ankorstore configuré → la modale propose la case « Publier sur Ankorstore » (même mécanique que PFS). L'utilisatrice **doit cocher la case** pour que la sync parte.
2. Enqueue dans la file partagée avec `mode: "publish"`, `marketplace: "ankorstore"`. Route API → `publishProductToMarketplaces({ pfs, ankorstore })`.
3. À l'intérieur de la server action, le routing se fait selon `ankorsProductId` :
   - Si `ankorsProductId` existant → `lib/ankorstore-update.ts:ankorstoreUpdateProductInPlace` (PATCH incrémental).
   - Sinon → `lib/ankorstore-publish.ts:ankorstorePublishProduct` (création).
   - Fallback : si l'update échoue (ID stale), reset des IDs et nouvelle création.
4. `ankorstoreUpdateProductInPlace` construit le snapshot cible, le compare à `ankorsLastSyncSnapshot`, génère un patch ciblé.
5. Skip product update si champs identiques. Patch des variantes modifiées uniquement. Upload des images dont le path a changé. Skip statut si inchangé.
6. Snapshot mis à jour en fin de sync.

**Conséquence assumée** (cohérente avec PFS d'aujourd'hui) : si l'utilisatrice oublie de cocher la case au save, la modification ne part pas chez Ankorstore. Pas d'auto-sync silencieuse.

### Rafraîchir

1. Bouton « Rafraîchir » → modale → case Ankorstore cochée.
2. Enqueue `mode: "refresh"`, `marketplace: "ankorstore"`.
3. `lib/ankorstore-refresh.ts:ankorstoreRefreshProduct` : crée un nouveau produit Ankorstore (avec ref temporaire), upload images, archive l'ancien (operationType `delete`), renomme le nouveau avec la vraie ref. Rollback si échec mi-parcours.
4. Remplace `ankorsProductId` + `ankorsVariantId`. Reset snapshot à `Prisma.DbNull`. Premier sync incrémental ultérieur fera la photo.

### Resynchro forcée (icône ↻)

1. Clic sur ↻ Ankorstore + confirmation → enqueue `mode: "resync"`, `marketplace: "ankorstore"`.
2. `ankorstoreUpdateProductInPlace(id, undefined, { skipRevalidation: true, forceFullSync: true })` → traite localement le snapshot comme `null` → diff complet → toutes les sections renvoyées.
3. `committedSnapshot` est initialisé sur le **vrai** snapshot précédent (préserve l'état connu en cas de crash partiel).
4. Pas de fallback automatique sur publish en cas d'échec : on retourne l'erreur.

### Supprimer

1. `app/actions/admin/products.ts:deleteProduct` ou `bulkDeleteProducts`.
2. Si `ankorsProductId` existe + `ankors_enabled` → appel `lib/ankorstore-api-write.ts:ankorstoreDeleteProduct` (3-step : create delete operation → add products → start → poll).
3. **Correctif bug « Could not archive SKUs »** : retry avec backoff exponentiel (3 essais : 1s, 4s, 16s). Si toujours échec, log d'erreur enrichi (SKUs concernés, état Ankorstore retourné) pour pouvoir investiguer ; suppression locale toujours effective.

### Stock

- Pas de sync silencieuse depuis le tableau rapide variantes (`updateVariantQuick`).
- Le stock part **uniquement** au save (via update incrémental, qui ne fire que si la case Ankorstore est cochée dans la modale) ou au refresh.
- Pas de re-introduction de l'ancien `triggerAnkorstoreSync` fire-and-forget : il avait été supprimé avec le reste du code et on ne le ramène pas, par cohérence avec PFS et avec la décision (b) de la brainstorming.

### Matching

1. Page `/admin/ankorstore` → liste produits sans `ankorsProductId`.
2. Bouton « Lancer le matching automatique » → pour chaque produit : `lib/ankorstore-match.ts:findCandidate(reference, name)` → appel `lib/ankorstore-api.ts:ankorstoreSearchProducts` par SKU.
3. Affichage : produit local | candidat suggéré | actions Confirmer / Refuser.
4. Bouton « Tout valider » pour les évidents (avec confirmation modale).
5. Confirmation : `confirmAnkorstoreMatch(productId, ankorstoreProductId)` → remplit `ankorsProductId` + `ankorsVariantId` par couleur (en mappant les variantes locales sur les variantes Ankorstore par SKU). **Pas d'appel API d'écriture.**
6. **Initialisation du snapshot** : à la confirmation du match, on calcule le snapshot Ankorstore comme si on venait de pousser le produit (mêmes valeurs que celles que `ankorstorePublishProduct` aurait envoyées) et on le stocke dans `ankorsLastSyncSnapshot`. Au prochain save coché Ankorstore, le diff sera vide → rien n'est envoyé. C'est seulement quand l'utilisatrice modifie quelque chose que la modification part chez Ankorstore.

**Hypothèse assumée** : à l'instant du match, le produit du site et le produit Ankorstore sont supposés alignés (c'est le sens même du « match »). Si ce n'est pas le cas, l'utilisatrice peut utiliser ↻ resync pour forcer un push complet aligné sur l'état du site.

## Erreurs et garde-fous

- **Kill switch** : `ankors_enabled = false` dans Paramètres → tous les flux Ankorstore sont court-circuités (pas d'enqueue, pas d'appel API). PFS reste totalement indépendant.
- **Logs préfixés** `[Ankorstore]` (équivalent `[PFS]`), exploitables via `pm2 logs`.
- **Retry** sur les erreurs transitoires (rate limit 429, archive SKUs, OAuth token rotation).
- **Snapshot null après publish/refresh** (comme PFS) : la sync suivante reconstruit la photo, pas de risque d'envoi partiel basé sur un snapshot invalide.
- **Validation au save** : si `ankors_enabled` mais identifiants vides → toast d'erreur explicite, blocage de la modale.

## Tests et validation

### Tests automatisés

Les 5 fichiers de tests d'origine sont recréés et adaptés à la nouvelle architecture. Deux nouveaux fichiers couvrent ce qui n'existait pas avant : le snapshot diff (`ankorstore-update.test.ts`) et le retry delete (`ankorstore-delete-retry.test.ts`). Tous tournent dans la suite Vitest standard, exécutée avant chaque déploiement.

### Parcours de validation manuelle (en local d'abord)

1. **Paramètres** — saisir identifiants OAuth2, cliquer « Tester la connexion », vérifier ✓.
2. **Publier nouveau produit** — créer dans `/admin/produits/nouveau`, cocher Ankorstore au save, suivre le widget, vérifier sur Ankorstore.
3. **Update incrémental** — modifier seulement le stock, vérifier dans le widget que seul le stock part (pas de re-upload images).
4. **Refresh** — déclencher ↻ resync, vérifier le snapshot mis à jour.
5. **Refresh complet** — bouton « Rafraîchir » + case Ankorstore, vérifier création nouveau + archivage ancien.
6. **Suppression** — supprimer un produit, vérifier l'archivage Ankorstore.
7. **Matching** — `/admin/ankorstore` → matching auto sur quelques produits déjà existants.

## Plan de déploiement

L'ordre des étapes minimise le risque de casser PFS :

1. **Schéma Prisma + paramètres** (champs + clés `SiteConfig` + UI Paramètres). Aucune action côté Ankorstore encore.
2. **Briques métier** (lib/, server actions) avec tests automatisés. Toujours invisible côté admin.
3. **Renommage `PfsRefreshContext` → `MarketplaceRefreshContext`** + extension du widget. PFS continue de fonctionner identiquement.
4. **Boutons et modales** sur fiche produit + liste produits. Première utilisabilité côté admin.
5. **Page de matching** `/admin/ankorstore` + bouton « Lier à un existant » sur fiche.
6. **Validation locale** (parcours manuel ci-dessus + tests automatisés verts).
7. **Push en prod** (commit + déploiement VPS classique).
8. **Matching de masse en prod** : l'utilisatrice lance le matching auto et confirme les candidats produit par produit. À partir de là, toute modification future part automatiquement chez Ankorstore.

Le matching de masse se fait **après** le déploiement prod pour éviter que les `ankorsProductId` matchés en local soient perdus au déploiement (la base prod ne les aurait pas).

## Mise à jour CLAUDE.md

Une fois le code en place, restaurer la section Ankorstore de `CLAUDE.md` qui avait été retirée le 2026-05-02 — adaptée à la nouvelle architecture (snapshot diff, file partagée, correctifs delete) et signalant que le module est de nouveau actif.
