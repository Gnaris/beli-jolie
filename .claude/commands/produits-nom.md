---
description: Compléter des fiches produit (nom + description + sous-catégories + tags) via la page locale http://localhost:3010
argument-hint: [taille du lot, par défaut 10]
---

Lance une session du skill `produits-nom`.

Taille du lot demandée : **$ARGUMENTS** (si vide, prendre 10 par défaut).

Suis exactement le **Mode A** documenté dans `.claude/skills/produits-nom/SKILL.md` :

1. **Étape A.1** — Vérifier qu'aucune session n'est déjà en cours (local + filet VPS).
   - Si une session non-poussée existe, demander à la cliente : (1) reprendre, (2) pousser puis nouveau lot, (3) effacer et recommencer.
2. **Étape A.2** — Confirmer la taille du lot (utiliser l'argument `$ARGUMENTS` si fourni, sinon 10).
3. **Étape A.3** — Récupérer les N produits via le VPS :
   ```bash
   ssh root@72.61.106.128 'cd /var/www/beliandjolie && NODE_OPTIONS="-r ./scripts/_lib_no_next_cache.cjs" npx tsx scripts/name-batch-export.ts <N>'
   ```
4. **Étape A.4** — Télécharger les images en local dans `${USERPROFILE}\Desktop\beli-images-temp\`.
5. **Étape A.5** — Lire chaque image et générer :
   - 3 noms + 3 descriptions (selon `references/style-guide.md`)
   - `proposedTags` (5-12 tags lowercase)
   - `proposedSubCategories` (1-4 sous-cat sous la catégorie principale)
   - `clarifyingQuestions` (0-3 si vraie incertitude)
   - `categoryFlag` (null ou `{ current, suggested }` si la catégorie principale paraît fausse)
6. **Étape A.6** — Écrire le fichier session sur `${USERPROFILE}\Desktop\beli-nom-session.json` (format v2 documenté dans SKILL.md).
7. **Étape A.7** — Démarrer le serveur en arrière-plan :
   ```bash
   node ".claude/skills/produits-nom/scripts/server.cjs" "${USERPROFILE}/Desktop/beli-nom-session.json"
   ```
8. **Étape A.8** — Informer la cliente en français simple :
   - Le nombre de produits prêts
   - L'adresse : **http://localhost:3010**
   - Le mode d'emploi : « choisissez un nom + une description parmi mes 3 propositions, ajustez les tags / sous-catégories déjà cochés, cliquez Valider, ça passe au suivant »
   - Si bannière jaune visible : « vous pouvez répondre aux questions et regénérer, OU ignorer et valider tel quel »
   - Si rien ne va pour nom/description : « cochez "Aucun ne va", écrivez pourquoi, cliquez "Demander de regénérer", puis revenez ici taper `regénère` »
   - À la fin : « bouton vert "Tout pousser sur le site" en haut à droite »

**Règles absolues** (rappel) :
- Aucune couleur, aucun mot marketing dans les noms/descriptions.
- Le push final ne touche **pas** aux marketplaces — il lève juste le drapeau « Synchro nécessaire » pour celles qui sont déjà liées. La cliente synchronise manuellement depuis l'admin.
- Toujours parler en français simple, non-technique.
