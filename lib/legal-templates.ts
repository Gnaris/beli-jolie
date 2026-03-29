/**
 * lib/legal-templates.ts
 *
 * Templates HTML pré-remplis pour les documents légaux.
 * Utilisent des variables {{xxx}} remplacées par les infos société.
 */

export const LEGAL_VARIABLE_LIST = [
  { key: "company_name", label: "Raison sociale" },
  { key: "legal_form", label: "Forme juridique" },
  { key: "capital", label: "Capital social" },
  { key: "siret", label: "SIRET" },
  { key: "rcs", label: "RCS" },
  { key: "tva_number", label: "N° TVA" },
  { key: "address", label: "Adresse" },
  { key: "city", label: "Ville" },
  { key: "postal_code", label: "Code postal" },
  { key: "country", label: "Pays" },
  { key: "phone", label: "Téléphone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Site web" },
  { key: "director", label: "Directeur de publication" },
  { key: "host_name", label: "Hébergeur (nom)" },
  { key: "host_address", label: "Hébergeur (adresse)" },
  { key: "host_phone", label: "Hébergeur (téléphone)" },
  { key: "host_email", label: "Hébergeur (email)" },
] as const;

export type LegalVariable = (typeof LEGAL_VARIABLE_LIST)[number]["key"];

/**
 * Replace {{variable}} placeholders with company info values.
 */
export function renderLegalContent(
  content: string,
  companyInfo: Record<string, string | null | undefined>
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = companyInfo[key];
    return value || match; // Keep placeholder if no value
  });
}

/**
 * Convert CompanyInfo DB record to flat key-value map for template rendering.
 */
export function companyInfoToVariables(
  info: {
    name: string;
    legalForm?: string | null;
    capital?: string | null;
    siret?: string | null;
    rcs?: string | null;
    tvaNumber?: string | null;
    address?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    director?: string | null;
    hostName?: string | null;
    hostAddress?: string | null;
    hostPhone?: string | null;
    hostEmail?: string | null;
  } | null
): Record<string, string> {
  if (!info) return {};
  return {
    company_name: info.name || "",
    legal_form: info.legalForm || "",
    capital: info.capital || "",
    siret: info.siret || "",
    rcs: info.rcs || "",
    tva_number: info.tvaNumber || "",
    address: info.address || "",
    city: info.city || "",
    postal_code: info.postalCode || "",
    country: info.country || "France",
    phone: info.phone || "",
    email: info.email || "",
    website: info.website || "",
    director: info.director || "",
    host_name: info.hostName || "",
    host_address: info.hostAddress || "",
    host_phone: info.hostPhone || "",
    host_email: info.hostEmail || "",
  };
}

// ─────────────────────────────────────────────
// Default templates for each document type
// ─────────────────────────────────────────────

export const DEFAULT_TEMPLATES = {
  MENTIONS_LEGALES: {
    title: "Mentions légales",
    content: `<h2>1. Éditeur du site</h2>
<p>Le site <strong>{{website}}</strong> est édité par la société <strong>{{company_name}}</strong>, {{legal_form}} au capital de {{capital}} €.</p>
<ul>
<li><strong>Siège social :</strong> {{address}}, {{postal_code}} {{city}}, {{country}}</li>
<li><strong>SIRET :</strong> {{siret}}</li>
<li><strong>RCS :</strong> {{rcs}}</li>
<li><strong>N° TVA intracommunautaire :</strong> {{tva_number}}</li>
<li><strong>Téléphone :</strong> {{phone}}</li>
<li><strong>Email :</strong> {{email}}</li>
</ul>

<h2>2. Directeur de la publication</h2>
<p>Le directeur de la publication est <strong>{{director}}</strong>.</p>

<h2>3. Hébergeur</h2>
<ul>
<li><strong>Nom :</strong> {{host_name}}</li>
<li><strong>Adresse :</strong> {{host_address}}</li>
<li><strong>Téléphone :</strong> {{host_phone}}</li>
<li><strong>Email :</strong> {{host_email}}</li>
</ul>

<h2>4. Propriété intellectuelle</h2>
<p>L'ensemble du contenu de ce site (textes, images, vidéos, logos, marques) est protégé par le droit de la propriété intellectuelle. Toute reproduction, même partielle, est interdite sans autorisation préalable de {{company_name}}.</p>

<h2>5. Données personnelles</h2>
<p>Les informations collectées sur ce site font l'objet d'un traitement informatique destiné à la gestion des commandes et de la relation client. Conformément au RGPD, vous disposez d'un droit d'accès, de rectification et de suppression de vos données. Pour exercer ce droit, contactez-nous à : <strong>{{email}}</strong>.</p>`,
  },

  CGV: {
    title: "Conditions Générales de Vente",
    content: `<h2>Article 1 — Objet</h2>
<p>Les présentes Conditions Générales de Vente (CGV) régissent les relations contractuelles entre <strong>{{company_name}}</strong> (ci-après « le Vendeur ») et tout professionnel effectuant un achat sur le site <strong>{{website}}</strong> (ci-après « l'Acheteur »).</p>

<h2>Article 2 — Identité du vendeur</h2>
<ul>
<li><strong>Raison sociale :</strong> {{company_name}}, {{legal_form}}</li>
<li><strong>Siège social :</strong> {{address}}, {{postal_code}} {{city}}</li>
<li><strong>SIRET :</strong> {{siret}}</li>
<li><strong>N° TVA :</strong> {{tva_number}}</li>
<li><strong>Contact :</strong> {{email}} — {{phone}}</li>
</ul>

<h2>Article 3 — Accès et inscription</h2>
<p>L'accès au catalogue et la passation de commandes sont réservés aux professionnels disposant d'un compte approuvé. L'inscription nécessite la fourniture d'un numéro SIRET valide et peut être soumise à validation.</p>

<h2>Article 4 — Prix</h2>
<p>Les prix sont indiqués en euros hors taxes (HT). La TVA applicable est calculée selon les règles en vigueur (20% France métropole, exonération intracommunautaire sur présentation d'un numéro de TVA valide, 0% DOM-TOM et hors UE).</p>

<h2>Article 5 — Commande</h2>
<p>La validation d'une commande implique l'acceptation intégrale des présentes CGV. Un montant minimum de commande peut être requis. La commande est confirmée par un email récapitulatif envoyé à l'Acheteur.</p>

<h2>Article 6 — Paiement</h2>
<p>Le paiement s'effectue en ligne par carte bancaire via la plateforme sécurisée Stripe. Le paiement est exigible à la commande.</p>

<h2>Article 7 — Livraison</h2>
<p>Les délais de livraison sont donnés à titre indicatif. Les frais de port sont calculés en fonction du poids total et de la destination. Le transfert de risques s'opère au moment de la remise du colis au transporteur.</p>

<h2>Article 8 — Retours et réclamations</h2>
<p>En tant que vente entre professionnels (B2B), le droit de rétractation de 14 jours prévu par le Code de la consommation ne s'applique pas. Toute réclamation relative à un défaut de conformité doit être adressée dans les 48 heures suivant la réception à <strong>{{email}}</strong>.</p>

<h2>Article 9 — Garanties</h2>
<p>Les produits bénéficient de la garantie légale contre les vices cachés (articles 1641 et suivants du Code civil).</p>

<h2>Article 10 — Responsabilité</h2>
<p>{{company_name}} ne saurait être tenue responsable des dommages indirects résultant de l'utilisation des produits. La responsabilité est limitée au montant de la commande.</p>

<h2>Article 11 — Données personnelles</h2>
<p>Les données collectées sont traitées conformément à notre Politique de confidentialité et au RGPD. Pour plus d'informations, consultez notre page dédiée.</p>

<h2>Article 12 — Droit applicable</h2>
<p>Les présentes CGV sont soumises au droit français. Tout litige sera soumis aux tribunaux compétents de {{city}}.</p>`,
  },

  CGU: {
    title: "Conditions Générales d'Utilisation",
    content: `<h2>Article 1 — Objet</h2>
<p>Les présentes Conditions Générales d'Utilisation (CGU) définissent les règles d'accès et d'utilisation du site <strong>{{website}}</strong> exploité par <strong>{{company_name}}</strong>.</p>

<h2>Article 2 — Accès au site</h2>
<p>L'accès au site est réservé aux professionnels. La création d'un compte nécessite la fourniture d'informations exactes et à jour. L'utilisateur est responsable de la confidentialité de ses identifiants.</p>

<h2>Article 3 — Utilisation du site</h2>
<p>L'utilisateur s'engage à utiliser le site de manière loyale et conformément à sa destination. Il est interdit de :</p>
<ul>
<li>Collecter automatiquement des données du site (scraping)</li>
<li>Tenter d'accéder à des zones non autorisées</li>
<li>Utiliser le site à des fins illicites</li>
<li>Perturber le fonctionnement du site</li>
</ul>

<h2>Article 4 — Compte utilisateur</h2>
<p>{{company_name}} se réserve le droit de suspendre ou supprimer tout compte en cas de non-respect des présentes CGU ou de fourniture d'informations inexactes.</p>

<h2>Article 5 — Propriété intellectuelle</h2>
<p>L'ensemble des éléments du site (design, textes, images, logos) sont la propriété de {{company_name}} et sont protégés par le droit de la propriété intellectuelle.</p>

<h2>Article 6 — Responsabilité</h2>
<p>{{company_name}} s'efforce d'assurer la disponibilité du site mais ne garantit pas un accès ininterrompu. La société ne saurait être tenue responsable des interruptions temporaires pour maintenance ou mise à jour.</p>

<h2>Article 7 — Modification des CGU</h2>
<p>{{company_name}} se réserve le droit de modifier les présentes CGU à tout moment. Les utilisateurs seront informés des modifications par tout moyen approprié.</p>

<h2>Article 8 — Contact</h2>
<p>Pour toute question relative aux présentes CGU, contactez-nous à : <strong>{{email}}</strong> ou par téléphone au <strong>{{phone}}</strong>.</p>`,
  },

  POLITIQUE_CONFIDENTIALITE: {
    title: "Politique de confidentialité",
    content: `<h2>1. Responsable du traitement</h2>
<p>Le responsable du traitement des données personnelles est <strong>{{company_name}}</strong>, {{legal_form}}, dont le siège social est situé au {{address}}, {{postal_code}} {{city}}.</p>
<p>Contact : <strong>{{email}}</strong> — <strong>{{phone}}</strong></p>

<h2>2. Données collectées</h2>
<p>Nous collectons les données suivantes :</p>
<ul>
<li><strong>Données d'identification :</strong> nom, prénom, raison sociale, SIRET, email, téléphone</li>
<li><strong>Données de connexion :</strong> adresse IP, logs de connexion</li>
<li><strong>Données de commande :</strong> adresses de livraison, historique des commandes</li>
<li><strong>Données de paiement :</strong> traitées directement par Stripe (nous ne stockons pas vos données bancaires)</li>
</ul>

<h2>3. Finalités du traitement</h2>
<ul>
<li>Gestion des comptes clients et des commandes</li>
<li>Communication relative aux commandes (confirmation, expédition, facturation)</li>
<li>Sécurité du site (prévention de la fraude, protection contre les accès non autorisés)</li>
<li>Amélioration de nos services</li>
</ul>

<h2>4. Base légale</h2>
<ul>
<li><strong>Exécution du contrat :</strong> traitement des commandes et gestion du compte</li>
<li><strong>Intérêt légitime :</strong> sécurité du site, prévention de la fraude</li>
<li><strong>Obligation légale :</strong> conservation des factures (10 ans)</li>
</ul>

<h2>5. Durée de conservation</h2>
<ul>
<li>Données de compte : durée de la relation commerciale + 3 ans</li>
<li>Données de commande : 10 ans (obligation comptable)</li>
<li>Logs de connexion : 12 mois</li>
<li>Cookies : 13 mois maximum</li>
</ul>

<h2>6. Destinataires des données</h2>
<p>Vos données peuvent être transmises à :</p>
<ul>
<li>Nos prestataires de paiement (Stripe)</li>
<li>Nos transporteurs (Easy-Express, Colissimo, Chronopost)</li>
<li>Notre hébergeur ({{host_name}})</li>
</ul>
<p>Aucun transfert de données hors de l'Union Européenne n'est effectué sans garanties appropriées.</p>

<h2>7. Vos droits</h2>
<p>Conformément au RGPD, vous disposez des droits suivants :</p>
<ul>
<li>Droit d'accès à vos données</li>
<li>Droit de rectification</li>
<li>Droit à l'effacement (« droit à l'oubli »)</li>
<li>Droit à la portabilité</li>
<li>Droit d'opposition</li>
<li>Droit à la limitation du traitement</li>
</ul>
<p>Pour exercer ces droits, contactez-nous à : <strong>{{email}}</strong></p>
<p>Vous pouvez également introduire une réclamation auprès de la CNIL (www.cnil.fr).</p>

<h2>8. Sécurité</h2>
<p>Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos données : chiffrement SSL/TLS, mots de passe hashés, accès restreint aux données, monitoring des accès.</p>`,
  },

  COOKIES: {
    title: "Politique de cookies",
    content: `<h2>1. Qu'est-ce qu'un cookie ?</h2>
<p>Un cookie est un petit fichier texte déposé sur votre terminal (ordinateur, tablette, smartphone) lors de la consultation de notre site. Il permet de stocker des informations relatives à votre navigation.</p>

<h2>2. Cookies utilisés sur ce site</h2>

<h3>Cookies strictement nécessaires</h3>
<p>Ces cookies sont indispensables au fonctionnement du site et ne peuvent pas être désactivés :</p>
<ul>
<li><strong>Session d'authentification</strong> — Maintient votre connexion active (durée : session / 30 jours)</li>
<li><strong>Préférences de langue</strong> (<code>bj_locale</code>) — Mémorise votre langue préférée (durée : 1 an)</li>
<li><strong>Code d'accès invité</strong> (<code>bj_access_code</code>) — Permet la navigation sans inscription (durée : 1 an)</li>
</ul>

<h3>Cookies fonctionnels</h3>
<ul>
<li><strong>Panier</strong> — Sauvegarde le contenu de votre panier (stocké en base de données, lié à votre compte)</li>
</ul>

<h2>3. Cookies tiers</h2>
<ul>
<li><strong>Stripe</strong> — Cookies nécessaires au traitement sécurisé des paiements. Consultez la <a href="https://stripe.com/fr/privacy" target="_blank" rel="noopener noreferrer">politique de confidentialité de Stripe</a>.</li>
</ul>

<h2>4. Gestion des cookies</h2>
<p>Vous pouvez gérer vos préférences de cookies via les paramètres de votre navigateur :</p>
<ul>
<li>Chrome : Paramètres → Confidentialité et sécurité → Cookies</li>
<li>Firefox : Options → Vie privée et sécurité → Cookies</li>
<li>Safari : Préférences → Confidentialité → Cookies</li>
</ul>
<p>La suppression des cookies essentiels peut empêcher le bon fonctionnement du site.</p>

<h2>5. Contact</h2>
<p>Pour toute question relative aux cookies, contactez-nous à : <strong>{{email}}</strong></p>`,
  },
} as const;
