/**
 * Template "Retour en stock" — envoyé quand un produit sur lequel le client
 * a posé une alerte (RestockAlert) repasse en stock > 0.
 */
import {
  EMAIL_COLORS as C,
  EMAIL_FONT_HEADING as FONT_HEADING,
  renderEmailShell,
  renderHeroDark,
  renderCta,
  renderChip,
  renderChipLight,
  renderEyebrow,
  renderFooter,
  escapeHtml,
} from "@/lib/email-marketing/layout";

export interface BackInStockSuggestionView {
  name: string;
  priceLabel: string;
  imageUrl: string | null;
}

export interface BackInStockTemplateParams {
  customerFirstName: string;
  productName: string;
  productReference: string;
  productPriceLabel: string; // "4,20 €"
  productImageUrl: string | null;
  productUrl: string;
  suggestions: BackInStockSuggestionView[];
  unsubscribeUrl: string;
  pixelUrl?: string;
  companyLegal: string;
}

export interface BackInStockRenderResult {
  subject: string;
  html: string;
}

export function renderBackInStockEmail(
  params: BackInStockTemplateParams,
): BackInStockRenderResult {
  const subject = `Bonne nouvelle — ${params.productName} est de retour`;

  const hero = renderHeroDark(`
    <div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);display:inline-block;font-size:28px;line-height:64px;color:${C.white};">✦</div>
    <div style="margin-top:14px;">${renderChipLight("Bonne nouvelle")}</div>
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:12px 0 0;color:${C.white};">Un de vos favoris est de retour</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:440px;">Bonjour ${escapeHtml(params.customerFirstName)}, vous aviez posé une alerte sur ce produit. Il vient d'être réapprovisionné.</p>
  `);

  const productImg = params.productImageUrl
    ? `<img src="${escapeHtml(params.productImageUrl)}" alt="" width="600" height="220" style="display:block;width:100%;height:220px;object-fit:cover;background:${C.thumbMed};" />`
    : `<div style="height:220px;background:${C.thumbMed};text-align:center;font-size:64px;line-height:220px;color:${C.white};">◆</div>`;

  const suggestionsHtml =
    params.suggestions.length > 0
      ? `
        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>
        <div style="margin-bottom:12px;">${renderEyebrow("Vous aimerez peut-être aussi")}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            ${params.suggestions.slice(0, 3).map(renderSuggestion).join("")}
          </tr>
        </table>`
      : "";

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${C.slate200};border-radius:16px;overflow:hidden;">
          <tr><td style="padding:0;">${productImg}</td></tr>
          <tr>
            <td style="padding:20px;">
              <div style="font-size:11px;color:${C.slate500};">Réf. ${escapeHtml(params.productReference)}</div>
              <div style="font-family:${FONT_HEADING};font-weight:600;font-size:18px;margin-top:4px;color:${C.slate900};">${escapeHtml(params.productName)}</div>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:12px;">
                <tr>
                  <td>
                    <div style="font-size:11px;color:${C.slate500};">Prix pro (par pièce)</div>
                    <div style="font-family:${FONT_HEADING};font-weight:600;font-size:24px;color:${C.slate900};margin-top:2px;">${escapeHtml(params.productPriceLabel)}</div>
                  </td>
                  <td align="right">${renderChip("En stock")}</td>
                </tr>
              </table>
              <div style="margin-top:16px;text-align:center;">${renderCta("Voir le produit", params.productUrl)}</div>
            </td>
          </tr>
        </table>
        ${suggestionsHtml}
      </td>
    </tr>`;

  const footer = renderFooter({
    companyLegal: params.companyLegal,
    reasonLine: "Vous recevez cet email parce que vous avez ajouté ce produit à vos alertes de retour en stock.",
    unsubscribeUrl: params.unsubscribeUrl,
    unsubscribeLabel: "Se désabonner des alertes stock",
    pixelUrl: params.pixelUrl,
  });

  return { subject, html: renderEmailShell({ title: "Retour en stock", content, footer }) };
}

function renderSuggestion(s: BackInStockSuggestionView): string {
  const img = s.imageUrl
    ? `<img src="${escapeHtml(s.imageUrl)}" alt="" width="180" height="90" style="display:block;width:100%;height:90px;object-fit:cover;background:${C.thumbLight};border-radius:10px;" />`
    : `<div style="height:90px;background:${C.thumbLight};border-radius:10px;line-height:90px;font-size:28px;color:${C.slate600};text-align:center;">◆</div>`;
  return `
    <td width="33%" align="center" style="padding:4px;">
      ${img}
      <div style="font-size:12px;margin-top:8px;font-weight:500;color:${C.slate900};">${escapeHtml(s.name)}</div>
      <div style="font-size:12px;color:${C.slate500};">${escapeHtml(s.priceLabel)}</div>
    </td>`;
}
