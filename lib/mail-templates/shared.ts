/**
 * Layout HTML partagé pour tous les mails semi-automatiques envoyés depuis
 * /admin/utilisateurs. Charte Beli & Jolie : ardoise + arrondis + Roboto/Poppins.
 *
 * Compatibilité clients mail : styles inline, tableaux pour la mise en page,
 * pas de flexbox/grid, images en absolu.
 */

export interface SharedMailContext {
  shopName: string;
  baseUrl: string;
  legalLine: string; // "Beli & Jolie · Grossiste en bijoux, Aubervilliers, France"
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

/** Wrapper HTML : head + body + fonts + footer. */
export function wrapMail({
  title,
  bannerGradient,
  bannerTitle,
  bodyHtml,
  shared,
}: {
  title: string;
  bannerGradient: string;
  bannerTitle: string;
  bodyHtml: string;
  shared: SharedMailContext;
}): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Roboto:wght@400;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0; padding:0; background:#f1f5f9; font-family:'Roboto', -apple-system, sans-serif; color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9; padding:24px 12px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(15,23,42,0.08);">
<tr><td>
<!-- Bannière -->
<div style="background:${bannerGradient}; padding:36px 24px; color:white; text-align:center;">
<div style="font-size:11px; letter-spacing:0.2em; text-transform:uppercase; opacity:0.85; margin-bottom:8px;">${escapeHtml(shared.shopName)}</div>
<h1 style="font-family:'Poppins', sans-serif; font-size:24px; font-weight:700; margin:0; color:white;">${escapeHtml(bannerTitle)}</h1>
</div>
<!-- Corps -->
<div style="padding:28px 24px;">
${bodyHtml}
</div>
<!-- Footer -->
<div style="background:#0f172a; color:white; padding:24px; text-align:center;">
<div style="font-family:'Poppins', sans-serif; font-size:18px; font-weight:700; letter-spacing:0.02em; margin-bottom:6px;">${escapeHtml(shared.shopName)}</div>
<div style="font-size:11px; opacity:0.6; margin-bottom:12px;">${escapeHtml(shared.legalLine)}</div>
<div style="font-size:10px; opacity:0.4;">Vous recevez ce mail car vous êtes client ${escapeHtml(shared.shopName)}.</div>
</div>
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
