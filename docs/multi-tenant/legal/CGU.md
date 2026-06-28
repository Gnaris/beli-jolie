# Conditions Générales d'Utilisation — AVENTIS

> **Version 1.0 — En vigueur à compter du [DATE_LANCEMENT]**
>
> Document rédigé pour la plateforme SaaS **AVENTIS** opérée par l'Entreprise Individuelle Boris Chen.
> ⚠️ **Document non revu par un avocat.** Pour un lancement commercial à grande échelle, faire relire par un cabinet spécialisé numérique.

---

## Préambule

La plateforme **AVENTIS** (ci-après « AVENTIS » ou la « Plateforme »), accessible à l'adresse `https://aventis-app.fr`, est une solution logicielle en ligne (SaaS) éditée par :

**Entreprise Individuelle Boris Chen**
SIRET : 932 255 813 00010
Siège : 43 rue de Carency, 93000 Bobigny, France
Numéro de TVA intracommunautaire : FR13 932 255 813
Représentant légal : Monsieur Boris Chen
Email : `contact@aventis-app.fr`
Directeur de la publication : Monsieur Boris Chen

AVENTIS permet à des professionnels (ci-après le « Wholesaler » ou « l'Utilisateur ») de créer et exploiter, sous leur propre marque et sous leur propre nom de domaine, une boutique e-commerce destinée à leurs propres clients professionnels (ci-après le « Retailer »).

Les présentes Conditions Générales d'Utilisation (ci-après « CGU ») régissent l'accès et l'utilisation de la Plateforme par tout Wholesaler.

---

## Article 1 — Définitions

Dans les présentes CGU, les termes suivants ont la signification définie ci-après :

- **AVENTIS / la Plateforme / l'Éditeur** : la solution logicielle SaaS éditée par l'Entreprise Individuelle Boris Chen.
- **Wholesaler / Utilisateur** : toute personne physique ou morale exerçant à titre professionnel qui souscrit à AVENTIS pour créer et exploiter sa Boutique.
- **Boutique** : l'instance personnelle d'une boutique e-commerce du Wholesaler hébergée sur AVENTIS, accessible via un sous-domaine du type `<slug>.aventis-app.fr` ou via un nom de domaine personnel.
- **Retailer / Acheteur final** : la personne (physique ou morale) qui passe commande sur la Boutique du Wholesaler.
- **Formule / Abonnement** : le plan tarifaire souscrit par le Wholesaler (PRO ou ENTERPRISE).
- **Transaction** : toute commande payée par un Retailer sur la Boutique d'un Wholesaler.
- **Commission** : la fraction prélevée par AVENTIS sur chaque Transaction.
- **Période d'Essai** : période gratuite de 14 jours offerte à tout nouveau Wholesaler avant prélèvement du premier abonnement.
- **Stripe Connect Express** : service de paiement opéré par Stripe Payments Europe, Ltd, permettant l'encaissement direct des Transactions sur le compte bancaire du Wholesaler.

---

## Article 2 — Objet

Les présentes CGU ont pour objet de définir les conditions dans lesquelles AVENTIS met à la disposition du Wholesaler sa Plateforme SaaS, ainsi que les droits et obligations réciproques des parties.

Le Wholesaler reconnaît avoir lu et accepté les présentes CGU avant toute souscription.

---

## Article 3 — Acceptation et opposabilité

L'inscription à AVENTIS est subordonnée à l'acceptation expresse, par case à cocher, des présentes CGU. Cette acceptation a la même valeur qu'une signature manuscrite (article 1366 du Code civil).

À défaut d'acceptation, l'Utilisateur ne peut accéder à la Plateforme.

Les CGU acceptées prévalent sur tout document antérieur, conditions générales d'achat ou ordres de mission émis par le Wholesaler.

---

## Article 4 — Inscription et création de compte

### 4.1 Conditions d'inscription

Toute personne physique majeure agissant à titre professionnel ou toute personne morale immatriculée peut s'inscrire sur AVENTIS, sous réserve :

- d'être titulaire d'un **SIRET français** valide (vérifié automatiquement via l'API INSEE) ;
- de **valider son adresse email** via un lien d'activation ;
- de compléter le processus **KYC (Know Your Customer) de Stripe Connect Express** avant tout encaissement.

### 4.2 Informations obligatoires

Le Wholesaler s'engage à fournir des informations exactes, complètes et à jour, notamment :
- raison sociale et SIRET ;
- adresse postale ;
- email professionnel ;
- coordonnées bancaires (via Stripe) ;
- justificatif d'identité du dirigeant ;
- extrait Kbis (pour les sociétés).

Toute fausse déclaration entraîne la suspension immédiate du compte et la possible exclusion définitive sans remboursement.

### 4.3 Identifiants et sécurité

Le Wholesaler choisit ses identifiants (email + mot de passe) lors de l'inscription. Il est seul responsable de leur conservation et de la confidentialité de son compte. Toute action effectuée depuis son compte est réputée effectuée par lui.

En cas de perte ou de soupçon de compromission, le Wholesaler doit immédiatement réinitialiser son mot de passe et en informer AVENTIS.

### 4.4 Un compte par personne morale

Un Wholesaler ne peut créer qu'**un seul compte** par personne morale (un SIRET = un compte). La création de comptes multiples par contournement entraîne la suspension de tous les comptes concernés.

---

## Article 5 — Description du service

### 5.1 Périmètre du service

AVENTIS met à disposition du Wholesaler une plateforme logicielle permettant notamment :
- la création d'une boutique e-commerce sous sous-domaine `<slug>.aventis-app.fr` ;
- la gestion d'un catalogue produits (création, modification, import) ;
- la gestion des commandes, du stock, des clients ;
- l'encaissement des paiements via Stripe Connect Express ;
- la configuration d'un nom de domaine personnel (Formules PRO et ENTERPRISE) ;
- l'intégration avec les marketplaces externes (PFS, Ankorstore, Faire, eFashion) selon la formule souscrite ;
- la configuration du serveur d'envoi d'emails (SMTP) personnel ;
- la personnalisation visuelle de la boutique (logo, couleurs, bannière).

### 5.2 Cloisonnement des boutiques

Chaque Boutique constitue un environnement **strictement cloisonné**. Les données (catalogue, clients, commandes, statistiques) d'un Wholesaler ne sont accessibles à aucun autre Wholesaler. AVENTIS met en œuvre les mesures techniques et organisationnelles nécessaires pour garantir cette étanchéité.

### 5.3 Modèle d'hébergement

Les données du Wholesaler sont hébergées sur des serveurs situés dans l'Union Européenne (Hostinger, Lituanie). Aucune donnée n'est transférée hors UE sans l'accord exprès du Wholesaler.

### 5.4 Disponibilité

AVENTIS s'engage à fournir ses meilleurs efforts pour assurer une disponibilité du service de **99 % sur l'année** (hors maintenances programmées). Les maintenances sont annoncées au moins 48 heures à l'avance par email et planifiées en dehors des heures ouvrées dans la mesure du possible.

AVENTIS ne saurait être tenue responsable des interruptions imputables :
- aux opérateurs de télécommunications du Wholesaler ou du Retailer ;
- à des actes de tiers (cyberattaques, défaillances de fournisseurs Stripe, INPI, INSEE, etc.) ;
- à des cas de force majeure (article 18).

---

## Article 6 — Formules d'abonnement et tarification

### 6.1 Formules proposées

AVENTIS propose deux formules d'abonnement publiques :

| Formule | Cible | Caractéristiques principales |
|---|---|---|
| **PRO** | Wholesaler indépendant ou TPE | Jusqu'à 1 000 produits, commandes et stockage illimités, domaine personnel inclus, marketplaces externes non incluses |
| **ENTERPRISE** | Wholesaler établi ou multi-marques | Produits, commandes et stockage **illimités**, domaine personnel inclus, **toutes les marketplaces externes** (PFS, Ankorstore, Faire, eFashion) |

Une formule **MAX** non publique peut être attribuée à la discrétion exclusive de l'Éditeur (clients stratégiques, partenaires, comptes internes).

Les prix de chaque formule sont indiqués en HT sur la page de tarifs `https://aventis-app.fr/tarifs` et susceptibles d'évolution dans les conditions de l'article 19.

### 6.2 TVA

Tous les prix sont affichés en **HT (hors taxes)**. La TVA française au taux en vigueur (20 % à la date de rédaction) est ajoutée sur la facture finale. La TVA est récupérable par le Wholesaler dans les conditions du droit commun.

### 6.3 Périodicité

L'abonnement est facturé **mensuellement** d'avance, prélevé sur la carte bancaire saisie via Stripe Billing.

---

## Article 7 — Commission sur les Transactions

### 7.1 Principe

En sus de l'abonnement, AVENTIS prélève une **commission de 3 % HT** sur le montant TTC de chaque Transaction réalisée sur la Boutique du Wholesaler. Cette commission est prélevée automatiquement via le mécanisme « Application Fee » de Stripe Connect au moment de chaque encaissement.

### 7.2 Modalités de prélèvement

Pour chaque Transaction :
1. Le Retailer paie le montant total via la Boutique.
2. Stripe prélève ses propres frais de traitement (variables selon le moyen de paiement, à la charge du Wholesaler).
3. AVENTIS prélève sa commission de 3 % HT.
4. Le solde est versé sur le compte bancaire du Wholesaler associé à Stripe Connect Express.

### 7.3 Facturation des commissions

Une facture mensuelle récapitulative est émise par AVENTIS le 1er de chaque mois, regroupant :
- le montant de l'abonnement du mois ;
- la somme des commissions prélevées au cours du mois précédent ;
- la TVA correspondante.

Cette facture est consultable et téléchargeable au format PDF depuis l'interface d'administration du Wholesaler.

### 7.4 Remboursements

En cas de remboursement intégral ou partiel d'une Transaction par le Wholesaler à son Retailer, la commission AVENTIS correspondante **n'est pas restituée**, conformément à l'usage du secteur (Stripe applique la même règle pour ses propres frais de traitement).

---

## Article 8 — Modalités de paiement

### 8.1 Moyen de paiement de l'abonnement

L'abonnement est exclusivement payé par **carte bancaire** via le portail sécurisé Stripe Billing.

### 8.2 Échec de paiement

En cas d'échec d'un prélèvement (carte refusée, plafond atteint, etc.) :
- **Tentatives automatiques** : Stripe relance le prélèvement automatiquement pendant 7 jours (jusqu'à 3 tentatives).
- **Notifications** : le Wholesaler reçoit des emails à J+1, J+3 et J+5 pour mettre à jour ses informations de paiement.
- **Délai de grâce** : la Boutique reste pleinement accessible pendant 7 jours après le premier échec (article 11).

### 8.3 Mise à jour des informations bancaires

Le Wholesaler peut mettre à jour ses informations de paiement à tout moment depuis son interface d'administration via un lien sécurisé Stripe.

---

## Article 9 — Période d'Essai gratuite

### 9.1 Durée

Tout nouveau Wholesaler bénéficie d'une **Période d'Essai gratuite de 14 jours** à compter de son inscription, **sans saisie de carte bancaire requise**.

### 9.2 Limites pendant l'Essai

Pendant la Période d'Essai, le Wholesaler bénéficie des fonctionnalités de la formule **PRO**, à l'exception :
- de l'activation des paiements réels (le KYC Stripe Connect est nécessaire pour vendre) ;
- de la connexion à un nom de domaine personnel.

### 9.3 Fin de l'Essai

À l'expiration de la Période d'Essai :
- Si le Wholesaler a souscrit une formule payante : le premier prélèvement intervient automatiquement.
- Sinon, la Boutique est **suspendue** (article 11) jusqu'à souscription.

---

## Article 10 — Durée, résiliation et suppression du compte

### 10.1 Durée du contrat

Le contrat est conclu pour une **durée indéterminée**, par périodes mensuelles renouvelables tacitement.

### 10.2 Résiliation par le Wholesaler

Le Wholesaler peut résilier son abonnement à tout moment depuis son interface d'administration. La résiliation prend effet **à la fin de la période mensuelle en cours déjà payée**, sans préavis ni frais.

Aucun remboursement prorata temporis n'est effectué pour les jours restants à courir.

### 10.3 Résiliation par AVENTIS

AVENTIS peut résilier le compte d'un Wholesaler en cas :
- d'impayé persistant après le délai d'archivage (article 11) ;
- de violation grave des CGU ;
- d'activité frauduleuse ou contraire à la loi ;
- de litiges récurrents avec ses Retailers laissant présumer une mauvaise foi.

En cas de résiliation pour faute grave, aucun remboursement n'est dû.

### 10.4 Export des données

À tout moment, et avant toute résiliation effective, le Wholesaler peut demander l'**export de ses données** (catalogue produits, fichier clients, historique commandes, factures émises) au format ZIP via son interface d'administration.

Cette demande est soumise à une **double confirmation par code OTP envoyé par email** pour prévenir tout détournement.

---

## Article 11 — Suspension pour impayé

En cas d'impayé non régularisé après les 7 jours du délai de grâce :

| Jour | Action |
|---|---|
| **J+8** | Boutique **suspendue** : la page d'accueil affiche un message « Boutique temporairement indisponible », les Retailers ne peuvent plus accéder à la boutique ni passer commande. L'interface d'administration reste accessible pour régulariser. |
| **J+30** | Compte **archivé** : l'accès à l'interface d'administration est coupé. Les données sont conservées mais inaccessibles. |
| **J+90** | **Suppression définitive** des données conformément à la politique de rétention RGPD. |

À tout moment avant J+90, le Wholesaler peut régulariser sa situation pour réactiver son compte.

---

## Article 12 — Obligations du Wholesaler

Le Wholesaler s'engage à :

### 12.1 Conformité légale

- exercer une activité **commerciale licite** conforme au droit français et européen ;
- vendre uniquement des produits **dont il dispose des droits** (propriété intellectuelle, contrats d'approvisionnement, certifications éventuelles) ;
- respecter le droit de la consommation (mentions obligatoires, droit de rétractation, garanties légales) vis-à-vis de ses Retailers ;
- rédiger et publier ses propres Conditions Générales de Vente (CGV) à destination de ses Retailers (un modèle adapté lui est fourni par AVENTIS à titre indicatif).

### 12.2 Données et confidentialité

- traiter les données personnelles de ses Retailers conformément au **RGPD**, en tant que responsable de traitement ;
- accepter le **Data Processing Agreement (DPA)** annexé aux présentes CGU, faisant d'AVENTIS son sous-traitant technique ;
- ne pas tenter de contourner les mécanismes de cloisonnement pour accéder aux données d'autres Wholesalers.

### 12.3 Usage loyal

- ne pas tenter d'attaquer ou de saturer techniquement la Plateforme (DoS, scrapping massif, injections) ;
- ne pas revendre ou redistribuer l'accès à AVENTIS à des tiers (sauf accord exprès) ;
- ne pas utiliser AVENTIS pour des activités contraires aux bonnes mœurs ou à l'ordre public.

### 12.4 Paiement

- maintenir à jour des informations de paiement valides ;
- régler les sommes dues à leur échéance ;
- assumer les frais de toute commission marketplace, frais Stripe ou taxe applicable à ses propres ventes.

### 12.5 Communication

- répondre lui-même aux questions et réclamations de ses Retailers (le support client final est à sa charge) ;
- configurer son propre serveur SMTP pour l'envoi des emails à ses Retailers (sinon les emails ne seront pas envoyés et il en sera seul responsable).

---

## Article 13 — Obligations d'AVENTIS

AVENTIS s'engage à :

- mettre à disposition la Plateforme dans les conditions de l'article 5 ;
- protéger les données du Wholesaler par des mesures techniques et organisationnelles raisonnables (chiffrement en transit et au repos pour les données sensibles, sauvegardes régulières) ;
- notifier le Wholesaler dans les meilleurs délais en cas d'incident de sécurité affectant ses données (au plus tard 72 heures après prise de connaissance, conformément au RGPD) ;
- fournir un support technique par email à `support@aventis-app.fr` (engagement de meilleur effort, pas de délai contractuel garanti) ;
- maintenir la Plateforme en condition opérationnelle, corriger les bugs critiques dans des délais raisonnables, et publier des mises à jour régulières ;
- traiter les données personnelles du Wholesaler conformément à la **Politique de Confidentialité**.

---

## Article 14 — Protection des données personnelles (RGPD)

### 14.1 Données collectées par AVENTIS sur le Wholesaler

AVENTIS collecte, en qualité de **responsable de traitement** vis-à-vis du Wholesaler :
- identité et contact (nom, prénom, email, téléphone, adresse) ;
- données d'entreprise (raison sociale, SIRET, TVA, Kbis, IBAN via Stripe) ;
- données de connexion (logs, adresse IP, type de navigateur) ;
- données de paiement (gérées par Stripe, AVENTIS ne stocke jamais les numéros de carte).

Ces données sont traitées pour :
- gérer le compte et la facturation du Wholesaler ;
- assurer la sécurité de la Plateforme ;
- répondre aux obligations légales (comptabilité, lutte anti-fraude).

**Durée de conservation** : 3 ans après la fin du contrat pour les données contractuelles, 10 ans pour les factures (obligation comptable).

Le Wholesaler dispose d'un droit d'accès, de rectification, d'effacement, de limitation, de portabilité et d'opposition sur ses données, exerçable à `dpo@aventis-app.fr` ou par courrier à l'adresse du siège.

Il peut également introduire une réclamation auprès de la **CNIL** (www.cnil.fr).

### 14.2 Données traitées par AVENTIS pour le compte du Wholesaler (sous-traitance)

Pour les données des **Retailers** stockées dans la Boutique du Wholesaler :
- le **Wholesaler** est **responsable de traitement** ;
- **AVENTIS** agit comme **sous-traitant** au sens de l'article 28 du RGPD.

Les modalités de cette sous-traitance sont précisées dans le **Data Processing Agreement (DPA)** annexé aux présentes CGU, qui en fait partie intégrante. En souscrivant à AVENTIS, le Wholesaler accepte le DPA dans son intégralité.

### 14.3 Hébergement et sous-traitants

Les données sont hébergées dans l'Union Européenne. AVENTIS fait appel aux sous-traitants suivants, tous situés en UE ou conformes au RGPD :
- **Hostinger** (hébergement serveurs, Lituanie) ;
- **Stripe Payments Europe** (paiements, Irlande) ;
- **Let's Encrypt / acme.sh** (certificats HTTPS, sans accès aux données) ;
- **PFS / Ankorstore / Faire / eFashion** (marketplaces externes, uniquement si activées par le Wholesaler — chacune avec ses propres engagements RGPD).

La liste des sous-traitants est tenue à jour dans la Politique de Confidentialité.

---

## Article 15 — Propriété intellectuelle

### 15.1 Droits d'AVENTIS

La Plateforme, son code source, ses bases de données, ses interfaces graphiques, ses textes, logos et marques sont la propriété exclusive de l'Éditeur. Toute reproduction, représentation, traduction ou exploitation non autorisée est interdite.

Le Wholesaler bénéficie, pendant la durée de son abonnement, d'un **droit d'usage personnel, non exclusif et non cessible** de la Plateforme.

### 15.2 Droits du Wholesaler sur ses contenus

Le Wholesaler conserve l'intégralité de ses droits sur les contenus qu'il publie sur sa Boutique (images produits, descriptions, textes, marques).

En les téléversant sur AVENTIS, il accorde à l'Éditeur une **licence limitée, non exclusive et gratuite** d'hébergement, de copie et de représentation, **strictement nécessaire à l'exécution du service** et pour la durée de l'abonnement.

### 15.3 Garantie sur les contenus

Le Wholesaler garantit qu'il dispose de tous les droits sur les contenus qu'il téléverse, et qu'aucun d'eux ne porte atteinte aux droits de tiers. Il garantit AVENTIS contre toute action en contrefaçon ou diffamation intentée à raison de ces contenus.

---

## Article 16 — Confidentialité

Chaque partie s'engage à conserver confidentielles les informations non publiques de l'autre partie auxquelles elle aurait accès dans le cadre du contrat, et à ne les utiliser qu'aux fins de l'exécution du service.

Cette obligation perdure 3 ans après la fin du contrat.

---

## Article 17 — Responsabilité

### 17.1 Limitations de responsabilité

La responsabilité d'AVENTIS ne peut être engagée que pour les dommages **directs et prévisibles** résultant d'un manquement avéré à ses obligations contractuelles. AVENTIS ne saurait être tenue responsable des dommages indirects (perte de chiffre d'affaires, perte de clientèle, atteinte à l'image).

En tout état de cause, la responsabilité totale d'AVENTIS au titre du contrat est plafonnée au **montant total des sommes payées par le Wholesaler au cours des 12 derniers mois précédant le fait générateur**.

### 17.2 Exclusions

AVENTIS n'est pas responsable :
- des contenus publiés par le Wholesaler sur sa Boutique ;
- des relations commerciales entre le Wholesaler et ses Retailers (ventes, retours, litiges, garanties) ;
- des défaillances ou indisponibilités des prestataires externes (Stripe, PFS, Ankorstore, Faire, eFashion, INSEE, etc.) ;
- des actes de tiers (piratage informatique, cyberattaque) malgré des mesures de protection raisonnables ;
- des conséquences fiscales, comptables ou douanières des ventes effectuées par le Wholesaler.

### 17.3 Responsabilité du Wholesaler

Le Wholesaler est seul responsable :
- du respect du droit applicable à son activité ;
- de la conformité des produits qu'il vend ;
- du traitement des données personnelles de ses Retailers ;
- des litiges commerciaux avec ses Retailers ;
- de la véracité des informations qu'il publie.

Le Wholesaler s'engage à indemniser AVENTIS de tout préjudice résultant d'un manquement à ses obligations.

---

## Article 18 — Force majeure

Aucune des parties ne pourra être tenue responsable d'un manquement à ses obligations en cas de force majeure au sens de l'article 1218 du Code civil (catastrophes naturelles, guerre, pandémie, grèves générales, défaillance d'infrastructures publiques, décisions gouvernementales rendant impossible l'exécution).

La partie empêchée informera l'autre dans les meilleurs délais. Si la situation se prolonge au-delà de 30 jours, chaque partie pourra résilier le contrat sans indemnité.

---

## Article 19 — Modifications des CGU

AVENTIS se réserve le droit de modifier les CGU à tout moment, notamment pour adapter le service, intégrer de nouvelles fonctionnalités, ou se conformer à de nouvelles obligations légales.

Les modifications seront notifiées par email au Wholesaler avec un préavis de **30 jours** avant leur entrée en vigueur. Pendant ce préavis, le Wholesaler peut résilier son abonnement sans frais s'il refuse les nouvelles conditions. À défaut de résiliation à l'expiration du préavis, les nouvelles CGU sont réputées acceptées.

---

## Article 20 — Modifications des tarifs

AVENTIS se réserve le droit de modifier le prix des abonnements et/ou le taux de commission, avec un **préavis de 60 jours** par email. Le Wholesaler peut résilier son abonnement sans frais s'il refuse la nouvelle tarification, ou conserver son tarif actuel jusqu'à la fin de sa période mensuelle en cours, puis basculer sur le nouveau tarif au renouvellement.

---

## Article 21 — Cession

AVENTIS peut céder le contrat à toute société venant aux droits de l'Entreprise Individuelle Boris Chen (notamment en cas de transformation en SASU/SARL ou de cession du fonds), sans accord préalable du Wholesaler. Le Wholesaler en sera informé par email.

Le Wholesaler ne peut céder son compte à un tiers sans accord exprès d'AVENTIS.

---

## Article 22 — Notifications

Sauf disposition contraire, toute notification entre les parties s'effectue par **email** (à l'adresse `contact@aventis-app.fr` pour AVENTIS, à l'adresse renseignée à l'inscription pour le Wholesaler).

---

## Article 23 — Renonciation et nullité partielle

Le fait pour AVENTIS de ne pas exercer un droit prévu aux présentes CGU ne saurait valoir renonciation à ce droit.

Si l'une des stipulations des CGU venait à être déclarée nulle ou inapplicable, les autres stipulations resteraient pleinement applicables.

---

## Article 24 — Droit applicable et juridiction

Les présentes CGU sont régies par le **droit français**.

Tout litige relatif à leur formation, leur exécution ou leur interprétation sera, à défaut de résolution amiable préalable (à laquelle les parties s'engagent), soumis à la compétence exclusive des **Tribunaux du ressort de la Cour d'Appel de Paris**, nonobstant pluralité de défendeurs ou appel en garantie.

Conformément aux articles L.611-1 et suivants du Code de la consommation, le Wholesaler agissant à titre professionnel **ne bénéficie pas** du recours à la médiation de la consommation.

---

## Annexes

Les documents suivants font partie intégrante des présentes CGU :

- **Annexe 1** — Data Processing Agreement (DPA) — voir `DPA.md`
- **Annexe 2** — Politique de Confidentialité — voir `POLITIQUE-CONFIDENTIALITE.md`
- **Annexe 3** — Mentions Légales — voir `MENTIONS-LEGALES.md`
- **Annexe 4** — Modèle de CGV à destination des Retailers (fourni à titre indicatif) — à produire

---

*Dernière mise à jour : 2026-06-28 — Version 1.0*
