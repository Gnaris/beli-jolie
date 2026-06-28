# Politique de Confidentialité — AVENTIS

> Version 1.0 — En vigueur à compter du [DATE_LANCEMENT]

La présente politique a pour objet d'informer les Utilisateurs de la plateforme AVENTIS de la manière dont leurs données personnelles sont collectées, traitées et protégées, conformément au **Règlement Général sur la Protection des Données (RGPD, Règlement UE 2016/679)** et à la **Loi Informatique et Libertés** modifiée.

---

## 1. Responsable de traitement

**Entreprise Individuelle Boris Chen** (« AVENTIS »)
SIRET : 932 255 813 00010
Siège : 43 rue de Carency, 93000 Bobigny, France
Contact : `contact@aventis-app.fr`
Délégué à la protection des données (DPO) : `dpo@aventis-app.fr`

---

## 2. Distinction entre les rôles

| Catégorie de données | Responsable de traitement | AVENTIS agit comme |
|---|---|---|
| Données du Wholesaler (compte AVENTIS) | **AVENTIS** | Responsable de traitement |
| Données des Retailers (clients du Wholesaler) | **Le Wholesaler** | Sous-traitant (cf. DPA dans les CGU) |
| Données des visiteurs du site `aventis-app.fr` (page d'accueil, blog, formulaire de contact) | **AVENTIS** | Responsable de traitement |

---

## 3. Données collectées et finalités

### 3.1 Données du Wholesaler

| Donnée | Finalité | Base légale | Durée |
|---|---|---|---|
| Email, mot de passe (hashé) | Authentification | Exécution du contrat | Durée du contrat + 3 ans |
| Nom, prénom, téléphone | Communication | Exécution du contrat | Idem |
| Raison sociale, SIRET, TVA, Kbis | Conformité légale et facturation | Obligation légale | 10 ans (Code de commerce) |
| Adresse postale, IBAN | Facturation et reversement | Exécution du contrat | Idem |
| Justificatif d'identité (CNI / passeport) | KYC Stripe Connect | Obligation légale (LCB-FT) | 5 ans après fin de relation |
| Logs de connexion, IP | Sécurité | Intérêt légitime | 12 mois |

### 3.2 Données des Retailers (collectées par AVENTIS pour le compte du Wholesaler)

| Donnée | Finalité | Base légale | Durée |
|---|---|---|---|
| Email, nom, prénom, téléphone | Création compte sur la Boutique | Définie par le Wholesaler | Idem |
| Adresse de livraison/facturation | Traitement des commandes | Idem | Idem |
| Historique de commandes | Service client + comptabilité du Wholesaler | Idem | 10 ans (facture) |
| Données de paiement (carte bancaire) | Encaissement | Gérée 100 % par Stripe — AVENTIS n'en a jamais l'accès | N/A (Stripe) |

### 3.3 Données des visiteurs du site `aventis-app.fr`

| Donnée | Finalité | Base légale | Durée |
|---|---|---|---|
| Formulaire de contact (email, message) | Réponse à la demande | Intérêt légitime | 3 ans |
| Cookies de session (authentification) | Connexion sécurisée | Strict nécessaire (pas de consentement requis) | Durée de la session |
| Logs serveur (IP, user-agent) | Sécurité, anti-abus | Intérêt légitime | 12 mois |

**Aucun cookie publicitaire ou tracker tiers (Google Analytics, Facebook Pixel, etc.)** n'est utilisé à la date de publication.

---

## 4. Destinataires des données

Les données ne sont jamais vendues. Elles sont accessibles à :
- l'équipe d'AVENTIS (à ce jour : Boris Chen, dirigeant unique) ;
- les sous-traitants techniques limitativement énumérés en section 5 ;
- les autorités publiques en cas d'obligation légale (CNIL, fisc, justice).

---

## 5. Sous-traitants

Liste des sous-traitants utilisés par AVENTIS :

| Sous-traitant | Service | Localisation | Conformité |
|---|---|---|---|
| **Hostinger** | Hébergement serveurs | Lituanie (UE) | RGPD ✓ |
| **Stripe Payments Europe** | Paiements, abonnements, Connect | Irlande (UE) | RGPD ✓, certifié PCI DSS Level 1 |
| **Let's Encrypt** | Certificats HTTPS (sans accès aux données) | États-Unis | RGPD ✓ (pas de transfert de données personnelles) |
| **PFS, Ankorstore, Faire, eFashion** | Marketplaces externes (activées par chaque Wholesaler) | UE / divers | À la discrétion du Wholesaler |
| **INSEE** | Vérification SIRET | France | Service public |

Aucun transfert de données personnelles hors UE n'est effectué sans le consentement préalable de l'Utilisateur ou sans garanties appropriées (clauses contractuelles types de la Commission Européenne).

---

## 6. Droits des personnes concernées

Conformément aux articles 15 à 22 du RGPD, vous disposez des droits suivants sur vos données :

- **Droit d'accès** : obtenir confirmation que vos données sont traitées et en recevoir une copie ;
- **Droit de rectification** : faire corriger des données inexactes ou incomplètes ;
- **Droit à l'effacement (« droit à l'oubli »)** : faire supprimer vos données sous réserve des obligations légales de conservation ;
- **Droit à la limitation** : geler temporairement le traitement ;
- **Droit à la portabilité** : recevoir vos données dans un format structuré et lisible (export ZIP disponible dans votre interface) ;
- **Droit d'opposition** : refuser certains traitements fondés sur l'intérêt légitime ;
- **Droit de retirer votre consentement** à tout moment, sans effet rétroactif ;
- **Droit de définir des directives** sur le sort de vos données après votre décès.

**Pour exercer ces droits** : envoyer un email à `dpo@aventis-app.fr` ou un courrier au siège, en justifiant de votre identité.

Réponse sous **1 mois maximum** (extensible à 3 mois pour les demandes complexes).

En cas de litige, vous pouvez introduire une réclamation auprès de la **CNIL** :
- En ligne : www.cnil.fr/plaintes
- Par courrier : 3 Place de Fontenoy, 75007 Paris

---

## 7. Sécurité

AVENTIS met en œuvre les mesures techniques et organisationnelles raisonnables pour protéger vos données :
- chiffrement des mots de passe (Argon2/bcrypt) ;
- chiffrement AES-256-GCM des données sensibles (clés API marketplaces, mots de passe SMTP) ;
- chiffrement HTTPS systématique (TLS 1.3) ;
- sauvegardes journalières chiffrées ;
- accès au serveur restreint par SSH avec authentification par clé ;
- mises à jour de sécurité régulières du système et des dépendances ;
- séparation logique stricte entre les boutiques (cloisonnement multi-tenant).

En cas de **violation de données** susceptible d'engendrer un risque pour les droits et libertés des personnes, AVENTIS notifiera la CNIL dans les **72 heures** et informera les personnes concernées dans les meilleurs délais si le risque est élevé.

---

## 8. Cookies

Le site `aventis-app.fr` utilise uniquement des **cookies fonctionnels strictement nécessaires** :

| Cookie | Finalité | Durée |
|---|---|---|
| `next-auth.session-token` | Authentification | Durée de la session |
| `next-auth.csrf-token` | Protection CSRF | Session |
| `aventis-tenant` | Routage multi-boutique | Session |

Ces cookies n'exigent **pas de consentement préalable** selon la doctrine CNIL (art. 82 LIL).

Aucun cookie publicitaire ni de mesure d'audience tiers n'est déposé sans consentement.

---

## 9. Modifications de la politique

La présente politique peut être amenée à évoluer. Toute modification substantielle sera notifiée par email aux Utilisateurs avec un préavis de 30 jours.

Date de la dernière mise à jour : **2026-06-28**.

---

## 10. Contact

Pour toute question relative à la protection de vos données :
- Email : `dpo@aventis-app.fr`
- Courrier : Boris Chen — DPO AVENTIS — 43 rue de Carency, 93000 Bobigny, France

---

*Dernière mise à jour : 2026-06-28 — Version 1.0*
