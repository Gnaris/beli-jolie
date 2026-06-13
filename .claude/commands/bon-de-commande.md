---
description: Convertir un bon de commande chinois en Excel d'import Beli & Jolie
argument-hint: [chemin du fichier Excel, par défaut C:/Users/Admin/Downloads/A.xlsx]
---

Le bon de commande à traiter : **$ARGUMENTS**

Si l'argument est vide, demande à la cliente quel fichier du dossier `C:/Users/Admin/Downloads/` traiter.

Lance le skill `bon-de-commande` :
1. Vérifie que le fichier existe.
2. Parse-le avec `node .claude/skills/bon-de-commande/scripts/parse-po.cjs <fichier>`.
3. Sépare les références 返单 (à ignorer / liste pour la cliente) des produits importables.
4. Si des catégories ou couleurs chinoises ne sont pas dans la table de mapping, **demande confirmation à la cliente avant de générer**.
5. Génère le fichier final dans `C:/Users/Admin/Downloads/import-<FOURNISSEUR>.xlsx`.
6. À la fin, présente à la cliente :
   - le compte des produits importés
   - la liste des références 返单 mises de côté
   - le chemin du fichier généré
   - le trajet d'import dans le site (Produits → Importer → glisser le fichier)
7. Mets à jour `references/mapping.md` avec les nouvelles correspondances confirmées.

**Règle absolue** : ne jamais deviner une valeur manquante — toujours demander à la cliente, en français simple.
