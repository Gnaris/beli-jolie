/**
 * Template "Retour en stock" — email récapitulatif avec liste des produits
 * favorisés qui viennent de repasser en stock.
 *
 * Fonctionne aussi bien pour 1 produit que pour N — le titre s'adapte,
 * la liste montre chaque produit avec image + nom + prix + bouton "Voir".
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

export interface DigestProductView {
  productName: string;
  reference: string;
  priceLabel: string;
  productUrl: string;
  imageUrl: string | null;
}

export interface BackInStockDigestParams {
  customerFirstName: string;
  products: DigestProductView[];
  browseAllUrl: string;
  unsubscribeUrl: string;
  pixelUrl?: string;
  companyLegal: string;
}

export function renderBackInStockDigestEmail(
  params: BackInStockDigestParams,
): { subject: string; html: string } {
  const count = params.products.length;
  const subject =
    count === 1
      ? `${params.products[0].productName} est de retour`
      : `${count} de vos favoris sont de retour`;

  const headline =
    count === 1
      ? "Un de vos favoris est de retour"
      : `${count} de vos favoris sont de retour`;

  const intro =
    count === 1
      ? "Vous l'aviez ajouté à vos favoris, il vient d'être réapprovisionné."
      : "Vous les aviez ajoutés à vos favoris — ils viennent d'être réapprovisionnés.";

  const hero = renderHeroDark(`
    <div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);display:inline-block;font-size:28px;line-height:64px;color:${C.white};">✦</div>
    <div style="margin-top:14px;">${renderChipLight("Bonne nouvelle")}</div>
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:12px 0 0;color:${C.white};">${escapeHtml(headline)}</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:440px;">Bonjour ${escapeHtml(params.customerFirstName)}, ${intro}</p>
  `);

  const productRows = params.products.map(renderProductRow).join("");

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${productRows}
        </table>

        <div style="text-align:center;margin-top:24px;">
          ${renderCta("Voir toute la boutique →", params.browseAllUrl)}
        </div>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <p style="text-align:center;color:${C.slate500};font-size:13px;line-height:1.6;">
          Les stocks bougent vite — pensez à commander rapidement pour être sûr d'obtenir la quantité voulue.
        </p>
      </td>
    </tr>`;

  const footer = renderFooter({
    companyLegal: params.companyLegal,
    reasonLine:
      "Vous recevez cet email parce que vous avez ajouté ces produits à vos favoris sur notre boutique.",
    unsubscribeUrl: params.unsubscribeUrl,
    unsubscribeLabel: "Ne plus recevoir d'alertes de retour en stock",
    pixelUrl: params.pixelUrl,
  });

  return { subject, html: renderEmailShell({ title: headline, content, footer }) };
}

function renderProductRow(p: DigestProductView): string {
  const thumb = p.imageUrl
    ? `<img src="${escapeHtml(p.imageUrl)}" alt="" width="84" height="84" style="display:block;width:84px;height:84px;border-radius:10px;object-fit:cover;background:${C.thumbLight};" />`
    : `<div style="width:84px;height:84px;border-radius:10px;background:${C.thumbMed};color:${C.white};font-weight:600;font-size:24px;line-height:84px;text-align:center;font-family:${FONT_HEADING};">◆</div>`;

  return `
    <tr>
      <td style="padding:6px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.slate50};border:1px solid ${C.slate200};border-radius:14px;">
          <tr>
            <td width="100" style="padding:16px;">${thumb}</td>
            <td style="padding:16px 8px;">
              <div style="font-weight:500;color:${C.slate900};font-size:15px;">${escapeHtml(p.productName)}</div>
              <div style="font-size:12px;color:${C.slate500};margin-top:4px;">Réf. ${escapeHtml(p.reference)}</div>
              <div style="font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:15px;margin-top:6px;">${escapeHtml(p.priceLabel)}</div>
            </td>
            <td align="right" style="padding:16px;">
              <a href="${escapeHtml(p.productUrl)}" style="display:inline-block;padding:10px 16px;border-radius:10px;font-weight:500;text-decoration:none;color:${C.white};background:${C.slate900};font-family:${FONT_HEADING};font-size:13px;">Voir</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}
