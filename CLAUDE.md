# CLAUDE.md

Guide de Claude Code pour ce dépôt.

## À qui tu parles

La personne qui te parle **n'est pas développeuse** — elle dirige le projet. Parle-lui comme à une cliente qui veut savoir ce qui a changé sur son site, pas comme à un collègue technicien :
- **Pas de jargon** ("fonction", "endpoint", "cache", "schema"…). Si obligé, explique le mot en une phrase de tous les jours.
- **Dis ce qui change pour elle et ses clients** sur le site, pas ce que tu as touché dans le code.
- **Court, en français simple.** Pas de longues listes techniques.
- **Tests proposés = trajets dans le site** (*« Ouvrez l'admin, allez dans Produits… »*) — jamais de commandes terminal.
- **Détails techniques** restent entre toi et le code.

> **Docs détaillées** : `docs/architecture.md` · `docs/pfs-system.md` · `docs/styling.md` · `docs/pfs-api.md`

---

## Règles de travail

- **Auto-maintenance CLAUDE.md** : mettre à jour si nouvelle convention/env var importante.
- **Parallélisation** : sous-agents en parallèle quand les sous-tâches sont indépendantes.
- **Récap demande** : à la fin de chaque réponse, section **« Ce que vous m'avez demandé »** (1-3 phrases).
- **Impact croisé** : avant de coder, vérifier si d'autres fonctionnalités peuvent être impactées. Si oui, prévenir **avant** de toucher au code.
- **Suggestions** : si une variante peut améliorer la tâche (UX, robustesse, perf), la proposer en plus. Elle décide.
- **Tests unitaires obligatoires** sur toute nouvelle feature ou modif (Vitest).

### Workflow modification → validation → push

Quand l'utilisatrice demande **corriger / réparer / mettre à jour** quelque chose qui touche au site :

1. **Modifier en local uniquement** (`C:\Users\Admin\Desktop\beli-jolie\`). Pas de push automatique.
2. **À la fin**, l'informer que c'est prêt à tester en local + trajet de test dans le site.
3. **Attendre sa décision** :
   - **« Mettre de côté »** → garder local pour push grouper plus tard.
   - **« Push en production »** → boucle complète :
     1. `git add` + `git commit` + `git push origin master`
     2. `ssh root@72.61.106.128` puis `cd /var/www/beliandjolie && git fetch origin master && git reset --hard origin/master`
     3. `npm install --no-audit --no-fund` (si deps modifiées) + `npx prisma generate && npx prisma db push --skip-generate` (si schema modifié)
     4. `NODE_OPTIONS='--max-old-space-size=4096' npm run build`
     5. `pm2 restart beliandjolie`
     6. **Vérif parcours visiteur** : `curl -sL` sur la route concernée, suivre les redirections, vérifier le `<title>` final — pas juste un endpoint interne.
4. **L'informer à la fin** dans tous les cas. Code identique aux 3 endroits (local, GitHub, VPS).

**Exception Ankorstore** : push direct en prod (les callbacks async ne hittent pas localhost, donc le local ne sert à rien).

Confirmation **uniquement** avant actions vraiment risquées (suppression de données, drop tables, push --force, secrets).

### Procédures en attente (déclenchées par phrase de code)

- **« feu vert journaux »** → exécuter `docs/operations/mysql-binlog-cleanup.md`. Une fois réussie, **supprimer le fichier et retirer cette ligne**.

---

## Architecture

B2B SaaS e-commerce générique (vente en gros). Stack : **Next.js 16 App Router · MySQL (Prisma) · Tailwind v4 · TypeScript**.

### Route groups (`app/`)

| Group | URL | Access |
|-------|-----|--------|
| `(auth)` | `/connexion`, `/inscription` | Unauthenticated only |
| `(admin)` | `/admin/*` | ADMIN role |
| `(client)` | `/espace-pro/*`, `/panier/*`, `/commandes/*`, `/favoris` | CLIENT APPROVED |
| *(direct)* | `/produits/*`, `/collections/*`, `/categories` | Public — visiteurs OK, prix masqués si pas APPROVED |

Protection : `middleware.ts` (edge) + group `layout.tsx`. Maintenance avec cache 60s **on success only** (pas de lock 1min sur erreur transitoire).

**Visibilité des prix** : `lib/price-visibility.ts` (`canSeePrices(session)`). API publique remet `unitPrice`/`discountPercent` à 0/null si pas autorisé ; filtres `minPrice/maxPrice` ignorés (anti-dichotomie). UI affiche « Connectez-vous pour voir les prix ».

### Layers
- **Server actions** (`app/actions/admin|client/`) — toutes mutations, `requireAdmin()`/`requireAuth()` obligatoires.
- **API routes** (`app/api/`) — webhooks, SSE, file-serving.
- **Lib** (`lib/`) — business logic. Modules clés : `pfs-*`, `ankorstore-*`, `marketplace-pricing.ts`, `storage.ts`, `email.ts`, `cached-data.ts`, `security.ts`, `encryption.ts`, `logger.ts`, `seo.ts`.
- **Components** — `admin/`, `client/`, `ui/`, `home/`.

### Marketplaces (PFS + Ankorstore)

- **Identifiants** : `Product.pfsProductId`/`ankorsProductId` + `ProductColor.pfsVariantId`/`ankorsVariantId`. `null` = non publié.
- **Kill switch Ankorstore** : `getCachedAnkorstoreEnabled()` (Paramètres > Marketplaces). PFS toujours actif si configuré.
- **Modale au save produit** : case à cocher par marketplace si produit complet + marketplace configurée → enqueue dans `MarketplaceRefreshWidget`.
- **Publish vs Update** : `*UpdateProductInPlace()` si ID connu (PATCH avec diff snapshot), sinon `*PublishProduct()`. Fallback publish si update échoue.
- **Diff snapshot** (`Product.pfsLastSyncSnapshot` Json?) : envoie à PFS seulement ce qui a changé. Reset à `Prisma.DbNull` quand `pfsProductId` change. `null` = sync complète.
- **Resync forcé** : icône ↻ sur la fiche produit, `forceFullSync: true` → diff complet, ne touche pas l'ID.
- **Best Seller PFS** : appliqué au save (pas toggle instantané). STAR/REMOVE_STAR seulement si changé.
- **Annexes PFS** : LIVE via `lib/pfs-annexes.ts` (cache 60min, tag `pfs-annexes`).
- **Proxy images marketplace** : `/api/marketplace-image?path=...` upscale à 500px si source < 500px (Ankorstore exige ≥ 500px). Fichiers d'origine intacts. Pas appliqué à PFS.
- **Delete** : PFS = local-only. Ankorstore = propagation auto callback-only via `ankorstoreKickoffStandaloneDelete()`.

### Mode callback-only Ankorstore

Toutes opérations Ankorstore (publish, update, refresh, delete) **asynchrones** : kickoff → retour immédiat avec `operationId` → résultat via webhook (`/api/webhooks/ankorstore`). **Aucun polling Ankorstore.**

- Table `AnkorstoreOperation` (id, productId, type, status, payload, callbackPayload).
- `ANKORSTORE_WEBHOOK_SECRET` (env var) dans la query string du callback URL.
- **Dev local** : Ankorstore ne peut pas appeler `localhost` → opérations restent `PENDING`. Tests en prod uniquement.
- UI poll `/api/admin/ankorstore-operations` toutes les 3s.
- Si callback perdu : op bloquée. Re-cliquer « Publier » relance (annule les anciennes PENDING).
- PATCH stock/prices restent synchrones (pas besoin de callback).

### Refresh produit

Bouton « Rafraîchir » + bulk. Modale avec cases : boutique (bump `lastRefreshedAt`) + PFS + Ankorstore. Traitement parallèle limité (5 simultanés) via `MarketplaceRefreshWidget`. `pfsRefreshProduct()` crée nouveau produit avec ref TEMP, archive l'ancien, renomme. Rollback auto si échec.

« Nouveauté » frontend = `max(createdAt, lastRefreshedAt) > now - 30j`.

### Marketplace pricing (`lib/marketplace-pricing.ts`)

Markup par marketplace via SiteConfig : 3 types (`percent`/`fixed`/`multiplier`), 3 arrondis (`none`/`up`/`down`). Clés : `{marketplace}_price_markup_{type|value|rounding}`. **PACK** : markup sur prix unitaire (total ÷ qty), arrondi, puis × qty. Jamais sur le total.

### Import PFS (auto-création des attributs)

`/admin/produits/importer-pfs` — choix produits → import direct. Chaque attribut manquant (composition, pays, saison, taille, couleur, catégorie) est **créé auto à la volée** dans `createOrLinkMapping`. Auto-traduction en arrière-plan via API PFS.

Rattrapage : `npx tsx scripts/enrich-pfs-products.ts`.

### Import Excel produits

`/admin/produits/importer` : upload → preview server → **récap éditable UI** → confirmation → job background. **Format Excel uniquement**.

- Modèle Excel : 5 lignes d'en-tête figées (section / headers / Obligatoire/Facultatif / exemples / données).
- Composants clés : `EditableProductCard`, `EntitySelect` (avec bouton « + »), `CompositionEditor`, `effective-status.ts` (compteur "Prêts" basé sur l'effective, pas l'analyse serveur initiale), `QuickCreateModal` (réutilise celui de `/admin/produits?tab=categories`).
- **Overrides** : type `ImportOverride` sérialisé en JSON dans `{filePath}.overrides.json`, appliqué après propagation référence, avant validation.
- **Quick-create idempotent** : entités existantes → mise à jour des mappings, pas P2002.

### Auth

NextAuth v4, Credentials + JWT (30d). New users = `PENDING` → admin approves. Token : `id`, `role`, `status`, `company`.

### i18n

next-intl 4.x, **routing par préfixe** (`/fr/...`, `/en/...`). Locales : **fr (défaut) + en**. Auto-translation : **API PFS** (gratuit, lié au compte). Toggle : `auto_translate_enabled`.

- Routes hors i18n : `/admin/*`, `/api/*`, `/maintenance`, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/icon`, `/apple-icon`.
- Liens admin → public : hardcoder `/fr/...`.
- Sitemap : 7× chaque URL (1 par locale) avec `alternates.languages`.
- Sélecteur de langue : `router.replace(pathname, { locale })`.
- **Mapping PFS pays/composition** : par libellé FR (`pfsCountryRef = "Chine"`). Côté publish, `country_of_manufacture` suit priorité `isoCode → pfsCountryRef → "CN"`.

### Styling

**Tailwind CSS v4** — pas de `tailwind.config.js`, theme dans `app/globals.css` `@theme {}`. **Pas de dark mode**. Clean flat design avec ombres subtiles. **No claymorphism** — utilities Tailwind standard (`shadow-sm/md/lg`).

### Enums Prisma

`ProductStatus` (OFFLINE|ONLINE|ARCHIVED|SYNCING), `SaleType` (UNIT|PACK), `OrderStatus` (PENDING|SHIPPED|CANCELLED — workflow simplifié, PENDING libellé « Nouveau » admin / « En attente » client, seule transition = PENDING → SHIPPED, annulation depuis PENDING seul), `UserRole` (ADMIN|CLIENT), `UserStatus` (PENDING|APPROVED|REJECTED).

---

## Versions critiques

| Lib | Version | Contrainte |
|-----|---------|-----------|
| Next.js | 16.1.6 | `params` = `Promise` (await). `revalidateTag("tag", "default")` = 2 args |
| Prisma | 5.22.0 | **PAS v7** |
| NextAuth | v4 | **PAS v5** |
| Zod | 4.3.6 | `.issues` PAS `.errors` |
| Tailwind | v4 | No config file, theme dans `globals.css` |
| React | 19.2.3 | |

`serverExternalPackages: ["pdfkit", "sharp", "exceljs"]` dans `next.config.ts`. Path alias `@/*` → `./*`.

---

## Gotchas critiques

### UI / Components
- **`ssr: false`** interdit dans Server Components → wrapper `"use client"`.
- **`PublicSidebar.tsx`** = header public (PAS `Navbar.tsx`).
- **Badges** : toujours `badge badge-*` (success/warning/error/neutral/info/purple).
- **Dropdowns** : toujours `CustomSelect`, jamais `<select>` natif.
- **UI context** : `useConfirm()` (ConfirmDialog), `useToast()` (Toast) — pas de default import.
- **No dark mode** : CSS variables (`bg-bg-primary`, `text-text-primary`, `border-border`).
- **Touch targets** min 44px, `prefers-reduced-motion` respecté.

### Produits / Variantes
- **Ne jamais supprimer** un produit `ARCHIVED`.
- **`Color.patternImage`** prioritaire sur `Color.hex`.
- **Une variante = une couleur**. `groupKey` = `colorId` (helper `variantGroupKeyFromState()`).
- **PACK mono-couleur** : `colorId` + `VariantSize`. `unitPrice` = `computeTotalPrice(v)` (total du pack en BDD, pas unitaire).
- **PACK multi-couleurs** : `PackColorLine[]` + `PackColorLineSize[]`. `variantSizes` vide. Détection : `isMultiColorPack(v)` UI / `c.packLines.length > 0` serveur.
- **UNIT** : max 1 taille (description, pas sélection client).
- **OrderItem.sizesJson** : préférer sur `OrderItem.size` legacy.

### Server actions / Caching
- **`requireAdmin()` / `requireAuth()`** obligatoire.
- Retour cohérent : `{ success: boolean, error?: string }`.
- **Cache** : `getCached*` + `revalidateTag(tag, "default")` (2 args Next 16).
- **TTLs** : 5min (site-config, dashboard), 10min (bestsellers), 60min (categories, colors, tags, collections, sizes, countries, seasons, pfs-annexes).

### Logging
- **Jamais `console.log/warn/error`** côté serveur → `import { logger } from "@/lib/logger"`.
- Pour Type erreur + Stack : `logger.error("[X] msg", { error: err })`.
- `instrumentation.ts` capte `uncaughtException`/`unhandledRejection`.

### Auth redirect
- **Login → /admin** : `window.location.href = "/admin"` (full reload), **pas** `router.push()` (le router localisé produirait `/fr/admin` qui est 404).

### Encryption
- `lib/encryption.ts` AES-256-GCM, clé maître = `ENCRYPTION_KEY` (base64 32 bytes).
- `SENSITIVE_KEYS` = liste des clés SiteConfig chiffrées. Ajouter toute nouvelle clé sensible.

### Images & fichiers (stockage local)
- Module unique : `lib/storage.ts`. Helpers : `productImageDir/BaseName`, `collectionImageDir`, `bannerDir`, `kbisDir`, `invoiceDir`, etc. **Ne jamais hardcoder de path.**
- **Arbo publique** `public/uploads/` : `produits/`, `collections/`, `motifs-couleurs/`, `banniere/`, `catalogues/`, `bordereaux/`, `reclamations/`.
- **Arbo privée** `private/uploads/` : `kbis/`, `documents/`, `factures/`, `pieces-jointes-email/`, `avoirs/`.
- Images produit : WebP 3 tailles (large/`-md`/`-thumb`), max 5 par couleur. Lecture compat avec ancien `_md`/`_thumb` via `getImagePaths()`.
- Renommage auto : `renameProductFolder(oldRef, newRef)` dans la transaction Prisma.
- Brouillon : `uploads/produits/_brouillon/` si pas encore de référence.
- DB paths déjà au format URL publique.
- **PFS image sync** : JPEG uniquement (pas WebP), upload multipart. Logs `[PFS Images]`.
- Reset data : `npx tsx scripts/wipe-data.ts` (préserve ADMIN, SiteConfig, CompanyInfo, LegalDocument).

### SEO
- `lib/seo.ts` : `buildAlternates(path)`, `buildOrganizationSchema()`, `buildWebsiteSchema()`.
- **Organization JSON-LD** rendu **uniquement** dans `app/layout.tsx`. `WebSite` sur home. `Product` + `BreadcrumbList` sur fiche produit.
- Clés SiteConfig SEO : `site_logo_url`, `social_*_url` (facebook/instagram/linkedin/twitter/youtube/tiktok).
- Favicon dynamique : `app/icon.tsx` + `apple-icon.tsx` via `ImageResponse`.

### Integrations
- **SSE** : `lib/product-events.ts` via `globalThis` singleton. Hook : `useProductStream()`.
- **Easy-Express** : prix en centimes (÷100), poids min 1kg, +5€ marge, transactionId expire vite.

---

## Variables d'environnement

- **Obligatoires** : `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_KEY`.
- **Stripe (env-only)** : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Plus de Stripe Connect, plus d'UI admin Paiement.
- **Email** : `SMTP_HOST/PORT/SECURE/USER/PASSWORD/FROM_EMAIL/FROM_NAME`. Destinataire admin = **Paramètres > Société > Email** (plus de `NOTIFY_EMAIL`).
- **Ankorstore webhook** : `ANKORSTORE_WEBHOOK_SECRET`.
- **Via UI admin (chiffrés en BDD)** : clé Easy-Express, identifiants PFS (email + mot de passe — réutilisés pour la traduction auto).

---

## Commandes

```bash
npm run dev / build / start / lint
npm run test / test:watch / test:coverage   # Vitest
npm run test:pfs-smoke                      # PFS smoke tests
npx prisma db push && npx prisma generate   # Après modif schema, redémarrer dev d'abord
npx prisma studio
npx tsx scripts/create-admin.ts
```

Integration tests : `__tests__/integration/` (DB-backed, `fileParallelism: false`).

---

## Production (`https://beliandjolie.com`)

VPS Hostinger Ubuntu 24.04 LTS. Code dans `/var/www/beliandjolie`. Nginx → Next.js (`127.0.0.1:3000`). PM2 géré par systemd (`pm2-root.service`). MySQL 8, Node 20 LTS, Certbot HTTPS.

- **`.env` prod** : `/var/www/beliandjolie/.env`. ⚠️ Lu uniquement au démarrage → `pm2 restart beliandjolie` après modif.
- **UFW** : seuls 22/80/443 ouverts. SSH par clé uniquement.
- **Lecteur réseau Windows V:** monté via SSHFS-Win → édition directe `.env` et fichiers du site.
- **Playwright Chromium** (import PFS) : pas installé par `npm install`. Après deploy initial / upgrade Playwright :
  ```
  ssh root@72.61.106.128 "cd /var/www/beliandjolie && npx playwright install --with-deps chromium"
  ```
- **Pas dans le repo** : `scripts/deploy/`, `public/uploads/`, `private/uploads/`. **Sauvegarder régulièrement uploads VPS** (rsync/cron).
