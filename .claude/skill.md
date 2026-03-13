# Skill — Beli & Jolie

Guide de travail pour Claude Code sur ce projet. À lire et appliquer systématiquement.

---

## Autorisation d'exécution

Claude a **libre accès** pour exécuter toutes les commandes nécessaires au projet sans demander confirmation :
- `npm run dev / build / lint`
- `npx prisma db push / generate / studio`
- `git add / commit / push`
- Toute commande terminal liée au projet

> Exception : actions destructives irréversibles (drop DB, reset --hard, force push) → toujours confirmer.

---

## Organisation du travail

### TodoWrite — obligatoire pour toute tâche non triviale
1. Décomposer chaque demande en sous-tâches dès réception
2. Marquer `in_progress` AVANT de commencer chaque sous-tâche
3. Marquer `completed` IMMÉDIATEMENT après
4. Ne jamais avoir plus d'une tâche `in_progress` à la fois

### Agents parallèles
- Utiliser plusieurs sous-agents en parallèle (outil `Agent`) si les tâches sont indépendantes
- Exemples : corriger des bugs dans des fichiers différents, créer plusieurs pages simultanément

### Vérification systématique
À chaque fin de tâche :
1. **1ère vérification** : le code fait ce qui était demandé
2. **2ème vérification** : pas de régressions sur les fichiers adjacents
3. **3ème vérification** : `npm run lint` (ou build si besoin) ne retourne pas d'erreurs

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
- Après modif schema : `npx prisma db push` puis restart dev server puis `npx prisma generate`
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
