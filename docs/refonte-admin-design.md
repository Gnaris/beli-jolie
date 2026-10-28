# Refonte design admin — branche `refonte-admin-design`

> **Pourquoi cette branche existe** : la cliente veut dépoussiérer tout le panneau admin pour libérer de l'espace, moderniser le look et simplifier la lecture. Comme c'est gros et visuel, on itère en local tant que ce n'est pas totalement validé, puis on merge sur `master` d'un coup quand tout est prêt. Pas de push prod intermédiaire.

## Direction design validée

- **Fond général admin** = gris très doux (`#F1F1F3`) pour faire ressortir les cartes blanches.
- **Sidebar** = pile de **petites bulles blanches arrondies** (`rounded-2xl`, bordure fine, légère ombre), au lieu d'un gros bloc monolithique de 260 px.
- **Icônes seules** dans la sidebar, pas de texte. Au survol d'une icône OU de la sidebar entière → **tous les labels** s'affichent en infobulles noires à droite (texte blanc + petite flèche).
- **Sous-navigations** (ex. Produits → Catégories, Couleurs, Compositions, Tailles, Saisons, Codes SH, Mots-clés ; Marketing → Modèles mail / WhatsApp / etc.) **sortent de la sidebar** et deviennent une **barre horizontale d'onglets** en haut de la page concernée.
- **Zone de contenu** = carte blanche arrondie à côté des bulles de nav.

## Étapes du chantier

### ✅ Étape 1 — Refonte sidebar + fond admin
**Statut** : fait (commit initial de la branche).

Fichiers modifiés :
- `components/admin/AdminDesktopShell.tsx` — réécriture complète : plus de mode replié/déplié, plus de sous-menus dans la sidebar, bulles séparées, hover global, tooltips rendus en portal (`createPortal` → `document.body`) pour éviter tout clipping.
- `app/(admin)/layout.tsx` — fond du wrapper passe de `bg-white` à `#F1F1F3`.
- `components/admin/AdminShellsLive.tsx` — `<main>` devient une carte blanche arrondie à côté de la sidebar.

Compat :
- `AdminMobileNav.tsx` (< `lg`) inchangé pour l'instant.
- Mode sombre admin (`html.admin-dark`) : règle CSS existante `aside .bg-white → #18181b` continue à s'appliquer, mais à retester en profondeur.

### ⏳ Étape 2 — Sous-nav horizontale « Produits »
**Statut** : à faire.

Créer un composant `components/admin/products/ProductsSubnav.tsx` (barre d'onglets horizontale avec pastilles de warning). À injecter dans :
- `/admin/produits`
- `/admin/categories`
- `/admin/couleurs`
- `/admin/compositions`
- `/admin/saisons`
- `/admin/tailles`
- `/admin/codes-sh`
- `/admin/mots-cles`

### ⏳ Étape 3 — Sous-nav horizontale « Marketing »
**Statut** : à faire.

Même principe pour :
- `/admin/contact-client` (Envoyer des mails)
- `/admin/contact-client/mails` (Modèles de mail)
- `/admin/contact-client/whatsapp` (Modèles WhatsApp)
- `/admin/contact-client/mails/panier-abandonne`
- `/admin/contact-client/mails/inactivite`

### ⏳ Étape 4 — Audit mode sombre admin
Vérifier que les bulles passent proprement en noir en mode sombre, que les bordures restent lisibles, que le hover global fonctionne.

### ⏳ Étape 5 — Audit mobile
Passage de la version mobile (`AdminMobileNav`) au même langage visuel (bulles + fond doux) si pertinent.

## Comment tester localement

```bash
git checkout refonte-admin-design
# Pas de git pull nécessaire tant que personne d'autre ne touche à la branche.
npm install                 # au cas où le package-lock aurait bougé
npm run dev
```

Puis ouvrir `http://localhost:3000/admin`. Trajets de test à faire :

1. Vérifier que le fond est gris doux + sidebar en bulles.
2. Survoler la sidebar : tous les labels doivent apparaître à droite.
3. Cliquer les icônes : la navigation doit continuer à marcher (toutes les URLs admin existent déjà).
4. Vérifier que les pastilles bleues (commandes/clients en attente) et oranges (traductions manquantes) restent visibles sur les icônes.
5. Tester le widget flottant bas-droite (traduction/mkt/images/shooting/chat) : ne doit pas être caché.
6. Tester en mode sombre (Paramètres → Affichage → Sombre).
7. Mobile : rafraîchir sur mobile → la nav mobile est inchangée pour l'instant.

## Comment merger en prod le jour J

Quand toutes les étapes sont validées par la cliente :

```bash
git checkout master
git pull
git merge refonte-admin-design
# Vérifier que tout compile : npm run build
git push origin master
```

Puis GitHub Actions `.github/workflows/deploy.yml` prend le relais (voir `CLAUDE.md` section « Workflow modif → validation → push »).

## Convention de commit

Préfixe `refonte-admin:` pour tous les commits de cette branche, suivi d'un verbe court en français. Exemples :

- `refonte-admin: sidebar en bulles + hover global`
- `refonte-admin: sous-nav horizontale produits`
- `refonte-admin: audit mode sombre`
