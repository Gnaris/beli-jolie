/**
 * Template "Newsletter / Nouveautés" — envoi manuel depuis l'admin.
 *
 * Reçoit une liste de produits sélectionnés par l'admin + un intro
 * personnalisable.
 */
import {
  EMAIL_COLORS as C,
  EMAIL_FONT_HEADING as FONT_HEADING,
  renderEmailShell,
  renderHeroDark,
  renderCta,
  renderChipLight,
  renderFooter,
  escapeHtml,
} from "@/lib/email-marketing/layout";

export interface NewsletterProductView {
  name: string;
  priceLabel: string;
  productUrl: string;
  imageUrl: string | null;
  isNew?: boolean;
}

export interface NewsletterTemplateParams {
  eyebrow: string; // ex. "Nouveautés · Semaine 30"
  title: string; // ex. "42 nouveaux modèles cette semaine"
  intro: string;
  products: NewsletterProductView[];
  browseAllUrl: string;
  browseAllLabel: string;
  unsubscribeUrl: string;
  pixelUrl?: string;
  companyLegal: string;
  subject: string;
}

export function renderNewsletterEmail(params: NewsletterTemplateParams): {
  subject: string;
  html: string;
} {
  const hero = renderHeroDark(`
    ${renderChipLight(params.eyebrow)}
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:16px 0 0;color:${C.white};">${escapeHtml(params.title)}</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:440px;">${escapeHtml(params.intro)}</p>
  `);

  const productRows: string[] = [];
  for (let i = 0; i < params.products.length; i += 2) {
    productRows.push(`
      <tr>
        ${renderProduct(params.products[i])}
        ${params.products[i + 1] ? renderProduct(params.products[i + 1]) : `<td width="50%"></td>`}
      </tr>`);
  }

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${productRows.join("")}
        </table>

        <div style="text-align:center;margin-top:24px;">${renderCta(params.browseAllLabel, params.browseAllUrl)}</div>
      </td>
    </tr>`;

  const footer = renderFooter({
    companyLegal: params.companyLegal,
    reasonLine: "Vous recevez cette newsletter parce que vous avez accepté les communications commerciales.",
    unsubscribeUrl: params.unsubscribeUrl,
    unsubscribeLabel: "Se désabonner de la newsletter",
    pixelUrl: params.pixelUrl,
  });

  return { subject: params.subject, html: renderEmailShell({ title: params.eyebrow, content, footer }) };
}

function renderProduct(p: NewsletterProductView): string {
  const img = p.imageUrl
    ? `<img src="${escapeHtml(p.imageUrl)}" alt="" width="280" height="150" style="display:block;width:100%;height:150px;object-fit:cover;background:${C.thumbLight};" />`
    : `<div style="height:150px;background:${C.thumbLight};text-align:center;font-size:48px;line-height:150px;color:${C.slate600};">◆</div>`;

  const badge = p.isNew
    ? `<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;background:${C.slate100};color:${C.slate700};border:1px solid ${C.slate200};">Nouveau</span>`
    : "";

  return `
    <td width="50%" valign="top" style="padding:6px;">
      <a href="${escapeHtml(p.productUrl)}" style="text-decoration:none;color:inherit;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${C.slate200};border-radius:12px;overflow:hidden;">
          <tr><td style="padding:0;">${img}</td></tr>
          <tr>
            <td style="padding:12px;">
              ${badge}
              <div style="font-weight:500;color:${C.slate900};font-size:13px;margin-top:8px;">${escapeHtml(p.name)}</div>
              <div style="font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:14px;margin-top:4px;">${escapeHtml(p.priceLabel)}</div>
            </td>
          </tr>
        </table>
      </a>
    </td>`;
}
