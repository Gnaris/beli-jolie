/**
 * scripts/relance-clients-inactifs-lib.ts
 *
 * Fonctions pures + pools de variations pour le script de relance.
 * Séparées du script principal pour être testables sans booter Prisma.
 */

const CONTACT_EMAIL = "contact@beliandjolie.com";
const SIGNATURE = "L'équipe Beli & Jolie";
const NOTE_MAX = 2000;

// Objets — 4 formulations différentes, ton sobre (pas de « ! », pas d'emoji).
export const SUBJECTS: readonly string[] = [
  "Un petit mot pour prendre de vos nouvelles",
  "On voulait savoir si tout se passait bien",
  "Suivi de votre compte pro Beli & Jolie",
  "Un mot rapide de la part de Beli & Jolie",
] as const;

// Intros — 6 accroches, tutoient jamais, tout au vouvoiement.
// Chaque intro se termine sur une phrase qui appelle les questions ensuite.
export const INTROS: readonly string[] = [
  "Nous revenons vers vous suite à la création récente de votre compte professionnel sur notre plateforme B2B. Beli & Jolie est un grossiste en bijoux acier inoxydable pour les professionnels, et nous tenons à entretenir une vraie relation commerciale avec chacun de nos comptes validés, sans nous contenter d'envoyer des newsletters automatiques. Nous avons constaté que votre compte est bien actif, mais qu'aucune commande n'a encore été passée. C'est tout à fait normal, et nous voulions simplement nous assurer que tout se passait bien de votre côté.",

  "Nous vous contactons dans le cadre du suivi personnalisé de nos nouveaux comptes professionnels. Beli & Jolie est fournisseur grossiste B2B spécialisé en bijoux acier inoxydable, et nous accordons une attention particulière à chaque client validé sur notre plateforme. Nous avons remarqué que votre compte est en place mais qu'aucune commande n'a encore été passée à ce jour, et nous voulions donc prendre quelques minutes pour échanger avec vous.",

  "Nous nous permettons de vous écrire pour prendre de vos nouvelles. En tant que fournisseur grossiste B2B en bijoux acier inoxydable, nous préférons de loin les échanges directs aux relances automatiques : chaque compte professionnel validé chez nous compte, et nous aimons savoir comment nos clients vivent leur découverte de la maison. Votre compte est actif depuis quelque temps mais nous n'avons pas encore eu l'occasion de traiter une première commande avec vous.",

  "Un mot rapide de la part de Beli & Jolie. Depuis la validation de votre compte professionnel, nous n'avons pas encore eu le plaisir de traiter une commande pour votre société. Nous sommes un grossiste B2B en bijoux acier inoxydable, et nous préférons faire les choses simplement : plutôt que de vous envoyer une énième newsletter, on préfère venir vers vous directement pour comprendre où vous en êtes.",

  "Nous prenons contact avec vous personnellement dans le cadre du suivi de nos nouveaux comptes pro. Fournisseur grossiste en bijoux acier inoxydable pour les professionnels, Beli & Jolie tient à connaître chaque revendeur qui rejoint la maison. Votre compte est validé et actif, mais aucune commande n'a encore été enregistrée, et nous voulions donc savoir comment se passait votre découverte de notre catalogue et de nos conditions professionnelles.",

  "Nous venons vers vous simplement pour prendre de vos nouvelles. Beli & Jolie, grossiste B2B en bijoux acier inoxydable, cherche à construire une relation de long terme avec chaque professionnel qui s'inscrit sur la plateforme. Nous avons remarqué que vous avez créé votre compte pro mais que vous n'avez pas encore passé de première commande, ce qui peut être une simple question de timing. Nous voulions nous en assurer.",
] as const;

// Questions individuelles — mêmes 4 questions, formulées une seule fois.
const QUESTIONS = {
  catalogue: "Avez-vous trouvé ce que vous cherchiez dans notre catalogue ?",
  prix: "Nos tarifs professionnels correspondent-ils à ce que vous attendiez ?",
  freins: "Y a-t-il quelque chose qui vous freine actuellement (livraison, minimum de commande, gamme, disponibilité) ?",
  aide: "Souhaitez-vous que nous vous envoyions notre catalogue PDF, ou qu'un conseiller vous rappelle ?",
} as const;

// 3 ordres différents (les 4 questions dans un ordre distinct).
export const QUESTION_ORDERS: readonly (readonly (keyof typeof QUESTIONS)[])[] = [
  ["catalogue", "prix", "freins", "aide"],
  ["prix", "catalogue", "aide", "freins"],
  ["freins", "aide", "catalogue", "prix"],
] as const;

// 4 formules de fin.
export const CLOSERS: readonly string[] = [
  "Toute réponse, même en une seule ligne, nous est précieuse et nous aide à améliorer notre service. Si vous avez la moindre question ou besoin d'un accompagnement particulier, il vous suffit de répondre directement à ce message, nous le lisons personnellement.",

  "Un simple retour de votre part, même très court, nous rendrait grand service. Vous pouvez répondre directement à ce mail et nous vous répondrons en moins de 24 h. Si vous préférez discuter de vive voix, nous restons également à votre disposition.",

  "N'hésitez pas à nous répondre en toute franchise, même si c'est pour nous dire que ce n'est pas le bon moment. Nous préférons largement une réponse honnête à un long silence, et nous adapterons notre suivi en conséquence.",

  "Vos remarques comptent beaucoup pour nous, quelles qu'elles soient. Ce mail arrive directement dans notre boîte pro, vous pouvez répondre en toute simplicité : un retour rapide, une question précise, ou même une critique nous serait très utile.",
] as const;

export interface BuildEmailInput {
  company: string;
  firstName?: string | null;
  introIdx: number;
  orderIdx: number;
  closerIdx: number;
  subjectIdx: number;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Assemble un mail à partir des indices de variantes.
 * Salutation « Bonjour {Société} » (choix cliente 21/09/2026).
 */
export function buildEmailForClient(input: BuildEmailInput): BuiltEmail {
  const intro = INTROS[input.introIdx % INTROS.length];
  const order = QUESTION_ORDERS[input.orderIdx % QUESTION_ORDERS.length];
  const closer = CLOSERS[input.closerIdx % CLOSERS.length];
  const subject = SUBJECTS[input.subjectIdx % SUBJECTS.length];

  const questionsText = order.map((k) => `- ${QUESTIONS[k]}`).join("\n");
  const questionsHtml = order
    .map((k) => `  <li style="margin:6px 0;">${escapeHtml(QUESTIONS[k])}</li>`)
    .join("\n");

  const greeting = `Bonjour ${input.company},`;

  const text = [
    greeting,
    "",
    intro,
    "",
    questionsText,
    "",
    closer,
    "",
    "Bien cordialement,",
    "",
    SIGNATURE,
    CONTACT_EMAIL,
  ].join("\n");

  const html = `<div style="font-family:'Roboto',Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;max-width:640px;">
<p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
<ul style="padding-left:0;list-style:none;margin:0 0 16px;">
${questionsHtml}
</ul>
<p style="margin:0 0 16px;">${escapeHtml(closer)}</p>
<p style="margin:0 0 4px;">Bien cordialement,</p>
<p style="margin:0;">${escapeHtml(SIGNATURE)}<br />
<a href="mailto:${CONTACT_EMAIL}" style="color:#334155;text-decoration:none;">${CONTACT_EMAIL}</a></p>
</div>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Ajoute une ligne datée à la note admin existante, sans jamais écraser.
 * Tronque le début si la nouvelle taille dépasse 2000 caractères, en
 * préservant la ligne fraîchement ajoutée en fin.
 */
export function appendAdminNote(
  existing: string | null,
  date: Date,
  message: string,
): string {
  const stamp = formatFrDate(date);
  const line = `— ${stamp} · ${message}`;
  const base = (existing ?? "").trimEnd();
  const combined = base ? `${base}\n${line}` : line;
  if (combined.length <= NOTE_MAX) return combined;

  // Tronque le début de l'existant pour laisser passer la nouvelle ligne.
  const keepLine = `\n${line}`;
  const budget = NOTE_MAX - keepLine.length - 3; // 3 = "..."
  if (budget <= 0) {
    // Cas extrême : la nouvelle ligne seule dépasse — on la tronque à la fin.
    return line.slice(0, NOTE_MAX);
  }
  const trimmedBase = base.slice(base.length - budget);
  return `...${trimmedBase}${keepLine}`;
}

function formatFrDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
