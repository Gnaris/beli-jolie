# Plan d'architecture — Beli & Jolie SaaS multi-boutiques

## 0. Vue d'ensemble en deux phrases

On transforme le site actuel en une plateforme où chaque **cliente** (= « tenant ») gère sa propre boutique sous son propre sous-domaine, en gardant **toutes les données dans la même base** mais en ajoutant une étiquette `tenantId` sur chaque ligne. Beli & Jolie devient simplement la **première boutique** parmi d'autres, sans aucune perte de données ni d'images.

---

## 1. Inventaire de l'existant impacté

### 1.1 Tables Prisma à étiqueter `tenantId` (= cloisonnement)

Toutes les tables ci-dessous reçoivent une colonne `tenantId String` + index + clé étrangère vers `Tenant.id`. Toute requête Prisma qui les touche DOIT inclure `where: { tenantId }`.

**Bloc « Catalogue & produits »** (28 tables)
- `Product`, `ProductColor`, `ProductColorImage`, `VariantSize`, `PackColorLine`, `PackColorLineSize`
- `ProductComposition`, `ProductSimilar`, `ProductBundle`, `PendingSimilar`, `ProductTag`, `ProductTranslation`
- `Category`, `CategoryTranslation`, `SubCategory`, `SubCategoryTranslation` *(voir décision §7 — peuvent rester globales)*
- `Color`, `ColorTranslation` *(voir décision §7)*
- `Composition`, `CompositionTranslation` *(idem)*
- `Tag`, `TagTranslation` *(idem)*
- `Size` *(idem — la bibliothèque de tailles est mince et générique)*
- `Season`, `SeasonTranslation` *(propre à chaque boutique)*
- `ManufacturingCountry`, `ManufacturingCountryTranslation` *(globale en pratique — pays géographiques)*
- `HsCode` *(globale — codes douaniers internationaux)*
- `Collection`, `CollectionTranslation`, `CollectionProduct`
- `Catalog`, `CatalogProduct`
- `Promotion`, `PromotionCategory`, `PromotionCollection`, `PromotionProduct`, `PromotionUsage`

**Bloc « Commerce »** (10 tables)
- `User` (cf. décision §7 sur les comptes cross-tenants), `ShippingAddress`
- `Cart`, `CartItem`
- `Order`, `OrderItem`, `OrderItemModification`
- `Favorite`, `RestockAlert`
- `Credit`, `CreditUsage`

**Bloc « SAV & messagerie »** (8 tables)
- `Conversation`, `Message`, `MessageAttachment`
- `Claim`, `ClaimItem`, `ClaimImage`, `ClaimReturn`, `ClaimReship`

**Bloc « Marketplaces »** (5 tables)
- `AnkorstoreOperation`, `MarketplaceRefreshJob`
- `EfashionShootingBatchItem`
- `ImageProcessingJob`
- `StripeWebhookEvent`

**Bloc « Stock & historique »** (3 tables)
- `StockMovement`, `PriceHistory`, `ProductView`

**Bloc « Imports & jobs »** (3 tables)
- `ImportJob`, `ImportDraft`, `LoginOtp`

**Bloc « Config & légal »** (4 tables)
- `SiteConfig` (clé/valeur — devient `(tenantId, key)` composite), `CompanyInfo`
- `LegalDocument`, `LegalDocumentVersion`

**Bloc « Analytics »** (1)
- `Visit`

### Tables qui restent **globales** (= sans `tenantId`)
- `Tenant` (nouvelle table)
- `User` *(si on choisit le modèle « un compte = plusieurs boutiques »)* — voir décision §7
- `LoginAttempt`, `AccountLockout`, `RegistrationLog` *(sécurité globale par email/IP)*
- `PasswordResetToken` *(le token est l'unique)*
- `TranslationQuota` *(quota provider partagé)*
- Selon décision §7 : `Category`, `Color`, `Composition`, `Tag`, `Size`, `ManufacturingCountry`, `HsCode` peuvent rester globales partagées.

### 1.2 Modules `lib/` à adapter (résumé par famille)

- **PFS** : `pfs-annexes.ts`, `pfs-api.ts`, `pfs-api-write.ts`, `pfs-auth.ts`, `pfs-brand.ts`, `pfs-color-conflicts.ts`, `pfs-family-resolve.ts`, `pfs-import.ts`, `pfs-import-processor.ts`, `pfs-list-cache.ts`, `pfs-publish.ts`, `pfs-refresh.ts`, `pfs-status.ts`, `pfs-sync-diff.ts`, `pfs-translate.ts`, `pfs-update.ts`
- **Ankorstore** : `ankorstore-api.ts`, `ankorstore-api-write.ts`, `ankorstore-auth.ts`, `ankorstore-catalog-cache.ts`, `ankorstore-delete.ts`, `ankorstore-publish.ts`, `ankorstore-refresh.ts`, `ankorstore-update.ts`, `ankorstore-search-rank.ts`, `ankorstore-sync-diff.ts`, `ankorstore-variant-link.ts`
- **eFashion** : tous les `efashion-*.ts` (15 fichiers)
- **Cache** : `cached-data.ts` (réécriture des tags `["categories"]` → `["categories", tenantId]`)
- **Storage** : `lib/storage.ts` — toutes les fonctions `*Dir()` reçoivent un `tenantSlug`
- **Marketplaces croisés** : `marketplace-pricing.ts`, `marketplace-image.ts`, `marketplace-queue-serializer.ts`, `marketplace-queue-worker.ts`, `bulk-variant-marketplace-targets.ts`
- **Workers singleton** : `image-queue.ts`, `marketplace-queue-worker.ts`, `ankorstore-catalog-cache.ts` — déjà multi-jobs en parallèle, mais chaque job en BDD recevra `tenantId` ; le worker lit cette colonne et l'utilise pour ouvrir l'`AsyncLocalStorage`.
- **Auth/Session** : `auth.ts` — ajout du `tenantId` actif dans le JWT
- **SiteConfig & encryption** : `cached-data.ts` lit `site_config` → devient lookup par `(tenantId, key)` ; `encryption.ts` reste global (clé maître unique).
- **Notifications** : `email.ts`, `notifications.ts`, `restock-alert/*` — l'email vient du `CompanyInfo` du tenant, plus de `NOTIFY_EMAIL` global.
- **Easy-Express** : `easy-express.ts` — la clé API est propre au tenant.
- **Stripe** : `stripe.ts` + `app/api/payments/*` — voir décision §7.
- **Affichage** : `product-display.ts`, `product-display-shared.ts`, `seo.ts` (`buildOrganizationSchema()` lit `site_logo_url` — devient par-tenant)
- **Sécurité applicative** : `security.ts` (login attempts) reste global ; `rate-limit.ts` peut rester global ou par tenant selon volume.

### 1.3 Server actions à propager

**`app/actions/admin/` (40 fichiers)** — toutes utilisent `requireAdmin()` inline. Toutes doivent basculer sur un nouveau helper unique `requireTenantAdmin()` qui retourne `{ session, tenantId }` et toutes leurs requêtes Prisma doivent ajouter `tenantId`.

**`app/actions/client/` (9 fichiers)** : idem avec `requireTenantClient()`.

### 1.4 Routes API à adapter (`app/api/`)

**Routes simples (tenant déduit du Host header)** : tout ce qui est `admin/*`, `client/*`, `cart/*`, `favorites/*`, `legal/*`, `marketplace-image/*`, `products/*`, `restock-alert/*`, `site-status/*`, `track-visit/*`, `translations/*`, `e2e/*`, `internal/*`, `auth/*`, `chat/*`, `carriers/*`, `commandes/*`.

**Routes webhook (le tenant n'est PAS dans l'URL — défi spécifique)** :
- `app/api/webhooks/ankorstore/route.ts` : la row `AnkorstoreOperation` portera `tenantId` → on retrouve le tenant via cette ligne.
- `app/api/payments/webhook/route.ts` (stripe) : URL webhook par-tenant `/api/webhooks/stripe/[tenantSlug]/route.ts`.

**Routes neutres** : `auth/[...nextauth]`, `e2e/*`, `internal/health`, `site-status/route.ts`.

---

## 2. Architecture cible

### 2.1 Modèle Prisma `Tenant`

```prisma
enum TenantStatus { ACTIVE SUSPENDED ARCHIVED }
enum SubscriptionPlan { TRIAL STARTER PRO ENTERPRISE }

model Tenant {
  id                String           @id @default(cuid())
  slug              String           @unique
  name              String
  status            TenantStatus     @default(ACTIVE)
  subscriptionPlan  SubscriptionPlan @default(TRIAL)
  trialEndsAt       DateTime?
  stripeCustomerId  String?          @unique
  stripeSubscriptionId String?       @unique
  primaryDomain     String?          @unique
  customDomainStatus String?
  logoUrl           String?
  brandColors       Json?
  contactEmail      String
  contactPhone      String?
  maxProducts       Int?
  maxStorageGB      Int?
  maxOrders         Int?
  productCount      Int              @default(0)
  storageBytes      BigInt           @default(0)
  ordersMonth       Int              @default(0)
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  users    UserTenant[]

  @@index([status])
  @@index([primaryDomain])
}

model UserTenant {
  userId   String
  tenantId String
  role     Role     @default(ADMIN)
  isSuperAdmin Boolean @default(false)
  createdAt DateTime @default(now())

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@id([userId, tenantId])
  @@index([tenantId])
}
```

### 2.2 Résolution du tenant à chaque requête

**Couche 1 — Middleware Edge (`middleware.ts`)** : examine le `Host` header de la requête entrante et le transforme en `tenantId`.

```
host = "boutique-x.belijolie-shop.com"  → slug = "boutique-x"
host = "maboutique.fr"                  → lookup Tenant by primaryDomain
host = "boutique-x.localhost:3000"      → slug = "boutique-x" (dev)
host = "admin.belijolie-shop.com"       → tenantId = null + isSuperAdminPanel = true
```

Cache du lookup en mémoire (TTL 30s), invalidé via `revalidateTag(\`tenant:${slug}\`)`.

**Couche 2 — Server Components & Server Actions (`AsyncLocalStorage`)** : helper `getTenantContext()` qui stocke `{ tenantId, tenantSlug, isSuperAdmin }` dans un AsyncLocalStorage.

```ts
// lib/tenant-context.ts (nouveau)
import { AsyncLocalStorage } from "node:async_hooks";

interface TenantCtx { tenantId: string; tenantSlug: string; isSuperAdmin: boolean }
const storage = new AsyncLocalStorage<TenantCtx>();

export function runWithTenant<T>(ctx: TenantCtx, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}
export function getCurrentTenantId(): string {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("Tenant context manquant — appel hors d'une requête HTTP ?");
  return ctx.tenantId;
}
```

**Couche 3 — helpers d'auth** :
```ts
// lib/auth-tenant.ts (nouveau)
export async function requireTenant() { ... }
export async function requireTenantClient() { ... }
export async function requireTenantAdmin() { ... }
export async function requireSuperAdmin() { ... }
```

### 2.3 Stratégie credentials marketplaces

```prisma
enum MarketplaceProvider { PFS ANKORSTORE EFASHION EASY_EXPRESS }

model TenantMarketplaceCredentials {
  id          String              @id @default(cuid())
  tenantId    String
  provider    MarketplaceProvider
  credentials Json                // chiffré via lib/encryption.ts
  enabled     Boolean             @default(false)
  webhookSecret String?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  @@unique([tenantId, provider])
}
```

### 2.4 Storage par tenant

| Aujourd'hui | Cible |
|---|---|
| `public/uploads/produits/[ref]/...` | `public/uploads/t/[tenantSlug]/produits/[ref]/...` |
| `public/uploads/collections/[slug]/` | `public/uploads/t/[tenantSlug]/collections/[slug]/` |
| `public/uploads/banniere/` | `public/uploads/t/[tenantSlug]/banniere/` |
| `private/uploads/kbis/[clientId]/` | `private/uploads/t/[tenantSlug]/kbis/[clientId]/` |
| `private/uploads/factures/[year]/` | `private/uploads/t/[tenantSlug]/factures/[year]/` |
| *(nouveau)* | `public/uploads/tenants/[slug]/logo.webp` |

Lecture automatique du `tenantSlug` depuis l'ALS pour minimiser le diff sur les ~150 sites d'appel.

### 2.5 Cache Next.js par tenant

Tags paramétrés par tenant : `getCachedCategories(tenantId)` → tag `categories:${tenantId}`. Invalidation : `revalidateTag(\`categories:${tenantId}\`, "default")`.

### 2.6 Sessions NextAuth

JWT enrichi : `tenantId`, `tenantRole`, `isSuperAdmin`. Login lit le Host header pour savoir sur quel tenant.

### 2.7 Super-admin

`app/_super/*` sous `admin.belijolie-shop.com` : liste tenants, création, suspension, vue conso, facturation, impersonation via cookie signé.

---

## 3. Stratégie de migration de la boutique actuelle

### 3.1 Cible

Beli & Jolie devient le tenant `slug="belijolie"`. Toutes les ~9000 produits + 13 Go d'images rattachés à ce tenant **en place**.

### 3.2 Script BDD (`scripts/migrate-to-multitenant.ts`)

```
1.  ALTER TABLE ajoute tenantId String NULL sur toutes les tables
2.  CREATE TABLE Tenant + UserTenant + TenantMarketplaceCredentials
3.  INSERT INTO Tenant ('belijolie-id', 'belijolie', 'Beli & Jolie', ACTIVE, ENTERPRISE)
4.  INSERT INTO UserTenant : pour chaque user existant
5.  UPDATE Product SET tenantId='belijolie-id' (batches de 5000) — idem 70+ tables
6.  ALTER TABLE pour mettre tenantId en NOT NULL + FK + index
7.  Migrer SiteConfig SENSITIVE_KEYS → TenantMarketplaceCredentials
8.  CompanyInfo, LegalDocument : UPDATE SET tenantId='belijolie-id'
9.  CHECK FINAL : SELECT COUNT(*) WHERE tenantId IS NULL = 0
10. Reset compteurs Tenant
```

Script **idempotent**.

### 3.3 Script storage (`scripts/migrate-storage-to-multitenant.ts`)

```
1.  mv public/uploads/{produits,collections,banniere,...} → public/uploads/t/belijolie/
2.  Idem private/
3.  UPDATE chaque table qui stocke un path : replace "/uploads/produits/" → "/uploads/t/belijolie/produits/"
4.  Vérif croisée : fs.stat sur 100 rows random
```

**Symlink temporaire** maintenu 2 semaines comme filet de sécurité.

### 3.4 Plan de rollback

- Dump MySQL complet pré-migration
- Snapshot Hostinger VPS
- rsync uploads vers disque externe
- Rollback < 24h : reset code + restore SQL + restore uploads (1-2h)

---

## 4. Stratégie des domaines / HTTPS

### 4.1 Nginx — un seul server block wildcard

```nginx
server {
  listen 443 ssl http2;
  server_name *.belijolie-shop.com;
  ssl_certificate /etc/letsencrypt/live/belijolie-shop.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/belijolie-shop.com/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Wildcard cert via DNS-01 challenge.

### 4.2 Domaines persos (`maboutique.fr`)

Outil : **`acme.sh`** pour les certs on-demand. Daemon Node `scripts/domain-provisioner.ts` (PM2 séparé) qui poll les `Tenant.customDomainStatus = "pending_dns"`.

Flux :
1. Saisie domaine dans admin tenant
2. Affichage records DNS à créer
3. Poll DNS (2 min, 24h max)
4. `acme.sh --issue` puis création conf Nginx
5. `nginx -t && systemctl reload nginx`
6. Marquer status = "active"

### 4.3 Vérification DNS avant provisioning

Avant `acme.sh` : `dns.resolve4(domain)` + dry-run HTTP-01. Respecte rate limit Let's Encrypt (5 échecs/heure/hostname).

### 4.4 Reload Nginx sans downtime

`systemctl reload nginx` → SIGHUP, finit les requêtes en cours sur anciens workers.

---

## 5. Découpage en sprints

### Sprint 1 — Fondations multi-tenant (8-12 j-dev)

- Modèle Prisma `Tenant`, `UserTenant`, `TenantMarketplaceCredentials`
- Helper `lib/tenant-context.ts` + `lib/auth-tenant.ts`
- Middleware Next.js résolution tenant
- Cache lookup tenant (TTL 30s)
- Page erreur tenant introuvable / suspendu
- Tests unitaires résolution tenant
- Doc `*.localhost:3000`

**Réversible** : aucun code applicatif ne dépend encore du tenant.

### Sprint 2 — Propagation tenantId aux tables métier (15-20 j-dev)

- `tenantId` ajouté à toutes les tables §1.1
- Helpers `requireTenant*()` câblés sur 49 fichiers d'actions
- Réécriture systématique des requêtes Prisma
- Réécriture `cached-data.ts` avec tags par tenant
- Adaptation 60+ modules `lib/`
- Tests d'intégration anti-fuite

**Irréversible** sans dump.

### Sprint 3 — Migration de la boutique actuelle (5-8 j-dev)

- Scripts `migrate-to-multitenant.ts` et `migrate-storage-to-multitenant.ts`
- Dry-run script
- Doc bascule prod
- Tests pré-prod avec dump prod

**Irréversible** majeur.

### Sprint 4 — Onboarding tenant, super-admin, branding (8-12 j-dev)

- UI super-admin `admin.belijolie-shop.com`
- Wizard onboarding tenant (slug, paiement Stripe, boutique vide)
- Personnalisation logo / couleurs
- Saisie credentials marketplaces chiffrés
- Email de bienvenue + tutoriel premier produit

### Sprint 5 — Domaines persos, facturation Stripe, bascule prod (8-12 j-dev)

- Workflow ajout domaine perso (`scripts/domain-provisioner.ts`)
- Subscription Stripe (STARTER / PRO / ENTERPRISE)
- Webhook Stripe par tenant
- Compteurs conso (cron nuit)
- Suspension auto si impayé
- Bascule prod beliandjolie.com

### Dépendances entre sprints

```
Sprint 1 ──┬─► Sprint 2 ──► Sprint 3 ──┬─► Sprint 4 ──► Sprint 5
           │                            │
           └──── (peut commencer)       └──── (peut commencer après Sprint 3)
                  Sprint 4 squelette UI
                  (sans données)
```

### Total estimé

**44 à 64 jours-dev** (≈ 9 à 13 semaines à 1 dev temps plein ; 4 à 7 semaines à 2 devs).

---

## 6. Risques et mitigations

### Risque #1 — Fuite de données entre tenants (RGPD critique)

Une seule requête Prisma oubliant `where: { tenantId }` peut exposer des données.

**Mitigations** :
1. Tests automatisés `__tests__/integration/tenant-isolation/` — un test par modèle
2. Wrapper Prisma `$extends()` qui injecte auto `tenantId` dans tous les `where` (filet de sécurité)
3. Code review obligatoire sur PR touchant `lib/` ou `app/actions/`
4. Logging structuré avec `tenantId` dans chaque query

### Risque #2 — Régression du site Beli & Jolie pendant le chantier

**Mitigations** :
1. Branche `feat/multi-tenant` dérivée de `master`, master continue à recevoir hotfixes
2. Pré-prod miroir du VPS (2e VPS bas-coût), dump prod restauré chaque nuit
3. Bascule prod en fenêtre maintenance courte (dimanche matin), runbook scripté

### Risque #3 — Perte d'images pendant migration storage

13 Go = données précieuses.

**Mitigations** :
1. Backup rsync complet vers disque externe avant migration
2. Test du script en pré-prod sur vraie copie
3. Symlink temporaire 2 semaines
4. Vérification croisée post-migration (`fs.stat()` sur tous les paths)

### Risque #4 — Workers singleton mélangent les tenants

`image-queue.ts`, `marketplace-queue-worker.ts`, `ankorstore-catalog-cache.ts` sont des singletons.

**Mitigations** :
1. Jobs en BDD reçoivent `tenantId`
2. Worker ouvre `runWithTenant()` avant business logic
3. `ankorstore-catalog-cache.ts` : `Map<tenantId, CatalogCache>`, limité aux 5 plus actifs
4. Test multi-tenant en parallèle

### Risque #5 — Webhook Ankorstore reçu sans contexte tenant

**Mitigations** :
1. Row `AnkorstoreOperation` portera `tenantId` (Sprint 2)
2. Fallback : `?tenantId=...` en query string du callback URL

---

## 7. Décisions à trancher par la propriétaire

1. **Catalogue partagé ou par tenant ?** Recommandation : **globales partagées** pour pays/HS/sizes/compositions ; **par tenant** pour Category/Color/Tag/Collection.

2. **Comptes utilisateurs : cross-tenant ou pas ?** Recommandation : **3 comptes différents** pour un client B2B qui achète chez 3 boutiques. Plus simple, RGPD net.

3. **Stripe : Stripe Connect ou comptes Stripe séparés ?** Recommandation : **comptes séparés** au démarrage, évoluer vers Stripe Connect plus tard si le modèle « commission » devient stratégique.

4. **Tarification : abonnement fixe ou commission ?** Recommandation : **abonnement fixe** au démarrage (STARTER/PRO/ENTERPRISE).

5. **Marketplaces : un seul compte plateforme ou un par tenant ?** Recommandation : **par tenant** (PFS/Ankorstore/eFashion exigent un SIRET, IBAN par vendeur).

6. **Domaine racine de la plateforme** : ex `belijolie-shop.com`. Doit être différent de `beliandjolie.com` pour éviter confusion. À acheter avant Sprint 1.

7. **Email expéditeur** : Recommandation : **un seul email plateforme** au démarrage, avec `Reply-To` du tenant.

8. **Limites de plan** : à définir commercialement. Ex : STARTER = 500 produits / 1 Go / 50 cmd/mois, PRO = 5000 / 10 Go / illimité, ENTERPRISE = illimité.

9. **Auto-translation** : quota mutualisé. Recommandation : **mutualisé via PFS** (gratuit).

10. **Super-admin** : 1 seule super-admin ou prévoir équipe (support, billing) ? Pas bloquant pour Sprint 1, à anticiper.

---

## Fichiers critiques pour l'implémentation

- `prisma/schema.prisma` — schéma à étendre avec `Tenant`, `UserTenant`, `TenantMarketplaceCredentials`, et `tenantId` sur 60+ tables
- `middleware.ts` — résolution tenant depuis Host header (couche 1)
- `lib/prisma.ts` — wrapper `$extends` pour injection auto de `tenantId` (filet de sécurité)
- `lib/auth.ts` — enrichissement JWT avec `tenantId`, `tenantRole`, `isSuperAdmin`
- `lib/storage.ts` — fonctions `*Dir()` préfixées par `tenantSlug`
- `lib/cached-data.ts` — tags de cache paramétrés par `tenantId`
