# Chantier multi-tenant — à finir

**Objectif** : 1 seule installation Next.js qui sert plusieurs boutiques (Beli & Jolie, Issyma, futures cliente…) selon le domaine tapé. Fini les clones à maintenir un par un.

**Session du 2026-07-11** : phases 1 à 6 codées + isolation cross-tenant validée par test (5/5). Poussé sur `master`. Cron auto-pull VPS désactivé (plus de déploiement automatique par accident).

---

## Reprendre sur un autre PC — 5 min

```bash
git clone git@github.com:Gnaris/beli-jolie.git
cd beli-jolie
npm install
npx prisma generate
npx prisma db push --skip-generate    # applique le schéma multi-tenant à la BDD locale
npx tsx scripts/seed-default-tenant.ts    # crée la boutique "beli-jolie" en local
MULTI_TENANT_SCOPE=off npx tsx scripts/backfill-tenant-id-all.ts    # rattache toutes les données existantes à cette boutique
npm run dev
```

Ouvrir `http://localhost:3000` — le site doit répondre normalement.

Pour rejouer le test d'isolation cross-tenant (5/5 doit passer) :

```bash
MULTI_TENANT_SCOPE=off npx tsx scripts/dev/clean-and-reseed-demo.ts    # crée la boutique "demo" avec 3 produits test
MULTI_TENANT_SCOPE=off npx tsx scripts/dev/test-cross-tenant-fix.ts
```

---

## Ce qui reste à faire — dans l'ordre

### 1. Table `SiteConfig` : clé primaire composite

**Le problème** : la table qui stocke toute votre config (Stripe, maintenance, marges livraison, clés marketplaces…) a aujourd'hui une clé primaire qui empêche 2 boutiques d'avoir des configs séparées. Un `insert` d'Issyma sur `maintenance_mode` échouerait car Beli & Jolie a déjà cette ligne.

**Ce qu'il faut faire** :
- Dans `prisma/schema.prisma`, changer le modèle `SiteConfig` : remplacer `@@id([key])` par `@@id([tenantId, key])`.
- Dans le code, remplacer les ~126 appels `siteConfig.findUnique({ where: { key } })` par `siteConfig.findFirst({ where: { key } })` (l'extension multi-tenant ajoute `tenantId` toute seule).
- Fichiers touchés majoritaires : `lib/cached-data.ts`, `app/actions/admin/site-config.ts` (41 appels dedans), `app/api/site-status/route.ts`, `lib/onboarding.ts`, `lib/health.ts`, `app/actions/admin/stripe-config.ts`, `app/actions/admin/onboarding.ts`, `app/actions/admin/marketplace-refresh.ts`, `app/actions/admin/mailbox-provision.ts`, `lib/auto-translate.ts`.

Pour lister tous les appels : `grep -rn "siteConfig\.findUnique" --include="*.ts" .`

### 2. Références produits, numéros de commande, emails clients : unicité par boutique

**Le problème** : aujourd'hui la référence produit (ex: `E807`) est unique dans TOUTE la BDD. Impossible qu'Issyma vende un produit avec la même référence qu'un produit de Beli & Jolie. Idem pour les numéros de commande, les emails clients, les SIRETs.

**Ce qu'il faut faire** dans `prisma/schema.prisma` :
- `Product.reference` : passer de `@unique` à `@@unique([tenantId, reference])`
- `Order.orderNumber` : idem
- `User.email` : idem
- `User.siret` : idem
- `User.stripeCustomerId` : idem
- Marketplaces IDs (`Product.pfsProductId`, `ankorsProductId`, `efashionReferenceBase`, `faireProductId`) : idem

Puis `prisma db push` en local pour appliquer.

### 3. Chemins d'upload : passer le slug boutique aux ~60 endroits qui créent des fichiers

**Le problème** : quand on ajoute une image produit aujourd'hui, le chemin est calculé sans savoir à quelle boutique appartient l'image. En pratique elle irait dans `/uploads/produits/…` (ancien path partagé) au lieu de `/uploads/beli-jolie/produits/…` (bon path).

**Ce qu'il faut faire** : dans chaque endroit du code qui appelle un des helpers `productImageDir`, `collectionImageDir`, `bannerDir`, `faviconDir`, `colorPatternDir`, `chatAttachmentDir`, `bordereauDir`, `kbisDir`, `clientDocumentsDir`, `invoiceDir`, `claimDir`, `creditNoteDir`, `emailAttachmentDir`, ajouter en 2ᵉ argument `tenant.slug` (récupéré via `const { tenant } = await requireAdmin()` ou équivalent).

**Fichiers concernés** (~60 endroits, liste complète dans le rapport de l'audit) :
- `app/api/admin/products/images/route.ts:76, 82`
- `app/api/admin/products/import/images/route.ts:229`
- `app/api/admin/products/import/draft/[id]/route.ts:377`
- `app/api/admin/collections/images/route.ts:51`
- `app/api/admin/banner/image/route.ts:46`
- `app/api/admin/favicon/image/route.ts:48`
- `app/api/admin/colors/upload-pattern/route.ts:56`
- `app/api/admin/commandes/[id]/invoice/route.ts:55`
- `app/api/auth/register/route.ts:164, 215`
- `app/api/client/claims/upload/route.ts:59`
- `app/api/chat/upload/route.ts:52`
- `app/actions/client/upload-bordereau.ts:69`
- `app/actions/admin/products.ts:1646, 2299`
- `app/actions/admin/collections.ts:207`
- `app/actions/admin/ankorstore.ts:776`
- `lib/pfs-import.ts:1618, 1775`
- `lib/import-processor.ts:1596`

Trouver le reste avec : `grep -rn "productImageDir\|collectionImageDir\|bannerDir\|faviconDir\|colorPatternDir\|chatAttachmentDir\|bordereauDir\|kbisDir\|clientDocumentsDir\|invoiceDir\|claimDir\|creditNoteDir\|emailAttachmentDir" --include="*.ts" .`

### 4. Test Vitest CI qui figure l'isolation cross-tenant

**Le but** : que le test d'isolation `scripts/dev/test-cross-tenant-fix.ts` tourne en Vitest automatiquement pour ne jamais casser l'isolation par accident.

**Ce qu'il faut faire** :
- Créer `__tests__/integration/cross-tenant-isolation.test.ts` qui :
  1. Crée 2 tenants de test avec `TEST_INTEG_` prefix
  2. Crée un produit + une commande dans chaque
  3. Depuis un mock de `getCurrentTenant()` sur tenant A, tente delete/update/upsert sur les rows de tenant B
  4. Vérifie que chaque tentative throw ET que la BDD est intacte
- Nettoyage dans `setup.ts::cleanupTestData` (déjà en place pour Tenant/TenantDomain).

---

## La bascule prod — après les 4 points ci-dessus

Ne pas lancer avant que tout ce qui précède soit codé + testé.

Ordre :
1. Tester d'abord sur `demo.beliandjolie.com` (staging) via le playbook adapté.
2. Une fois validé sur demo, faire la vraie bascule sur `beliandjolie.com` + `issyma.com`.

Le playbook complet est dans `scripts/deploy/multitenant-cutover-playbook.md`. Il détaille :
- Backup complet des 2 BDD + uploads (`scripts/deploy/multitenant-backup.sh`)
- Passage en maintenance
- Fusion des BDD (les données Issyma injectées dans `beli_jolie` avec `tenantId=issyma`)
- Migration des uploads Issyma sous `public/uploads/issyma/`
- Bascule Nginx vers un seul vhost catch-all
- Arrêt du PM2 Issyma, restart Beli & Jolie avec le nouveau code
- Vérifications visiteur + admin + marketplaces
- Rollback complet documenté si un truc casse

Prévoir ~30 min de coupure des 2 sites pendant la bascule, un soir de faible trafic. Prévenir Issyma de mettre son onboarding en pause avant.

---

## Fichiers importants créés pendant le chantier

**Le code multi-tenant** :
- `lib/tenant.ts` — helpers server-side (`getCurrentTenant`, `requireCurrentTenant`, …)
- `lib/tenant-als.ts` — AsyncLocalStorage qui propage le tenant à travers les microtasks Prisma
- `lib/prisma-tenant-scope.ts` — extension Prisma qui scope auto tous les reads/writes par tenant
- `lib/auth-helpers.ts` — `requireAdmin`/`requireAuth` centralisés qui vérifient aussi le tenant JWT
- `middleware.ts` (modifié) — résout host → tenant, injecte les headers
- `app/api/tenant-by-host/route.ts` — endpoint interne de résolution

**Les scripts utilitaires** :
- `scripts/seed-default-tenant.ts` — seed le tenant beli-jolie
- `scripts/backfill-tenant-id-all.ts` — rattache toutes les données existantes à beli-jolie
- `scripts/propagate-tenant-id.ts` — script qui a ajouté tenantId aux 63 modèles Prisma (déjà exécuté)
- `scripts/normalize-collations.ts` — normalise les collations MySQL (déjà exécuté)
- `scripts/migrate-uploads-to-tenant.ts` — déplace les uploads sous `{tenantSlug}/…` (déjà exécuté en local)
- `scripts/dev/seed-demo-tenant.ts` — crée la 2ᵉ boutique test "demo"
- `scripts/dev/test-cross-tenant-fix.ts` — test bout-en-bout d'isolation (5/5)

**La documentation** :
- `scripts/deploy/multitenant-backup.sh` — backup complet prod
- `scripts/deploy/multitenant-cutover-playbook.md` — les 7 étapes de la bascule
- `scripts/deploy/README.md` — état du dossier deploy après cleanup
- Ce fichier (`CHANTIER-MULTITENANT-A-FINIR.md`) — le plan de reprise

---

## Découvertes techniques à retenir (pour ne pas re-tomber dedans)

- **`next/headers` ne fonctionne pas dans les callbacks async d'extensions Prisma** avec Next 16 + Turbopack. Le request scope Next.js ne survit pas aux microtasks. On utilise `lib/tenant-als.ts` (AsyncLocalStorage Node natif) pour propager le tenantId. Peuplée par `getCurrentTenant()` au début du handler.
- **`fetch()` de Node (undici) refuse silencieusement le Host header custom** — un `fetch('http://127.0.0.1:3000', { headers: { Host: 'beliandjolie.com' } })` part quand même avec Host=127.0.0.1:3000. Pour les tests multi-tenant, utiliser `http.request` du module `node:http`.
- **Middleware Next.js peut boucler à l'infini** si ses fetch internes ne sont pas dans une liste de bypass. On saute la logique middleware pour `/api/tenant-by-host`, `/api/site-status`, `/api/onboarding-status` (voir `isInternalMiddlewareCall` dans `middleware.ts`).
- **Cache `unstable_cache`** partage les entrées entre tenants si `keyParts` ne contient pas le tenantId. Le helper `tenantScopedCache` dans `lib/cached-data.ts` gère ça automatiquement.

---

**Feuille de route récap** :

- [ ] SiteConfig PK composite + refactor 126 findUnique
- [ ] Uniqueness per-tenant (5 champs à passer en @@unique composite)
- [ ] Uploads : passer tenant.slug aux 60 callers
- [ ] Test Vitest isolation cross-tenant
- [ ] Bascule staging (demo.beliandjolie.com)
- [ ] Bascule prod (beliandjolie.com + issyma.com) — soir de faible trafic
