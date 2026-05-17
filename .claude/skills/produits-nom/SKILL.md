---
name: produits-nom
description: Use this skill whenever the user wants help renaming Beli & Jolie products. Triggers in two situations - (a) the user wants to GENERATE a new batch of product name and description proposals as an Excel file on their Desktop (phrases like "produits-nom", "nouveau lot de noms", "génère des noms", "lot suivant", "lance les noms", "donne-moi 10 produits à renommer"), or (b) the user wants to APPLY her validated choices from a returned Excel to the production database and sync PFS + Ankorstore marketplaces (phrases like "traite mon retour", "applique l'Excel", "j'ai rempli le fichier", "voici mes choix", or providing a path to an .xlsx file on Desktop or Downloads). The user is non-technical, French-speaking, and manages ~9000 stainless steel jewelry products which she is renaming progressively across many sessions, sometimes from different PCs.
---

# Skill : produits-nom

## Contexte

La cliente dirige **Beli & Jolie**, un site B2B de vente en gros de bijoux en acier inoxydable. Elle a **~9 000 produits** dont les noms/descriptions actuels sont génériques (« Boucles d'oreilles en acier inoxydable », même texte sur tous). Elle veut renommer **chaque produit** avec un nom + description **courts, factuels, basés sur ce qu'on voit** sur la photo (pas de couleur, pas de mots marketing).

Ce travail s'étale sur plusieurs sessions et possiblement plusieurs PC. Un **journal centralisé sur le VPS** garde la trace de ce qui est déjà fait pour qu'on ne refasse jamais deux fois le même produit.

## Style de communication

**Toujours en français. Toujours non-technique.** La cliente n'est pas développeuse. Lui parler comme à une chef d'entreprise qui veut savoir ce qui change sur son site.
- Pas de jargon (cache, schema, API, etc.) — si nécessaire, expliquer en une phrase de tous les jours.
- Dire ce qui change pour elle/ses clients, pas ce qui change dans le code.
- Tests proposés = trajets dans le site (« ouvrez l'admin, allez dans Produits, cliquez sur… »).

## Détection du mode

Quand le skill se déclenche, identifier le mode :

- **Mode A — Nouveau lot** : la cliente parle de « générer », « nouveau lot », « lance », ou tape juste `/produits-nom` sans rien d'autre. → Aller à la section [Mode A](#mode-a--générer-un-nouveau-lot).
- **Mode B — Appliquer un retour** : la cliente parle d'un fichier Excel qu'elle a rempli (« traite mon retour », « voici mon fichier », « j'ai rempli »), ou pointe vers un `.xlsx`. → Aller à la section [Mode B](#mode-b--appliquer-un-retour).

Si **ambigu**, demander gentiment :
> Vous voulez (A) un nouveau lot de produits à renommer, ou (B) que je traite un fichier Excel que vous avez rempli et déposé sur le bureau ?

## Paramètres globaux

- **VPS SSH** : `ssh root@72.61.106.128`
- **Projet sur VPS** : `/var/www/beliandjolie/`
- **Journal** : `/var/www/beliandjolie/data/name-review-log.json`
- **Bureau local** (Windows) : `${USERPROFILE}\Desktop\` — où sauver les Excel
- **Dossier images temporaire** : `${USERPROFILE}\Desktop\beli-images-temp\`

Lire le journal au début de chaque mode :
```bash
ssh root@72.61.106.128 'cat /var/www/beliandjolie/data/name-review-log.json'
```

---

## Mode A — Générer un nouveau lot

### Étape A.1 — Demander la taille du lot

> Combien de produits dans ce lot ? (par défaut 10)

Attendre la réponse. Si elle dit juste « ok » ou ne précise pas, partir sur **10**.

### Étape A.2 — Récupérer les prochains produits via le VPS

```bash
ssh root@72.61.106.128 'cd /var/www/beliandjolie && NODE_OPTIONS="-r ./scripts/_lib_no_next_cache.cjs" npx tsx scripts/name-batch-export.ts <N>'
```

Le script renvoie un JSON :
```json
{
  "journalSize": 10,
  "requested": 10,
  "returned": 10,
  "products": [
    { "id": "...", "reference": "A322", "name": "...", "description": "...", "category": "...", "imagePath": "/uploads/produits/a322/a322-argent-1.webp" }
  ]
}
```

### Étape A.3 — Télécharger les images dans le dossier temporaire

Pour chaque produit, télécharger l'image vers `${USERPROFILE}\Desktop\beli-images-temp\` :
```bash
mkdir -p "/c/Users/chenb/Desktop/beli-images-temp"
scp "root@72.61.106.128:/var/www/beliandjolie/public<imagePath>" "/c/Users/chenb/Desktop/beli-images-temp/<reference-lowercase>.webp"
```

### Étape A.4 — Regarder chaque image et générer 5 noms + 5 descriptions

Utiliser l'outil **Read** sur chaque fichier `.webp` du dossier temporaire pour visualiser le produit. Suivre **strictement** le style décrit dans `references/style-guide.md`.

**Règles absolues** :
- **Aucune couleur** dans les noms ou descriptions
- **Aucun mot marketing** (élégant, sublime, parfait, raffiné, etc.)
- Décrire uniquement **ce qu'on voit visuellement** (forme, matière, motif, type de pendant)
- **Court et factuel**
- Description = **1 phrase**

### Étape A.5 — Construire le fichier Excel

Utiliser le script local `scripts/build-excel.cjs` :
```bash
node "<PROJECT>/.claude/skills/produits-nom/scripts/build-excel.cjs" "<chemin-payload.json>" "<chemin-sortie.xlsx>"
```

Le payload JSON doit contenir :
```json
{
  "imagesDir": "C:\\Users\\chenb\\Desktop\\beli-images-temp",
  "outputPath": "C:\\Users\\chenb\\Desktop\\noms-produits-YYYY-MM-DD-lotN.xlsx",
  "products": [
    {
      "reference": "A322",
      "names": ["Nom 1", "Nom 2", "Nom 3", "Nom 4", "Nom 5"],
      "descs": ["Desc 1", "Desc 2", "Desc 3", "Desc 4", "Desc 5"]
    }
  ]
}
```

Nom du fichier de sortie : `noms-produits-<YYYY-MM-DD>-lot<N>.xlsx` où N s'incrémente. Compter combien de lots existent déjà sur le bureau pour incrémenter (ou laisser tomber la numérotation si la cliente n'en veut pas).

### Étape A.6 — Informer la cliente

Lui dire :
- Le nombre de produits dans le lot
- Le chemin du fichier Excel sur son bureau
- Lui rappeler le mode d'emploi (déroulants 1-5 ou Aucun, commentaire si Aucun)
- Lui demander de renvoyer le fichier rempli en le déposant sur le bureau et en disant « traite mon retour »

---

## Mode B — Appliquer un retour

### Étape B.1 — Localiser le fichier Excel rempli

Chercher sur le bureau le fichier `.xlsx` le plus récent qui correspond au pattern `noms-produits-*.xlsx` :
```bash
ls -t "/c/Users/chenb/Desktop/"*.xlsx 2>/dev/null | head -5
```

Si plusieurs candidats, demander à la cliente lequel.

### Étape B.2 — Lire et parser le fichier

Utiliser `scripts/parse-xlsx.cjs` :
```bash
node "<PROJECT>/.claude/skills/produits-nom/scripts/parse-xlsx.cjs" "<chemin-vers-fichier.xlsx>"
```

Le script renvoie un JSON :
```json
{
  "validated": [
    { "ref": "A322", "name": "Nom retenu", "description": "Desc retenue" }
  ],
  "partial_name_only": [
    { "ref": "A314", "name": "Nom retenu", "desc_comment": "..." }
  ],
  "partial_desc_only": [
    { "ref": "A455", "description": "Desc retenue", "name_comment": "..." }
  ],
  "to_revise": [
    { "ref": "A465", "name_comment": "...", "desc_comment": "..." }
  ]
}
```

### Étape B.3 — Récapituler avant d'appliquer

Montrer à la cliente :
- Combien sont validés à 100 %
- Combien partiels (nom seul ou desc seule)
- Combien à revoir entièrement
- Les commentaires textuels pour les « Aucun »

Lui demander :
> Je peux appliquer les X produits validés (BDD + PFS + Ankorstore un par un) ?

Attendre son feu vert.

### Étape B.4 — Appliquer les validés

Préparer le payload :
```json
{
  "syncMarketplaces": true,
  "items": [
    { "ref": "A322", "name": "...", "description": "..." }
  ]
}
```

Le déposer temporairement sur le VPS et lancer :
```bash
scp /local/payload.json root@72.61.106.128:/tmp/_apply_payload.json
ssh root@72.61.106.128 'cd /var/www/beliandjolie && NODE_OPTIONS="-r ./scripts/_lib_no_next_cache.cjs" npx tsx scripts/name-batch-apply.ts /tmp/_apply_payload.json && rm /tmp/_apply_payload.json'
```

Le script gère :
- Mise à jour BDD (nom + description)
- Suppression des traductions DeepL (regénérées automatiquement)
- Sync PFS
- Sync Ankorstore **un par un avec 15 s entre chaque** (évite les erreurs 403)
- Mise à jour du journal

⚠️ **Si la cliente a beaucoup de produits validés à appliquer**, prévenir que ça prend du temps (~15 s × N pour Ankorstore + temps PFS). Pour 10 produits, ~3-4 minutes.

### Étape B.5 — Traiter les partiels et révisions

Pour les **partiels** (nom OU desc seul validé) : enregistrer la partie validée dans le journal avec statut `pending_revision` + commentaire. Refaire des propositions uniquement pour la partie manquante.

Pour les **révisions complètes** : refaire 5 noms + 5 descriptions en tenant compte du commentaire de la cliente.

Construire un mini-Excel de révisions (`noms-produits-revisions-<date>.xlsx`) avec les mêmes scripts.

### Étape B.6 — Bilan final

Récapituler à la cliente :
- Produits appliqués avec succès (BDD + sync marketplaces)
- Erreurs éventuelles (notamment Ankorstore en `pending_retry`)
- Fichier de révisions sur le bureau, prochaine étape

---

## Notes techniques importantes

### Synchronisation Ankorstore
**TOUJOURS un produit à la fois**, avec délai. Le script `name-batch-apply.ts` gère déjà le délai de 15 s. **Ne JAMAIS** modifier ça pour paralléliser — la cliente a explicitement signalé que ça provoque des erreurs 403.

### Stub next/cache
Les scripts tsx hors contexte Next.js ont besoin du stub `_lib_no_next_cache.cjs` pré-chargé via `NODE_OPTIONS="-r ./scripts/_lib_no_next_cache.cjs"`. Sans ça, les fonctions cachées (`getCachedSiteConfig` etc.) plantent avec « incrementalCache missing ».

### Format du journal
Voir `references/journal-format.md`.

### Style des noms/descriptions
Voir `references/style-guide.md` — référence à relire à chaque génération.

### Traductions DeepL
Les traductions (anglais, allemand, etc.) sont **automatiquement effacées** par le script apply, puis **régénérées en arrière-plan** par DeepL (~minutes). La cliente n'a rien à faire.

### Si l'image d'un produit n'existe pas
Le `colorImages` de la BDD peut être vide. Dans ce cas, signaler à la cliente le produit comme « sans image — à compléter » et le skip pour le lot en cours (ne pas le mettre dans le journal pour qu'il soit re-tenté plus tard).
