---
name: bon-de-commande
description: Use this skill when the user sends a Chinese purchase order Excel file (« bon de commande ») and wants it converted to Beli & Jolie's bulk-import Excel format. The skill (1) parses the PO, (2) separates « 返单 » (already-on-site) references into a list reported to the user, (3) asks the user to confirm any Chinese category/color labels not yet in the mapping table, (4) writes the final import Excel to C:/Users/Admin/Downloads/ named after the supplier (« import-A.xlsx », « import-ZC.xlsx »…), and (5) flags any missing required info before generation. Trigger phrases (FR) : « voici un bon de commande », « j'ai un bon de commande », « parse ce bon », « convertis le bon », plus tout message contenant une pièce jointe Excel en chinois venue de Downloads/. The user is non-technical, French-speaking, so address her like a client : announce the count of products / 返单 / unknowns before generating, never guess missing values, and learn the mapping over time by updating references/mapping.md as new categories/colors/suppliers are confirmed.
---

# Skill : bon-de-commande

## Contexte

La cliente reçoit régulièrement des **bons de commande de ses fournisseurs chinois** (Excel `.xlsx`). Chaque bon de commande contient des produits qu'elle veut **importer en masse** sur son site Beli & Jolie via l'écran d'import existant (`/admin/produits/importer`).

Le skill convertit ce bon de commande chinois → Excel d'import au bon format Beli & Jolie.

## Style de communication

**Toujours en français. Toujours non-technique.** La cliente n'est pas développeuse — pas de jargon (parser, JSON, schema…). Lui parler comme à une cliente :
- Lui dire combien de produits dans le bon, combien sont nouveaux, combien sont des **« 返单 » (déjà sur le site)**.
- Si elle doit valider quelque chose, lui poser une question claire en français.
- Tests = parcours dans le site (« ouvrez l'admin, allez dans Produits > Importer, glissez le fichier… »).

## Règle d'or — ne jamais deviner

Si un élément manque ou si une valeur chinoise n'est pas connue (catégorie, couleur, fournisseur), **toujours demander à la cliente** avant d'écrire le fichier final. Une fois confirmée, **mettre à jour `references/mapping.md`** pour ne plus poser la question.

---

## Paramètres

- **Dossier de sortie** : `C:/Users/Admin/Downloads/`
- **Format de nom** : `import-<FOURNISSEUR>.xlsx` (ex : `import-A.xlsx`, `import-ZC.xlsx`).
- **Mapping connu** : `.claude/skills/bon-de-commande/references/mapping.md`
- **Format Excel d'import** : `.claude/skills/bon-de-commande/references/format-import.md`
- **Parser** : `.claude/skills/bon-de-commande/scripts/parse-po.cjs`
- **Générateur Excel** : `.claude/skills/bon-de-commande/scripts/build-import.cjs`

---

## Workflow

### Étape 1 — Identifier le fichier de bon de commande

La cliente envoie un message avec un chemin vers un `.xlsx` (souvent `C:/Users/Admin/Downloads/X.xlsx`). Confirmer le chemin et vérifier l'existence du fichier.

### Étape 2 — Parser le bon de commande

```bash
node "C:/Users/Admin/Desktop/beli-jolie/.claude/skills/bon-de-commande/scripts/parse-po.cjs" "<chemin-bon.xlsx>" > "$TEMP/bdc-parsed.json"
```

Le parseur lit la première feuille et extrait :
- **品名** (nom chinois — sert de catégorie)
- **货号** (référence complète, ex : `A2493-448-280` → ref produit = `A2493`)
- **颜色** (couleur chinoise)
- **数量** (quantité = stock)
- **价格** (prix unitaire — **source de vérité**, ignorer le prix codé dans la référence)

Il sort un JSON avec : `supplier`, `fandan` (liste 返单), `products` (importables), `unknownCategories`, `unknownColors`, `issues`.

### Étape 3 — Communiquer le compte à la cliente

Lui dire en une phrase simple :
> J'ai lu le bon de commande. Il y a **X produits nouveaux** à importer et **Y références déjà présentes (返单)** qu'on va mettre de côté.

Puis lui lister les **références 返单** ligne par ligne :
> **Références déjà sur le site (à ignorer)** :
> - A2169 — boucles d'oreilles
> - A1867 — collier
> - A1922 — bague
> - …

### Étape 4 — Vérifier les valeurs inconnues

Si le JSON a des `unknownCategories` ou `unknownColors` (= valeurs chinoises non encore traduites dans `references/mapping.md`), lui poser **une seule question groupée** :

> Avant de générer le fichier, j'aurais besoin que vous me confirmiez quelques traductions :
>
> **Catégories nouvelles :**
> - 耳骨夹 (clip de cartilage) → quelle catégorie du site ?
> - 脚链 (chaîne de cheville) → Bracelets ? ou autre ?
>
> **Couleurs nouvelles :**
> - 白色 (blanc) → on crée la couleur « Blanc » ?
> - 胡兰 → c'est quoi cette couleur ?
> - 金+白 (bicolore doré + blanc) → on garde laquelle comme principale ?

Attendre ses réponses. **Mettre à jour `references/mapping.md`** au fur et à mesure.

### Étape 5 — Signaler les manques bloquants

Si après l'étape 4 il reste des `issues` (prix manquant, quantité manquante, aucune couleur déclarée), les lister à la cliente :

> ⚠️ Avant de générer, signalez-moi quoi faire pour ces produits :
> - A2580 : la couleur « blanc » n'a pas de prix dans le bon
> - …

Si elle dit « laisse tomber ce produit », l'exclure. Si elle donne le prix, le noter. Re-confirmer la liste finale.

### Étape 5b — Exclure les références déjà en BDD (LOCAL + PROD)

Le 返单 du fournisseur n'est **pas fiable** : il arrive que la cliente ait déjà ajouté manuellement certains produits sans qu'ils soient marqués 返单. Il faut donc **toujours** interroger la BDD du site (LOCAL et PROD) pour exclure les références qui y sont déjà.

```bash
# BDD locale
node ".claude/skills/bon-de-commande/scripts/find-existing-refs.cjs" "$TEMP/bdc-parsed.json" > "$TEMP/bdc-skip-local.json"

# BDD prod (via SSH sur le VPS Hostinger)
node ".claude/skills/bon-de-commande/scripts/find-existing-refs-prod.cjs" "$TEMP/bdc-parsed.json" > "$TEMP/bdc-skip-prod.json"

# Fusionner les deux listes dans bdc-skip.json
node -e "const a=JSON.parse(require('fs').readFileSync(process.env.TEMP+'/bdc-skip-local.json','utf-8'));const b=JSON.parse(require('fs').readFileSync(process.env.TEMP+'/bdc-skip-prod.json','utf-8'));require('fs').writeFileSync(process.env.TEMP+'/bdc-skip.json',JSON.stringify([...new Set([...a,...b])]))"
```

Si des refs sont remontées, le dire à la cliente :
> En plus des 23 références 返单, j'ai trouvé X autres produits déjà sur votre site (en prod) que j'exclus aussi : A1494, A2134…

### Étape 5c — Important : l'import ne fait PAS de quick-create automatique

L'écran d'import du site **n'auto-crée pas** les catégories, sous-catégories ou couleurs absentes — il les signale et propose une modale « créer rapidement » que l'admin doit cliquer une fois par entité manquante.

**Conséquence** : le générateur laisse volontairement les **sous-catégories vides** (elles sont facultatives) pour économiser des clics. Pour les catégories + couleurs (obligatoires), on liste à la cliente celles qu'elle devra créer dans l'UI avant l'import.

### Étape 6 — Préparer les données traduites

Construire un fichier `$TEMP/bdc-data.json` au format attendu par `build-import.cjs` :

```json
{
  "supplier": "A",
  "products": [
    {
      "reference": "A2493",
      "fullRef": "A2493-448-280",
      "category": "Boucles d'oreilles",
      "sub_categories": "",
      "variants": [
        { "color": "Doré",   "unit_price": 4.8, "stock": 184 },
        { "color": "Argent", "unit_price": 4.5, "stock": 70 }
      ]
    }
  ]
}
```

- **Nom / description** sont générés à partir de la catégorie (cf. `build-import.cjs`). La cliente pourra les améliorer plus tard via le skill `produits-nom`.
- **Composition / pays / saison / taille** = valeurs par défaut (« Acier inoxydable:100 » / « Chine » / « Toutes saisons » / « 0 »).

### Étape 7 — Générer le fichier Excel

Pipeline complet (traduction chinois → français + génération Excel + exclusion refs en BDD) :

```bash
node ".claude/skills/bon-de-commande/scripts/translate-and-build.cjs" \
  "$TEMP/bdc-parsed.json" \
  "C:/Users/Admin/Downloads/import-<FOURNISSEUR>.xlsx" \
  "$TEMP/bdc-skip.json"
```

Le fichier est écrit dans le dossier `Downloads` de la cliente, nommé d'après le fournisseur.

### Étape 8 — Bilan à la cliente

Lui annoncer le résultat en clair :

> ✅ Le fichier d'import est prêt : **import-A.xlsx** dans votre dossier Téléchargements.
> Il contient **142 produits** avec leurs couleurs et leurs prix.
>
> **Pour l'importer** : allez dans l'admin → Produits → bouton « Importer » → glissez le fichier.
>
> **À part** : voici les 23 références **déjà sur le site** qu'on a mises de côté :
> - A2169, A1867, A1922, …
>
> Si vous voulez ajuster un nom ou une description plus tard, utilisez la commande `/produits-nom`.

---

## Mise à jour du mapping

Chaque fois que la cliente **confirme** une traduction, mettre à jour `references/mapping.md` :
- Ajouter la ligne dans la table « connue » (catégorie ou couleur).
- Supprimer la ligne correspondante de la section « à confirmer ».
- Ajouter le fournisseur dans la table « Fournisseurs identifiés » si nouveau.

C'est ce qui fait que le skill s'améliore avec le temps : moins de questions à chaque nouveau bon de commande.

---

## Notes techniques importantes

### Structure du bon de commande chinois (observé sur A.xlsx)

- L'en-tête est à la ligne 2 : `图片 / 品名 / 货号 / 颜色 / 数量 / 价格 / 金额 / 箱号`.
- Une ligne avec `货号` rempli = nouveau produit. Les lignes suivantes avec seulement `颜色` rempli = couleurs additionnelles du **même** produit.
- Format de référence : `<REF>-<X>-<Y>` (ex : `A2493-448-280`). La référence produit côté site = `<REF>` (avant le premier `-`). Suffixe lettre (ex : `A2518A`) = variante d'ensemble — à garder.
- 返单 apparaît dans `品名` : `耳环\r\n返单` = « boucles d'oreilles \\ commande répétée ». Ces produits **existent déjà** sur le site → à exclure de l'import et lister à la cliente.
- D'autres feuilles ou blocs de colonnes vides peuvent exister : ignorer, ne lire que le premier bloc utile (`品名/货号/...`).

### Règle prix

- **Toujours utiliser la colonne `价格`** (5e colonne, généralement) — c'est le vrai prix actuel.
- Le prix codé dans la référence (ex : `-520` → 5.20€) est souvent obsolète et ne correspond pas à `价格`. Ne s'en servir que si `价格` est vide.

### Fournisseur

Déduit automatiquement des lettres au début de la référence (`A2493` → fournisseur `A`, `ZC1024` → `ZC`).
Si plusieurs préfixes différents dans le même bon de commande, prévenir la cliente et lui demander.

### Quand mettre à jour le skill

- Nouveau fournisseur (ex : `ZC`, `BJ`, …) → ajouter dans `mapping.md`.
- Nouvelle catégorie chinoise observée → ajouter dans `mapping.md` après confirmation.
- Nouvelle couleur chinoise observée → idem.
- Si la structure d'un bon est très différente (autre fournisseur), adapter `parse-po.cjs` et noter dans `mapping.md` la différence.
