/**
 * Template "Bienvenue" — envoyé quand l'admin valide un compte client
 * (PENDING → APPROVED).
 */
import {
  EMAIL_COLORS as C,
  EMAIL_FONT_HEADING as FONT_HEADING,
  renderEmailShell,
  renderHeroDark,
  renderCta,
  renderEyebrow,
  renderFooter,
  escapeHtml,
} from "@/lib/email-marketing/layout";

export interface WelcomeTemplateParams {
  customerFirstName: string;
  shopName: string;
  catalogUrl: string;
  contactEmail: string;
  contactPhone?: string;
  unsubscribeUrl: string;
  pixelUrl?: string;
  companyLegal: string;
}

export function renderWelcomeEmail(params: WelcomeTemplateParams): {
  subject: string;
  html: string;
} {
  const subject = `Bienvenue chez ${params.shopName} — votre compte est activé`;

  const hero = renderHeroDark(`
    <div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);display:inline-block;font-size:28px;line-height:64px;color:${C.white};">✦</div>
    <div style="text-transform:uppercase;letter-spacing:0.2em;font-size:11px;font-weight:600;color:${C.slate300};margin-top:14px;">Compte activé</div>
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:8px 0 0;color:${C.white};">Bienvenue dans la maison, ${escapeHtml(params.customerFirstName)}</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:460px;">Votre compte professionnel est validé. Vous avez maintenant accès aux prix pros et à l'ensemble du catalogue.</p>
  `);

  const step = (n: string, title: string, desc: string) => `
    <tr>
      <td style="padding:6px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${C.slate200};border-radius:12px;">
          <tr>
            <td width="60" valign="top" style="padding:16px;">
              <div style="width:36px;height:36px;border-radius:50%;background:${C.slate900};color:${C.white};text-align:center;line-height:36px;font-weight:600;font-family:${FONT_HEADING};">${n}</div>
            </td>
            <td valign="top" style="padding:16px 16px 16px 0;">
              <div style="font-weight:500;color:${C.slate900};">${title}</div>
              <div style="font-size:13px;color:${C.slate500};margin-top:4px;line-height:1.5;">${desc}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const contactLine = params.contactPhone
    ? `Écrivez à <a href="mailto:${escapeHtml(params.contactEmail)}" style="color:${C.slate900};font-weight:500;">${escapeHtml(params.contactEmail)}</a> ou appelez le <strong>${escapeHtml(params.contactPhone)}</strong> — on vous répond en moins de 24 h.`
    : `Écrivez à <a href="mailto:${escapeHtml(params.contactEmail)}" style="color:${C.slate900};font-weight:500;">${escapeHtml(params.contactEmail)}</a> — on vous répond en moins de 24 h.`;

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <div style="text-align:center;">${renderCta("Découvrir les nouveautés →", params.catalogUrl)}</div>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <div style="margin-bottom:16px;">${renderEyebrow("Pour bien démarrer")}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${step("1", "Explorez le catalogue", "Notre sélection complète est à votre disposition, réassortie régulièrement.")}
          ${step("2", "Enregistrez vos favoris", "Une alerte sur un produit → vous êtes averti dès qu'il revient en stock.")}
          ${step("3", "Passez votre 1<sup>re</sup> commande", "Vos conditions commerciales sont visibles dans votre espace pro.")}
        </table>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <div style="text-align:center;">
          <div style="margin-bottom:8px;">${renderEyebrow("Une question ?")}</div>
          <p style="color:${C.slate600};font-size:14px;line-height:1.6;">${contactLine}</p>
        </div>
      </td>
    </tr>`;

  const footer = renderFooter({
    companyLegal: params.companyLegal,
    reasonLine: `Vous recevez cet email suite à la validation de votre compte professionnel chez ${escapeHtml(params.shopName)}.`,
    unsubscribeUrl: params.unsubscribeUrl,
    unsubscribeLabel: "Se désabonner des communications commerciales",
    pixelUrl: params.pixelUrl,
  });

  return { subject, html: renderEmailShell({ title: "Bienvenue", content, footer }) };
}
