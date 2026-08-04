/**
 * lib/email-marketing/templates/inactive-client.ts
 *
 * Template HTML "Client inactif" — envoyé aux clients APPROVED sans
 * connexion depuis un délai configurable.
 *
 * Ton : commercial et professionnel, orienté catalogue / nouveautés,
 * sans culpabilisation ni familiarité excessive.
 */

import {
  EMAIL_COLORS as C,
  EMAIL_FONT_HEADING as FONT_HEADING,
  renderEmailShell,
  renderHeroDark,
  renderEyebrowLight,
  renderCta,
  renderFooter,
  escapeHtml,
} from "@/lib/email-marketing/layout";

export interface InactiveClientTemplateParams {
  customerFirstName: string;
  shopName: string;
  daysSinceLastLogin: number;
  catalogUrl: string;
  unsubscribeUrl: string;
  pixelUrl?: string;
  companyLegal: string;
}

export interface InactiveClientRenderResult {
  subject: string;
  html: string;
}

export function renderInactiveClientEmail(
  params: InactiveClientTemplateParams,
): InactiveClientRenderResult {
  const subject = `Nouveautés et retours en stock chez ${params.shopName}`;
  const firstName = escapeHtml(params.customerFirstName || "");
  const greeting = firstName ? `Bonjour ${firstName},` : "Bonjour,";
  const daysLabel = formatDaysLabel(params.daysSinceLastLogin);
  const shopName = escapeHtml(params.shopName);

  const hero = renderHeroDark(`
    <div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);display:inline-block;font-size:28px;line-height:64px;color:${C.white};">✦</div>
    <div style="margin-top:16px;">${renderEyebrowLight("Sélection professionnelle")}</div>
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:8px 0 0;color:${C.white};">Le catalogue a bougé depuis votre dernière visite</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:460px;">Nouveaux arrivages, retours en stock, coups de cœur de la saison — votre espace pro vous attend, vos conditions commerciales inchangées.</p>
  `);

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <p style="color:${C.slate700};font-size:15px;line-height:1.7;margin:0 0 16px;">${greeting}</p>
        <p style="color:${C.slate700};font-size:15px;line-height:1.7;margin:0 0 16px;">
          Votre dernière visite chez ${shopName} remonte à ${escapeHtml(daysLabel)}. Notre équipe a réapprovisionné plusieurs références et intégré de nouvelles pièces à la sélection professionnelle. Vos tarifs pros restent identiques — aucune action de votre part n'est nécessaire pour en profiter.
        </p>

        <div style="text-align:center;margin:28px 0;">
          ${renderCta("Découvrir les nouveautés →", params.catalogUrl)}
          <div style="margin-top:14px;font-size:11px;color:${C.slate400};">Accès direct avec vos identifiants habituels</div>
        </div>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <div style="margin-bottom:16px;text-transform:uppercase;letter-spacing:0.2em;font-size:11px;font-weight:600;color:${C.slate500};">Ce que vous retrouvez</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${renderBenefitRow("Nouveautés de la saison", "Sélection renouvelée chaque semaine, cohérente avec votre positionnement.")}
          ${renderBenefitRow("Retours en stock", "Vos favoris réapprovisionnés — activez les alertes stock depuis votre espace.")}
          ${renderBenefitRow("Tarifs et conditions pros conservés", "Aucun changement sur vos remises, franco de port ou modes de règlement.")}
        </table>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <div style="text-align:center;">
          <div style="margin-bottom:8px;text-transform:uppercase;letter-spacing:0.2em;font-size:11px;font-weight:600;color:${C.slate500};">Besoin d'un accompagnement ?</div>
          <p style="color:${C.slate600};font-size:14px;line-height:1.6;margin:0;">Notre équipe commerciale reste disponible pour toute demande spécifique — sélection sur mesure, devis, réassort.</p>
        </div>
      </td>
    </tr>`;

  const footer = renderFooter({
    companyLegal: params.companyLegal,
    reasonLine: `Vous recevez cet email professionnel en tant que client de ${shopName}. Vous pouvez à tout moment ajuster vos préférences ci-dessous.`,
    unsubscribeUrl: params.unsubscribeUrl,
    unsubscribeLabel: "Ne plus recevoir ce type de rappel",
    pixelUrl: params.pixelUrl,
  });

  const html = renderEmailShell({
    title: "Nouveautés catalogue",
    content,
    footer,
  });
  return { subject, html };
}

function renderBenefitRow(title: string, desc: string): string {
  return `
    <tr>
      <td style="padding:6px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${C.slate200};border-radius:12px;">
          <tr>
            <td width="52" valign="top" style="padding:16px;">
              <div style="width:32px;height:32px;border-radius:50%;background:${C.slate900};color:${C.white};text-align:center;line-height:32px;font-weight:700;font-family:${FONT_HEADING};font-size:14px;">✓</div>
            </td>
            <td valign="top" style="padding:16px 16px 16px 0;">
              <div style="font-weight:600;color:${C.slate900};font-size:14px;">${escapeHtml(title)}</div>
              <div style="font-size:13px;color:${C.slate500};margin-top:4px;line-height:1.5;">${escapeHtml(desc)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function formatDaysLabel(days: number): string {
  if (days < 30) return `${days} jour${days > 1 ? "s" : ""}`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mois`;
  const years = Math.floor(months / 12);
  const remainingMonths = months - years * 12;
  if (remainingMonths === 0) return `${years} an${years > 1 ? "s" : ""}`;
  return `${years} an${years > 1 ? "s" : ""} et ${remainingMonths} mois`;
}
