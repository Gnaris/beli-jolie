# Microstore — Plan de reprise (session suivante)

> Rédigé le 2026-08-25 après une session marathon qui a livré : API native `/goods/add` + `/goods/update` + `/goods/disable` + `/goods/del`, delete variantes via `del_id`, CRUD attributs bibliothèque + couleurs (`/user/set_attr` + `/user/set_color`), refactor push produit, doc complète, refonte du parcours de connexion QR (fini le bookmarklet).

## Contexte

Beli & Jolie utilise Microstore (Dokkr) comme marketplace supplémentaire. Historiquement, le push se faisait via un CSV `/goods/import_v1` (upsert par référence, aucune gestion propre des variantes). Résultat : quand la cliente changeait une couleur d'un produit, l'ancienne restait côté Microstore → fiche avec des couleurs mélangées et des images fausses.

**Nuit du 24 au 25 août 2026** : reverse complet des vrais endpoints de l'appli mobile MC Gérant via HTTP Toolkit MCP. Découverte : chaque objet Microstore (produit, variante SKU, catégorie, marque, année, saison, composition, couleur) a un **ID numérique** exposé par l'API. Ces IDs permettent updates ciblés + `del_id` propre.

## Ce qui a été livré cette nuit

### Backend / lib
- `lib/microstore-goods-crud.ts` — 400 lignes, CRUD produit natif (add/get/update/disable/del + deleteVariants avec del_id auto)
- `lib/microstore-attributes.ts` — 340 lignes, CRUD génériques cat/brand/year/season + couleur + alias multilangue (pas de composition : envoyée en texte libre dans `remark_material`)
- `lib/microstore-products.ts` — **refactor complet**, plus de CSV, utilise goods-crud, auto-create attributs/couleurs manquants au push, persiste `microstoreProductId` + `microstoreVariantId` après chaque push

### Server actions
- `app/actions/admin/microstore-products.ts` — 2 nouvelles : `toggleMicrostoreProductDisabled`, `deleteProductFromMicrostore`
- `app/actions/admin/microstore-attributes.ts` — nouveau fichier, 8 fonctions CRUD attributs + couleurs

### UI
- `components/admin/products/MicrostoreStatusCard.tsx` — 2 nouveaux boutons ronds (👁‍🗨 masquer/afficher + 🗑 supprimer)
- `components/admin/settings/MicrostoreConnectCard.tsx` — remplacement du bookmarklet par un vrai flow QR compagnon (2 clics au lieu de 5 étapes)
- `components/admin/shared/MicrostoreAttributeSelect.tsx` — composant réutilisable prêt à être branché dans les 4 formulaires d'attributs BJ

### Prisma
- `Product.microstoreProductId Int?` + `@@unique(tenantId, microstoreProductId)`
- `ProductColor.microstoreVariantId Int?` + `@@index`
- `Color.microstoreColorId Int?` — pour mapping manuel (à brancher)
- `Category.microstoreCategoryId Int?` — idem
- `Season.microstoreSeasonId Int?` — idem
- `Composition.microstoreCompositionId Int?` — **colonne conservée mais inutilisée** : la composition est envoyée en texte libre dans `remark_material` sur le produit, pas comme attribut. Pas de mapping UI.

### Doc + tests + script
- `docs/microstore-api.md` — 3 nouvelles sections détaillées (§ 4.3-4.5), section 10 mise à jour, doc index enrichie
- `__tests__/lib/microstore-goods-crud.test.ts` — 12 tests (sérialisation form-urlencoded, del_id, mix create/preserve)
- `__tests__/lib/microstore-attributes.test.ts` — 7 tests (`buildCatOrder`)
- `__tests__/lib/microstore-products.test.ts` — 7 tests legacy CSV skippés + explication
- `scripts/backfill-microstore-goods-ids.ts` — retrouve les IDs Microstore des produits déjà poussés (dry-run par défaut, `--apply` pour écrire)

## Ce qu'il reste à faire (session suivante)

### Objectif de la session : mapping manuel + liaison produit Microstore

La cliente a demandé explicitement le **mapping MANUEL** (elle refuse le mapping automatique par nom uniquement) : dans chaque formulaire d'attribut BJ (couleur, catégorie, saison), elle veut un `<CustomSelect>` « Correspondance Microstore » où elle choisit l'ID Microstore équivalent. Les compositions BJ sont hors périmètre : elles ne sont pas un attribut natif Microstore, elles partent en texte libre dans `remark_material` sur le produit. De même, elle veut pouvoir **lier manuellement** un produit BJ à un produit Microstore existant en cherchant par référence.

### Tâche 1 — Brancher `<MicrostoreAttributeSelect>` dans les 3 formulaires BJ (~1h)

Le composant réutilisable existe déjà. Il reste à :

**A. `ColorEditorModal.tsx`** (`components/admin/couleurs/ColorEditorModal.tsx`)
- Étendre `ColorEditorEditMode` avec `microstoreColorId: number | null`
- Ajouter `microstoreColorId` en param de `onSave`
- Ajouter `<MicrostoreAttributeSelect kind="color" value={microstoreColorId} onChange={setMicrostoreColorId} />` après le champ PFS
- Modifier `updateColorDirect` (dans `app/actions/admin/colors.ts`) pour accepter et persister `microstoreColorId`
- Idem pour `createColorDirect` (création)
- Adapter le callsite (probablement `components/admin/couleurs/CouleursMasterDetail.tsx` ou équivalent)

**B. `CategoryEditorModal.tsx`** (via `components/admin/categories/CategoriesMasterDetail.tsx`)
- Même pattern avec `kind="category"` et `microstoreCategoryId`

**C. `SeasonEditorModal.tsx`** (via `components/admin/seasons/SeasonsMasterDetail.tsx`)
- Même pattern avec `kind="season"` et `microstoreSeasonId`

**Pattern à répliquer partout** :
```tsx
const [microstoreId, setMicrostoreId] = useState<number | null>(editMode?.microstoreColorId ?? null);
// … dans le form
<MicrostoreAttributeSelect kind="color" value={microstoreId} onChange={setMicrostoreId} />
// … dans onSave
await editMode.onSave(name, ..., microstoreId);
```

### Tâche 2 — Prioriser les mappings BDD sur le match par nom dans le push (~15 min)

Dans `lib/microstore-products.ts`, la fonction `ensureAttributeId` + `ensureColorId` matche actuellement par nom. Modifier pour :
1. Si `Color.microstoreColorId != null` → utiliser cet ID directement
2. Sinon → tenter le match par nom (comportement actuel)
3. Sinon → auto-create (comportement actuel)

Nécessite de fetcher les colonnes de mapping dans `loadExportProducts` ou de faire une requête Prisma dédiée au moment du push.

### Tâche 3 — Carte + modale « Lier à un produit Microstore existant » (~1h30)

**Nouveau composant** `components/admin/products/MicrostoreLinkingCard.tsx` (à créer sur le modèle de la partie « lien » de `MicrostoreStatusCard`) :
- Affiche `microstoreProductId` si présent (badge « Lié à MC #10929 »)
- Bouton « Lier manuellement » si pas encore lié → ouvre la modale
- Bouton « Délier » si déjà lié

**Nouvelle modale** `components/admin/products/LinkMicrostoreProductModal.tsx` :
- Champ recherche (par référence ou nom)
- Server action `searchMicrostoreProductsByRef(query)` qui utilise l'endpoint H5 `getMicrostoreGoodsByItemRef` déjà en place (dans `lib/microstore-picture-station.ts`)
- Liste des candidats trouvés (item_ref, nom, thumbnails)
- Bouton « Lier » qui persiste `Product.microstoreProductId` + `ProductColor.microstoreVariantId` via un matching des couleurs (comme dans le script backfill)

**Server action** `app/actions/admin/microstore-linking.ts` :
- `searchMicrostoreProductsByRef(query: string)` → utilise H5
- `linkMicrostoreProductManually(bjProductId: string, microstoreProductId: number)` → fetch les SKUs Microstore, matche par nom couleur, remplit BDD
- `unlinkMicrostoreProduct(bjProductId: string)` → reset les IDs (comme après un delete)

**Intégration** :
- Ajouter la carte dans `MarketplaceStatusButtons.tsx` (au-dessus ou à côté du `MicrostoreStatusCard` existant)
- Ou bien fusionner dans `MicrostoreStatusCard` (nouveau bouton « 🔗 Lier » si `microstoreProductId == null`)

### Tâche 4 — Tests + typecheck + rapport (~15 min)

- Vérifier que tous les tests unitaires existants passent
- Typecheck rapide sur les fichiers modifiés
- Rapport final à la cliente + demande de go pour merge sur master

## Blocages connus

### `prisma generate` verrouillé sur Windows
`npx prisma generate` bloque parfois sur `node_modules/.prisma/client/query_engine-windows.dll.node` verrouillé par un process Node (souvent le `npm run dev`). Solution : arrêter le dev server, relancer `prisma generate`, puis relancer le dev server. Alternative : utiliser `as never` dans les queries Prisma qui touchent aux nouveaux champs pour contourner temporairement.

### Migration prod
Le schema Prisma a 6 nouvelles colonnes (2 pour Product/ProductColor + 4 pour attributs BJ). Le workflow GitHub Actions applique auto `prisma db push` sur prod si `schema.prisma` change (voir `.github/workflows/deploy.yml`). **Attention** : `--accept-data-loss` n'est pas dans le workflow — vérifier que Prisma ne bloque pas sur les nouveaux `@@unique` composites.

### Backfill non exécuté sur prod
Le script `scripts/backfill-microstore-goods-ids.ts` doit être exécuté après le déploiement pour que tous les produits déjà poussés (via l'ancien CSV) récupèrent leur `microstoreProductId` + `microstoreVariantId`. Sans ça, chaque produit sera vu comme « non lié » et un futur push va soit RE-CREER (doublon côté Microstore) soit tomber sur du legacy CSV.

Séquence recommandée après deploy prod :
1. Re-scanner le QR Microstore depuis `/admin/parametres` (les tests de la nuit ont probablement invalidé le token stocké)
2. `ssh root@72.61.106.128 "cd /var/www/beliandjolie && npx tsx scripts/backfill-microstore-goods-ids.ts"` (dry-run)
3. Si stats OK → `npx tsx scripts/backfill-microstore-goods-ids.ts --apply`

## Comment reprendre en début de session

1. Se remettre le contexte en lisant ce fichier + `docs/microstore-api.md` (surtout § 4.3-4.5)
2. `git checkout feat/microstore-native-api` + `git pull`
3. `npm run dev` en local + scan QR sur `/admin/parametres` pour avoir un token
4. Attaquer **Tâche 1A (ColorEditorModal)** comme pattern de référence
5. Répliquer sur Category / Composition / Season
6. Puis Tâche 2 (refactor push priorités)
7. Puis Tâche 3 (carte + modale liaison produit) — le plus gros morceau
8. Rapport final + demande de merge master
