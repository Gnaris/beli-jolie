/**
 * Registre des 28 mails transactionnels éditables depuis l'admin
 * (/admin/contact-client/mails/systeme).
 *
 * Pour chaque scénario :
 *  - `key`         clé stable utilisée en BDD (TransactionalEmailOverride.scenarioKey)
 *                   + comme `tracking.scenarioKey` sur `sendMail()`.
 *  - `audience`    "CLIENT" ou "ADMIN" (sert à grouper dans l'UI).
 *  - `group`       sous-regroupement UI ("auth", "compte", "commande",
 *                   "support", "paiement", "securite").
 *  - `label`       libellé court affiché sur la carte.
 *  - `description` phrase expliquant quand ce mail est envoyé.
 *  - `variables`   tokens disponibles à l'intérieur du sujet / HTML.
 *                   `required: true` = l'éditeur refuse de sauver si absent.
 *
 * Module PUR (0 dépendance serveur) — safe pour import client.
 */

export type TransactionalScenarioKey =
  // ── CLIENT — auth / mot de passe ──
  | "LOGIN_OTP"
  | "PASSWORD_RESET"
  | "EMAIL_CHANGE_CONFIRM"
  | "EMAIL_CHANGE_NOTICE"
  // ── CLIENT — compte ──
  | "ACCOUNT_APPROVED"
  | "ACCOUNT_REJECTED"
  | "ACCOUNT_REVOKED"
  | "ACCOUNT_INACTIVITY_WARNING"
  | "ACCOUNT_INACTIVITY_REVOKED"
  | "ACCOUNT_REACTIVATED_PROBATION"
  // ── CLIENT — commandes ──
  | "ORDER_CREATED"
  | "ORDER_BANK_TRANSFER_PENDING"
  | "ORDER_VALIDATED"
  | "ORDER_BANK_TRANSFER_CONFIRMED"
  | "ORDER_SHIPPED"
  | "ORDER_FOLLOWUP_REVIEW"
  | "ORDER_CANCELLED"
  | "ORDER_MODIFIED"
  // ── CLIENT — paiement ──
  | "CHECKOUT_PAYMENT_LINK"
  | "ORDER_SUPPLEMENT_REQUEST"
  // ── CLIENT — service client ──
  | "SUPPORT_REPLY"
  // ── ADMIN — clients ──
  | "ADMIN_NEW_REGISTRATION"
  | "ADMIN_NEW_MESSAGE"
  | "ADMIN_CLIENT_REPLIED"
  | "ADMIN_NEW_CLAIM"
  // ── ADMIN — commandes ──
  | "ADMIN_NEW_ORDER"
  // ── ADMIN — sécurité ──
  | "ADMIN_LOGIN_NOTIFICATION"
  | "ADMIN_PAYMENT_ERROR"
  | "ADMIN_ORPHAN_PAYMENT_INTENT";

export type TransactionalScenarioAudience = "CLIENT" | "ADMIN";

export type TransactionalScenarioGroup =
  | "auth"
  | "compte"
  | "commande"
  | "paiement"
  | "support"
  | "securite";

/**
 * Nature d'une variable :
 *  - "text"      : chaîne simple (prénom, numéro, montant). S'insère n'importe
 *                   où, y compris dans le sujet.
 *  - "url"       : URL complète (lien reset, lien commande). À placer dans
 *                   l'attribut `href=""` d'un lien `<a>`.
 *  - "htmlBlock" : fragment HTML pré-fabriqué (tableau d'articles, bloc IBAN).
 *                   S'insère TEL QUEL — ne pas réécrire son contenu. Souvent
 *                   optionnel visuel (chaîne vide si pas applicable).
 */
export type TransactionalVariableKind = "text" | "url" | "htmlBlock";

export interface TransactionalScenarioVariable {
  token: string;
  label: string;
  example: string;
  required?: boolean;
  /** Tooltip court du chip (modal). */
  hint?: string;
  /** Explication détaillée reprise par le prompt IA + visible dans le modal. */
  description?: string;
  /** Change le code couleur du chip + l'instruction d'usage IA. */
  kind?: TransactionalVariableKind;
}

export interface TransactionalScenarioMeta {
  key: TransactionalScenarioKey;
  audience: TransactionalScenarioAudience;
  group: TransactionalScenarioGroup;
  label: string;
  description: string;
  variables: TransactionalScenarioVariable[];
  /**
   * Ton / contexte à passer dans le prompt IA. Garde la génération cohérente :
   * un OTP est factuel et court, une confirmation de compte est chaleureuse,
   * une alerte paiement orphelin est factuelle et urgente, etc.
   */
  aiTone: string;
}

// Variables communes à tous les mails (toujours disponibles).
const SHOP_VARIABLES: TransactionalScenarioVariable[] = [
  { token: "shopName", label: "Nom de la boutique", example: "Beli & Jolie" },
  { token: "shopEmail", label: "Email boutique", example: "contact@beliandjolie.com" },
];

/* ─────────────────────────────────────────────
   Classification automatique d'une variable
   ───────────────────────────────────────────── */

/**
 * Détermine la nature d'une variable à partir de son token / exemple.
 * Priorité : kind explicite > fin de nom (`*Url`, `*Html`, `*Block`, `*Note`,
 * `*Row`, `*Tag`, `*Suffix`, `*Lines`) > exemple commençant par "<" ou "http".
 */
export function classifyVariableKind(
  variable: TransactionalScenarioVariable,
): TransactionalVariableKind {
  if (variable.kind) return variable.kind;
  const t = variable.token;
  if (/Url$/.test(t)) return "url";
  if (/(Html|Block|Note|Row|Tag|Suffix|Lines)$/.test(t)) return "htmlBlock";
  const ex = variable.example?.trim() ?? "";
  if (ex.startsWith("<")) return "htmlBlock";
  if (/^https?:\/\//.test(ex)) return "url";
  return "text";
}

/** Phrase générique d'usage affichée dans l'éditeur + prompt IA. */
export function describeVariableUsage(
  variable: TransactionalScenarioVariable,
): string {
  if (variable.description) return variable.description;
  const kind = classifyVariableKind(variable);
  switch (kind) {
    case "url":
      return `URL complète. Placez-la dans l'attribut href d'un lien : <a href="{${variable.token}}">Mon libellé</a>. Ne l'affichez pas comme texte brut (ça expose le token).`;
    case "htmlBlock":
      return `Fragment HTML pré-fabriqué par le site (${variable.label.toLowerCase()}). Insérez {${variable.token}} TEL QUEL à l'endroit voulu — ne réécrivez pas son contenu. Peut être vide si l'info ne s'applique pas (ex. pas de virement bancaire → bloc vide, le mail reste propre).`;
    case "text":
    default:
      return `Texte simple remplacé par la vraie valeur (ex. « ${variable.example} »). Insérable dans le sujet ou le corps HTML, n'importe où dans une phrase.`;
  }
}

export const VARIABLE_KIND_LABELS: Record<TransactionalVariableKind, string> = {
  text: "Texte",
  url: "Lien (URL)",
  htmlBlock: "Bloc HTML",
};

export const TRANSACTIONAL_SCENARIOS: TransactionalScenarioMeta[] = [
  // ─────────────────────────────────────────────
  // CLIENT — auth
  // ─────────────────────────────────────────────
  {
    key: "LOGIN_OTP",
    audience: "CLIENT",
    group: "auth",
    label: "Code de connexion (OTP)",
    description:
      "Envoyé lorsque le client demande à se connecter avec un code à 6 chiffres (sans mot de passe).",
    aiTone:
      "Mail factuel et court. Le client vient de demander un code pour se connecter. Mettre le code en grand, bien visible, et rappeler qu'il est valable 10 minutes. Rassurer en cas d'envoi non sollicité.",
    variables: [
      { token: "code", label: "Code à 6 chiffres", example: "483201", required: true },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "PASSWORD_RESET",
    audience: "CLIENT",
    group: "auth",
    label: "Mot de passe oublié",
    description:
      "Envoyé après la demande de réinitialisation du mot de passe. Contient le lien vers le formulaire.",
    aiTone:
      "Mail factuel, rassurant. Un lien bouton 'Réinitialiser mon mot de passe', valable 1 heure. Rappeler que si l'utilisateur n'est pas à l'origine de la demande, ignorer suffit.",
    variables: [
      { token: "resetUrl", label: "Lien de réinitialisation", example: "https://exemple.com/reinitialiser?token=…", required: true },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "EMAIL_CHANGE_CONFIRM",
    audience: "CLIENT",
    group: "auth",
    label: "Confirmation du nouvel email",
    description:
      "Envoyé à la NOUVELLE adresse quand le client change d'email, pour qu'il confirme qu'elle lui appartient.",
    aiTone:
      "Mail court, factuel. Bouton 'Confirmer mon nouvel email', valable 1 heure. Mentionner que sans confirmation, l'email ne sera pas changé.",
    variables: [
      { token: "confirmUrl", label: "Lien de confirmation", example: "https://exemple.com/confirmer-email?token=…", required: true },
      { token: "newEmail", label: "Nouvel email", example: "nouveau@exemple.com" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "EMAIL_CHANGE_NOTICE",
    audience: "CLIENT",
    group: "auth",
    label: "Alerte changement d'email",
    description:
      "Envoyé à l'ANCIENNE adresse (sécurité) quand quelqu'un demande à changer l'email du compte.",
    aiTone:
      "Mail informatif de sécurité. L'utilisateur doit comprendre : une demande a été faite, voici le nouvel email, aucune action à faire s'il est à l'origine, sinon changer son mot de passe immédiatement.",
    variables: [
      { token: "newEmail", label: "Nouvel email demandé", example: "nouveau@exemple.com", required: true },
      { token: "resetUrl", label: "Lien mot de passe oublié", example: "https://exemple.com/mot-de-passe-oublie" },
      ...SHOP_VARIABLES,
    ],
  },

  // ─────────────────────────────────────────────
  // CLIENT — compte
  // ─────────────────────────────────────────────
  {
    key: "ACCOUNT_APPROVED",
    audience: "CLIENT",
    group: "compte",
    label: "Compte validé",
    description:
      "Envoyé quand l'admin approuve l'inscription B2B du client. Bienvenue + lien connexion.",
    aiTone:
      "Mail chaleureux, accueillant. Féliciter, souhaiter la bienvenue. Inviter à se connecter via un bouton bien visible. Rester professionnel et bref.",
    variables: [
      { token: "firstName", label: "Prénom du client", example: "Marie", required: true },
      { token: "loginUrl", label: "Lien de connexion", example: "https://exemple.com/connexion" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ACCOUNT_REJECTED",
    audience: "CLIENT",
    group: "compte",
    label: "Compte refusé",
    description:
      "Envoyé quand l'admin refuse l'inscription d'un nouveau client B2B (SIRET invalide, hors cible...).",
    aiTone:
      "Mail poli, respectueux. Ne pas humilier, ne pas culpabiliser. Expliquer que le compte n'a pas pu être validé, afficher le motif s'il y en a un, inviter à contacter si erreur.",
    variables: [
      { token: "firstName", label: "Prénom du client", example: "Marie", required: true },
      { token: "reasonBlock", label: "Bloc motif (vide si absent)", example: "<div>Motif : ...</div>" },
      { token: "contactBlock", label: "Bloc contact (vide si absent)", example: "<p>Pour toute question...</p>" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ACCOUNT_REVOKED",
    audience: "CLIENT",
    group: "compte",
    label: "Compte désactivé",
    description:
      "Envoyé quand l'admin révoque l'accès d'un compte DÉJÀ VALIDÉ (différent du refus d'inscription).",
    aiTone:
      "Mail factuel, sobre. Le client connaissait déjà la boutique. Dire : accès suspendu, motif éventuel, contact pour appel.",
    variables: [
      { token: "firstName", label: "Prénom du client", example: "Marie", required: true },
      { token: "reasonBlock", label: "Bloc motif (vide si absent)", example: "<div>Motif : ...</div>" },
      { token: "contactBlock", label: "Bloc contact (vide si absent)", example: "<p>Pour toute question...</p>" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ACCOUNT_INACTIVITY_WARNING",
    audience: "CLIENT",
    group: "compte",
    label: "Avertissement avant désactivation (inactivité)",
    description:
      "Envoyé automatiquement à un client validé qui n'a pas passé commande depuis la durée configurée. Avertit que son compte sera désactivé si rien ne se passe dans les prochains jours.",
    aiTone:
      "Mail chaleureux, bienveillant. Ton de retrouvailles — surtout pas culpabilisant. Rappeler qu'on apprécie le client, mentionner la durée d'inactivité, inviter à revenir commander avant la date limite pour conserver l'accès complet (prix pro, catalogue).",
    variables: [
      { token: "firstName", label: "Prénom du client", example: "Marie", required: true },
      { token: "daysInactive", label: "Jours sans commande", example: "365", required: true },
      { token: "graceDays", label: "Jours restants avant désactivation", example: "15", required: true },
      { token: "catalogUrl", label: "Lien vers le catalogue", example: "https://exemple.com/produits" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ACCOUNT_INACTIVITY_REVOKED",
    audience: "CLIENT",
    group: "compte",
    label: "Compte désactivé pour inactivité",
    description:
      "Envoyé automatiquement quand le délai de grâce suivant l'avertissement est écoulé sans nouvelle commande. Le compte passe en « Désactivé » : le client peut toujours se connecter, mais ne voit plus les prix et ne peut plus commander. Il doit contacter le service client pour être réactivé.",
    aiTone:
      "Mail factuel et respectueux. Expliquer clairement : le compte a été désactivé par mesure de propreté administrative, le client peut toujours se connecter et parcourir le site mais ne verra plus les tarifs. L'inviter à contacter le service client (lien chat / email) pour une réactivation rapide. Ne pas culpabiliser.",
    variables: [
      { token: "firstName", label: "Prénom du client", example: "Marie", required: true },
      { token: "daysInactive", label: "Jours sans commande", example: "380", required: true },
      { token: "supportUrl", label: "Lien vers le service client (chat / contact)", example: "https://exemple.com/contact" },
      { token: "shopEmail", label: "Email boutique (pour contact)", example: "contact@beliandjolie.com" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ACCOUNT_REACTIVATED_PROBATION",
    audience: "CLIENT",
    group: "compte",
    label: "Compte réactivé (avec probation)",
    description:
      "Envoyé quand un administrateur réactive un compte précédemment désactivé pour inactivité. Prévient le client que son accès est rouvert mais qu'il a X jours pour passer une commande, sinon le compte sera re-désactivé automatiquement.",
    aiTone:
      "Mail chaleureux de bienvenue retour. Rassurer : accès complet retrouvé, prix de nouveau visibles. Mais être explicite sur la période de probation : X jours pour passer une commande, sinon le compte sera à nouveau désactivé automatiquement. Pas de ton menaçant — plutôt une invitation à redécouvrir la boutique.",
    variables: [
      { token: "firstName", label: "Prénom du client", example: "Marie", required: true },
      { token: "probationDays", label: "Jours de probation", example: "30", required: true },
      { token: "catalogUrl", label: "Lien vers le catalogue", example: "https://exemple.com/produits" },
      ...SHOP_VARIABLES,
    ],
  },

  // ─────────────────────────────────────────────
  // CLIENT — commandes
  // ─────────────────────────────────────────────
  {
    key: "ORDER_CREATED",
    audience: "CLIENT",
    group: "commande",
    label: "Confirmation de commande",
    description:
      "Envoyé juste après la création d'une commande standard (paiement en ligne ou commande admin).",
    aiTone:
      "Mail chaleureux de confirmation. Remercier, rassurer sur la prise en charge, afficher le récapitulatif et un lien vers la commande.",
    variables: [
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "clientCompany", label: "Nom de la société", example: "Boutique Marie" },
      { token: "itemsHtml", label: "Tableau des articles", example: "<tr>…</tr>", required: true },
      { token: "totalsHtml", label: "Récap totaux HT / TVA / TTC", example: "<table>…</table>", required: true },
      { token: "orderUrl", label: "Lien vers la commande", example: "https://exemple.com/commandes/…" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ORDER_BANK_TRANSFER_PENDING",
    audience: "CLIENT",
    group: "commande",
    label: "Commande en attente de virement",
    description:
      "Envoyé quand le client choisit « virement bancaire ». Contient l'IBAN et le libellé à utiliser.",
    aiTone:
      "Mail factuel et précis. Insister sur le libellé à mentionner dans le virement, afficher l'IBAN clairement, rappeler que la commande partira dès réception.",
    variables: [
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "clientCompany", label: "Nom de la société", example: "Boutique Marie" },
      { token: "bankTransferHtml", label: "Bloc IBAN + titulaire + montant", example: "<div>IBAN…</div>", required: true },
      { token: "itemsHtml", label: "Tableau des articles", example: "<tr>…</tr>" },
      { token: "totalsHtml", label: "Récap totaux", example: "<table>…</table>" },
      { token: "orderUrl", label: "Lien vers la commande", example: "https://exemple.com/commandes/…" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ORDER_VALIDATED",
    audience: "CLIENT",
    group: "commande",
    label: "Commande validée",
    description:
      "Envoyé quand l'admin passe la commande en « validée » (prête à être expédiée).",
    aiTone:
      "Mail positif, confirmation que la commande part bientôt. Si des ajustements ont été faits (retraits/rupture), le mentionner clairement.",
    variables: [
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "clientCompany", label: "Nom de la société", example: "Boutique Marie" },
      { token: "adjustmentsHtml", label: "Bloc ajustements (vide si aucun)", example: "<div>Quelques ajustements…</div>" },
      { token: "itemsHtml", label: "Tableau des articles", example: "<tr>…</tr>" },
      { token: "totalsHtml", label: "Récap totaux", example: "<table>…</table>" },
      { token: "orderUrl", label: "Lien vers la commande", example: "https://exemple.com/commandes/…" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ORDER_BANK_TRANSFER_CONFIRMED",
    audience: "CLIENT",
    group: "commande",
    label: "Virement reçu",
    description:
      "Envoyé quand l'admin confirme avoir reçu le virement. La commande part en préparation.",
    aiTone:
      "Mail chaleureux. Confirmer la bonne réception du virement, dire que la commande part en préparation et sera expédiée sous peu.",
    variables: [
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "clientCompany", label: "Nom de la société", example: "Boutique Marie" },
      { token: "itemsHtml", label: "Tableau des articles", example: "<tr>…</tr>" },
      { token: "totalsHtml", label: "Récap totaux", example: "<table>…</table>" },
      { token: "orderUrl", label: "Lien vers la commande", example: "https://exemple.com/commandes/…" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ORDER_SHIPPED",
    audience: "CLIENT",
    group: "commande",
    label: "Commande expédiée",
    description:
      "Envoyé quand l'admin marque la commande comme expédiée (avec transporteur + n° de suivi).",
    aiTone:
      "Mail enthousiaste. Annoncer l'expédition, mettre en avant le bloc de suivi, ajouter un lien vers la commande.",
    variables: [
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "clientCompany", label: "Nom de la société", example: "Boutique Marie" },
      { token: "trackingHtml", label: "Bloc transporteur + suivi (vide si absent)", example: "<div>Transporteur : …</div>" },
      { token: "itemsHtml", label: "Tableau des articles", example: "<tr>…</tr>" },
      { token: "totalsHtml", label: "Récap totaux", example: "<table>…</table>" },
      { token: "orderUrl", label: "Lien vers la commande", example: "https://exemple.com/commandes/…" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ORDER_FOLLOWUP_REVIEW",
    audience: "CLIENT",
    group: "commande",
    label: "Suivi 10 j après expédition",
    description:
      "Envoyé automatiquement 10 jours après que la commande a été marquée comme expédiée. Mail de relance libre : prendre des nouvelles, demander un avis sur le site ou sur Google, inviter à repasser commande, etc. Envoyé une seule fois par commande.",
    aiTone:
      "Mail chaleureux et personnel, surtout pas commercial agressif. On a confiance que le colis est bien arrivé — on prend des nouvelles, on invite le client à partager son ressenti (avis en ligne) et on reste disponible en cas de pépin. Rester bref, invitant, jamais insistant.",
    variables: [
      { token: "firstName", label: "Prénom du client", example: "Marie" },
      { token: "clientCompany", label: "Nom de la société", example: "Boutique Marie" },
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "orderUrl", label: "Lien vers la commande", example: "https://exemple.com/fr/commandes/…" },
      { token: "reviewUrl", label: "Lien pour déposer un avis sur le site", example: "https://exemple.com/fr/espace-pro" },
      { token: "catalogUrl", label: "Lien vers le catalogue", example: "https://exemple.com/fr/produits" },
      { token: "supportUrl", label: "Lien contact / service client", example: "https://exemple.com/fr/contact" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ORDER_CANCELLED",
    audience: "CLIENT",
    group: "commande",
    label: "Commande annulée",
    description:
      "Envoyé quand l'admin annule une commande.",
    aiTone:
      "Mail factuel, respectueux. Confirmer l'annulation, inviter à contacter en cas de question.",
    variables: [
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "clientCompany", label: "Nom de la société", example: "Boutique Marie" },
      { token: "itemsHtml", label: "Tableau des articles", example: "<tr>…</tr>" },
      { token: "totalsHtml", label: "Récap totaux", example: "<table>…</table>" },
      { token: "orderUrl", label: "Lien vers la commande", example: "https://exemple.com/commandes/…" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ORDER_MODIFIED",
    audience: "CLIENT",
    group: "commande",
    label: "Commande modifiée",
    description:
      "Envoyé quand l'admin réduit la quantité d'un article (rupture ou geste commercial) — avec le détail des avoirs.",
    aiTone:
      "Mail transparent. Expliquer que des ajustements ont été faits, afficher le tableau article par article, puis annoncer le total à rembourser/créditer.",
    variables: [
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "clientCompany", label: "Nom de la société", example: "Boutique Marie" },
      { token: "modificationsHtml", label: "Tableau des modifications", example: "<tr>…</tr>", required: true },
      { token: "totalCredit", label: "Total avoir (€)", example: "24,50" },
      { token: "orderUrl", label: "Lien vers la commande", example: "https://exemple.com/commandes/…" },
      ...SHOP_VARIABLES,
    ],
  },

  // ─────────────────────────────────────────────
  // CLIENT — paiement
  // ─────────────────────────────────────────────
  {
    key: "CHECKOUT_PAYMENT_LINK",
    audience: "CLIENT",
    group: "paiement",
    label: "Lien de paiement",
    description:
      "Envoyé quand le client demande un lien direct Stripe (si l'iframe est bloquée par son antivirus/VPN).",
    aiTone:
      "Mail factuel et rassurant. Expliquer le lien sécurisé, afficher le montant, mettre un bouton 'Payer maintenant' bien visible, rappeler la date d'expiration.",
    variables: [
      { token: "greeting", label: "Formule de salutation", example: "Bonjour <strong>Marie</strong>," },
      { token: "amountStr", label: "Montant (€)", example: "84,50", required: true },
      { token: "checkoutUrl", label: "Lien Stripe Checkout", example: "https://checkout.stripe.com/…", required: true },
      { token: "expiresStr", label: "Date d'expiration lisible", example: "25 octobre à 18h00", required: true },
      { token: "orderTag", label: "Bloc « N° X » (vide si pas de commande)", example: "<p>N° BJ-2026-00123</p>" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ORDER_SUPPLEMENT_REQUEST",
    audience: "CLIENT",
    group: "paiement",
    label: "Complément à régler",
    description:
      "Envoyé quand l'admin ajoute un article à une commande déjà payée (dépassement du montant initial).",
    aiTone:
      "Mail poli, expliquer que la commande a été ajustée, montrer clairement le complément à payer, proposer un bouton d'action adapté (Stripe ou virement).",
    variables: [
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "amountStr", label: "Montant complément (€)", example: "24,50", required: true },
      { token: "paymentBlock", label: "Bloc paiement (bouton Stripe ou lien virement)", example: "<div>Payer…</div>", required: true },
      ...SHOP_VARIABLES,
    ],
  },

  // ─────────────────────────────────────────────
  // CLIENT — service client
  // ─────────────────────────────────────────────
  {
    key: "SUPPORT_REPLY",
    audience: "CLIENT",
    group: "support",
    label: "Réponse du service client",
    description:
      "Envoyé au client quand un administrateur répond à son message (chat support ou réclamation).",
    aiTone:
      "Mail court et neutre. Ne pas montrer la réponse (confidentialité) — juste inviter à se connecter via un bouton. Rappeler pourquoi il reçoit ce mail (le service client).",
    variables: [
      { token: "greeting", label: "Salutation (Bonjour X,)", example: "Bonjour Marie,", required: true },
      { token: "conversationUrl", label: "Lien vers la conversation", example: "https://exemple.com/espace-pro", required: true },
      ...SHOP_VARIABLES,
    ],
  },

  // ─────────────────────────────────────────────
  // ADMIN — clients
  // ─────────────────────────────────────────────
  {
    key: "ADMIN_NEW_REGISTRATION",
    audience: "ADMIN",
    group: "compte",
    label: "Nouvelle inscription B2B",
    description:
      "Envoyé à l'admin dès qu'un nouveau client B2B s'inscrit (avec KBIS et justificatifs en pièce jointe). Précise si le dossier attend ou s'il a été validé/refusé automatiquement.",
    aiTone:
      "Mail interne, factuel. Lister les infos : prénom, nom, société, email, téléphone, SIRET, message. Mentionner s'il y a un KBIS joint. Signaler le statut du dossier (en attente / validé auto / refusé auto). Bouton vers /admin/clients.",
    variables: [
      { token: "firstName", label: "Prénom", example: "Marie", required: true },
      { token: "lastName", label: "Nom", example: "Dupont", required: true },
      { token: "company", label: "Société", example: "Boutique Marie", required: true },
      { token: "email", label: "Email", example: "marie@exemple.com", required: true },
      { token: "phone", label: "Téléphone", example: "06 12 34 56 78" },
      { token: "siret", label: "SIRET (ou mention « hors France »)", example: "123 456 789 00012" },
      { token: "messageBlock", label: "Bloc message libre (vide si absent)", example: "<tr><td>…</td></tr>" },
      { token: "kbisNote", label: "Note KBIS (joint ou absent)", example: "<p>Le KBIS est joint.</p>" },
      { token: "docNote", label: "Note document complémentaire (vide si absent)", example: "<p>Document joint.</p>" },
      { token: "statusLabel", label: "Statut du dossier", example: "en attente de validation", hint: "en attente de validation · validé automatiquement · refusé automatiquement" },
      { token: "statusBlock", label: "Bloc statut coloré (bandeau haut du mail)", example: `<div style="margin:16px 0;padding:12px 16px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;color:#92400E;font-size:13px;font-weight:bold;">Statut du dossier : en attente de validation</div>` },
      { token: "adminUrl", label: "Lien vers /admin/clients", example: "https://exemple.com/admin/clients" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ADMIN_NEW_MESSAGE",
    audience: "ADMIN",
    group: "support",
    label: "Nouveau message chat",
    description:
      "Envoyé à l'admin quand un client envoie un nouveau message via le chat flottant du site.",
    aiTone:
      "Mail interne court. Nom du client, société, aperçu du message, bouton vers l'admin.",
    variables: [
      { token: "clientName", label: "Prénom client", example: "Marie", required: true },
      { token: "clientCompany", label: "Société", example: "Boutique Marie" },
      { token: "subject", label: "Sujet", example: "Problème livraison" },
      { token: "messagePreview", label: "Aperçu du message", example: "Bonjour, j'ai une question…", required: true },
      { token: "adminUrl", label: "Lien vers l'admin", example: "https://exemple.com/admin" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ADMIN_CLIENT_REPLIED",
    audience: "ADMIN",
    group: "support",
    label: "Client a répondu",
    description:
      "Envoyé à l'admin quand un client répond dans sa conversation (chat ou réclamation).",
    aiTone:
      "Mail interne très court. Qui a répondu, dans quel contexte (chat / réclamation), bouton vers la conversation.",
    variables: [
      { token: "clientName", label: "Nom client (ou « Un client »)", example: "Marie Dupont", required: true },
      { token: "companySuffix", label: "Suffixe société (vide si absent)", example: " (Boutique Marie)" },
      { token: "conversationUrl", label: "Lien vers la conversation", example: "https://exemple.com/admin/service-client/…", required: true },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ADMIN_NEW_CLAIM",
    audience: "ADMIN",
    group: "support",
    label: "Nouvelle réclamation",
    description:
      "Envoyé à l'admin quand un client ouvre une nouvelle réclamation (ticket Service Client).",
    aiTone:
      "Mail interne. Afficher la référence, client, sujet, commande liée si présente, articles signalés si présents, aperçu du message, bouton vers la fiche réclamation.",
    variables: [
      { token: "claimReference", label: "Référence réclamation", example: "SC-2026-00042", required: true },
      { token: "clientName", label: "Nom client", example: "Marie Dupont", required: true },
      { token: "clientCompany", label: "Société", example: "Boutique Marie" },
      { token: "orderRow", label: "Ligne « Commande X » (vide si absent)", example: "<tr>…</tr>" },
      { token: "subject", label: "Sujet", example: "Produit cassé", required: true },
      { token: "reportedItemsBlock", label: "Bloc articles signalés (vide si absent)", example: "<div>…</div>" },
      { token: "messagePreview", label: "Aperçu du message", example: "Bonjour, le produit est arrivé…", required: true },
      { token: "claimUrl", label: "Lien vers la réclamation", example: "https://exemple.com/admin/service-client/…", required: true },
      ...SHOP_VARIABLES,
    ],
  },

  // ─────────────────────────────────────────────
  // ADMIN — commandes
  // ─────────────────────────────────────────────
  {
    key: "ADMIN_NEW_ORDER",
    audience: "ADMIN",
    group: "commande",
    label: "Nouvelle commande reçue",
    description:
      "Envoyé à l'admin immédiatement après qu'un client valide une commande sur le site.",
    aiTone:
      "Mail interne court. N° commande, client, montant TTC, bouton vers la fiche commande.",
    variables: [
      { token: "orderNumber", label: "Numéro de commande", example: "BJ-2026-00123", required: true },
      { token: "clientLabel", label: "Nom société ou email", example: "Boutique Marie", required: true },
      { token: "totalTTC", label: "Total TTC (€)", example: "84,50", required: true },
      { token: "orderUrl", label: "Lien vers la commande", example: "https://exemple.com/admin/commandes/…", required: true },
      ...SHOP_VARIABLES,
    ],
  },

  // ─────────────────────────────────────────────
  // ADMIN — sécurité
  // ─────────────────────────────────────────────
  {
    key: "ADMIN_LOGIN_NOTIFICATION",
    audience: "ADMIN",
    group: "securite",
    label: "Nouvelle connexion admin",
    description:
      "Envoyé à l'admin (mail perso) à chaque connexion réussie sur l'espace admin. Avec IP et navigateur.",
    aiTone:
      "Mail de sécurité. Date / IP / navigateur. Alerte visible si ce n'était pas l'admin, inviter à changer le mot de passe immédiatement.",
    variables: [
      { token: "adminEmail", label: "Email admin connecté", example: "contact@beliandjolie.com", required: true },
      { token: "when", label: "Date et heure (Paris)", example: "jeudi 21 octobre 2026 à 15h30", required: true },
      { token: "ip", label: "Adresse IP", example: "90.45.123.45", required: true },
      { token: "browser", label: "Navigateur", example: "Chrome sur Windows", required: true },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ADMIN_PAYMENT_ERROR",
    audience: "ADMIN",
    group: "securite",
    label: "Bug paiement client",
    description:
      "Envoyé à l'admin (mail perso) quand un client rencontre un bug TECHNIQUE pendant le paiement (pas carte refusée).",
    aiTone:
      "Mail d'alerte. Factuel, précis. Expliquer qu'un client n'a pas pu payer, lister les infos techniques pour investigation. Mentionner la dédup 5 min.",
    variables: [
      { token: "clientLabel", label: "Client (nom + email)", example: "Marie Dupont (marie@…)", required: true },
      { token: "clientCompany", label: "Société (vide si absente)", example: "Boutique Marie" },
      { token: "when", label: "Date / heure (format long)", example: "jeudi 21 octobre 2026 à 15h30" },
      { token: "whenShort", label: "Date / heure (format court)", example: "21/10/2026 15:30:12", required: true },
      { token: "stageLabel", label: "Étape (chargement ou confirmation)", example: "Confirmation du paiement" },
      { token: "sourceLabel", label: "Origine (tunnel / bouton)", example: "Tunnel de commande" },
      { token: "amount", label: "Montant (€)", example: "84,50" },
      { token: "paymentIntentId", label: "PI Stripe (si connu)", example: "pi_1234..." },
      { token: "orderId", label: "ID commande (si connu)", example: "cmxx…" },
      { token: "browser", label: "Navigateur", example: "Chrome sur Windows" },
      { token: "ip", label: "IP", example: "90.45.123.45" },
      { token: "errorLines", label: "Erreur Stripe (type / code / message)", example: "Type : api_error<br/>Code : …" },
      ...SHOP_VARIABLES,
    ],
  },
  {
    key: "ADMIN_ORPHAN_PAYMENT_INTENT",
    audience: "ADMIN",
    group: "securite",
    label: "Paiement orphelin détecté",
    description:
      "Envoyé à l'admin quand un paiement Stripe réussi n'a aucune commande associée (client débité sans commande).",
    aiTone:
      "Mail d'alerte urgent. Factuel. Afficher le montant, l'ID PaymentIntent, l'email client, la date. Action requise : vérifier côté admin, rembourser ou créer la commande recovery.",
    variables: [
      { token: "amount", label: "Montant débité (€)", example: "140,34", required: true },
      { token: "paymentIntentId", label: "ID PaymentIntent", example: "pi_1234...", required: true },
      { token: "receiptEmail", label: "Email client (ou —)", example: "marie@…" },
      { token: "paymentDate", label: "Date du paiement", example: "21/10/2026 à 15:30" },
      { token: "tenantName", label: "Nom boutique", example: "Beli & Jolie" },
      { token: "tenantSlug", label: "Slug boutique", example: "beli-jolie" },
      ...SHOP_VARIABLES,
    ],
  },
];

// Index pour lookup O(1).
const SCENARIOS_BY_KEY = new Map<TransactionalScenarioKey, TransactionalScenarioMeta>(
  TRANSACTIONAL_SCENARIOS.map((s) => [s.key, s]),
);

export function getScenarioMeta(
  key: TransactionalScenarioKey | string,
): TransactionalScenarioMeta | null {
  return SCENARIOS_BY_KEY.get(key as TransactionalScenarioKey) ?? null;
}

export const SCENARIO_GROUP_LABELS: Record<TransactionalScenarioGroup, string> = {
  auth: "Connexion",
  compte: "Compte client",
  commande: "Commandes",
  paiement: "Paiements",
  support: "Service client",
  securite: "Sécurité",
};

export const AUDIENCE_LABELS: Record<TransactionalScenarioAudience, string> = {
  CLIENT: "Mails envoyés aux clients",
  ADMIN: "Mails envoyés à vous (admin)",
};

/**
 * Langues disponibles pour un override transactionnel. FR est la langue
 * principale (toujours posée) ; les autres sont optionnelles (fallback FR).
 * Alignée sur les locales produit du site (next-intl).
 */
export const TRANSACTIONAL_LOCALES = ["fr", "en", "de", "es", "it"] as const;
export type TransactionalLocale = (typeof TRANSACTIONAL_LOCALES)[number];

export const TRANSACTIONAL_LOCALE_LABELS: Record<TransactionalLocale, string> = {
  fr: "Français",
  en: "English",
  de: "Deutsch",
  es: "Español",
  it: "Italiano",
};
