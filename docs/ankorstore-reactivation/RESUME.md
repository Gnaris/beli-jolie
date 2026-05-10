# RESUME — Réactivation Ankorstore

> **Pour Claude :** Si l'utilisatrice te dit **« reprends le plan Ankorstore »** (ou variante : « continue Ankorstore », « on reprend Ankorstore »), lis ce fichier en entier, charge le plan complet `docs/ankorstore-reactivation/PLAN.md` (et au besoin `SPEC.md` à côté), puis enchaîne directement sur la **Phase 3 — Task 3.1** en utilisant la skill `superpowers:subagent-driven-development`.

**Date du dernier travail :** 2026-05-11
**Branche :** `master`
**Dernier commit poussé sur GitHub :** `975c150` — `test(ankorstore): format JSON envoyé pour UNIT, PACK mono et multi-couleurs`

---

## État global : 19 / 38 tâches terminées (≈ 50 %)

Toutes les Phases 1 et 2 sont terminées et **poussées sur GitHub**. Aucun déploiement en production. Tous les tests automatiques passent.

### ✅ Phase 1 — Schéma + paramètres (terminée)

| Task | Description | Commit |
|------|-------------|--------|
| 1.1 | Champs Prisma `ankorsProductId` / `ankorsLastSyncSnapshot` / `ankorsVariantId` + index | `f90ec32` |
| 1.2 | `SENSITIVE_KEYS` ajout `ankors_client_id` + `ankors_client_secret` | `a29ea64` |
| 1.3 | `getCachedAnkorstoreCredentials` / `HasAnkorstoreConfig` / `AnkorstoreEnabled` dans `lib/cached-data.ts` | `6a34d05` |
| 1.4 | Server actions `updateAnkorstoreCredentials` / `validateAnkorstoreCredentials` / `toggleAnkorstoreEnabled` + extension `updateMarketplaceMarkup` | `723efd7` + fix `79d427c` |
| 1.5 | Carte `MarketplaceConfig` Ankorstore (toggle + credentials + 2 marges + VAT) + page `/admin/parametres` | `dca8db6` |

### ✅ Phase 2 — Briques métier `lib/` + tests (terminée)

| Task | Description | Commit |
|------|-------------|--------|
| 2.1 | Restauration `lib/ankorstore-auth.ts` (OAuth2 + cache token) depuis `c68fe7b^` | `8b77378` |
| 2.2 | Restauration `lib/ankorstore-match.ts` (extraction ref + matching variantes) depuis `a33fcd1^` | `ea7c01a` |
| 2.3 | `lib/ankorstore-api.ts` — client lecture (search/get/list/findBySku) avec retry 401/429/5xx | `5f4870d` |
| 2.4 | `lib/ankorstore-pricing.ts` — wholesale + retail + VAT + helpers cents | `a526ab1` |
| 2.5 | Tests pricing (7/7 ✅) | `9e914ab` |
| 2.6 | `lib/ankorstore-sync-diff.ts` — types + `diffAnkorstoreSnapshots` + `diffIsEmpty` | `1343731` |
| 2.7 | Tests sync-diff (7/7 ✅) | `12c2a60` |
| 2.8 | `lib/ankorstore-api-write.ts` — opérations bulk + retry delete sur « Could not archive SKUs » | `324b228` + fix `c2ff146` |
| 2.9 | Tests delete-retry (3/3 ✅) | `5d56074` + fix `1cecc8c` |
| 2.10 | `lib/ankorstore-publish.ts` — première publication (operation import + variantes + images URL) | `2de2f0a` |
| 2.11 | `lib/ankorstore-description.ts` + tests (5/5 ✅) + branchement dans publish | `38ff815` |
| 2.12 | `lib/ankorstore-update.ts` — update incrémental basé sur snapshot diff + tests (6/6 ✅) | `2aa5ca0` |
| 2.13 | `lib/ankorstore-refresh.ts` — refresh complet + rollback + tests (6/6 ✅) | `83e26ac` |
| 2.14 | Tests `ankorstore-push-products.test.ts` — format JSON UNIT/PACK/multi-couleurs (5/5 ✅) | `975c150` |

---

## ⏳ Reste à faire : 19 tâches (Phases 3 → 9)

### Phase 3 — Renommage file partagée (4 tâches)
- **3.1** Renommer `PfsRefreshContext.tsx` → `MarketplaceRefreshContext.tsx` + champ `marketplace: "pfs"|"ankorstore"` + `ankorsOutcome`
- **3.2** Renommer `PfsRefreshWidget.tsx` → `MarketplaceRefreshWidget.tsx` + badge Ankorstore
- **3.3** Mettre à jour `app/(admin)/layout.tsx`
- **3.4** Mettre à jour tous les autres consommateurs (grep + remplacement, ajout `marketplace: "pfs"` aux entrées existantes)

⚠️ **Risque de régression PFS** : tester soigneusement après cette phase.

### Phase 4 — Server actions + routes API Ankorstore (5 tâches)
- **4.1** Étendre `marketplace-publish.ts` (branche Ankorstore avec kill switch via `getCachedAnkorstoreEnabled`)
- **4.2** Étendre `marketplace-refresh.ts` (branche Ankorstore)
- **4.3** Créer `resyncProductOnAnkorstore` dans `marketplace-resync.ts`
- **4.4** Créer 3 routes API : `ankorstore-publish`, `ankorstore-refresh`, `ankorstore-resync`
- **4.5** `app/actions/admin/ankorstore.ts` (matching) + extraire les helpers communs vers `lib/ankorstore-snapshot.ts` (les TODOs marqués dans publish/update/refresh)

### Phase 5 — UI fiche produit + sidebar (6 tâches)
- **5.1** `useRefreshMarketplaceDialog.ts` — 3e checkbox Ankorstore
- **5.2** `MarketplaceStatusButtons.tsx` — badge Ankorstore + ↻ resync + bouton « Lier à un existant »
- **5.3** `LinkAnkorstoreProductModal.tsx` + route `/api/admin/ankorstore-search`
- **5.4** Modale au save du formulaire produit — case Ankorstore
- **5.5** Liste `/admin/produits` — colonne badge Ankorstore
- **5.6** Sidebar admin — entrée « Ankorstore »

### Phase 6 — Page de matching `/admin/ankorstore` (2 tâches)
- **6.1** Page server-side
- **6.2** Composant client `AnkorstoreMatchingClient` (matching auto + UI confirmation)

### Phase 7 — Suppression locale propage à Ankorstore (1 tâche)
- **7.1** `deleteProduct` + `bulkDeleteProducts` appellent `ankorstoreDeleteProduct` quand `ankorsProductId` existe et `ankors_enabled`

### Phase 9 — Documentation (1 tâche)
- **9.1** Restaurer la section Ankorstore dans `CLAUDE.md`

(La Phase 8 est de la validation manuelle dans le site + déploiement prod, hors automatisation.)

---

## Dette technique connue (TODOs laissés dans le code)

À adresser dans la Phase 4.5 ou 5 :

1. **`lib/ankorstore-publish.ts`** : images envoyées comme URLs publiques (champ `images` du payload), pas d'upload per-variant. URL construite avec `process.env.NEXTAUTH_URL` (donc inutilisable en local sans tunnel).
2. **`lib/ankorstore-update.ts`** : flux simplifiés pour
   - nouvelles variantes (sans `ankorsVariantId`) → log warn
   - variantes retirées localement → log warn (pas d'endpoint Ankorstore pour delete une variante)
   - status-only changes → no-op (pas d'API directe)
   - images-only → best-effort via opération update
3. **`lib/ankorstore-refresh.ts`** : la restauration en cas de rollback (PATCH du `external_id`) utilise `ankorstorePollOperation` mais ignore son résultat → si la restauration plante côté Ankorstore, log warn manquant.
4. **Helpers dupliqués** entre publish.ts / update.ts / refresh.ts : `buildVariantSku`, `loadProductFull`, `buildAnkorstoreCatalogProductInput`. Marqués `// TODO Task 4.5: extract to lib/ankorstore-shared.ts`.

---

## Hypothèses prises (à valider en parcours réel sur Ankorstore)

1. **`external_id` mutable** via une opération `update` (utilisé pour le refresh — archivage de l'ancien produit en le renommant `${ref}-archived-${ts}`). Si Ankorstore le rejette, la fonction échoue proprement (pas de write DB).
2. **Statut `succeeded | partially_failed | failed`** lu depuis `GET /catalog/integrations/operations/{id}` (endpoint séparé du `/results`).
3. **Multi-couleurs PACK** : aplati en 1 variante avec `options.color` joint par "/" (ex: « Rouge/Bleu »). Pas d'endpoint Ankorstore explicite pour packs.
4. **VAT par défaut** : 20 % si non configurée.

---

## Comment reprendre — workflow type

Quand l'utilisatrice dit la phrase magique :

1. **Pull** depuis GitHub si nouvelle machine : `git pull origin master`
2. **Vérifier l'état** : `git log --oneline -5` → doit voir `975c150` au top
3. **Charger les outils** : invoque la skill `superpowers:subagent-driven-development`
4. **Charger le plan complet** : `docs/superpowers/plans/2026-05-10-ankorstore-reactivation.md` (Phase 3 onwards = lignes ~400+)
5. **Recréer la TaskList** dans le tracker (38 tâches dont les 19 premières sont terminées) — ou créer juste les 19 restantes en `pending`
6. **Dispatcher le premier subagent implementer pour Task 3.1** (renommage `PfsRefreshContext`) avec le brief complet du plan + sonnet (refacto multi-fichiers)

### Convention de modèle par task

- `haiku` : tâches mécaniques (renommages, badges, sidebar entry, restauration depuis git)
- `sonnet` : tâches de jugement (server actions, UI complexes, refacto, page matching)

### Workflow par task

1. Implementer subagent → DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
2. Reviewer combiné (spec + qualité) → APPROVED ou liste d'issues
3. Si issues → dispatcher fix subagent → re-review
4. Marquer task complete → next task

### Risques à surveiller en Phase 3

- Casser PFS (renommage massif). Tester en local après Task 3.4 :
  - Aller sur `/admin/produits`, faire un save sur un produit existant avec PFS coché
  - Le widget bas-droite doit afficher « PFS : ✓ » comme avant

### Quand pousser en prod

**Pas avant la fin complète** (Phase 9). L'utilisatrice teste d'abord en local le parcours complet (cf. Phase 8 du plan), puis déploiement VPS classique.

---

## Pour info — fichiers Ankorstore créés

```
lib/ankorstore-auth.ts              (158 lignes — restauré)
lib/ankorstore-match.ts             (252 lignes — restauré)
lib/ankorstore-api.ts               (272 lignes — neuf)
lib/ankorstore-api-write.ts         (~450 lignes — neuf, avec fix poll)
lib/ankorstore-pricing.ts           (57 lignes — neuf)
lib/ankorstore-sync-diff.ts         (169 lignes — neuf)
lib/ankorstore-publish.ts           (614 lignes — neuf)
lib/ankorstore-description.ts       (~30 lignes — neuf)
lib/ankorstore-update.ts            (~430 lignes — neuf)
lib/ankorstore-refresh.ts           (453 lignes — neuf)

__tests__/lib/ankorstore-pricing.test.ts          (7 tests ✅)
__tests__/lib/ankorstore-sync-diff.test.ts        (7 tests ✅)
__tests__/lib/ankorstore-delete-retry.test.ts     (3 tests ✅)
__tests__/lib/ankorstore-description.test.ts      (5 tests ✅)
__tests__/lib/ankorstore-update.test.ts           (6 tests ✅)
__tests__/lib/ankorstore-refresh.test.ts          (6 tests ✅)
__tests__/lib/ankorstore-push-products.test.ts    (5 tests ✅)
                                                   ────────────────
                                                   39 tests passants
```

**Schema Prisma** : 4 champs ajoutés (3 sur Product, 1 sur ProductColor) + 2 index. ⚠️ **`prisma db push` n'a pas été exécuté en local** (MySQL local pas démarré quand Phase 1 a tourné). À refaire au démarrage local OU au déploiement prod.

---

## Tester rapidement que tout est bien en place

```bash
# 1. Pull
git pull origin master
git log --oneline -1
# Doit montrer : 975c150 test(ankorstore): format JSON envoyé pour UNIT, PACK mono et multi-couleurs

# 2. Tests automatiques
npm test -- __tests__/lib/ankorstore-

# 3. TypeScript
npx tsc --noEmit | grep ankorstore
# Attendu : 0 erreur

# 4. (si MySQL local démarré) appliquer le schéma
npx prisma db push --skip-generate
npx prisma generate
```
