/**
 * lib/email-marketing/templates/abandoned-cart.ts
 *
 * Template HTML de l'email "Panier abandonné" — extrait de la maquette v6
 * validée avec la cliente (hero sombre + contenu clair, palette ardoise pure).
 *
 * Compat Gmail/Outlook/Apple Mail : styles inline, tables, couleurs unies
 * (pas de linear-gradient dans <td>).
 */

import {
  EMAIL_COLORS as C,
  EMAIL_FONT_HEADING as FONT_HEADING,
  renderEmailShell,
  renderHeroDark,
  renderEyebrowLight,
  renderCta,
  renderChip,
  renderFooter,
  escapeHtml,
} from "@/lib/email-marketing/layout";

export interface AbandonedCartItemView {
  productName: string;
  reference: string;
  colorName: string | null;
  quantity: number;
  /** Prix total ligne (unitPrice × quantity), formaté en euros ("36,00 €"). */
  linePriceLabel: string;
  /** URL absolue de l'image (peut être null → placeholder). */
  imageUrl: string | null;
  /** Initiale de secours ("B", "C", "◆") si pas d'image. */
  fallbackInitial: string;
}

export interface AbandonedCartTemplateParams {
  customerFirstName: string;
  items: AbandonedCartItemView[];
  totalLabel: string; // ex: "78,00 €"
  itemCount: number;
  resumeUrl: string; // CTA "Reprendre ma commande"
  unsubscribeUrl: string;
  pixelUrl?: string;
  companyLegal: string;
  /**
   * Numéro de relance (0-indexed). Utilisé pour légèrement varier le ton :
   *   0 (24h) — ton doux "vos articles vous attendent"
   *   1 (72h) — ton avec un léger sentiment d'urgence
   */
  reminderIndex: number;
}

export interface AbandonedCartRenderResult {
  subject: string;
  html: string;
}

const SUBJECTS_BY_STAGE = [
  "Vous avez laissé quelques articles derrière vous",
  "Vos articles ne vous attendront plus longtemps",
  "Dernier rappel — vos articles sont toujours disponibles",
];

const HEADLINES_BY_STAGE = [
  "Vos articles vous attendent",
  "Vos articles sont toujours là — pour l'instant",
  "Une dernière chance avant qu'on libère votre panier",
];

const INTROS_BY_STAGE = (name: string) => [
  `Bonjour ${name}, vous avez commencé une commande. On vous a mis les articles de côté — ils sont toujours disponibles.`,
  `Bonjour ${name}, votre panier vous attend depuis quelques jours. Les stocks bougent vite, ne tardez pas trop.`,
  `Bonjour ${name}, dernière relance sur votre panier avant qu'on libère les articles pour d'autres clients.`,
];

const EYEBROWS_BY_STAGE = ["Panier en pause", "Relance panier", "Dernier rappel"];

export function renderAbandonedCartEmail(
  params: AbandonedCartTemplateParams,
): AbandonedCartRenderResult {
  const stage = Math.min(params.reminderIndex, SUBJECTS_BY_STAGE.length - 1);
  const subject = SUBJECTS_BY_STAGE[stage];
  const headline = HEADLINES_BY_STAGE[stage];
  const intro = INTROS_BY_STAGE(escapeHtml(params.customerFirstName))[stage];
  const eyebrow = EYEBROWS_BY_STAGE[stage];

  const hero = renderHeroDark(`
    <div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);display:inline-block;font-size:28px;line-height:64px;color:${C.white};">🛒</div>
    <div style="margin-top:16px;">${renderEyebrowLight(eyebrow)}</div>
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:8px 0 0;color:${C.white};">${escapeHtml(headline)}</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:440px;">${intro}</p>
  `);

  const productRows = params.items
    .map((item) => renderCartItemRow(item))
    .join("");

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${productRows}
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:24px;background:${C.slate50};border:1px solid ${C.slate200};border-radius:12px;">
          <tr>
            <td style="padding:16px 20px;">
              <div style="font-size:12px;color:${C.slate500};">Total du panier</div>
              <div style="font-family:${FONT_HEADING};font-weight:600;font-size:28px;color:${C.slate900};margin-top:4px;">${escapeHtml(params.totalLabel)}</div>
            </td>
            <td align="right" style="padding:16px 20px;">${renderChip(`${params.itemCount} article${params.itemCount > 1 ? "s" : ""}`)}</td>
          </tr>
        </table>

        <div style="text-align:center;margin-top:32px;">
          ${renderCta("Reprendre ma commande →", params.resumeUrl)}
          <div style="margin-top:14px;font-size:11px;color:${C.slate400};">Ce lien reste actif tant que votre panier est valide</div>
        </div>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="33%" align="center" style="padding:4px;">
              <div style="font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:14px;">Livraison offerte</div>
              <div style="font-size:12px;color:${C.slate500};margin-top:4px;">Selon vos conditions</div>
            </td>
            <td width="33%" align="center" style="padding:4px;">
              <div style="font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:14px;">Expédition rapide</div>
              <div style="font-size:12px;color:${C.slate500};margin-top:4px;">Colis suivi</div>
            </td>
            <td width="33%" align="center" style="padding:4px;">
              <div style="font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:14px;">SAV réactif</div>
              <div style="font-size:12px;color:${C.slate500};margin-top:4px;">Réponse &lt; 24 h</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const footer = renderFooter({
    companyLegal: params.companyLegal,
    reasonLine: "Vous recevez cet email parce que vous avez un compte professionnel sur notre boutique.",
    unsubscribeUrl: params.unsubscribeUrl,
    unsubscribeLabel: "Ne plus recevoir de rappels de panier",
    pixelUrl: params.pixelUrl,
  });

  const html = renderEmailShell({ title: "Panier abandonné", content, footer });
  return { subject, html };
}

function renderCartItemRow(item: AbandonedCartItemView): string {
  const thumb = item.imageUrl
    ? `<img src="${escapeHtml(item.imageUrl)}" alt="" width="84" height="84" style="display:block;width:84px;height:84px;border-radius:10px;object-fit:cover;background:${C.slate200};" />`
    : `<div style="width:84px;height:84px;border-radius:10px;background:${C.thumbMed};color:${C.white};font-weight:600;font-size:24px;line-height:84px;text-align:center;font-family:${FONT_HEADING};">${escapeHtml(item.fallbackInitial)}</div>`;

  const metaParts = [
    `Réf. ${item.reference}`,
    item.colorName ? item.colorName : null,
    `Qté ${item.quantity}`,
  ].filter(Boolean).join(" · ");

  return `
    <tr>
      <td style="padding:6px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.slate50};border:1px solid ${C.slate200};border-radius:14px;">
          <tr>
            <td width="100" style="padding:16px;">${thumb}</td>
            <td style="padding:16px 8px;">
              <div style="font-weight:500;color:${C.slate900};font-size:15px;">${escapeHtml(item.productName)}</div>
              <div style="font-size:12px;color:${C.slate500};margin-top:4px;">${escapeHtml(metaParts)}</div>
            </td>
            <td align="right" style="padding:16px;font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:15px;">${escapeHtml(item.linePriceLabel)}</td>
          </tr>
        </table>
      </td>
    </tr>`;
}
