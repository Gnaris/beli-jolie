/**
 * Layout HTML partagé pour tous les mails semi-automatiques envoyés depuis
 * /admin/utilisateurs. Charte Beli & Jolie : ardoise + arrondis + Roboto/Poppins.
 *
 * Compatibilité clients mail : styles inline, tableaux pour la mise en page,
 * pas de flexbox/grid, images en absolu.
 *
 * L'habillage (couleurs, logo, message footer, réseaux sociaux) est piloté
 * globalement par `lib/mail-branding.ts` (SiteConfig `mail_header_config` +
 * `mail_footer_config`). Les callers de `wrapMail()` n'ont plus à se soucier
 * du gradient — il est résolu ici depuis la config.
 */

import {
  DEFAULT_MAIL_BRANDING,
  resolveHeaderBackground,
  type MailBranding,
} from "@/lib/mail-branding-types";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";

export interface SharedMailContext {
  shopName: string;
  baseUrl: string;
  legalLine: string; // "Beli & Jolie · Grossiste en bijoux, Aubervilliers, France"
  /** Habillage résolu par le caller (via getCachedMailBranding). Fallback = valeurs historiques. */
  branding?: MailBranding;
  /**
   * Contexte pour la substitution des variables `{firstName}`, `{shopName}`,
   * etc. dans les champs éditables globaux (bannière + message perso footer).
   * Absent → les tokens sont conservés tels quels (utile pour les mails
   * système qui n'ont pas de destinataire personnalisé).
   */
  mergeContext?: MailMergeContext;
}

export function absoluteUrl(baseUrl: string, path: string | null): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalized}`;
}

export function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convertit les sauts de ligne saisis par la cliente (touche Entrée) en <br>
 * pour le rendu HTML final du mail. À appeler APRÈS escapeHtml pour ne pas
 * casser l'échappement. Compatible tous clients mail (Gmail/Outlook/Apple).
 */
export function escapeHtmlWithBreaks(str: string): string {
  return escapeHtml(str).replace(/\r?\n/g, "<br>");
}

/**
 * Rend le header du mail (bannière). Consomme la config globale
 * `MailHeaderConfig` : fond gradient/solide, logo optionnel (remplace l'eyebrow
 * nom-boutique si présent), couleur du texte.
 */
export function renderMailHeader(
  bannerTitle: string,
  shared: SharedMailContext,
  branding: MailBranding,
): string {
  const header = branding.header;
  const background = resolveHeaderBackground(header);
  const textColor = header.textColor;

  // Substitue les tokens {firstName}, {shopName}, etc. dans le titre.
  // Idempotent : re-appeler sur un texte sans token laisse le résultat inchangé.
  const resolvedTitle = shared.mergeContext
    ? interpolate(bannerTitle, shared.mergeContext)
    : bannerTitle;

  const logoOrEyebrow = header.logoUrl
    ? `<div style="margin-bottom:14px;"><img src="${escapeHtml(absoluteUrl(shared.baseUrl, header.logoUrl))}" alt="${escapeHtml(shared.shopName)}" style="max-height:${header.logoMaxHeight}px; display:inline-block; border:0;"></div>`
    : header.showShopName
      ? `<div style="font-size:11px; letter-spacing:0.2em; text-transform:uppercase; opacity:0.85; margin-bottom:8px; color:${textColor};">${escapeHtml(shared.shopName)}</div>`
      : "";

  return `<!-- Bannière -->
<div style="background:${background}; padding:36px 24px; color:${textColor}; text-align:center;">
${logoOrEyebrow}
<h1 style="font-family:'Poppins', sans-serif; font-size:24px; font-weight:700; margin:0; color:${textColor};">${escapeHtml(resolvedTitle)}</h1>
</div>`;
}

/** SVG inline icons pour les réseaux sociaux (Gmail/Outlook safe). */
function socialIcon(kind: "instagram" | "facebook", color: string): string {
  // On force la couleur via `fill` inline (les <img> distants seraient bloqués
  // par certains clients ; le SVG inline en dataURL est mieux rendu partout).
  if (kind === "instagram") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>`;
}

/**
 * Rend le footer du mail. Consomme `MailFooterConfig` : fond, couleur texte,
 * message perso (remplace la ligne « Vous recevez ce mail… »), liens sociaux.
 */
export function renderMailFooter(shared: SharedMailContext, branding: MailBranding): string {
  const footer = branding.footer;
  const bg = footer.bg;
  const color = footer.textColor;
  const rawMessage =
    footer.customMessage?.trim()
      ? footer.customMessage
      : `Vous recevez ce mail car vous êtes client ${shared.shopName}.`;
  // Substitue les variables ({firstName}, {shopName}, etc.) dans le message
  // custom. Les tokens inconnus sont conservés — la cliente les verra à la
  // relecture d'un envoi de test.
  const message = shared.mergeContext ? interpolate(rawMessage, shared.mergeContext) : rawMessage;

  const socialLinks: string[] = [];
  if (footer.instagramUrl?.trim()) {
    socialLinks.push(
      `<a href="${escapeHtml(footer.instagramUrl)}" style="display:inline-block; margin:0 6px; text-decoration:none;">${socialIcon("instagram", color)}</a>`,
    );
  }
  if (footer.facebookUrl?.trim()) {
    socialLinks.push(
      `<a href="${escapeHtml(footer.facebookUrl)}" style="display:inline-block; margin:0 6px; text-decoration:none;">${socialIcon("facebook", color)}</a>`,
    );
  }
  const socialLine = socialLinks.length
    ? `<div style="margin:12px 0;">${socialLinks.join("")}</div>`
    : "";

  // Lien vers la politique de confidentialité — obligatoire par le RGPD sur
  // tous les mails, y compris transactionnels (facture/OTP…). Absolue.
  const privacyUrl = `${shared.baseUrl.replace(/\/+$/, "")}/fr/confidentialite`;
  const privacyLink = `<a href="${escapeHtml(privacyUrl)}" style="color:${color}; opacity:0.6; text-decoration:underline;">Politique de confidentialité</a>`;

  return `<!-- Footer -->
<div style="background:${bg}; color:${color}; padding:24px; text-align:center;">
<div style="font-family:'Poppins', sans-serif; font-size:18px; font-weight:700; letter-spacing:0.02em; margin-bottom:6px; color:${color};">${escapeHtml(shared.shopName)}</div>
<div style="font-size:11px; opacity:0.6; margin-bottom:12px; color:${color};">${escapeHtml(shared.legalLine)}</div>
${socialLine}
<div style="font-size:10px; opacity:0.4; color:${color}; margin-bottom:8px;">${escapeHtml(message)}</div>
<div style="font-size:10px; color:${color};">${privacyLink}</div>
</div>`;
}

/** Wrapper HTML : head + body + fonts + footer.
 *
 * Le paramètre `bannerGradient` est conservé pour rétrocompat (callers non
 * migrés) mais IGNORÉ dès que `shared.branding` est fourni — la config
 * globale prend le pas.
 *
 * `omitGlobalChrome: true` supprime le header (bannière) ET le footer globaux
 * — utilisé par les mails marketing (newsletter + 3 scénarios) qui composent
 * leur propre en-tête et pied de page via blocs éditeur, y compris les
 * mentions légales via variables obligatoires.
 */
export function wrapMail({
  title,
  bannerGradient,
  bannerTitle,
  bodyHtml,
  shared,
  omitGlobalChrome,
}: {
  title: string;
  /** @deprecated — utiliser `shared.branding` (config globale). */
  bannerGradient?: string;
  bannerTitle: string;
  bodyHtml: string;
  shared: SharedMailContext;
  omitGlobalChrome?: boolean;
}): string {
  // Rétrocompat : si un caller n'a pas fourni la config, on assemble un
  // MailBranding à la volée à partir du bannerGradient legacy.
  const branding: MailBranding = shared.branding ?? {
    header: {
      ...DEFAULT_MAIL_BRANDING.header,
      bgType: "gradient",
      bgGradient: bannerGradient ?? DEFAULT_MAIL_BRANDING.header.bgGradient,
    },
    footer: DEFAULT_MAIL_BRANDING.footer,
  };

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Roboto:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light only; supported-color-schemes: light; }
  /* Force les clients mail en mode sombre (Gmail Android/iOS, Outlook.com, Apple Mail)
     à préserver le rendu clair : sinon ils inversent le fond blanc en noir mais laissent
     le texte blanc de la bannière, ce qui rend le mail illisible. */
  @media (prefers-color-scheme: dark) {
    body, table, td, div, p, h1, h2, h3, a, span { color-scheme: light only !important; }
  }
  /* Gmail Android (ogsc = "old Gmail supported color") */
  u + .body [data-ogsc] { color: inherit !important; }
</style>
</head>
<body class="body" style="margin:0; padding:0; background:#f1f5f9; font-family:'Roboto', -apple-system, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9; padding:24px 12px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(15,23,42,0.08);">
<tr><td>
${omitGlobalChrome ? "" : renderMailHeader(bannerTitle, shared, branding)}
<!-- Corps -->
<div style="padding:${omitGlobalChrome ? "0" : "28px 0"};">
${bodyHtml}
</div>
${omitGlobalChrome ? "" : renderMailFooter(shared, branding)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** CTA button in mail (dark rounded button). */
export function ctaButton(label: string, url: string): string {
  return `<div style="text-align:center; margin:20px 0 8px;">
<a href="${escapeHtml(url)}" style="display:inline-block; background:#0f172a; color:#ffffff; padding:14px 32px; border-radius:10px; font-family:'Poppins', sans-serif; font-weight:600; font-size:14px; text-decoration:none;">${escapeHtml(label)} →</a>
</div>`;
}
