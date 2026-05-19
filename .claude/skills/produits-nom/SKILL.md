---
name: produits-nom
description: Use this skill whenever the user wants help renaming Beli & Jolie products. Opens a local web interface (http://localhost:3010) that shows one product at a time with 5 name proposals + 5 description proposals to click on. The user picks, and validations are saved locally as she goes. At the end of the session, a single click pushes everything to the live site (BDD + PFS + Ankorstore). If she clicks "Aucun ne va" + writes a comment, the page asks her to come back in Claude Code and type "regénère" — at which point Claude regenerates the 5 propositions based on her comment by re-reading the product image. Trigger phrases (FR) - (a) NEW SESSION - "produits-nom", "nouveau lot de noms", "génère des noms", "lance les noms", "renommer des produits", "donne-moi un lot" ; (b) REGEN during active session - "regénère", "refais ces propositions" ; (c) STATUS - "où on en est", "combien de produits traités" ; (d) PUSH follow-up - "où en est l'envoi". The user is non-technical, French-speaking, and manages ~9000 stainless steel jewelry products being renamed progressively across many sessions, sometimes from different PCs.
---

# Skill : produits-nom

## Contexte

La cliente dirige **Beli & Jolie**, un site B2B de vente en gros de bijoux en acier inoxydable. Elle a **~9 000 produits** dont les noms/descriptions actuels sont génériques. Elle veut renommer **chaque produit** avec un nom + description **courts, factuels, basés sur ce qu'on voit** sur la photo (pas de couleur, pas de mots marketing).

Ce travail s'étale sur plusieurs sessions et possiblement plusieurs PC. Un **journal centralisé sur le VPS** garde la trace de ce qui est déjà fait pour qu'on ne refasse jamais deux fois le même produit.

## Style de communication

**Toujours en français. Toujours non-technique.** La cliente n'est pas développeuse. Lui parler comme à une chef d'entreprise qui veut savoir ce qui change sur son site.
- Pas de jargon (cache, schema, API, serveur, JSON, etc.) — si nécessaire, expliquer en une phrase de tous les jours.
- Dire ce qui change pour elle/ses clients, pas ce qui change dans le code.
- Tests proposés = trajets dans le site (« ouvrez l'admin, allez dans Produits, cliquez sur… »).

## Détection du mode

Trois modes possibles selon ce qu'elle demande :

- **Mode A — Nouvelle session** : phrases du type « génère un lot », « nouveau lot », « lance les noms », « renommer », ou juste `/produits-nom` sans plus de précision. → Aller à [Mode A](#mode-a--nouvelle-session).
- **Mode B — Regénérer (pendant une session active)** : phrase « regénère » ou « refais », alors qu'un fichier de session existe avec un `awaitingRegen`. → Aller à [Mode B](#mode-b--regénérer-pendant-la-session).
- **Mode C — Bilan / état** : phrase « où on en est », « combien de produits traités », etc. → Aller à [Mode C](#mode-c--état-de-la-session).

Si **ambigu**, demander gentiment :
> Vous voulez (A) démarrer un nouveau lot, (B) regénérer le produit en cours de regen, ou (C) voir où on en est ?

## Paramètres globaux

- **VPS SSH** : `ssh root@72.61.106.128`
- **Projet sur VPS** : `/var/www/beliandjolie/`
- **Journal central (sur VPS)** : `/var/www/beliandjolie/data/name-review-log.json` — trace des produits déjà validés, partagé entre tous les PC.
- **Session locale (sur ce PC)** : `${USERPROFILE}\Desktop\beli-nom-session.json` — état en cours d'une session (produits du lot + propositions + choix de la cliente avant push).
- **Dossier images temporaire** : `${USERPROFILE}\Desktop\beli-images-temp\` — webp téléchargés depuis le VPS pour visualisation.
- **Page web locale** : `http://localhost:3010` (port par défaut)

---

## Mode A — Nouvelle session

### Étape A.1 — Vérifier qu'aucune session n'est déjà en cours (local + VPS)

**Le PC de la cliente crash souvent.** Une copie de la session est synchronisée sur le VPS à chaque clic comme filet de secours. Au démarrage d'une session, vérifier les **deux** :

```bash
# 1. Local
ls "${USERPROFILE}/Desktop/beli-nom-session.json" 2>/dev/null && \
  jq -r '.updated_at + " " + .status' "${USERPROFILE}/Desktop/beli-nom-session.json" 2>/dev/null

# 2. VPS (filet de secours)
ssh root@72.61.106.128 'test -f /var/www/beliandjolie/data/name-session-backup/session.json && \
  jq -r ".updated_at + \" \" + .status" /var/www/beliandjolie/data/name-session-backup/session.json'
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
> Vous avez une session en cours avec X produits dont Y validés (dernière modif : Z). Vous voulez (1) reprendre, (2) la pousser puis démarrer un nouveau lot, ou (3) tout effacer et recommencer ?

- Si elle reprend → relancer juste le serveur (étape A.6 directement). Re-télécharger les images en local si elles manquent (cas restauration depuis VPS).
- Si elle pousse puis recommence → laisser la page faire le push, attendre, supprimer le fichier session (local + VPS), puis continuer.
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

Le script renvoie un JSON avec les N prochains produits non-traités (exclut tout ce qui est dans le journal).

### Étape A.4 — Télécharger les images en local

Créer le dossier temporaire s'il n'existe pas, puis pour chaque produit télécharger l'image :
```bash
mkdir -p "/c/Users/chenb/Desktop/beli-images-temp"
scp "root@72.61.106.128:/var/www/beliandjolie/public<imagePath>" "/c/Users/chenb/Desktop/beli-images-temp/<reference-lowercase>.webp"
```

Si un produit n'a pas d'image (`imagePath` null), le marquer dans la session comme « sans image » et ne pas le proposer dans le lot (re-tenté plus tard).

### Étape A.5 — Regarder chaque image et générer 5 noms + 5 descriptions

Utiliser l'outil **Read** sur chaque fichier `.webp` du dossier temporaire. Suivre **strictement** le style décrit dans `references/style-guide.md`.

**Règles absolues** :
- **Aucune couleur** dans les noms ou descriptions
- **Aucun mot marketing** (élégant, sublime, parfait, raffiné, etc.)
- Décrire uniquement **ce qu'on voit visuellement**
- **Court et factuel**, description = **1 phrase**

### Étape A.6 — Créer le fichier session et démarrer le serveur

Construire le fichier `${USERPROFILE}\Desktop\beli-nom-session.json` avec cette structure :

```json
{
  "version": 1,
  "created_at": "2026-05-19T10:00:00Z",
  "updated_at": "2026-05-19T10:00:00Z",
  "status": "in_progress",
  "products": [
    {
      "id": "...",
      "reference": "A322",
      "name": "Ancien nom",
      "description": "Ancienne description",
      "category": "Boucles d'oreilles",
      "imagePath": "/uploads/produits/a322/a322-argent-1.webp",
      "names": ["Nom 1", "Nom 2", "Nom 3", "Nom 4", "Nom 5"],
      "descs": ["Desc 1", "Desc 2", "Desc 3", "Desc 4", "Desc 5"]
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

### Étape A.7 — Informer la cliente

Lui dire en français simple :
- Le nombre de produits prêts
- L'adresse à ouvrir : **http://localhost:3010**
- Le mode d'emploi en une phrase : « pour chaque produit, cliquez sur le nom et la description qui vous plaisent, ça passe au suivant tout seul »
- Si rien ne va : « cochez "Aucun ne va", écrivez pourquoi, cliquez "Demander de regénérer", puis revenez ici taper `regénère` »
- À la fin : « cliquez sur le bouton vert "Tout pousser sur le site" en haut à droite »

---

## Mode B — Regénérer (pendant la session)

Quand la cliente tape « regénère » (ou « refais »), il y a normalement un `awaitingRegen` dans la session.

### Étape B.1 — Lire la session

```bash
cat "${USERPROFILE}/Desktop/beli-nom-session.json"
```

Trouver `awaitingRegen` : `{ ref, comment, what }` (`what` = `"name"`, `"description"`, ou `"both"`).

Si pas de `awaitingRegen`, dire à la cliente :
> Il n'y a rien à regénérer pour le moment. Tout est bon ?

### Étape B.2 — Re-regarder l'image et regénérer

Utiliser **Read** sur le fichier image correspondant : `${USERPROFILE}\Desktop\beli-images-temp\<ref-lowercase>.webp`.

Lire le commentaire et regénérer **en tenant compte** de ce qu'elle a écrit :
- `what === "name"` → 5 nouveaux noms (gardé : `descs` actuels)
- `what === "description"` → 5 nouvelles descriptions (gardé : `names` actuels)
- `what === "both"` → 5 noms + 5 descriptions

Toujours respecter le `style-guide.md`.

### Étape B.3 — Mettre à jour le fichier session

Remplacer dans le tableau `products` les nouveaux `names` et/ou `descs` du produit concerné, puis effacer `awaitingRegen` (le mettre à `null`).

Réécrire le fichier session avec les modifs.

### Étape B.4 — Informer la cliente

> Nouvelles propositions prêtes ! Retournez sur la page http://localhost:3010, elle se mettra à jour toute seule dans 2-3 secondes.

---

## Mode C — État de la session

Lire le fichier session, compter :
- Nombre total de produits dans le lot
- Nombre validés (dans `decisions`)
- Nombre en attente de regen
- Statut global (`in_progress`, `pushed`)

Présenter sous forme :
> Sur les X produits du lot, vous en avez validé Y. Y'en a Z qui attendent une regénération. La session n'a pas encore été poussée sur le site.

---

## Push final (déclenché par la cliente depuis la page)

Quand la cliente clique « Tout pousser sur le site » dans le navigateur, la page appelle l'API du serveur local qui :
1. Construit un payload avec tous les `decisions`
2. Copie le payload sur le VPS via `scp`
3. Lance `scripts/name-batch-apply.ts` sur le VPS via `ssh`
4. Marque la session comme `pushed`

Le serveur retourne immédiatement (envoi en arrière-plan). La cliente peut fermer la page.

**Si elle veut suivre l'avancement du push**, lui dire de revenir ici taper « où en est l'envoi » et on regardera :
```bash
ssh root@72.61.106.128 'tail -50 /tmp/beli-push.log'
```

Et le journal central :
```bash
ssh root@72.61.106.128 'cat /var/www/beliandjolie/data/name-review-log.json' | python -m json.tool | tail -100
```

---

## Notes techniques importantes

### Synchronisation Ankorstore
**TOUJOURS un produit à la fois**, avec délai. Le script `name-batch-apply.ts` gère déjà le délai de 15 s. **Ne JAMAIS** modifier ça pour paralléliser — la cliente a explicitement signalé que ça provoque des erreurs 403.

### Stub next/cache
Les scripts tsx hors contexte Next.js ont besoin du stub `_lib_no_next_cache.cjs` pré-chargé via `NODE_OPTIONS="-r ./scripts/_lib_no_next_cache.cjs"`. Sans ça, les fonctions cachées plantent.

### Le serveur reste en arrière-plan
Lancé via `run_in_background: true`, il tourne tant que la cliente n'a pas fini. Pas besoin de le tuer après le push — elle peut juste fermer la fenêtre Claude Code, le processus mourra avec.

Pour le tuer manuellement :
```bash
taskkill /F /IM node.exe
```

### Sauvegarde locale + filet VPS
Le fichier `beli-nom-session.json` est sur le Bureau. Chaque clic de validation déclenche :
1. Une réécriture atomique en local (`.tmp` puis `rename`)
2. Un `scp` non-bloquant vers `root@72.61.106.128:/var/www/beliandjolie/data/name-session-backup/session.json`

Le PC de la cliente crash souvent — la copie VPS permet de tout retrouver même si le disque local est inaccessible. Au prochain démarrage (Mode A.1), si le local est manquant ou plus vieux que le VPS, on restaure depuis le VPS.

Coalescence : si plusieurs validations se suivent vite, on ne lance qu'un seul `scp` à la fois — le suivant attend la fin du précédent puis se déclenche avec la version la plus récente.

### Format du journal central
Voir `references/journal-format.md`.

### Style des noms/descriptions
Voir `references/style-guide.md` — référence à relire à chaque génération **et** à chaque regen.

### Traductions DeepL
Les traductions (anglais, allemand, etc.) sont **automatiquement effacées** par le script apply, puis **régénérées en arrière-plan** par DeepL (~minutes). La cliente n'a rien à faire.

### Si l'image d'un produit n'existe pas
Le `colorImages` de la BDD peut être vide. Dans ce cas, signaler à la cliente le produit comme « sans image — à compléter » et le skip pour le lot en cours (ne pas le mettre dans le journal pour qu'il soit re-tenté plus tard).
