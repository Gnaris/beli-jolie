# PLAN V2 — AVENTIS : plateforme SaaS multi-boutiques

> Version actualisée du **2026-06-28**, validée avec la propriétaire.
> Remplace `PLAN.md` pour toute la partie « décisions ». La partie technique détaillée de `PLAN.md` (inventaire des 70 tables, modules `lib/`, etc.) reste valide en référence.

**Identité de la plateforme**
- **Nom** : AVENTIS (déjà nom commercial de l'entreprise individuelle Boris Chen, SIRET 932 255 813 00010)
- **Domaine racine** : `aventis-app.fr` (et `aventis-app.com` en redirection)
- **Sous-domaine super-admin** : `admin.aventis-app.fr`
- **Sous-domaines tenants** : `<slug-boutique>.aventis-app.fr` (ex : `marie.aventis-app.fr`)

---

## 0. Vue d'ensemble

On transforme la boutique actuelle Beli & Jolie en une **plateforme SaaS façon Shopify** : chaque wholesaler (cliente de la plateforme) gère sa propre boutique sous son sous-domaine, totalement cloisonnée des autres. Les retailers (clients finaux B2B) ne sauront jamais que les boutiques tournent sur la même plateforme. Beli & Jolie devient la **première boutique** parmi d'autres, sans aucune perte de données ni d'images.

**Modèle économique** : abonnement mensuel (configurable par la super-admin) + 3 % de commission HT sur chaque vente, prélevé automatiquement via Stripe Connect Express.

---

## 1. Décisions actées avec la propriétaire

### 1.1 Modèle produit

| Sujet | Décision |
|---|---|
| Type de plateforme | SaaS multi-boutiques, type Shopify |
| Design des boutiques | **Un seul thème commun** (pas de thème personnalisable pour V1) |
| Cible | Wholesalers **100 % français** au démarrage |
| Cloisonnement | Boutiques **totalement séparées** ; rien ne doit indiquer aux retailers qu'elles partagent une infrastructure |
| Concurrence | Wholesalers peuvent être concurrents directs (catalogue & clients invisibles entre eux) |

### 1.2 Tarification & paiements

| Sujet | Décision |
|---|---|
| Abonnement plateforme | **Stripe Billing** (mensuel) — prix **configurables dans l'admin super-admin** |
| Formules publiques | 2 formules : **PRO / ENTERPRISE** (prix et limites configurables) |
| Formule cachée | **MAX** (non visible publiquement, attribuable uniquement par la super-admin) |
| Période d'essai | **14 jours sans CB** |
| Annulation | La cliente garde son accès jusqu'à la fin du mois en cours |
| Dépassement de limite (produits) | Bloque la création de nouveaux produits + message « Limite atteinte, passer à la formule supérieure » |
| Paiements des ventes | **Stripe Connect Express** (compte connecté par wholesaler) |
| Commission plateforme | **3 % HT** par transaction, prélevée auto via « Application Fee » Stripe |
| Frais Stripe (info wholesaler) | 1,5 % + 0,25 € carte EEA, 0,8 % plafonné 5 € SEPA, 2 €/mois Connect Express |

### 1.3 Onboarding wholesaler

| Sujet | Décision |
|---|---|
| Inscription | **Auto, sans validation manuelle** |
| Garde-fous automatiques | (1) Vérification email · (2) Vérification SIRET API INSEE · (3) KYC Stripe Connect |
| Sous-domaine | **Choisi par la cliente** à l'inscription (`marie.<racine>.com`) |
| Domaine perso | Configurable plus tard dans son admin (PRO, ENTERPRISE et MAX) |
| Justificatifs | SIRET (auto INSEE), Kbis (upload PDF), IBAN (saisi dans Stripe Connect) |

### 1.4 Cycle de vie de l'abonnement (impayé)

| Étape | Délai |
|---|---|
| Carte échoue → Stripe re-tente | Automatique (3 tentatives sur 7 jours) |
| **Délai de grâce** (accès complet conservé) | 7 jours après le 1er échec |
| **Suspension** (boutique fermée temporairement, page « Boutique indisponible ») | À J+8 |
| **Archivage** (données préservées, accès coupé) | À J+30 |
| **Suppression définitive** | À J+90 |
| Export RGPD (téléchargement ZIP du catalogue + clients + commandes) | À tout moment, **avec confirmation par code email** |

### 1.5 Comptes & cloisonnement

| Sujet | Décision |
|---|---|
| Comptes retailer | **3 comptes différents** si un retailer achète chez 3 boutiques ; **aucun partage** |
| Validation des retailers | **Choix du wholesaler** (auto ou manuelle, configurable dans ses paramètres) |
| Catalogues (catégories, couleurs, tailles, tags, saisons) | **0 partage** — chacun les siens |
| Pays + codes HS | **0 partage** — chacun les siens (choix de la propriétaire) |
| Marketplaces externes (PFS, Ankorstore, Faire, eFashion) | Chaque wholesaler lie **ses propres identifiants** |
| Auto-traduction | **Liée au compte PFS de chaque wholesaler** (plus de quota mutualisé) |
| Branding par boutique (V1) | Logo, nom, couleurs, bannière home, mentions légales, CGV |

### 1.6 Support & communication

| Sujet | Décision |
|---|---|
| Support des retailers | **Le wholesaler lui-même** répond à ses propres clients |
| SMTP des emails sortants | **Configuré par chaque wholesaler** dans son admin (sinon il ne reçoit rien) |
| Support des wholesalers | **Page « Nous contacter »** publique avec coordonnées de la plateforme |
| Page d'accueil plateforme | À confectionner (vitrine pour attirer wholesalers) |
| Tarification | **Publique** sur le site de la plateforme |

### 1.7 Juridique & structure

| Sujet | Décision |
|---|---|
| Structure juridique | **Entreprise individuelle (micro-entreprise) « Boris Chen »** — nom commercial AVENTIS, SIRET 932 255 813 00010, RNE depuis 26/08/2024 |
| Activité déclarée à l'INPI | Modification déposée le 28/06/2026 (liasse J00256197112) — ajout activité principale « Édition, développement et exploitation de plateformes et logiciels en ligne (SaaS) à destination des professionnels » |
| Code APE attendu | **6311Z** (Traitement de données, hébergement et activités connexes) — confirmation INSEE sous 2-4 sem |
| Régime fiscal | BIC services, plafond 77 700 € HT/an |
| Bascule SASU/SARL | Quand le seuil sera atteint (anticiper à ~60 000 € HT/an pour éviter rupture) |
| TVA | **Déjà assujetti** (n° FR13932255813 actif depuis activité bijoux) — facture 20 % TVA sur abonnements + commissions |
| CGU + Politique de confidentialité | **Rédigées par Claude** (cercle proche → pas d'avocat au démarrage), dans `docs/multi-tenant/legal/` |

---

## 2. Architecture cible

### 2.1 Modèle Prisma à ajouter

```prisma
enum TenantStatus { ACTIVE GRACE SUSPENDED ARCHIVED }
// Codes de formule embarqués au seed initial : "PRO", "ENTERPRISE", "MAX"
// (la table Plan permet à la super-admin d'en ajouter / désactiver d'autres à chaud)

model Tenant {
  id                 String       @id @default(cuid())
  slug               String       @unique          // "marie", utilisé pour marie.platform.com
  name               String                        // "Boutique Marie"
  status             TenantStatus @default(ACTIVE)

  // Abonnement
  planId             String?                       // FK -> Plan (configurable)
  trialEndsAt        DateTime?
  stripeCustomerId   String?      @unique
  stripeSubscriptionId String?    @unique
  graceEndsAt        DateTime?                     // J+7 après 1er échec paiement
  suspendedAt        DateTime?
  archivedAt         DateTime?

  // Paiements vendeur
  stripeConnectAccountId String?  @unique          // acct_xxx, créé via Connect Express
  stripeConnectStatus    String?                   // "pending_kyc" | "active" | "rejected"

  // Domaines
  primaryDomain      String?      @unique          // ex: maboutique.fr
  customDomainStatus String?                       // "pending_dns" | "active" | "failed"

  // Identité
  logoUrl            String?
  brandPrimaryColor  String?
  brandSecondaryColor String?

  // Contact (boite mail de la wholesaler)
  contactEmail       String
  contactPhone       String?
  siret              String?                       // vérifié via API INSEE
  kbisFilePath       String?                       // upload PDF

  // SMTP perso
  smtpHost           String?
  smtpPort           Int?
  smtpUser           String?
  smtpPassword       String?                       // chiffré (lib/encryption.ts)
  smtpFromEmail      String?
  smtpFromName       String?

  // Préférences wholesaler
  retailerApprovalMode String  @default("MANUAL")  // "MANUAL" | "AUTO"

  // Compteurs (mis à jour par cron nuit)
  productCount       Int          @default(0)
  storageBytes       BigInt       @default(0)
  ordersMonth        Int          @default(0)

  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt

  users              UserTenant[]
  plan               Plan?        @relation(fields: [planId], references: [id])

  @@index([status])
  @@index([primaryDomain])
}

model Plan {
  id                String   @id @default(cuid())
  code              String   @unique              // "PRO" | "ENTERPRISE" | "MAX" (modifiable)
  name              String                        // "Pro"
  monthlyPriceCents Int                           // 0 = gratuit (à fixer dans l'admin)
  yearlyPriceCents  Int?                          // si abonnement annuel proposé
  commissionPercent Decimal  @db.Decimal(5, 3)    // 3.000
  maxProducts       Int?                          // null = illimité
  maxOrdersPerMonth Int?                          // null = illimité
  maxStorageGB      Int?                          // null = illimité
  allowCustomDomain Boolean  @default(false)
  allowedMarketplaces Json                        // ["PFS", "ANKORSTORE", "FAIRE", "EFASHION"]
  allowMarketplaceRefresh Boolean @default(false) // true uniquement pour MAX
  trialDays         Int      @default(14)
  isActive          Boolean  @default(true)
  isPublic          Boolean  @default(true)       // false pour MAX (cachée, attribuable uniquement par super-admin)
  sortOrder         Int      @default(0)

  tenants           Tenant[]
}

model UserTenant {
  userId       String
  tenantId     String
  role         UserRole @default(ADMIN)
  isSuperAdmin Boolean  @default(false)
  createdAt    DateTime @default(now())

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@id([userId, tenantId])
  @@index([tenantId])
}

model TenantMarketplaceCredentials {
  id            String              @id @default(cuid())
  tenantId      String
  provider      MarketplaceProvider // PFS | ANKORSTORE | EFASHION | FAIRE | EASY_EXPRESS
  credentials   Json                                  // chiffré via lib/encryption.ts
  enabled       Boolean             @default(false)
  webhookSecret String?
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  @@unique([tenantId, provider])
}

model BillingInvoice {
  id              String   @id @default(cuid())
  tenantId        String
  stripeInvoiceId String?  @unique
  periodStart     DateTime
  periodEnd       DateTime
  subscriptionCents Int                              // ex: 1000 = abonnement 10€
  commissionsCents  Int                              // somme des commissions du mois
  totalCents        Int
  pdfPath           String?                          // facture PDF générée
  status            String                           // "draft" | "paid" | "failed"
  createdAt         DateTime @default(now())
}
```

**Toutes les tables existantes** (Product, Order, Cart, User, etc. — cf. §1.1 de `PLAN.md` original, 70+ tables) reçoivent une colonne `tenantId String NOT NULL` + index + FK.

### 2.2 Résolution du tenant à chaque requête

3 couches comme prévu dans `PLAN.md` :

1. **Middleware Edge** : lit le `Host` header → résout `slug` ou `primaryDomain` → injecte dans header `x-tenant-id`.
2. **AsyncLocalStorage** (`lib/tenant-context.ts`) : ouvre un contexte par requête HTTP, propage `tenantId` à toutes les server actions et lib appelées.
3. **Helpers d'auth** : `requireTenantAdmin()`, `requireTenantClient()`, `requireSuperAdmin()`.

**Filet de sécurité** : extension Prisma `$extends()` qui injecte automatiquement `where: { tenantId }` dans toutes les requêtes des modèles tenant-scoped. Une seule fonction de garde-fou pour éviter les fuites.

### 2.3 Sous-domaines & domaines persos

- **Sous-domaine** (`marie.platform.com`) : créé automatiquement à l'inscription, **wildcard DNS + wildcard SSL** chez le registrar (let's encrypt DNS-01 challenge).
- **Domaine perso** (`maboutique.fr`) : la cliente saisit son domaine dans son admin → la plateforme affiche les records DNS à créer → un daemon Node poll → `acme.sh --issue` → conf nginx → reload.
- Disponible **uniquement sur PRO et ENTERPRISE**.

### 2.4 Stripe Connect Express

**Flux d'inscription wholesaler** :
1. Création compte plateforme (email + mdp + SIRET).
2. Vérification SIRET via API INSEE (gratuit) → bloque si invalide.
3. Vérification email (lien à cliquer).
4. Choix de la formule → redirection Stripe Checkout pour saisir CB de l'abonnement.
5. Onboarding Stripe Connect Express → KYC (Stripe vérifie l'identité du wholesaler).
6. Configuration boutique (logo, couleurs, SMTP, premier produit).

**Flux d'une vente** :
1. Retailer paie 100 € via Stripe.
2. Stripe prélève 1,5 % + 0,25 € (= 1,75 €) de frais Stripe.
3. Stripe prélève 3 % (= 3 €) d'**Application Fee** → arrive sur **votre compte plateforme**.
4. Stripe vire le solde (95,25 €) sur le compte bancaire du wholesaler.

**Webhooks Stripe** : `account.updated` (KYC), `invoice.payment_failed` (impayé), `customer.subscription.updated` (changement de formule), `payment_intent.succeeded` (vente).

### 2.5 Stockage par tenant

| Avant | Après |
|---|---|
| `public/uploads/produits/[ref]/` | `public/uploads/t/[slug]/produits/[ref]/` |
| `public/uploads/banniere/` | `public/uploads/t/[slug]/banniere/` |
| `private/uploads/kbis/[clientId]/` | `private/uploads/t/[slug]/kbis/[clientId]/` |
| *(nouveau)* | `public/uploads/tenants/[slug]/logo.webp` (logo wholesaler) |

### 2.6 Cache Next.js par tenant

Toutes les fonctions `getCached*` deviennent paramétrées : `getCachedCategories(tenantId)` → tag `categories:${tenantId}`. Invalidation : `revalidateTag(\`categories:${tenantId}\`, "default")`.

### 2.7 Super-admin (vous)

URL : `admin.<racine>.com` (sous-domaine réservé, hors mécanisme tenant).

Pages :
- **Tableau de bord** : revenus mois (abonnements + commissions), MRR, churn, nouveaux signups.
- **Boutiques** : liste, recherche, suspension/réactivation manuelle, impersonation (cookie signé pour aider une cliente).
- **Formules** : créer/éditer/désactiver `STARTER/PRO/ENTERPRISE` et leurs limites (prix, commission, quotas).
- **Facturation** : factures émises par la plateforme aux wholesalers (abonnements + commissions du mois) → PDF auto.
- **Logs** : événements importants (impayés, KYC échoués, suspensions auto).

---

## 3. Plan d'exécution par sprint

### Sprint 1 — Fondations multi-tenant (10-14 jours)

**Objectif** : la notion de tenant existe dans la base et dans les requêtes, mais aucun comportement applicatif n'en dépend encore.

- Modèles Prisma `Tenant`, `Plan`, `UserTenant`, `TenantMarketplaceCredentials`, `BillingInvoice`
- Helpers `lib/tenant-context.ts` + `lib/auth-tenant.ts`
- Middleware Next.js résolution tenant (Host header)
- Wildcard DNS + cert Let's Encrypt sur le domaine racine
- Page erreur "Boutique introuvable" / "Boutique indisponible"
- Extension Prisma `$extends()` pour injection auto de `tenantId`
- Tests unitaires résolution tenant
- Doc dev `*.localhost:3000`

**Réversible** sans dump.

### Sprint 2 — Propagation tenantId aux tables métier (18-22 jours)

**Objectif** : toutes les 70+ tables portent `tenantId` ; toutes les requêtes Prisma sont étanches.

- `tenantId` ajouté à toutes les tables (cf. §1.1 du `PLAN.md` original)
- Réécriture systématique des 49 fichiers `app/actions/` avec `requireTenantAdmin/Client()`
- Adaptation des 60+ modules `lib/`
- Réécriture `cached-data.ts` avec tags par tenant
- Workers singleton (`image-queue.ts`, `marketplace-queue-worker.ts`, `ankorstore-catalog-cache.ts`) ouvrent `runWithTenant()` avant business logic
- Tests d'intégration anti-fuite (1 test par modèle, en parallèle)

**Irréversible** sans dump.

### Sprint 3 — Migration Beli & Jolie en tenant `belijolie` (5-7 jours)

**Objectif** : les ~9000 produits et 13 Go d'images deviennent ceux du tenant `belijolie`.

- Script `scripts/migrate-to-multitenant.ts` (BDD)
- Script `scripts/migrate-storage-to-multitenant.ts` (fichiers)
- Dry-run sur dump prod restauré en pré-prod
- Symlink temporaire 2 semaines comme filet de sécurité
- Vérif croisée 100 paths random + `tenantId IS NULL = 0`
- Backup rsync complet uploads + dump SQL avant bascule prod
- Bascule prod en fenêtre maintenance (dimanche matin)

**Irréversible majeur** — c'est le moment du backup.

### Sprint 4 — Onboarding wholesaler + Stripe Connect + super-admin (12-16 jours)

**Objectif** : une nouvelle wholesaler peut s'inscrire, payer son abonnement, activer ses paiements, créer son premier produit.

- Page d'accueil publique de la plateforme + page tarifs
- Wizard inscription wholesaler (email + SIRET API INSEE + Stripe Checkout abonnement + Stripe Connect Express)
- Page « Mes paramètres » dans l'admin wholesaler : branding, SMTP, validation retailers (auto/manuel), domaine perso
- Super-admin `admin.<racine>.com` : dashboard, liste boutiques, suspension, impersonation, gestion formules
- Page « Nous contacter » avec coordonnées plateforme
- Email de bienvenue + tutoriel premier produit
- Webhook Stripe `payment_intent.succeeded` → enregistrement commission dans `BillingInvoice`
- Génération facture PDF mensuelle (abonnement + commissions) → email automatique au 1er du mois

### Sprint 5 — Domaines persos, impayés, RGPD, bascule prod publique (10-14 jours)

**Objectif** : la plateforme est prête à recevoir des wholesalers réels en production.

- Workflow ajout domaine perso (`scripts/domain-provisioner.ts` + `acme.sh`)
- Webhook Stripe `invoice.payment_failed` → bascule TENANT en GRACE → email rappel J+1, J+3, J+5
- Cron nuit : `ACTIVE→GRACE`, `GRACE→SUSPENDED`, `SUSPENDED→ARCHIVED`, `ARCHIVED→DELETED` selon délais
- Export RGPD : bouton dans admin wholesaler → email avec code OTP → confirmation → ZIP (catalogue + clients + commandes + factures)
- Tests bout-en-bout : inscription → paiement → vente → commission → export
- Rédaction CGU + Politique de confidentialité + Mentions légales (par Claude)
- Soft launch : invitation de 2-3 wholesalers du cercle proche en bêta

**Total estimé : 55 à 73 jours-dev** (≈ 11 à 15 semaines à 1 dev temps plein).

### Dépendances

```
Sprint 1 ──► Sprint 2 ──► Sprint 3 ──┬─► Sprint 4 ──► Sprint 5
                                      │
                                      └── (Sprint 4 peut commencer côté UI super-admin
                                          en parallèle de fin Sprint 3)
```

---

## 4. Risques et mitigations

### Risque #1 — Fuite de données entre tenants (RGPD critique)

Une seule requête Prisma oubliant `where: { tenantId }` peut exposer les commandes/clients de la boutique A à la boutique B.

**Mitigations** :
1. Extension Prisma `$extends()` qui injecte auto `tenantId` (filet de sécurité actif partout).
2. Tests d'intégration `__tests__/integration/tenant-isolation/` — un test par modèle, créent 2 tenants et vérifient qu'aucune requête ne traverse la frontière.
3. Logging structuré avec `tenantId` sur chaque query pour audit.
4. Code review obligatoire sur PR touchant `lib/` ou `app/actions/`.

### Risque #2 — Régression Beli & Jolie pendant le chantier

**Mitigations** :
1. Branche `feat/multi-tenant` dérivée de `master`, master continue à recevoir les hotfixes Beli & Jolie.
2. Pré-prod miroir du VPS, dump prod restauré chaque nuit.
3. Bascule prod en fenêtre maintenance courte (dimanche matin), runbook scripté.

### Risque #3 — Perte d'images pendant migration storage

13 Go = données précieuses (vous avez déjà investi du temps à les renommer/optimiser).

**Mitigations** :
1. Backup rsync complet vers disque externe **avant** migration.
2. Test du script sur copie pré-prod.
3. Symlink temporaire 2 semaines après bascule.
4. Vérification croisée `fs.stat()` sur 100 paths random post-migration.

### Risque #4 — Workers singleton mélangent les tenants

Les workers d'images, de queue Ankorstore et de cache catalogue sont des singletons globaux.

**Mitigations** :
1. Jobs en BDD reçoivent `tenantId`.
2. Worker ouvre `runWithTenant()` avant business logic.
3. `ankorstore-catalog-cache.ts` : `Map<tenantId, CatalogCache>` LRU 5 plus actifs.
4. Tests multi-tenant en parallèle.

### Risque #5 — Webhook Stripe/Ankorstore reçu sans contexte tenant

Les webhooks externes n'ont pas le Host header de la plateforme.

**Mitigations** :
1. **Stripe** : URL webhook par tenant (`/api/webhooks/stripe/[tenantSlug]`) avec secret distinct par tenant. Pour l'abonnement plateforme : webhook unique `/api/webhooks/platform-billing` → on retrouve le tenant via `stripeCustomerId`.
2. **Ankorstore** : row `AnkorstoreOperation` portera `tenantId` → on retrouve le tenant via cette ligne.

### Risque #6 — Stripe Connect refuse une wholesaler

Si Stripe refuse une wholesaler au KYC (pièce d'identité invalide, secteur non éligible…), elle ne peut pas activer ses paiements.

**Mitigations** :
1. Email automatique avec instructions et lien vers support Stripe.
2. Possibilité de débuter la boutique en mode « démo » (catalogue visible mais pas d'achat) pendant 30 jours.
3. Si après 30 jours pas de KYC → suspension.

---

## 5. Livrables annexes à produire

### 5.1 Documents juridiques (rédigés par Claude)

- [ ] **CGU de la plateforme** (l'accord entre vous et vos wholesalers) — inclut commission, abonnement, suspension, RGPD sous-traitance
- [ ] **CGV des boutiques** (template fourni à chaque wholesaler — qu'elle adaptera à ses retailers)
- [ ] **Politique de confidentialité** plateforme + template boutique
- [ ] **Mentions légales** plateforme + template boutique
- [ ] **DPA** (Data Processing Agreement) — inclus dans les CGU

### 5.2 Page d'accueil publique de la plateforme

Sections à concevoir :
- Hero : « Lancez votre boutique B2B en 10 minutes »
- Avantages : pas de code, intégrations marketplaces (PFS, Ankorstore, Faire, eFashion), gestion stocks, paiements sécurisés
- Tarifs publics (formules PRO et ENTERPRISE uniquement, MAX masquée — ressorties depuis `Plan` filtrées par `isPublic = true`)
- Démo / captures d'écran
- FAQ
- Contact

### 5.3 Documentation wholesaler (FAQ + tutos)

- « Comment créer mon premier produit »
- « Comment lier mon compte Ankorstore »
- « Comment configurer mon SMTP »
- « Comment ajouter mon nom de domaine perso »
- « Comment exporter mes données »
- Vidéos courtes (5-10 min chacune)

### 5.4 Emails transactionnels

- Bienvenue + vérification email
- Confirmation abonnement
- Échec paiement (J+1, J+3, J+5)
- Suspension boutique
- Archivage / suppression imminente
- Facture mensuelle (PDF en pièce jointe)
- Export RGPD prêt

---

## 6. Structure des formules (validée)

### 6.1 Nom et domaine de la plateforme

- **Nom commercial** : AVENTIS
- **Domaine racine** : `aventis-app.fr` (`+ aventis-app.com` en redirection)
- **À acheter** : OVH ou Gandi, ~25 €/an pour les deux

### 6.2 Formules

| Formule | Visible publiquement | Produits | Cmd/mois | Stockage | Domaine perso | Marketplaces | Refresh marketplaces |
|---|---|---|---|---|---|---|---|
| **PRO** | ✅ | 1 000 | Illimité | Illimité | ✅ | ❌ | ❌ |
| **ENTERPRISE** | ✅ | Illimité | Illimité | Illimité | ✅ | ✅ Toutes (PFS + Ankorstore + Faire + eFashion) | ❌ |
| **MAX** *(cachée)* | ❌ — attribuable uniquement par la super-admin | Illimité | Illimité | Illimité | ✅ | ✅ Toutes | ✅ |

**Notes** :
- Les prix sont **configurables dans l'admin super-admin** (mis à 0 par défaut, à fixer avant lancement).
- La formule **MAX** n'apparaît jamais sur la page de tarifs publique ni dans l'écran d'upgrade côté wholesaler. Seule la super-admin peut basculer une boutique en MAX.
- La fonctionnalité « refresh marketplaces » (re-pousser tous les produits vers PFS/Ankorstore/Faire/eFashion) reste réservée à MAX pour éviter de saturer les APIs des marketplaces.

---

## 7. Investissements externes à prévoir

| Poste | Coût | Quand |
|---|---|---|
| Domaines `aventis-app.fr` + `aventis-app.com` | ~25 €/an | **À acheter immédiatement** |
| VPS pré-prod (recommandé) | ~5 €/mois | Sprint 2 |
| Compte Stripe (création gratuite) | 0 € | Sprint 4 |
| Stripe Connect Express | 2 €/mois par boutique active | À partir de la 1re boutique |
| Disque externe pour backups | ~80 € one-shot | Avant Sprint 3 |
| Wildcard SSL Let's Encrypt | 0 € | Sprint 1 |
| `acme.sh` pour domaines persos | 0 € | Sprint 5 |

**Total démarrage : ~120 €** + frais Stripe variables selon volume.

---

## 8. Fichiers critiques pour l'implémentation

- `prisma/schema.prisma` — étendre avec `Tenant`, `Plan`, `UserTenant`, `TenantMarketplaceCredentials`, `BillingInvoice` + `tenantId` sur 70+ tables
- `middleware.ts` — résolution tenant depuis Host header
- `lib/tenant-context.ts` *(nouveau)* — AsyncLocalStorage
- `lib/auth-tenant.ts` *(nouveau)* — `requireTenant*()` helpers
- `lib/prisma.ts` — extension `$extends()` filet de sécurité
- `lib/auth.ts` — JWT enrichi `tenantId` + `isSuperAdmin`
- `lib/storage.ts` — toutes les `*Dir()` préfixées par `tenantSlug`
- `lib/cached-data.ts` — tags de cache paramétrés par `tenantId`
- `lib/stripe-platform.ts` *(nouveau)* — abonnements wholesalers (Stripe Billing)
- `lib/stripe-connect.ts` *(nouveau)* — paiements retailers + Application Fee
- `app/api/webhooks/stripe/platform/route.ts` *(nouveau)* — events abonnement
- `app/api/webhooks/stripe/[tenantSlug]/route.ts` *(nouveau)* — events vente
- `scripts/migrate-to-multitenant.ts` *(nouveau)* — migration BDD
- `scripts/migrate-storage-to-multitenant.ts` *(nouveau)* — migration fichiers
- `scripts/domain-provisioner.ts` *(nouveau)* — daemon domaines persos
- `app/_super/*` *(nouveau)* — interface super-admin

---

## 9. Récap final

**Ce que vous obtenez à la fin du Sprint 5** :

1. Votre site Beli & Jolie continue de fonctionner exactement comme avant (devenu « boutique belijolie » de la plateforme).
2. Vous avez une page d'accueil publique sur `<votreplateforme>.com` qui présente l'offre et les tarifs.
3. N'importe qui peut s'inscrire en 10 minutes, choisir une formule, activer Stripe Connect et créer sa boutique sur `<son-nom>.<votreplateforme>.com`.
4. Chaque vente sur n'importe quelle boutique vous reverse 3 % automatiquement, en plus de l'abonnement mensuel.
5. Vous avez une console super-admin pour suivre les revenus, gérer les formules, suspendre des boutiques.
6. Tout est étanche : aucune cliente ne voit les données d'une autre, et les retailers ne savent même pas que les boutiques partagent une plateforme.

**Délai total estimé** : 11 à 15 semaines à 1 dev temps plein.
**Investissement externe** : ~120 € pour le démarrage.
