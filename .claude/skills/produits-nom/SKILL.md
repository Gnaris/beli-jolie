---
name: produits-nom
description: Use this skill whenever the user wants help renaming Beli & Jolie products. Opens a local web interface (http://localhost:3010) in TWO steps. Step 1 — "Indices" grid : the user briefly describes each product in free text (material, shape, keywords). She can skip products. Step 2 — When she clicks "Générer les propositions", she comes back in Claude Code and types "génère" — Claude then reads each image + hints and produces 3 name proposals + 3 description proposals + suggested sub-categories + tags. She picks, adjusts tags/sub-categories, and validations are saved locally. At the end, a single click pushes everything to the live site — the push updates only the database (name, description, tags, sub-categories, note) and raises "Synchro nécessaire" flags for marketplaces already linked to each product, but does NOT push directly to PFS / Ankorstore / eFashion. If she clicks "Aucun ne va" + writes a comment, the page asks her to come back in Claude Code and type "regénère" — Claude regenerates the 3 proposals based on her comment + the original hint + re-reading the image. Trigger phrases (FR) - (a) NEW SESSION - "produits-nom", "nouveau lot de noms", "lance les noms", "renommer des produits", "donne-moi un lot" ; (b) GENERATE PROPOSALS after hints - "génère", "vas-y", "lance la génération", "analyse maintenant" ; (c) REGEN one product - "regénère", "refais ces propositions" ; (d) STATUS - "où on en est", "combien de produits traités" ; (e) PUSH follow-up - "où en est l'envoi". The user is non-technical, French-speaking, and manages ~9000 stainless steel jewelry products being renamed progressively across many sessions, sometimes from different PCs.
---

# Skill : produits-nom

## Contexte

La cliente dirige **Beli & Jolie**, un site B2B de vente en gros de bijoux en acier inoxydable. Elle a **~9 000 produits** dont les noms/descriptions actuels sont génériques. Elle veut renommer **chaque produit** avec un nom + description **courts, factuels, basés sur ce qu'on voit** sur la photo (pas de couleur, pas de mots marketing).

Ce travail s'étale sur plusieurs sessions et possiblement plusieurs PC. Le champ `Product.note` en base de données fait office de marqueur : un produit dont la note contient « Complété par l'IA » ne sera plus reproposé dans les lots suivants.

## Workflow en 2 temps (nouveau)

La cliente s'est rendue compte que quand je propose « à froid » sur juste l'image, je cite parfois des choses qui n'existent pas sur le produit (mauvaise matière, motif imaginé). Pour éviter ça, la session est maintenant découpée en **2 phases** :

1. **Phase « Indices »** (`phase: "collecting_hints"`) — la cliente ouvre localhost et voit une grille avec **une carte par produit** (photo + zone de texte libre). Elle tape rapidement des mots-clés (matière, forme, motif principal, particularités). Vide = elle n'a rien à ajouter, je génère à froid pour ce produit.
2. **Phase « Génération »** (`phase: "awaiting_generation"` puis `"validating"`) — quand elle clique « Générer les propositions », elle revient dans Claude Code et tape `génère`. Je lis chaque image + ses indices, puis je remplis les 3 noms / 3 descriptions / sous-catégories / tags par produit. La page bascule toute seule en mode validation (celle qu'elle connaît).

Le reste du flow (validation produit par produit, regen ponctuelle, push final) est **inchangé**.

## Portée tenant — beliandjolie UNIQUEMENT

Le VPS héberge deux boutiques (beliandjolie.com **et** issyma.fr) sur la même base. **Ce skill ne doit JAMAIS toucher les produits Issyma.** Les scripts `name-batch-export.ts` et `name-batch-apply.ts` sont hard-scopés sur le tenant `beliandjolie` (via `tenantALS.run(tenantId, …)`). Si un jour un autre skill équivalent est créé pour Issyma, il devra vivre dans son propre skill avec son propre slug — ne jamais paramétrer ce skill pour accepter un autre tenant.

## Style de communication

**Toujours en français. Toujours non-technique.** La cliente n'est pas développeuse. Lui parler comme à une chef d'entreprise qui veut savoir ce qui change sur son site.
- Pas de jargon (cache, schema, API, serveur, JSON, etc.) — si nécessaire, expliquer en une phrase de tous les jours.
- Dire ce qui change pour elle/ses clients, pas ce qui change dans le code.
- Tests proposés = trajets dans le site (« ouvrez l'admin, allez dans Produits, cliquez sur… »).

## Détection du mode

Quatre modes possibles :

- **Mode A — Nouvelle session** : phrases du type « nouveau lot », « lance les noms », « renommer », « donne-moi un lot », ou juste `/produits-nom` sans plus de précision. → Aller à [Mode A](#mode-a--nouvelle-session).
- **Mode B — Générer les propositions** : phrase « génère », « vas-y », « lance la génération », « analyse maintenant ». Une session doit exister avec `phase === "collecting_hints"` ou `phase === "awaiting_generation"`. → Aller à [Mode B](#mode-b--générer-les-propositions).
- **Mode C — Regénérer un produit** : phrase « regénère » ou « refais », alors qu'un fichier de session existe avec un `awaitingRegen`. → Aller à [Mode C](#mode-c--regénérer-un-produit).
- **Mode D — Bilan / état** : phrase « où on en est », « combien de produits traités », etc. → Aller à [Mode D](#mode-d--état-de-la-session).

Si **ambigu**, demander gentiment :
> Vous voulez (A) démarrer un nouveau lot, (B) lancer la génération sur le lot en cours (après avoir décrit les produits), (C) regénérer le produit en cours de regen, ou (D) voir où on en est ?

## Paramètres globaux

- **VPS SSH** : `ssh root@72.61.106.128`
- **Projet sur VPS** : `/var/www/beliandjolie/`
- **Session locale (sur ce PC)** : `${USERPROFILE}\Desktop\beli-nom-session.json` — état en cours d'une session (produits du lot + indices + propositions + choix de la cliente avant push).
- **Dossier images temporaire** : `${USERPROFILE}\Desktop\beli-images-temp\` — webp téléchargés depuis le VPS pour visualisation.
- **Page web locale** : `http://localhost:3010` (port par défaut)

---

## Mode A — Nouvelle session

**Rappel :** ce mode NE génère PLUS les propositions. Il prépare juste le lot et ouvre la grille d'indices. La génération se fait au Mode B.

### Étape A.1 — Vérifier qu'aucune session n'est déjà en cours (local + VPS)

**Le PC de la cliente crash souvent.** Une copie de la session est synchronisée sur le VPS à chaque clic comme filet de secours. Au démarrage d'une session, vérifier les **deux** :

```bash
# 1. Local
ls "${USERPROFILE}/Desktop/beli-nom-session.json" 2>/dev/null && \
  jq -r '.updated_at + " " + .status + " " + (.phase // "validating")' "${USERPROFILE}/Desktop/beli-nom-session.json" 2>/dev/null

# 2. VPS (filet de secours)
ssh root@72.61.106.128 'test -f /var/www/beliandjolie/data/name-session-backup/session.json && \
  jq -r ".updated_at + \" \" + .status + \" \" + (.phase // \"validating\")" /var/www/beliandjolie/data/name-session-backup/session.json'
```

Logique de décision :

| Local | VPS | Action |
|-------|-----|--------|
| Absent | Absent | → continuer Mode A.2 (nouvelle session) |
| Absent | Présent (non-pushed) | → restaurer depuis VPS, demander à la cliente si elle veut reprendre |
| Présent | Absent | → comportement standard (reprendre ou écraser) |
| Présent | Présent | → comparer `updated_at`, garder le plus récent |

**Pour restaurer depuis VPS** :
```bash
scp "root@72.61.106.128:/var/www/beliandjolie/data/name-session-backup/session.json" "/c/Users/chenb/Desktop/beli-nom-session.json"
```

Si une session **non poussée** existe (`status !== "pushed"`), proposer à la cliente :
> Vous avez une session en cours avec X produits (phase : indices / génération en attente / validation) — dernière modif : Z. Vous voulez (1) reprendre, (2) la pousser puis démarrer un nouveau lot, ou (3) tout effacer et recommencer ?

- Si elle reprend → relancer juste le serveur (étape A.6 directement). Re-télécharger les images en local si elles manquent (cas restauration depuis VPS). Si la phase est `awaiting_generation`, lui rappeler qu'il faut taper `génère`.
- Si elle pousse puis recommence → laisser la page faire le push comme d'habitude, attendre, supprimer le fichier session (local + VPS), puis continuer.
- Si elle efface → supprimer le fichier session (local + VPS) et continuer.

Pour effacer la copie VPS :
```bash
ssh root@72.61.106.128 'rm -f /var/www/beliandjolie/data/name-session-backup/session.json'
```

### Étape A.2 — Demander la taille du lot

> Combien de produits dans ce lot ? (par défaut 10, max raisonnable 30)

Si elle dit juste « ok » ou ne précise pas, partir sur **10**.

### Étape A.3 — Récupérer les prochains produits via le VPS

```bash
ssh root@72.61.106.128 'cd /var/www/beliandjolie && NODE_OPTIONS="-r ./scripts/_lib_no_next_cache.cjs" npx tsx scripts/name-batch-export.ts <N>'
```

Le script renvoie un JSON avec les N produits **les plus récemment créés** dont le champ `note` ne contient pas la mention « Complété par l'IA » (plus de journal JSON séparé — la note du produit en BDD fait foi).

Chaque produit retourné inclut : référence, ancien nom, ancienne description, note actuelle, catégorie principale avec ses sous-catégories disponibles, sous-catégories déjà attachées, tags déjà attachés, une image par couleur, et les identifiants marketplace (`pfsProductId`, `ankorsProductId`, `efashionReferenceBase`).

**Contenu de l'ensemble (parures uniquement)** : si le produit est une **Parure de bijoux** dont la référence se termine par « E », le script cherche automatiquement les sous-produits (collier, bracelet, boucles, bague) qui partagent la base de la référence. Exemple : `A2591E` → cherche `A2591`, `A2591A`, `A2591B`, `A2591C` (max un caractère suffixe). Ces produits reviennent dans le champ `siblings: [{ ref, category }]` et seront proposés à la cliente, tous cochés par défaut, dans la section « Contenu de l'ensemble » de la page. Au push, ils sont liés au parent via `ProductBundle`.

### Étape A.4 — Télécharger les images en local

Créer le dossier temporaire s'il n'existe pas, puis pour chaque produit télécharger l'image :
```bash
mkdir -p "/c/Users/chenb/Desktop/beli-images-temp"
scp "root@72.61.106.128:/var/www/beliandjolie/public<imagePath>" "/c/Users/chenb/Desktop/beli-images-temp/<reference-lowercase>.webp"
```

Si un produit n'a pas d'image (`imagePath` null), le marquer dans la session comme « sans image » et ne pas le proposer dans le lot (re-tenté plus tard).

### Étape A.5 — Créer le fichier session (SANS PROPOSITIONS) et démarrer le serveur

Construire le fichier `${USERPROFILE}\Desktop\beli-nom-session.json` en **phase indices**, avec des tableaux de propositions vides — ils seront remplis au Mode B après que la cliente ait donné ses indices :

```json
{
  "version": 3,
  "created_at": "2026-08-06T10:00:00Z",
  "updated_at": "2026-08-06T10:00:00Z",
  "status": "in_progress",
  "phase": "collecting_hints",
  "hints": {},
  "products": [
    {
      "id": "...",
      "reference": "A322",
      "name": "Ancien nom",
      "description": "Ancienne description",
      "note": null,
      "category": {
        "id": "...",
        "name": "Boucles d'oreilles",
        "availableSubCategories": [{ "id": "...", "name": "Créoles" }]
      },
      "subCategories": [],
      "tags": [],
      "colors": [{ "colorId": "...", "path": "/uploads/produits/a322/a322-argent-1.webp" }],
      "pfsProductId": null,
      "ankorsProductId": null,
      "efashionReferenceBase": null,
      "siblings": [{ "ref": "A2591", "category": "Collier" }, { "ref": "A2591A", "category": "Bracelet" }],
      "names": [],
      "descs": [],
      "names_en": [],
      "descs_en": [],
      "proposedTags": [],
      "proposedSubCategories": [],
      "clarifyingQuestions": [],
      "categoryFlag": null
    }
  ],
  "decisions": {},
  "awaitingRegen": null
}
```

Puis lancer le serveur **en arrière-plan** :
```bash
node "C:/Users/chenb/Desktop/beli-jolie/.claude/skills/produits-nom/scripts/server.cjs" "C:/Users/chenb/Desktop/beli-nom-session.json"
```

Utiliser `run_in_background: true` du tool Bash. Le serveur garde la main et écoute sur `http://localhost:3010`.

### Étape A.6 — Informer la cliente

Lui dire en français simple :
- Le nombre de produits prêts et l'adresse : **http://localhost:3010**
- Le mode d'emploi en deux phrases :
  1. « Pour chaque produit, écrivez rapidement vos indices dans la zone à droite de la photo (matière, forme, motif principal, mots-clés) — vous pouvez laisser vide si vous n'avez rien à ajouter. »
  2. « Quand vous avez fini de tout décrire, cliquez sur le bouton vert "Générer les propositions" en haut, puis revenez ici et tapez `génère`. Je regarderai chaque photo avec vos indices en tête et je proposerai 3 noms + 3 descriptions par produit. »
- Insister : « Vos indices sont facultatifs mais fortement recommandés — c'est ce qui évitera que je cite des matières ou des motifs qui ne sont pas sur le produit. »

---

## Mode B — Générer les propositions

Déclenché quand la cliente tape `génère` (ou `vas-y`, `lance la génération`, `analyse maintenant`) après avoir renseigné ses indices sur la page.

### Étape B.1 — Lire la session et vérifier la phase

```bash
cat "${USERPROFILE}/Desktop/beli-nom-session.json"
```

- Si la session n'existe pas → dire à la cliente qu'il n'y a rien à générer, elle veut peut-être démarrer un nouveau lot ?
- Si `phase === "validating"` → les propositions existent déjà. Ambigu : lui demander si elle voulait plutôt regénérer un produit précis (Mode C).
- Si `phase === "collecting_hints"` ou `phase === "awaiting_generation"` → continuer.

### Étape B.2 — Pour chaque produit, lire l'image + hint et générer

Pour chaque produit du lot :

1. **Read** l'image dans `${USERPROFILE}\Desktop\beli-images-temp\<ref-lowercase>.webp`
2. Récupérer l'indice de la cliente : `session.hints[product.reference]` (peut être vide — dans ce cas, générer à froid comme avant)
3. Générer, en suivant **strictement** `references/style-guide.md` :
   - **3 noms FR + 3 noms EN** (`names` et `names_en`, index-matché)
   - **3 descriptions FR + 3 descriptions EN** (`descs` et `descs_en`, index-matché)
   - **`proposedTags`** : 5 à 12 tags suggérés
   - **`proposedSubCategories`** : 1 à 4 sous-catégories suggérées (parmi `category.availableSubCategories` sinon inventées)
   - **`clarifyingQuestions`** : 0 à 3 questions si doute (matière ambiguë, élément coupé sur l'image, packaging non vu)
   - **`categoryFlag`** : `null` ou `{ current, suggested }` si la catégorie principale paraît fausse

**Traiter le hint comme vérité vérifiée** : si la cliente a écrit « émail rouge, coeur, chaîne fine », ne pas contredire (pas « résine » à la place d'émail, pas « oval » à la place de coeur). Le hint prime sur ma lecture visuelle en cas d'ambiguïté. **Mais** je peux quand même poser une `clarifyingQuestion` si le hint est incomplet (ex : hint = « coeur » mais je vois aussi un pendentif rond → demander).

**Règles absolues** (rappel) :
- **Aucune couleur** dans noms ou descriptions
- **Aucun mot marketing**
- Décrire uniquement **ce qu'on voit visuellement** (+ ce qui est confirmé par le hint)
- **Court et factuel**
- Les règles FR s'appliquent à l'EN — voir `references/style-guide.md` section « Anglais »

### Étape B.3 — Mettre à jour la session

Pour chaque produit, écrire les `names`, `descs`, `names_en`, `descs_en`, `proposedTags`, `proposedSubCategories`, `clarifyingQuestions`, `categoryFlag`.

Puis passer la session en `phase: "validating"`.

Réécrire le fichier session.

### Étape B.4 — Informer la cliente

> Propositions prêtes pour les X produits du lot. Retournez sur http://localhost:3010 — la page se mettra à jour toute seule dans 2-3 secondes en mode validation. Pour chaque produit : choisissez un nom + une description parmi mes 3 propositions, ajustez tags/sous-catégories, cliquez Valider. À la fin, bouton vert « Tout pousser sur le site » en haut à droite.

---

## Mode C — Regénérer un produit (ex-Mode B)

Quand la cliente tape « regénère » (ou « refais »), il y a normalement un `awaitingRegen` dans la session (posé par le bouton « Demander de regénérer » sur la page).

### Étape C.1 — Lire la session

```bash
cat "${USERPROFILE}/Desktop/beli-nom-session.json"
```

Trouver `awaitingRegen` : `{ ref, comment, answers, what }` (`what` = `"name"`, `"description"`, `"both"`, ou `"all"`).

Si pas de `awaitingRegen`, dire à la cliente :
> Il n'y a rien à regénérer pour le moment. Tout est bon ?

### Étape C.2 — Re-regarder l'image (+ hint initial) et regénérer

Utiliser **Read** sur le fichier image correspondant : `${USERPROFILE}\Desktop\beli-images-temp\<ref-lowercase>.webp`.

**Injecter dans le contexte** :
- L'indice initial de la cliente : `session.hints[ref]` (s'il existe)
- Le commentaire de regen : `awaitingRegen.comment`
- Les réponses aux questions de clarification : `awaitingRegen.answers`

Lire `awaitingRegen.what` :
- `"name"` → 3 nouveaux noms FR + 3 nouveaux noms EN (gardé : `descs`/`descs_en` + `proposedTags` + `proposedSubCategories` actuels)
- `"description"` → 3 nouvelles descriptions FR + 3 nouvelles descriptions EN
- `"both"` → 3 noms FR/EN + 3 descriptions FR/EN
- `"all"` → 3 noms FR/EN + 3 descriptions FR/EN + nouvelles `proposedTags` + nouvelles `proposedSubCategories` + nouvelles `clarifyingQuestions`

**Toujours regénérer EN en même temps que FR** — sinon l'index-match casse.

Le commentaire de la cliente **prime sur tout** (y compris sur son hint initial si elle a changé d'avis). Toujours respecter le `style-guide.md`.

### Étape C.3 — Mettre à jour le fichier session

Remplacer dans le tableau `products` les nouveaux `names` et/ou `descs` du produit concerné, puis effacer `awaitingRegen` (le mettre à `null`).

### Étape C.4 — Informer la cliente

> Nouvelles propositions prêtes ! Retournez sur la page http://localhost:3010, elle se mettra à jour toute seule dans 2-3 secondes.

---

## Mode D — État de la session (ex-Mode C)

Lire le fichier session, compter :
- Phase courante (`collecting_hints`, `awaiting_generation`, `validating`, ou `pushed`)
- Nombre total de produits dans le lot
- Nombre d'indices renseignés (dans `hints`, non vide)
- Nombre validés (dans `decisions`)
- Nombre en attente de regen
- Statut global (`in_progress`, `pushed`)

Présenter sous forme :
> Sur les X produits du lot, vous avez décrit Y (phase indices), validé Z propositions. Y'en a W qui attendent une regénération. La session n'a pas encore été poussée sur le site.

Adapter le message selon la phase.

---

## Push final (déclenché par la cliente depuis la page)

Quand la cliente clique « Tout pousser sur le site » dans le navigateur, la page appelle l'API du serveur local qui :
1. Construit un payload `{ items: [{ ref, name, description, nameEn, descriptionEn, tagNames, subCategoryNames, compositionRefs }, ...] }` avec tous les `decisions`. `nameEn`/`descriptionEn` sont retrouvés côté serveur par index-match dans les propositions. `compositionRefs` = refs cochées dans « Contenu de l'ensemble ».
2. Copie le payload sur le VPS via `scp`.
3. Lance `scripts/name-batch-apply.ts` sur le VPS via `ssh`. Le script applique **uniquement en BDD** :
   - met à jour `name`, `description`
   - écrit la traduction anglaise directement dans `ProductTranslation(locale=en)` si `nameEn`+`descriptionEn` sont fournis (pas de traduction auto). Sinon, efface toutes les traductions et laisse la traduction auto PFS les régénérer.
   - crée les tags manquants (anti-doublon lowercase sans accent), attache au produit
   - crée les sous-catégories manquantes sous la catégorie principale, attache au produit
   - écrit `note` en préfixant « Complété par l'IA le DD/MM/YYYY »
   - lève les drapeaux `pfsSyncRequired` / `ankorsSyncRequired` / `efashionSyncRequired` / `faireSyncRequired` UNIQUEMENT pour les marketplaces déjà liées au produit
   - remplace le contenu de l'ensemble (`ProductBundle`) — parent = ce produit, enfants = refs de `compositionRefs`. Refs inconnues ignorées silencieusement.
4. Marque la session comme `pushed`.

**Pas de push direct vers PFS / Ankorstore / eFashion**. C'est la cliente qui déclenche les synchros marketplace manuellement depuis l'admin (boutons existants sur la fiche produit et bulk).

Le serveur retourne immédiatement (envoi en arrière-plan). La cliente peut fermer la page.

**Si elle veut suivre l'avancement du push**, lui dire de revenir ici taper « où en est l'envoi » et on regardera :
```bash
ssh root@72.61.106.128 'tail -50 /tmp/beli-push.log'
```

---

## Notes techniques importantes

### Stub next/cache
Les scripts tsx hors contexte Next.js ont besoin du stub `_lib_no_next_cache.cjs` pré-chargé via `NODE_OPTIONS="-r ./scripts/_lib_no_next_cache.cjs"`. Sans ça, les fonctions cachées plantent.

### Le serveur reste en arrière-plan
Lancé via `run_in_background: true`, il tourne tant que la cliente n'a pas fini. Pas besoin de le tuer après le push — elle peut juste fermer la fenêtre Claude Code, le processus mourra avec.

Pour le tuer manuellement :
```bash
taskkill /F /IM node.exe
```

### Sauvegarde locale + filet VPS
Le fichier `beli-nom-session.json` est sur le Bureau. Chaque clic de validation **et chaque frappe d'indice** déclenche :
1. Une réécriture atomique en local (`.tmp` puis `rename`)
2. Un `scp` non-bloquant vers `root@72.61.106.128:/var/www/beliandjolie/data/name-session-backup/session.json`

Le PC de la cliente crash souvent — la copie VPS permet de tout retrouver même si le disque local est inaccessible. Au prochain démarrage (Mode A.1), si le local est manquant ou plus vieux que le VPS, on restaure depuis le VPS.

Coalescence : si plusieurs validations ou frappes d'indices se suivent vite, on ne lance qu'un seul `scp` à la fois — le suivant attend la fin du précédent puis se déclenche avec la version la plus récente.

### Style des noms/descriptions
Voir `references/style-guide.md` — référence à relire à chaque génération **et** à chaque regen.

### Traductions
Si le payload contient `nameEn`+`descriptionEn` (cas normal du skill), la traduction anglaise est écrite directement — pas de traduction auto. Si absente (édition manuelle par la cliente), le script efface les traductions et la **traduction auto PFS** (`lib/auto-translate.ts`, cf. CLAUDE.md) les régénère en arrière-plan.

### Si l'image d'un produit n'existe pas
Le `colorImages` de la BDD peut être vide. Dans ce cas, signaler à la cliente le produit comme « sans image — à compléter » et le skip pour le lot en cours (ne pas le mettre dans le journal pour qu'il soit re-tenté plus tard).

### Compatibilité des anciennes sessions
Si un fichier session sans champ `phase` est trouvé (versions ≤ 2), le traiter comme `phase: "validating"` — le workflow legacy s'applique (les propositions sont déjà dedans, la cliente est déjà en train de valider).
