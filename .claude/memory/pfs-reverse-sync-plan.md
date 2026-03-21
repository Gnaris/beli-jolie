---
name: PFS Reverse Sync - Plan & API Testing
description: Complete plan for BJ→PFS reverse sync system, all write endpoints tested and documented, pending user clarification on reference versioning (VS1/VS2/VS3)
type: project
---

## Contexte (2026-03-21)

L'utilisateur veut construire un **reverse sync BJ → PFS** (pousser les produits Beli Jolie vers Paris Fashion Shop).
Le sync PFS → BJ existe déjà et fonctionne.

## Phase 1 : Tests API — TERMINÉE

Tous les endpoints d'écriture PFS ont été testés et documentés dans `API_DOCUMENTATION.md` :

### Endpoints confirmés fonctionnels :
1. **POST** `/catalog/products` — créer un produit (`{ data: [...] }` array)
2. **PATCH** `/catalog/products/{id}` — modifier produit (`{ data: { ... } }` objet) — label, description, category, composition, country, season, **default_color**
3. **POST** `/catalog/products/{id}/variants` — créer variants ITEM + PACK
4. **PATCH** `/catalog/products/variants` — modifier variants avec **`variant_id`** (PAS `id`) — prix, stock, weight, discount_type, discount_value
5. **POST** `/catalog/products/{id}/image` — upload image (JPEG/PNG uniquement, pas WebP)
6. **PATCH** `/catalog/products/batch/updateStatus` — changer statut (NEW/DRAFT/READY_FOR_SALE/ARCHIVED/DELETED)
7. **PATCH** `/catalog/products/variants/batch/setAvailability` — batch enable/disable (`{ data: [{ id, enable }] }`)
8. **PATCH** `/catalog/products/variants/{variant_id}/setAvailability` — individuel (`{ enable: true|false }` sans wrapper data)
9. **DELETE** `/catalog/products/variants/{variant_id}` — supprimer variant
10. **GET** `/catalog/attributes/{type}` — référentiels (collections/9, categories/347, colors/142, compositions/114, countries/238, families/29, genders/4, sizes/673)

### Endpoints NON fonctionnels :
- **DELETE image** — crash 500
- **PATCH variants avec `id`** — retourne 200 mais `updated: 0` (utiliser `variant_id`)

### Produit de test :
- Référence: `T999VS1`
- ID PFS: `pro_57fc702bb74fef655d0200a54b4d`
- Statut: DRAFT
- Variants: ITEM GOLDEN + ITEM SILVER + PACK GOLDEN + PACK SILVER + PACK GOLDEN+SILVER

### Découvertes clés :
- PACK format plat : `packs: [{ color, size, qty }]` (pas de `sizes` imbriqué)
- `material_composition` doit être une string (pas array) — sinon 500
- Images : JPEG/PNG uniquement (WebP → 422)
- Prix PFS incluent 11% markup : `realPrice = Math.floor((pfsPrice / 1.11) * 10) / 10`
- Référence versioning : `A200VS1` → base `A200`, VS = numéro de version
- On ne peut pas supprimer un produit PFS et réutiliser la référence — il faut renommer d'abord

## Phase 2 : Reverse Sync — EN ATTENTE

### Spec validée par l'utilisateur :
1. Quand admin ouvre `/admin/produits/[id]` → vérification auto via `checkReference`
2. Produit n'existe pas sur PFS → bouton "Créer sur PFS"
3. Produit existe → comparaison complète + affichage des différences
4. Champs comparés : nom, catégorie, description, composition, variants (prix, stock, poids, type, packQty, taille, discount), images, statut, default_color
5. Status mapping : ONLINE↔READY_FOR_SALE, OFFLINE↔DRAFT, ARCHIVED↔ARCHIVED
6. Images toujours re-uploadées (WebP→JPEG)

### Propositions faites (en attente de validation) :
1. Mapping attributs BJ↔PFS via table `PfsMapping`
2. Mode preview avant push
3. Sync sélectif (choisir quoi synchroniser)
4. Historique des syncs
5. Bouton "Sync all" batch
6. Badge "PFS synced/outdated/missing" dans la liste produits

### Questions en attente :
1. Référence produit — comment gérer pour les produits créés sur BJ (pas de ref PFS) ?
2. Tous les produits ou seulement ceux importés de PFS ?
3. Prix : re-ajouter les 11% pour le reverse ?
4. Quelles propositions valider ?

### DERNIÈRE DEMANDE (avant pause) :
L'utilisateur veut faire une **"grosse modification sur son PFS"** liée au **versioning des références** (VS1/VS2/VS3). Il n'a pas encore précisé exactement quoi. Questions posées :
- Quel est l'objectif du versioning ?
- Pourquoi créer de nouvelles versions ?
- Quoi modifier concrètement (code sync, page admin, modèle de données, produits PFS) ?

**Why:** Le versioning est central — il impacte comment le reverse sync gère les références
**How to apply:** Reprendre cette discussion en posant les questions sur le versioning avant de coder

## Scripts de test créés :
- `scripts/test-pfs-patch.ts` — test PATCH variants avec variant_id
- `scripts/test-pfs-setavailability-variant.ts` — test setAvailability individuel
- `scripts/test-pfs-default-color.ts` — test default_color
- `scripts/test-pfs-attributes.ts` — test tous les référentiels
