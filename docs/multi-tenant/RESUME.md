# RESUME — Projet AVENTIS (plateforme SaaS multi-boutiques)

> Document de reprise — Dernière mise à jour : **2026-06-28**
> Lire ce fichier en début de session pour reprendre exactement là où on s'est arrêté.

---

## 🎯 Où on en est en deux phrases

On a finalisé toutes les décisions stratégiques de transformation de Beli & Jolie en plateforme SaaS multi-boutiques nommée **AVENTIS**, déposé la modification d'activité à l'INPI, rédigé les documents juridiques (CGU, mentions légales, politique de confidentialité). **Plus aucun code applicatif n'a encore été touché** — on est prêts à démarrer le Sprint 1 dès que le domaine `aventis-app.fr` est acheté.

---

## ✅ Ce qui est fait (28 juin 2026)

### Côté juridique / administratif
- [x] Modification d'activité INPI déposée (liasse **J00256197112**, 28/06/2026)
- [x] Nouvelle activité principale : **6311Z** « Traitement de données, hébergement et activités connexes »
- [x] Description : *« Édition, développement et exploitation de plateformes et logiciels en ligne (SaaS) à destination des professionnels et des entreprises. Commercialisation des solutions sous forme d'abonnement, de licence ou de commission sur les transactions. »*
- [x] Synthèse signée électroniquement via FranceConnect
- [x] Confirmation INSEE attendue **sous 2-4 semaines** (à vérifier sur `avis-situation-sirene.insee.fr` après mi-juillet 2026)

### Côté plan & documents
- [x] `docs/multi-tenant/PLAN-V2.md` — plan complet d'exécution (5 sprints, ~11-15 semaines)
- [x] `docs/multi-tenant/legal/CGU.md` — 24 articles
- [x] `docs/multi-tenant/legal/MENTIONS-LEGALES.md`
- [x] `docs/multi-tenant/legal/POLITIQUE-CONFIDENTIALITE.md`

### Décisions clés actées
| Sujet | Décision |
|---|---|
| Nom plateforme | **AVENTIS** (déjà nom commercial Boris Chen EI) |
| Domaine | **aventis-app.fr** + `aventis-app.com` (disponibles, à acheter) |
| Modèle économique | Abonnement mensuel + **3 % HT** commission par transaction |
| Paiements ventes | **Stripe Connect Express** (Application Fee 3 %) |
| Paiements abonnement | **Stripe Billing** mensuel |
| Formules | 2 publiques (**PRO**, **ENTERPRISE**) + 1 cachée (**MAX**, attribuable uniquement par super-admin) |
| Période essai | 14 jours sans CB |
| Impayé | Grâce J+7 → Suspension J+8 → Archivage J+30 → Suppression J+90 |
| Cloisonnement | Strict, retailers ne savent jamais que les boutiques sont sur la même plateforme |
| Comptes retailers | 3 comptes différents si 3 boutiques (jamais cross-boutique) |
| Catalogues | Pas de partage entre boutiques (chaque wholesaler crée les siens) |
| Marketplaces | Chaque wholesaler lie ses propres comptes |
| Validation retailers | Choix du wholesaler (auto ou manuelle) |
| Support retailers | Chaque wholesaler répond à ses clients + configure son SMTP |
| Support wholesalers | Page « Nous contacter » publique |
| Statut juridique | Micro-entreprise (Boris Chen EI), bascule SASU/SARL à ~60 000 € HT/an de CA SaaS |
| Diffusion INSEE | Actuellement à **NON** — à passer à **OUI** plus tard pour visibilité publique (`statut-diffusion-sirene.insee.fr`) |

---

## 🟥 Ce que la propriétaire DOIT faire avant la prochaine session

### 1. Acheter les domaines (5 min, ~25 €)
- `aventis-app.fr` (~12 €/an)
- `aventis-app.com` (~12 €/an)
- Conseillé : OVH (ovhcloud.com/fr/domains/) ou Gandi

### 2. Vérifier la marque AVENTIS à l'INPI (5 min, gratuit)
- Aller sur `base-marques.inpi.fr/categorical-search`
- Chercher « AVENTIS » dans les classes **9, 38, 42**
- Si rien enregistré dans ces classes → OK, on peut continuer
- Si marque enregistrée par Sanofi ou autre → discussion à avoir avant lancement

### 3. (Optionnel) Activer la diffusion INSEE
- Aller sur `statut-diffusion-sirene.insee.fr`
- Passer à **OUI** pour que l'entreprise soit trouvable par les futurs clients

---

## 🚀 Prochaine étape technique : Sprint 1

**Quand la propriétaire dit « on attaque le Sprint 1 », faire :**

### Setup
- [ ] Créer la branche Git `feat/multi-tenant` à partir de `master`
- [ ] S'assurer que `master` reste intacte pour les hotfixes Beli & Jolie en parallèle

### Code à produire (Sprint 1)

**Schéma Prisma (`prisma/schema.prisma`)** :
- [ ] enum `TenantStatus { ACTIVE GRACE SUSPENDED ARCHIVED }`
- [ ] model `Tenant` (cf. PLAN-V2.md §2.1, ajusté : champs `smtpHost/Port/User/Password/FromEmail/FromName`, `retailerApprovalMode`, etc.)
- [ ] model `Plan` (avec `allowMarketplaceRefresh`, `isPublic`)
- [ ] model `UserTenant`
- [ ] model `TenantMarketplaceCredentials`
- [ ] model `BillingInvoice`
- [ ] `npx prisma db push` + `npx prisma generate`

**Seed initial** (`scripts/seed-plans.ts`) :
- [ ] Insert Plan PRO (1000 produits, illimité cmd/stockage, domaine perso ✓, marketplaces ❌)
- [ ] Insert Plan ENTERPRISE (illimité partout, marketplaces ✓)
- [ ] Insert Plan MAX caché (`isPublic = false`, `allowMarketplaceRefresh = true`)
- [ ] Prix initiaux à 0 cts (à fixer dans l'admin avant lancement)

**Modules nouveaux** :
- [ ] `lib/tenant-context.ts` — AsyncLocalStorage + `runWithTenant()` + `getCurrentTenantId()`
- [ ] `lib/auth-tenant.ts` — `requireTenant()`, `requireTenantAdmin()`, `requireTenantClient()`, `requireSuperAdmin()`
- [ ] `lib/prisma.ts` — extension `$extends({ query: { ... } })` pour injection auto `tenantId` (filet de sécurité)

**Middleware** :
- [ ] Adapter `middleware.ts` pour résoudre `Host` → slug → tenantId, injecter dans header `x-tenant-id`
- [ ] Cache lookup tenant en mémoire (TTL 30 s)
- [ ] Page erreur `app/_tenant-not-found/page.tsx`
- [ ] Page erreur `app/_tenant-suspended/page.tsx`

**Tests** :
- [ ] `__tests__/unit/tenant-context.test.ts`
- [ ] `__tests__/unit/middleware-tenant.test.ts`
- [ ] Doc dev `<slug>.aventis-app.localhost:3000` (modification `/etc/hosts` Windows)

**Validation Sprint 1** :
- [ ] Tous les tests passent
- [ ] Site Beli & Jolie continue de fonctionner identique (sur branche master)
- [ ] On peut créer manuellement 2 tenants en BDD et accéder à `tenant1.aventis-app.localhost:3000` vs `tenant2.aventis-app.localhost:3000` qui retournent chacun la bonne valeur de `getCurrentTenantId()`

**Durée estimée** : 10-14 jours-dev.

---

## 📋 Sprints suivants (rappel)

- **Sprint 2** (18-22 j) : Propagation `tenantId` à toutes les 70+ tables + réécriture des 49 fichiers `app/actions/` + tests anti-fuite
- **Sprint 3** (5-7 j) : Migration Beli & Jolie en tenant `belijolie` (BDD + fichiers + symlinks)
- **Sprint 4** (12-16 j) : Onboarding wholesaler + Stripe Connect + super-admin + page d'accueil publique
- **Sprint 5** (10-14 j) : Domaines persos + impayés + RGPD + soft launch

---

## 🧠 Notes importantes pour la reprise

- **Pas de hotfix Beli & Jolie dans la branche `feat/multi-tenant`** — toujours faire les hotfixes sur `master` puis rebase la branche feature de temps en temps.
- **Le code APE 6311Z n'est pas encore officiel** côté INSEE (en traitement). Pour facturer en attendant, utiliser le SIRET 932 255 813 00010 avec mention « code APE en cours de mise à jour ».
- **Diffusion INSEE = NON actuellement** : à passer à OUI sur `statut-diffusion-sirene.insee.fr` quand la propriétaire sera prête à être trouvable publiquement.
- **L'activité bijoux 4791B a probablement été supprimée** par la modification INPI (pas rétrogradée en secondaire comme suggéré). Si la propriétaire veut reprendre la vente plus tard, prévoir une 2e démarche INPI.
- **Diffusion email transactionnel** : prévoir un compte Brevo / SendGrid / Mailgun pour les emails plateforme (bienvenue, factures), distinct des SMTP perso des wholesalers.

---

## 🔑 Liens utiles

- INPI Guichet Unique : https://procedures.inpi.fr/
- Suivi formalité : `J00256197112` (à saisir dans son espace INPI)
- Vérif SIRET : `https://avis-situation-sirene.insee.fr/`
- Vérif marque : `https://base-marques.inpi.fr/categorical-search`
- Diffusion INSEE : `https://statut-diffusion-sirene.insee.fr/`
- Mon Compte Stripe (à créer après achat domaine) : `https://dashboard.stripe.com/`

---

*Document à mettre à jour à la fin de chaque session de travail.*
