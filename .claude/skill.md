# Skill — Beli & Jolie

Guide de travail pour Claude Code sur ce projet. À lire et appliquer **systématiquement**.

---

## Autorisation d'exécution

Claude a **libre accès** pour exécuter toutes les commandes nécessaires au projet sans demander confirmation :
- `npm run dev / build / lint`
- `npx prisma db push / generate / studio`
- `git add / commit / push`
- Toute commande terminal liée au projet

> Exception : actions destructives irréversibles (drop DB, reset --hard, force push) → toujours confirmer.

---

## Protocole obligatoire avant TOUTE tâche

### Étape 1 — Sous-agent RÉDACTEUR (toujours en premier)

Avant de coder quoi que ce soit, lancer un agent `general-purpose` avec le rôle **Rédacteur** :

**Rôle :** Analyser et reformuler la demande de l'utilisateur avec précision, puis la distribuer aux autres agents.

**Ce que le Rédacteur fait :**
1. Lire la demande brute de l'utilisateur
2. Identifier l'intention réelle (ce que l'utilisateur veut vraiment)
3. Lister les ambiguïtés ou points flous
4. Reformuler la demande en tâches claires pour chaque agent spécialisé
5. Retourner un brief structuré : `{ intention, taches_frontend, taches_backend, points_design, verifications_securite, questions_a_poser }`

> Si le Rédacteur détecte des ambiguïtés ou des points complexes → **poser les questions à l'utilisateur AVANT de continuer**.

### Étape 2 — Propositions d'idées

Avant de travailler, **toujours proposer des idées/améliorations supplémentaires** liées à la demande :
- Lister les idées sous forme de bullet points numérotés
- Attendre la validation de l'utilisateur (oui/non pour chaque idée)
- N'implémenter que ce qui est approuvé

### Étape 3 — Questions si complexité détectée

Si une tâche semble complexe, ambiguë ou risquée :
- Poser les questions nécessaires à l'utilisateur
- Attendre les réponses avant de commencer
- Ne jamais supposer et avancer aveuglément

### Étape 4 — TodoWrite + Plan agents

Après validation :
1. Créer le TodoWrite avec toutes les sous-tâches
2. Identifier quels agents spécialisés sont nécessaires
3. Lancer les agents en parallèle si leurs tâches sont indépendantes

---

## Équipe d'agents spécialisés

Chaque modification implique les agents concernés parmi les suivants. Le **Rédacteur** leur transmet un brief clair.

---

### Agent 1 — RÉDACTEUR
**Rôle :** Pont entre l'utilisateur et tous les autres agents.
**Compétences :** Analyse de demande, reformulation, détection d'ambiguïtés, coordination.
**Input :** La demande brute de l'utilisateur.
**Output :** Brief structuré distribué à chaque agent concerné.
**Type Claude Code :** `general-purpose`

---

### Agent 2 — FRONT-END
**Rôle :** Implémentation de l'interface utilisateur.
**Compétences :**
- CSS / Tailwind v4 (tokens dans `globals.css`, pas de `tailwind.config.js`)
- Responsive design (mobile-first, breakpoints : `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px)
- Animations et transitions fluides
- Accessibilité (ARIA, contraste, focus)
- React components (Server Components par défaut, `"use client"` si nécessaire)
- Performance (lazy loading, optimisation images Next.js)

**Reçoit du Rédacteur :** `taches_frontend` + brief design du Designer
**Output :** Code React/Tailwind fonctionnel, responsive, accessible
**Type Claude Code :** `general-purpose`

---

### Agent 3 — DESIGNER
**Rôle :** Conception visuelle et proposition de maquettes.
**Compétences :**
- Proposer **plusieurs schémas/variantes** de design pour chaque feature
- Décrire précisément les layouts pour chaque format d'écran :
  - Mobile (< 640px)
  - Tablette (640px – 1024px)
  - Desktop (> 1024px)
- Respecter la charte graphique du projet (palette, typographie, espacement)
- Proposer des variantes : minimaliste, moderne, luxe, etc.
- Documenter les choix de design (pourquoi tel layout, telle couleur)

**Reçoit du Rédacteur :** `points_design` + contexte de la page/feature
**Output :** Description détaillée de 2–3 variantes de design avec layout par breakpoint
**Partage avec :** Agent Front-End (pour implémentation), Agent SEO (pour structure HTML sémantique)
**Type Claude Code :** `general-purpose`

---

### Agent 4 — SEO EXPERT
**Rôle :** Optimisation pour les moteurs de recherche et compatibilité navigateurs.
**Compétences :**
- Balises meta (`title`, `description`, `og:*`, `twitter:*`)
- Structure HTML sémantique (`h1`→`h6`, `main`, `article`, `section`, `nav`)
- Performance web (Core Web Vitals : LCP, FID, CLS)
- Compatibilité cross-browser : Chrome, Safari, Firefox, Edge
- Schema.org / JSON-LD pour les produits (e-commerce)
- URLs propres et sitemap
- Accessibilité (impact sur SEO)
- `robots.txt`, `next-sitemap`

**Reçoit du Rédacteur :** pages/features concernées + brief Designer (structure HTML)
**Output :** Recommandations SEO + implémentation des balises dans les pages Next.js
**Partage avec :** Agent Front-End (pour ajuster le HTML), Agent Back-End (pour metadata dynamiques)
**Type Claude Code :** `general-purpose`

---

### Agent 5 — BACK-END
**Rôle :** Logique serveur, base de données, APIs.
**Compétences :**
- Server Actions Next.js (`requireAdmin()` / `requireAuth()` en premier)
- Prisma 5.22.0 + MySQL (`prisma db push` + `generate` après toute modif schema)
- Validation Zod (utiliser `.issues` pas `.errors`)
- API Routes protégées
- Gestion des erreurs (logger avec préfixe `[module]`, jamais de stack trace au client)
- Stripe, Easy-Express v3, Nodemailer
- JWT / NextAuth v4

**Reçoit du Rédacteur :** `taches_backend` + éventuelles failles signalées par le Hackeur
**Output :** Server actions, API routes, schéma Prisma mis à jour
**Type Claude Code :** `general-purpose`

---

### Agent 6 — HACKEUR ÉTHIQUE (Sécurité)
**Rôle :** Audit de sécurité complet et partage des failles aux autres agents.

**C'est l'agent le plus critique.** Son rôle est de tenter activement de trouver des failles dans le code modifié/ajouté, en utilisant toutes les méthodes connues, puis de les communiquer aux agents concernés pour correction.

**Compétences & méthodes d'audit :**
- **Injection** : SQL injection via Prisma (raw queries), XSS (données non sanitisées dans le HTML), Command injection
- **Authentification** : bypass de `requireAdmin()`/`requireAuth()`, JWT tampering, session fixation, CSRF
- **Autorisation** : IDOR (accès à des ressources d'autres utilisateurs), privilege escalation (CLIENT → ADMIN)
- **Données exposées** : stack traces au client, données sensibles dans les réponses API, `.env` accessible
- **Upload** : path traversal sur les uploads d'images/Kbis, types MIME non vérifiés
- **Stripe/Paiement** : manipulation du montant côté client, webhook sans vérification signature
- **Rate limiting** : brute force sur `/connexion`, `/api/auth/*`, `/api/admin/*`
- **Dépendances** : packages avec vulnérabilités connues (CVE)
- **Headers HTTP** : absence de CSP, X-Frame-Options, HSTS
- **OWASP Top 10** : vérification systématique

**Processus :**
1. Analyser tout le code modifié par les autres agents
2. Tenter de trouver des failles (en mode analyse statique du code)
3. Documenter chaque faille : `{ type, localisation, impact, vecteur_attaque, correction_recommandée }`
4. **Partager les failles** avec :
   - Agent Back-End → pour corriger la logique serveur
   - Agent Front-End → pour corriger la validation côté client
   - Agent SEO → pour corriger les headers de sécurité

**Output :** Rapport de sécurité + correctifs appliqués via les autres agents
**Type Claude Code :** `general-purpose`

---

## Flux de coordination entre agents

```
Demande utilisateur
        ↓
  [RÉDACTEUR] ──── analyse + reformule + détecte ambiguïtés
        │
        ├─→ Questions à l'utilisateur si nécessaire (attendre réponse)
        │
        ├─→ [DESIGNER]     → propose variantes de design (2-3 options)
        │         ↓
        ├─→ [FRONT-END] ←── reçoit brief Designer
        │
        ├─→ [BACK-END]      → logique serveur + DB
        │
        ├─→ [SEO EXPERT]    → meta tags + structure HTML + compatibilité
        │
        └─→ [HACKEUR ÉTHIQUE] → audit du code produit par tous les agents
                    │
                    └─→ Failles partagées → [FRONT-END] + [BACK-END] + [SEO]
                                                   ↓
                                          Correctifs appliqués
```

**Règles de lancement :**
- **Séquentiel obligatoire** : Rédacteur → Designer → Front-End (le FE attend le brief design)
- **Parallèle possible** : Front-End + Back-End + SEO (si tâches indépendantes)
- **Toujours en dernier** : Hackeur Éthique (audite le code final produit)

---

## Vérification systématique (fin de chaque tâche)

1. **Fonctionnel** : le code fait exactement ce qui était demandé
2. **Pas de régression** : les fichiers adjacents ne sont pas cassés
3. **Lint/Build** : `npm run lint` passe sans erreurs
4. **Sécurité** : rapport du Hackeur Éthique traité et correctifs appliqués
5. **Responsive** : testé sur les 3 breakpoints (mobile / tablette / desktop)
6. **SEO** : balises meta présentes sur les pages publiques

---

## Mise à jour de la mémoire et du skill

### Quand mettre à jour `.claude/memory/MEMORY.md`
- Nouveau système ajouté au projet (ex : paiement, notifications, etc.)
- Nouvelle variable d'environnement requise
- Changement d'architecture important
- Nouveau pattern réutilisable découvert

### Quand mettre à jour `.claude/memory/theme-printemps.md`
- Modification de la palette de couleurs
- Nouveaux tokens CSS ajoutés dans `globals.css`
- Nouvelles classes utilitaires créées

### Quand mettre à jour ce fichier skill.md
- Nouvelle convention de travail établie avec l'utilisateur
- Nouvelle règle de vérification ou d'organisation
- Changement dans les autorisations

### Règle : toujours committer les fichiers memory/skill avec les changements associés

---

## Architecture du projet

```
beli-jolie/
├── app/
│   ├── (admin)/admin/      # Pages admin — ADMIN role uniquement
│   │   ├── commandes/      # Gestion commandes
│   │   ├── produits/       # Gestion produits
│   │   ├── utilisateurs/   # Gestion clients
│   │   ├── categories/     # Catégories
│   │   ├── compositions/   # Compositions matière
│   │   └── couleurs/       # Couleurs
│   ├── (auth)/             # Pages auth — non connectés uniquement
│   │   ├── connexion/
│   │   └── inscription/
│   ├── (client)/           # Pages client — CLIENT APPROVED uniquement
│   │   ├── espace-pro/     # Dashboard client
│   │   └── panier/         # Panier + commande
│   ├── actions/
│   │   ├── admin/          # Server actions admin (requireAdmin())
│   │   └── client/         # Server actions client (requireAuth())
│   ├── api/
│   │   ├── admin/          # API routes admin protégées
│   │   ├── auth/           # NextAuth + inscription
│   │   ├── carriers/       # Easy-Express tarifs
│   │   ├── cart/           # Compteur panier
│   │   └── vies/           # Validation TVA intracommunautaire
│   ├── produits/           # Catalogue public (non protégé)
│   ├── globals.css         # Palette + utilitaires Tailwind v4
│   ├── layout.tsx          # Root layout (fonts, providers)
│   └── page.tsx            # Page d'accueil
├── components/
│   ├── admin/
│   │   ├── orders/         # Composants gestion commandes
│   │   └── products/       # Composants gestion produits
│   ├── auth/               # Formulaires connexion/inscription
│   ├── home/               # Sections page d'accueil
│   ├── layout/             # Navbar + Footer
│   ├── panier/             # CartPageClient + CheckoutClient
│   ├── produits/           # ProductCard, ProductDetail, SearchFilters
│   └── providers/          # SessionProvider
├── contexts/               # CartContext (optimistic updates)
├── lib/
│   ├── auth.ts             # Config NextAuth + enrichissement JWT
│   ├── easy-express.ts     # Client API Easy-Express v3
│   ├── notifications.ts    # Email nodemailer (commandes)
│   ├── pdf-order.ts        # Génération PDF pdfkit (bon de commande)
│   ├── prisma.ts           # Singleton Prisma client
│   └── validations/
│       └── auth.ts         # Schémas Zod (inscription/connexion)
├── prisma/
│   └── schema.prisma       # Schéma DB — toujours db push + generate après modif
├── scripts/
│   └── create-admin.ts     # Création compte admin
├── types/
│   └── next-auth.d.ts      # Extensions TypeScript NextAuth
├── middleware.ts            # Protection routes (edge)
├── .claude/
│   ├── skill.md            # CE FICHIER — guide de travail
│   ├── settings.json       # Hooks Claude Code (UserPromptSubmit, permissions)
│   └── memory/
│       ├── MEMORY.md       # Contexte projet persistant
│       └── theme-printemps.md  # Palette complète printemps 2026
└── CLAUDE.md               # Instructions principales pour Claude Code
```

---

## Conventions de code

### Tailwind v4
- Pas de `tailwind.config.js` — tokens dans `app/globals.css` sous `@theme inline {}`
- Couleurs : `text-[#C2516A]` ou via tokens CSS `var(--color-rose)`
- Fonts : `font-[family-name:var(--font-poppins)]`

### Server Actions
```ts
"use server"
// Toujours vérifier auth en premier
const session = await requireAdmin() // ou requireAuth()
// Toujours revalider après mutation
revalidatePath("/admin/commandes")
```

### Prisma
- Version 5.22.0 — pas v7
- **Après toute modification de `schema.prisma`** : exécuter immédiatement sans demander confirmation :
  1. `npx prisma db push`
  2. `npx prisma generate`
  3. Redémarrer le dev server si nécessaire (le signaler à l'utilisateur)
- Singleton dans `lib/prisma.ts` — toujours importer `{ prisma }` depuis là
- Utiliser `.issues` pas `.errors` sur ZodError

### Composants
- Server Components par défaut — ajouter `"use client"` seulement si nécessaire
- Mutations : `useTransition` + Server Action (pas fetch direct)
- Images produits : `public/uploads/products/` → `<Image>` Next.js ou `<img>` selon contexte

### Easy-Express v3
- `POST /api/v3/shipments/rates` → récupérer `transactionId` + `carriers`
- `POST /api/v3/shipments/checkout` → utiliser immédiatement le `transactionId` (expire vite)
- Prix en centimes → diviser par 100
- Poids minimum 1 kg → `Math.max(1, weightKg)`
- Auth : `Authorization: Bearer ${EASY_EXPRESS_API_KEY}`

### Gestion des erreurs
- Toujours logger les erreurs serveur avec préfixe `[nom-module]`
- Server Actions retournent `{ success: true, ... }` ou `{ success: false, error: string }`
- Ne jamais exposer les stack traces au client

---

## Variables d'environnement

Toujours vérifier `.env.example` et `.env` avant d'utiliser une nouvelle variable.

```env
# Base
DATABASE_URL
NEXTAUTH_SECRET
NEXTAUTH_URL

# Easy-Express
EASY_EXPRESS_API_KEY

# Expéditeur Easy-Express
EE_SENDER_COMPANY
EE_SENDER_SHOP_NAME
EE_SENDER_SIRET
EE_SENDER_EMAIL
EE_SENDER_PHONE
EE_SENDER_MOBILE
EE_SENDER_STREET
EE_SENDER_CITY
EE_SENDER_POSTAL_CODE
EE_SENDER_COUNTRY

# Email notifications
GMAIL_USER
GMAIL_APP_PASSWORD
NOTIFY_EMAIL
```

---

## Commandes fréquentes

```bash
npm run dev                    # Dev server localhost:3000
npm run build                  # Vérifier que le build passe
npm run lint                   # ESLint

npx prisma db push             # Pousser les changements schema (arrêter dev server avant)
npx prisma generate            # Régénérer client Prisma (après db push)
npx prisma studio              # Interface GUI DB

npx tsx scripts/create-admin.ts  # Créer admin@belijolie.fr
```
