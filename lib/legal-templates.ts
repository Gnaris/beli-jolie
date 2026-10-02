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
<p>Le site <strong>{{website}}</strong> est édité par la société <strong>{{company_name}}</strong>, {{legal_form}} au capital social de {{capital}} €.</p>
<ul>
<li><strong>Siège social :</strong> {{address}}, {{postal_code}} {{city}}, {{country}}</li>
<li><strong>SIRET :</strong> {{siret}}</li>
<li><strong>RCS :</strong> {{rcs}}</li>
<li><strong>N° TVA intracommunautaire :</strong> {{tva_number}}</li>
<li><strong>Téléphone :</strong> {{phone}}</li>
<li><strong>Email :</strong> {{email}}</li>
</ul>

<h2>2. Directeur de la publication</h2>
<p>Le directeur de la publication est <strong>{{director}}</strong>, en qualité de représentant légal de {{company_name}}.</p>

<h2>3. Hébergement</h2>
<p>Le site est hébergé par :</p>
<ul>
<li><strong>Nom :</strong> {{host_name}}</li>
<li><strong>Adresse :</strong> {{host_address}}</li>
<li><strong>Téléphone :</strong> {{host_phone}}</li>
<li><strong>Email :</strong> {{host_email}}</li>
</ul>

<h2>4. Nous contacter</h2>
<p>Pour toute question relative au fonctionnement du site, à une commande ou à votre compte, vous pouvez nous joindre par email à <strong>{{email}}</strong> ou par téléphone au <strong>{{phone}}</strong> (horaires d'ouverture indiqués sur la page de contact).</p>

<h2>5. Propriété intellectuelle</h2>
<p>L'ensemble du contenu du site (textes, photographies, visuels, logos, marques, mise en page, arborescence, code source) est la propriété exclusive de {{company_name}} ou de ses partenaires et est protégé par le droit français et international de la propriété intellectuelle.</p>
<p>Toute reproduction, représentation, modification, publication ou adaptation, totale ou partielle, par quelque procédé que ce soit, est strictement interdite sans l'autorisation écrite préalable de {{company_name}}. Toute exploitation non autorisée constitue une contrefaçon sanctionnée par les articles L.335-2 et suivants du Code de la propriété intellectuelle.</p>

<h2>6. Crédits</h2>
<p>Les photographies des produits sont réalisées par {{company_name}} ou fournies par ses fournisseurs avec autorisation d'exploitation commerciale. Les éventuels visuels tiers sont mentionnés à proximité ou dans les métadonnées des fichiers concernés.</p>

<h2>7. Données personnelles et cookies</h2>
<p>Le traitement des données personnelles collectées sur le site est détaillé dans notre <a href="/confidentialite">Politique de confidentialité</a>. L'usage des cookies est décrit dans notre <a href="/cookies">Politique de cookies</a>.</p>

<h2>8. Loi applicable</h2>
<p>Les présentes mentions légales sont soumises au droit français. En cas de litige, et à défaut d'accord amiable, les tribunaux français seront seuls compétents.</p>`,
  },

  CGV: {
    title: "Conditions Générales de Vente",
    content: `<h2>Article 1 — Objet et champ d'application</h2>
<p>Les présentes Conditions Générales de Vente (ci-après « CGV ») régissent, sans restriction ni réserve, les relations contractuelles entre la société <strong>{{company_name}}</strong> (ci-après « le Vendeur ») et tout acheteur professionnel (ci-après « l'Acheteur ») passant commande sur le site <strong>{{website}}</strong>.</p>
<p>La vente est strictement réservée aux professionnels agissant dans le cadre de leur activité commerciale (achat pour revente, usage professionnel). Les CGV n'ouvrent aucun droit à un consommateur au sens du Code de la consommation ; en particulier, le droit de rétractation de quatorze (14) jours ne s'applique pas.</p>
<p>Toute commande emporte adhésion pleine, entière et sans réserve aux présentes CGV, lesquelles prévalent sur toutes conditions d'achat de l'Acheteur, sauf accord écrit préalable du Vendeur.</p>

<h2>Article 2 — Identité du Vendeur</h2>
<ul>
<li><strong>Raison sociale :</strong> {{company_name}}, {{legal_form}} au capital social de {{capital}} €</li>
<li><strong>Siège social :</strong> {{address}}, {{postal_code}} {{city}}, {{country}}</li>
<li><strong>SIRET :</strong> {{siret}}</li>
<li><strong>RCS :</strong> {{rcs}}</li>
<li><strong>N° TVA intracommunautaire :</strong> {{tva_number}}</li>
<li><strong>Contact :</strong> {{email}} — {{phone}}</li>
</ul>

<h2>Article 3 — Accès au site et création de compte</h2>
<p>La consultation du catalogue est libre. En revanche, la consultation des prix et la passation de commandes sont réservées aux Acheteurs disposant d'un compte approuvé par le Vendeur.</p>
<p>L'inscription nécessite la fourniture :</p>
<ul>
<li>pour les sociétés françaises : d'un numéro SIRET valide, de la forme juridique et de la raison sociale ;</li>
<li>pour les sociétés étrangères : d'un numéro d'immatriculation professionnelle équivalent et, le cas échéant, d'un numéro de TVA intracommunautaire valide ;</li>
<li>d'un justificatif d'activité (extrait Kbis de moins de trois mois ou équivalent) sur demande du Vendeur.</li>
</ul>
<p>Après vérification, le compte est <strong>approuvé, mis en attente de pièces complémentaires ou refusé</strong>. Le Vendeur se réserve le droit discrétionnaire de refuser une inscription sans avoir à justifier sa décision. Les prix et le tunnel de commande ne sont accessibles qu'une fois le compte approuvé.</p>

<h2>Article 4 — Produits et disponibilité</h2>
<p>Les produits proposés sont décrits et présentés avec la plus grande exactitude possible. Les photographies et descriptions sont fournies à titre indicatif et ne sauraient engager le Vendeur en cas de variations mineures (nuance de couleur, dimensions à ±1 cm, infimes différences liées au caractère artisanal de certaines pièces).</p>
<p>Les offres de produits et de prix sont valables tant qu'elles sont visibles sur le site, dans la limite des stocks disponibles. En cas d'indisponibilité partielle ou totale d'un produit après validation de la commande, le Vendeur en informe l'Acheteur dans les meilleurs délais et procède, au choix de l'Acheteur, à un report de livraison, au remplacement du produit par un article équivalent, à l'émission d'un avoir utilisable sur une prochaine commande ou au <strong>remboursement du montant correspondant</strong>.</p>

<h2>Article 5 — Prix</h2>
<p>Les prix sont indiqués en euros, <strong>hors taxes (HT)</strong>, hors frais de livraison. La TVA applicable est calculée au moment de la commande selon les règles fiscales en vigueur :</p>
<ul>
<li><strong>France métropolitaine :</strong> TVA au taux légal en vigueur ;</li>
<li><strong>Union Européenne :</strong> exonération de TVA sur présentation d'un numéro de TVA intracommunautaire valide (régime B2B intracommunautaire) ; à défaut, TVA française applicable ;</li>
<li><strong>DOM-TOM et hors Union Européenne :</strong> hors TVA, taxes locales et droits de douane à la charge exclusive de l'Acheteur.</li>
</ul>
<p>Le Vendeur se réserve le droit de modifier ses prix à tout moment. Les produits sont néanmoins facturés sur la base des tarifs en vigueur au moment de la validation de la commande.</p>

<h2>Article 6 — Minimum de commande</h2>
<p>Un montant minimum de commande de <strong>cent (100) euros hors taxes</strong> est exigé pour toute passation de commande sur le Site. Les commandes dont le sous-total serait inférieur à ce seuil ne pourront être validées.</p>

<h2>Article 7 — Processus de commande</h2>
<p>L'Acheteur sélectionne les produits souhaités, valide son panier, choisit son mode de livraison et de paiement, puis confirme sa commande. La commande n'est définitivement formée qu'après encaissement du paiement (pour le paiement par carte bancaire) ou enregistrement de l'ordre de virement (pour le paiement par virement).</p>
<p>Un email de confirmation récapitulant la commande (produits, quantités, prix, adresse de livraison) est adressé à l'Acheteur. Le Vendeur archive le bon de commande ; celui-ci fait foi entre les parties.</p>

<h2>Article 8 — Modalités de paiement</h2>
<p>Les moyens de paiement acceptés sont :</p>
<ul>
<li><strong>Carte bancaire</strong> (Visa, Mastercard, American Express) via la plateforme sécurisée <strong>Stripe</strong>. Les transactions sont chiffrées et conformes à la directive européenne DSP2 (authentification forte « 3-D Secure »). Le Vendeur ne stocke ni n'a accès aux données bancaires de l'Acheteur ;</li>
<li><strong>Virement bancaire</strong> : les coordonnées bancaires du Vendeur sont communiquées à l'Acheteur lors de la validation de la commande. La commande est préparée dès réception effective des fonds sur le compte du Vendeur.</li>
</ul>
<p>Le paiement est exigible à la commande. Aucun escompte n'est accordé pour paiement anticipé.</p>

<h2>Article 9 — Retard de paiement</h2>
<p>En cas de retard de paiement, des pénalités légales peuvent s'appliquer dans les conditions prévues par le Code de commerce. Tout défaut de paiement partiel ou total pourra en outre entraîner la suspension immédiate de toute nouvelle livraison jusqu'à régularisation.</p>

<h2>Article 10 — Réserve de propriété</h2>
<p>Conformément à l'article L.624-16 du Code de commerce, <strong>les marchandises livrées restent la propriété exclusive de {{company_name}} jusqu'au paiement intégral et effectif de leur prix</strong> (principal, frais, taxes et accessoires inclus). En revanche, les risques de perte ou de détérioration sont transférés à l'Acheteur dès la livraison. L'Acheteur s'interdit, jusqu'au paiement intégral, de donner les marchandises en gage, de les transformer ou de les céder dans des conditions anormales.</p>

<h2>Article 11 — Livraison</h2>
<p>Les commandes sont expédiées par des transporteurs partenaires professionnels, avec suivi et assurance incluse dans les frais de port. Le choix du mode de livraison et du transporteur est proposé à l'Acheteur au moment du paiement, en fonction de la destination.</p>
<p>Les délais de livraison sont donnés à titre indicatif. Les frais de port sont calculés automatiquement au moment du paiement en fonction du poids, du volume et de la destination. Le <strong>transfert des risques</strong> intervient au moment de la remise du colis au transporteur. L'Acheteur est invité à vérifier l'état du colis à réception et à formuler toute réserve utile auprès du transporteur avant de signer le bon de livraison.</p>

<h2>Article 12 — Livraisons hors Union Européenne et DOM-TOM</h2>
<p>Pour les livraisons à destination des DOM-TOM, des pays hors Union Européenne ou de tout territoire soumis à une déclaration douanière, une facture détaillée accompagnée d'une déclaration douanière (code SH, pays d'origine, valeur unitaire, poids) est jointe au colis. Les <strong>droits de douane, taxes à l'importation, TVA locale et frais de dédouanement</strong> sont à la charge exclusive de l'Acheteur et payables directement au transporteur ou aux autorités douanières. Le refus de l'Acheteur de régler ces frais à destination entraîne l'abandon du colis, sans remboursement de la commande ni des frais de port.</p>

<h2>Article 13 — Réception et réclamations</h2>
<p>L'Acheteur dispose d'un délai d'<strong>un (1) mois à compter de la réception</strong> pour formuler toute réclamation relative à un défaut de conformité, un manquant ou une avarie, par email à <strong>{{email}}</strong>, accompagnée de photos et du bon de livraison. Passé ce délai, les marchandises sont réputées acceptées et aucune réclamation ne pourra être prise en compte, sauf à faire jouer la garantie des vices cachés.</p>
<p>En cas de réclamation fondée, le Vendeur procède, à son choix, soit au <strong>remplacement du produit concerné</strong>, soit à l'<strong>émission d'un avoir d'un montant équivalent</strong>, utilisable automatiquement en déduction du montant d'une prochaine commande. <strong>Aucun remboursement en numéraire n'est effectué au titre d'une réclamation.</strong> L'Acheteur ne pourra prétendre à aucune indemnité complémentaire à ce titre.</p>

<h2>Article 14 — Annulation d'une commande en attente</h2>
<p>Tant que la commande n'a pas été expédiée (statut « en attente »), l'Acheteur peut en demander l'annulation en contactant le service client à <strong>{{email}}</strong>. Si le paiement a déjà été encaissé, un remboursement intégral sera effectué dans un délai maximum de quatorze (14) jours. Une fois la commande expédiée, aucune annulation n'est possible.</p>

<h2>Article 15 — Garanties</h2>
<p>Les produits bénéficient de la <strong>garantie légale contre les vices cachés</strong> prévue aux articles 1641 et suivants du Code civil, à l'exclusion de toute autre garantie. Toute demande au titre de la garantie des vices cachés doit être adressée dans un délai de deux (2) ans à compter de la découverte du vice.</p>
<p>Sont exclus de la garantie les dommages résultant d'une mauvaise utilisation, d'une transformation du produit par l'Acheteur, d'une usure normale ou d'un cas de force majeure.</p>

<h2>Article 16 — Responsabilité</h2>
<p>La responsabilité de {{company_name}} ne peut en aucun cas être engagée pour les dommages indirects (perte d'exploitation, perte de clientèle, préjudice commercial, atteinte à l'image). En toute hypothèse, la responsabilité du Vendeur est limitée au montant hors taxes de la commande concernée.</p>

<h2>Article 17 — Force majeure</h2>
<p>Aucune des parties ne saurait voir sa responsabilité engagée pour l'inexécution ou le retard d'exécution de l'une de ses obligations résultant d'un cas de force majeure au sens de l'article 1218 du Code civil (notamment : catastrophes naturelles, incendie, inondation, grève générale, décision administrative, pandémie, interruption durable des moyens de transport ou de télécommunications). La partie empêchée en informe l'autre partie dans les meilleurs délais.</p>

<h2>Article 18 — Propriété intellectuelle</h2>
<p>Tous les éléments du site (textes, photographies, visuels, logos, marques) sont la propriété exclusive de {{company_name}} ou de ses partenaires. Toute reproduction, représentation ou exploitation, même partielle, est interdite sans autorisation écrite préalable, conformément aux Mentions légales du site.</p>

<h2>Article 19 — Données personnelles</h2>
<p>Les données collectées dans le cadre de la relation commerciale sont traitées conformément au Règlement Général sur la Protection des Données (RGPD) et à la loi « Informatique et Libertés ». Les modalités détaillées (finalités, durée de conservation, destinataires, droits de l'Acheteur) figurent dans la <a href="/confidentialite">Politique de confidentialité</a>.</p>

<h2>Article 20 — Modification des CGV</h2>
<p>Le Vendeur se réserve le droit de modifier les présentes CGV à tout moment. Les CGV applicables à une commande sont celles en vigueur et acceptées par l'Acheteur au moment de la validation de la commande.</p>

<h2>Article 21 — Droit applicable et juridiction compétente</h2>
<p>Les présentes CGV sont régies par le droit français. <strong>À défaut de résolution amiable, tout litige relatif à leur interprétation ou à leur exécution relèvera de la compétence exclusive du Tribunal de commerce du ressort du siège social de {{company_name}} ({{city}})</strong>, nonobstant pluralité de défendeurs ou appel en garantie.</p>`,
  },

  CGU: {
    title: "Conditions Générales d'Utilisation",
    content: `<h2>Article 1 — Objet</h2>
<p>Les présentes Conditions Générales d'Utilisation (ci-après « CGU ») définissent les règles d'accès au site <strong>{{website}}</strong> (ci-après « le Site »), exploité par <strong>{{company_name}}</strong>, et les règles d'utilisation des services qui y sont proposés. Elles s'appliquent à tout visiteur et à tout titulaire d'un compte sur le Site.</p>
<p>L'utilisation du Site vaut acceptation sans réserve des présentes CGU. En cas de désaccord avec tout ou partie de ces conditions, l'utilisateur doit cesser immédiatement d'utiliser le Site.</p>

<h2>Article 2 — Accès au Site</h2>
<p>Le catalogue et les fiches produits sont consultables librement par tout visiteur. La consultation des prix, l'ajout au panier et la passation de commandes nécessitent la <strong>création d'un compte professionnel</strong> et sa validation préalable par {{company_name}}.</p>
<p>Le Site est accessible 24 heures sur 24 et 7 jours sur 7, sous réserve des interruptions temporaires nécessaires à sa maintenance, à sa mise à jour ou liées à un cas de force majeure.</p>

<h2>Article 3 — Création d'un compte professionnel</h2>
<p>L'inscription est réservée aux professionnels agissant dans le cadre de leur activité (revendeurs, détaillants, grossistes, créateurs). L'utilisateur s'engage à fournir des informations exactes, complètes et à jour :</p>
<ul>
<li>raison sociale et forme juridique ;</li>
<li>numéro SIRET (sociétés françaises) ou numéro d'immatriculation professionnelle équivalent (sociétés étrangères) ;</li>
<li>numéro de TVA intracommunautaire le cas échéant ;</li>
<li>adresse postale, email et téléphone professionnels ;</li>
<li>identité du représentant légal.</li>
</ul>
<p>Un justificatif d'activité (extrait Kbis de moins de trois mois ou équivalent) peut être demandé à tout moment par {{company_name}}.</p>

<h2>Article 4 — Processus de validation du compte</h2>
<p>À la suite de l'inscription, chaque compte est examiné par les équipes de {{company_name}}. Trois décisions sont possibles :</p>
<ul>
<li><strong>Approuvé :</strong> l'utilisateur accède immédiatement aux prix, au catalogue complet et au tunnel de commande ;</li>
<li><strong>En attente :</strong> l'équipe demande une pièce complémentaire par email (Kbis, précision sur l'activité, etc.) ;</li>
<li><strong>Refusé :</strong> l'inscription est refusée. {{company_name}} n'est pas tenu de motiver son refus (clientèle réservée aux professionnels d'un secteur ciblé, incohérences dans les informations fournies, etc.).</li>
</ul>
<p>Le délai habituel de traitement est de <strong>un (1) à trois (3) jours ouvrés</strong>. L'utilisateur est informé de la décision par email.</p>

<h2>Article 5 — Identifiants et sécurité du compte</h2>
<p>L'utilisateur choisit un identifiant (email professionnel) et un mot de passe lors de l'inscription. Il est seul responsable de la confidentialité de ses identifiants et de toutes les actions effectuées depuis son compte. Toute perte, vol ou utilisation non autorisée doit être signalée sans délai à <strong>{{email}}</strong> pour que {{company_name}} puisse procéder à la suspension du compte.</p>
<p>{{company_name}} met en place des mesures techniques pour sécuriser l'authentification (mots de passe hachés, verrouillage temporaire après plusieurs tentatives échouées, code de confirmation par email pour certaines opérations sensibles).</p>

<h2>Article 6 — Règles d'usage du Site</h2>
<p>L'utilisateur s'engage à utiliser le Site de manière loyale et conformément à sa destination. Il s'interdit notamment :</p>
<ul>
<li>de collecter automatiquement des données du Site (<em>scraping</em>, moissonnage, extraction automatisée) ;</li>
<li>de tenter d'accéder à des zones réservées ou de contourner les mécanismes de sécurité ;</li>
<li>de perturber le fonctionnement du Site (saturation, injection de code, logiciels malveillants) ;</li>
<li>d'utiliser le Site à des fins frauduleuses ou illicites (fausses commandes, usurpation d'identité) ;</li>
<li>de reproduire, copier ou exploiter commercialement les contenus du Site sans autorisation écrite.</li>
</ul>
<p>Tout manquement expose l'utilisateur à la suspension ou à la clôture immédiate de son compte, sans préjudice d'éventuelles poursuites.</p>

<h2>Article 7 — Messagerie et pièces jointes</h2>
<p>Le Site intègre une messagerie permettant à l'utilisateur d'échanger directement avec le service client de {{company_name}}. Les messages peuvent inclure des pièces jointes (photos, documents). L'utilisateur s'engage à :</p>
<ul>
<li>utiliser la messagerie de façon courtoise et professionnelle ;</li>
<li>ne joindre que des fichiers en lien avec la relation commerciale ;</li>
<li>ne pas envoyer de contenus illicites, offensants ou de pièces jointes contenant des logiciels malveillants.</li>
</ul>
<p>Les conversations et les pièces jointes sont conservées pour les besoins du service client et à titre de preuve en cas de litige (voir Politique de confidentialité).</p>

<h2>Article 8 — Suspension et clôture du compte</h2>
<p>{{company_name}} se réserve le droit de suspendre ou de clôturer un compte, après notification par email et sauf urgence :</p>
<ul>
<li>en cas de non-respect des présentes CGU ou des CGV ;</li>
<li>en cas d'impayé non régularisé après relance ;</li>
<li>en cas de fourniture d'informations inexactes, trompeuses ou obsolètes ;</li>
<li>en cas d'inactivité prolongée du compte (plus de trente-six mois).</li>
</ul>
<p>L'utilisateur peut également demander à tout moment la clôture de son compte en adressant un email à <strong>{{email}}</strong>. Les données nécessaires au respect des obligations légales (facturation, comptabilité) sont conservées pendant la durée prévue par la loi, puis supprimées.</p>

<h2>Article 9 — Protection des données personnelles</h2>
<p>Les données collectées via le compte utilisateur sont traitées conformément au RGPD. L'utilisateur dispose d'un droit d'accès, de rectification, d'opposition, d'effacement et de portabilité de ses données. Les modalités d'exercice de ces droits et le détail des traitements figurent dans la <a href="/confidentialite">Politique de confidentialité</a>.</p>

<h2>Article 10 — Propriété intellectuelle</h2>
<p>Tous les éléments du Site sont protégés par le droit de la propriété intellectuelle et restent la propriété de {{company_name}} ou de ses partenaires. Les modalités détaillées sont précisées dans les <a href="/mentions-legales">Mentions légales</a>.</p>

<h2>Article 11 — Disponibilité et responsabilité</h2>
<p>{{company_name}} met en œuvre les moyens raisonnables pour assurer la disponibilité du Site, sans garantir un accès ininterrompu. {{company_name}} ne saurait être tenu responsable des interruptions temporaires pour maintenance, mise à jour, incident technique ou cas de force majeure, ni des dommages indirects résultant de l'utilisation du Site.</p>

<h2>Article 12 — Modification des CGU</h2>
<p>{{company_name}} se réserve le droit de modifier les présentes CGU à tout moment. La version applicable est celle publiée sur le Site. La poursuite de l'utilisation du Site vaut acceptation des nouvelles CGU.</p>

<h2>Article 13 — Contact</h2>
<p>Pour toute question relative aux présentes CGU, vous pouvez contacter {{company_name}} :</p>
<ul>
<li>par email : <strong>{{email}}</strong></li>
<li>par téléphone : <strong>{{phone}}</strong></li>
<li>par courrier : {{company_name}} — {{address}}, {{postal_code}} {{city}}, {{country}}</li>
</ul>`,
  },

  POLITIQUE_CONFIDENTIALITE: {
    title: "Politique de confidentialité",
    content: `<h2>1. Introduction</h2>
<p>La présente politique de confidentialité décrit la façon dont <strong>{{company_name}}</strong> collecte, utilise et protège les données personnelles des visiteurs et utilisateurs du site <strong>{{website}}</strong>, conformément au Règlement (UE) 2016/679 du 27 avril 2016 (« RGPD ») et à la loi n° 78-17 du 6 janvier 1978 modifiée (« Informatique et Libertés »).</p>

<h2>2. Responsable du traitement</h2>
<p>Le responsable du traitement des données personnelles est :</p>
<ul>
<li><strong>{{company_name}}</strong>, {{legal_form}}</li>
<li>Siège social : {{address}}, {{postal_code}} {{city}}, {{country}}</li>
<li>SIRET : {{siret}}</li>
<li>Contact : <strong>{{email}}</strong> — <strong>{{phone}}</strong></li>
</ul>

<h2>3. Délégué à la protection des données (DPO)</h2>
<p>Compte tenu de la taille de la structure et de la nature des traitements effectués, {{company_name}} <strong>n'a pas désigné de Délégué à la protection des données</strong>. Toute demande relative à vos données personnelles peut être adressée directement au responsable du traitement à l'adresse <strong>{{email}}</strong>.</p>

<h2>4. Données collectées</h2>
<p>Les données personnelles collectées via le Site sont :</p>
<ul>
<li><strong>Données d'identification professionnelle :</strong> raison sociale, forme juridique, SIRET, numéro de TVA, nom et prénom du représentant légal ;</li>
<li><strong>Données de contact :</strong> adresse email professionnelle, numéro de téléphone, adresse postale ;</li>
<li><strong>Données de compte :</strong> identifiant (email), mot de passe (haché), préférences de notification, consentement newsletter ;</li>
<li><strong>Données de commande :</strong> historique des commandes, adresses de livraison et de facturation, factures ;</li>
<li><strong>Données de paiement :</strong> moyens de paiement enregistrés chez notre prestataire Stripe ; {{company_name}} <strong>ne stocke ni n'a accès</strong> aux numéros de carte bancaire ;</li>
<li><strong>Données de messagerie :</strong> contenu des échanges avec notre service client via la messagerie du Site, pièces jointes incluses ;</li>
<li><strong>Données de connexion et de sécurité :</strong> adresse IP, logs d'authentification, tentatives échouées, codes de confirmation à usage unique (OTP) ;</li>
<li><strong>Données de navigation strictement nécessaires :</strong> cookies de session et de préférence (voir <a href="/cookies">Politique de cookies</a>).</li>
</ul>

<h2>5. Finalités du traitement</h2>
<p>Vos données sont utilisées pour :</p>
<ul>
<li>créer et gérer votre compte professionnel (vérification SIRET/Kbis, approbation, authentification) ;</li>
<li>traiter vos commandes (préparation, facturation, expédition, suivi de livraison) ;</li>
<li>vous adresser des communications transactionnelles (confirmation de commande, bordereau de livraison, facture, relances d'impayés) ;</li>
<li>répondre à vos demandes via la messagerie et le service client ;</li>
<li>vous envoyer des communications commerciales (newsletter, nouveautés, offres) uniquement si vous y avez consenti ;</li>
<li>vous adresser des relances de panier abandonné et des rappels d'inactivité, sauf opposition de votre part (lien de désinscription en un clic dans chaque email) ;</li>
<li>prévenir la fraude et sécuriser le Site (logs, verrouillage de compte, OTP) ;</li>
<li>respecter nos obligations légales (facturation, comptabilité, lutte anti-blanchiment).</li>
</ul>

<h2>6. Base légale des traitements</h2>
<ul>
<li><strong>Exécution du contrat :</strong> gestion du compte, traitement des commandes, livraison, facturation ;</li>
<li><strong>Consentement :</strong> newsletter et communications commerciales (révocable à tout moment) ;</li>
<li><strong>Intérêt légitime :</strong> sécurité du Site, prévention de la fraude, amélioration des services, relances de paniers abandonnés (avec droit d'opposition) ;</li>
<li><strong>Obligation légale :</strong> conservation des factures et pièces comptables, lutte contre la fraude fiscale.</li>
</ul>

<h2>7. Durées de conservation</h2>
<ul>
<li><strong>Données de compte :</strong> durée de la relation commerciale, puis trois (3) ans à compter du dernier contact ;</li>
<li><strong>Factures et pièces comptables :</strong> dix (10) ans à compter de la clôture de l'exercice (obligation légale) ;</li>
<li><strong>Données de messagerie :</strong> trois (3) ans à compter du dernier échange ;</li>
<li><strong>Logs d'authentification et de sécurité :</strong> douze (12) mois ;</li>
<li><strong>Codes OTP et jetons de session :</strong> durée de vie limitée (quelques minutes à quelques jours) ;</li>
<li><strong>Consentement newsletter :</strong> jusqu'à retrait du consentement, puis trois (3) ans à compter du dernier contact ;</li>
<li><strong>Cookies :</strong> treize (13) mois maximum.</li>
</ul>

<h2>8. Destinataires des données</h2>
<p>Vos données ne sont jamais vendues ni cédées à des tiers à des fins commerciales. Elles peuvent être transmises, strictement pour les besoins de l'exécution de nos services, à nos prestataires de paiement, de livraison, d'hébergement technique, d'envoi d'emails transactionnels, ainsi qu'à notre expert-comptable à des fins exclusivement comptables et fiscales. Vos données peuvent également être communiquées aux autorités publiques et administrations compétentes, uniquement sur réquisition légale.</p>

<h2>9. Vos droits</h2>
<p>Conformément au RGPD, vous disposez des droits suivants sur vos données personnelles :</p>
<ul>
<li><strong>Droit d'accès</strong> à vos données ;</li>
<li><strong>Droit de rectification</strong> en cas d'inexactitude ;</li>
<li><strong>Droit à l'effacement</strong> (« droit à l'oubli »), sous réserve des obligations légales de conservation ;</li>
<li><strong>Droit à la limitation</strong> du traitement ;</li>
<li><strong>Droit d'opposition</strong>, notamment aux communications commerciales et aux relances automatisées ;</li>
<li><strong>Droit à la portabilité</strong> de vos données ;</li>
<li><strong>Droit de retirer votre consentement</strong> à tout moment (newsletter) ;</li>
<li><strong>Droit de définir des directives</strong> relatives au sort de vos données après votre décès.</li>
</ul>

<h2>10. Comment exercer vos droits</h2>
<p>Pour exercer l'un de ces droits, adressez votre demande par email à <strong>{{email}}</strong> ou par courrier postal à l'adresse du siège social indiquée ci-dessus. Une pièce d'identité pourra vous être demandée en cas de doute raisonnable sur votre identité.</p>
<p>{{company_name}} s'engage à répondre à votre demande dans un délai maximum d'<strong>un (1) mois</strong>, prolongeable de deux mois en cas de complexité.</p>
<p>Si vous estimez, après nous avoir contactés, que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la <strong>Commission Nationale de l'Informatique et des Libertés (CNIL)</strong> — 3 Place de Fontenoy, 75007 Paris — <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer">www.cnil.fr</a>.</p>

<h2>11. Sécurité des données</h2>
<p>{{company_name}} met en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos données contre tout accès non autorisé, altération, divulgation ou destruction : chiffrement des échanges (HTTPS/TLS), mots de passe hachés, chiffrement AES-256 des secrets sensibles (clés API, identifiants de prestataires), verrouillage automatique des comptes après plusieurs tentatives échouées, codes à usage unique (OTP) pour les opérations sensibles, journalisation des accès, sauvegardes régulières chiffrées.</p>

<h2>12. Cookies</h2>
<p>Le Site utilise exclusivement des cookies strictement nécessaires à son fonctionnement. Aucun cookie publicitaire ni de mesure d'audience n'est déposé. Le détail figure dans notre <a href="/cookies">Politique de cookies</a>.</p>

<h2>13. Modification de la présente politique</h2>
<p>{{company_name}} peut modifier la présente politique de confidentialité à tout moment pour l'adapter aux évolutions légales, techniques ou de son activité. La version en vigueur est celle publiée sur le Site.</p>`,
  },

  COOKIES: {
    title: "Politique de cookies",
    content: `<h2>1. Qu'est-ce qu'un cookie ?</h2>
<p>Un cookie est un petit fichier texte déposé sur votre terminal (ordinateur, tablette, smartphone) par le navigateur lorsque vous consultez un site web. Il permet de stocker des informations relatives à votre navigation (préférences, session de connexion) ou nécessaires au fonctionnement de certains services.</p>

<h2>2. Notre position : aucun cookie publicitaire ni de mesure d'audience</h2>
<p>Nous avons fait le choix de <strong>ne pas déposer de cookies publicitaires, de mesure d'audience ou de réseaux sociaux</strong> sur le Site. Nous n'utilisons ni Google Analytics, ni Meta Pixel, ni aucun outil comparable. Nous ne vendons aucune donnée de navigation à des tiers.</p>
<p>En conséquence, et conformément à la <strong>délibération n° 2020-091 de la CNIL</strong>, aucun bandeau de consentement préalable n'est requis sur le Site : <strong>tous les cookies déposés sont strictement nécessaires au fonctionnement du Site</strong> ou à la fourniture d'un service expressément demandé par vous.</p>

<h2>3. Cookies strictement nécessaires</h2>

<h3>Authentification et sécurité</h3>
<ul>
<li><strong>Cookies de session NextAuth</strong> (<code>next-auth.session-token</code>, <code>next-auth.csrf-token</code>, <code>next-auth.callback-url</code>) — Maintiennent votre connexion active et protègent les formulaires contre les attaques CSRF. <em>Durée : session ou 30 jours maximum.</em></li>
</ul>

<h3>Préférences utilisateur</h3>
<ul>
<li><strong><code>bj_locale</code></strong> — Mémorise la langue d'affichage que vous avez choisie (français ou anglais). <em>Durée : 1 an.</em></li>
<li><strong><code>bj_admin_theme</code></strong> — Mémorise votre choix de thème clair ou sombre dans l'espace d'administration (déposé uniquement si vous êtes connecté en tant qu'administrateur). <em>Durée : 5 ans.</em></li>
</ul>

<h2>4. Cookies tiers</h2>
<p>Pendant une transaction par carte bancaire, le prestataire de paiement <strong>Stripe</strong> dépose des cookies dans la fenêtre sécurisée de paiement (iframe). Ces cookies sont nécessaires au bon déroulement de la transaction et à la lutte contre la fraude (authentification 3-D Secure, détection de comportements suspects). Ils relèvent de la politique de Stripe :</p>
<ul>
<li><a href="https://stripe.com/fr/privacy" target="_blank" rel="noopener noreferrer">Politique de confidentialité de Stripe</a></li>
<li><a href="https://stripe.com/fr/legal/cookies-policy" target="_blank" rel="noopener noreferrer">Politique des cookies de Stripe</a></li>
</ul>

<h2>5. Gestion des cookies dans votre navigateur</h2>
<p>Vous pouvez à tout moment configurer votre navigateur pour accepter, refuser ou supprimer les cookies. Attention : la suppression des cookies strictement nécessaires empêchera le bon fonctionnement du Site (impossibilité de se connecter, perte du panier, perte des préférences de langue).</p>
<ul>
<li><strong>Chrome :</strong> Paramètres → Confidentialité et sécurité → Cookies et autres données des sites</li>
<li><strong>Firefox :</strong> Paramètres → Vie privée et sécurité → Cookies et données des sites</li>
<li><strong>Safari :</strong> Préférences → Confidentialité → Gérer les données des sites web</li>
<li><strong>Edge :</strong> Paramètres → Cookies et autorisations de site → Gérer et supprimer les cookies</li>
</ul>

<h2>6. Durée de conservation</h2>
<p>Conformément aux recommandations de la CNIL, la durée de vie d'un cookie n'excède pas <strong>treize (13) mois</strong>, hormis le cookie de préférence de thème d'administration (<code>bj_admin_theme</code>) dont la durée est portée à cinq ans par confort d'usage (accessible uniquement aux administrateurs).</p>

<h2>7. Modification de la présente politique</h2>
<p>En cas d'ajout, de modification ou de suppression d'un cookie, la présente politique est mise à jour. La version applicable est celle publiée sur le Site.</p>

<h2>8. Contact</h2>
<p>Pour toute question relative aux cookies ou à vos données personnelles, écrivez-nous à <strong>{{email}}</strong>.</p>`,
  },
} as const;
