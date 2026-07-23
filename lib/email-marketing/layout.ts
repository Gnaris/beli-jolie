/**
 * lib/email-marketing/layout.ts
 *
 * Composants HTML réutilisables pour tous les emails marketing.
 * Contrainte : compat Gmail/Outlook/Apple Mail — donc styles inline,
 * tables pour le layout, fonds couleurs unies (pas de linear-gradient
 * dans les <td> qui ne rendent pas dans Gmail).
 *
 * Charte : ardoise pure — hero sombre à texte blanc, contenu clair.
 */

export const EMAIL_COLORS = {
  slate900: "#0f172a",
  slate800: "#1e293b",
  slate700: "#334155",
  slate600: "#475569",
  slate500: "#64748b",
  slate400: "#94a3b8",
  slate300: "#cbd5e1",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f8fafc",
  white: "#ffffff",
  heroBg: "#0f172a", // fond noir ardoise du hero (couleur unie)
  thumbLight: "#cbd5e1",
  thumbMed: "#64748b",
  thumbDark: "#334155",
};

const C = EMAIL_COLORS;
export const EMAIL_FONT = "'Roboto', Arial, sans-serif";
export const EMAIL_FONT_HEADING = "'Poppins', Arial, sans-serif";

export interface EmailShellParams {
  /** Titre HTML (invisible dans l'aperçu Gmail). */
  title: string;
  /** Contenu principal (tables <tr>…</tr> attendues). */
  content: string;
  /** HTML du footer (mentions légales, liens désinscription). */
  footer: string;
}

export function renderEmailShell({ title, content, footer }: EmailShellParams): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f6;font-family:${EMAIL_FONT};color:${C.slate900};">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(title)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef2f6;padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;width:100%;background:${C.white};border-radius:20px;overflow:hidden;box-shadow:0 30px 60px -20px rgba(15,23,42,0.15);">
        ${content}
        <tr>
          <td style="background:${C.slate50};padding:24px 32px;text-align:center;font-size:12px;color:${C.slate400};line-height:1.7;border-top:1px solid ${C.slate200};">
            ${footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * Hero sombre à texte blanc — utilise bgcolor + background-color pour compat
 * tous clients mail (Gmail ignore les linear-gradient dans les <td>).
 */
export function renderHeroDark(inner: string): string {
  return `
    <tr>
      <td bgcolor="${C.heroBg}" style="background-color:${C.heroBg};padding:40px 32px;text-align:center;color:${C.white};">
        ${inner}
      </td>
    </tr>`;
}

export function renderEyebrow(text: string, color = C.slate500): string {
  return `<div style="text-transform:uppercase;letter-spacing:0.2em;font-size:11px;font-weight:600;color:${color};">${escapeHtml(text)}</div>`;
}

export function renderEyebrowLight(text: string): string {
  return renderEyebrow(text, C.slate300);
}

/** CTA principal — fond noir, texte blanc. */
export function renderCta(label: string, href: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${C.slate900};color:${C.white};padding:14px 28px;border-radius:12px;font-weight:600;text-decoration:none;font-family:${EMAIL_FONT_HEADING};letter-spacing:0.02em;">${escapeHtml(label)}</a>`;
}

/** Chip clair — utilisé dans le contenu. */
export function renderChip(text: string): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;background:${C.slate100};color:${C.slate700};border:1px solid ${C.slate200};">${escapeHtml(text)}</span>`;
}

/** Chip sombre — utilisé dans le hero. */
export function renderChipLight(text: string): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;background:rgba(255,255,255,0.1);color:${C.white};border:1px solid rgba(255,255,255,0.2);">${escapeHtml(text)}</span>`;
}

/** Pixel de tracking d'ouverture (image 1×1 invisible en pied de mail). */
export function renderTrackingPixel(pixelUrl: string): string {
  return `<img src="${escapeHtml(pixelUrl)}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;opacity:0;" />`;
}

/** Footer standard avec lien de désinscription. */
export function renderFooter(params: {
  companyLegal: string; // ex. "Beli & Jolie · 90 rue de la Haie Coq, 93300 Aubervilliers"
  reasonLine: string; // ex. "Vous recevez cet email parce que vous avez un compte…"
  unsubscribeUrl: string;
  unsubscribeLabel?: string;
  preferencesUrl?: string;
  pixelUrl?: string;
}): string {
  const preferences = params.preferencesUrl
    ? `<a href="${escapeHtml(params.preferencesUrl)}" style="color:${C.slate600};">Gérer mes préférences</a> · `
    : "";
  const unsubLabel = params.unsubscribeLabel ?? "Ne plus recevoir cet email";
  const pixel = params.pixelUrl ? renderTrackingPixel(params.pixelUrl) : "";
  return `
    ${params.reasonLine}<br />
    ${preferences}<a href="${escapeHtml(params.unsubscribeUrl)}" style="color:${C.slate600};">${escapeHtml(unsubLabel)}</a><br />
    ${escapeHtml(params.companyLegal)}
    ${pixel}
  `;
}

/**
 * Échappement HTML basique pour texte utilisateur inséré dans les templates.
 * NB : les URLs signées et les valeurs contrôlées côté serveur restent sûres.
 */
export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
