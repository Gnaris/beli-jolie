import { wrapMail, ctaButton, escapeHtml, type SharedMailContext } from "./shared";

export function renderInactiveClientMail({
  firstName,
  daysInactive,
  shared,
}: {
  firstName: string;
  daysInactive: number | null;
  shared: SharedMailContext;
}): { subject: string; html: string } {
  const subject = `Nos nouveautés vous attendent chez ${shared.shopName}`;

  let body = `<p style="font-size:14px; color:#0f172a; margin:0 0 12px;">Bonjour ${escapeHtml(firstName)},</p>`;

  if (daysInactive === null) {
    body += `<p style="font-size:13px; color:#475569; line-height:1.6; margin:0 0 16px;">Vous n'avez encore jamais visité notre boutique en ligne. Nos nouveautés vous attendent !</p>`;
  } else {
    body += `<p style="font-size:13px; color:#475569; line-height:1.6; margin:0 0 12px;">Cela fait <strong>${daysInactive} jour${daysInactive > 1 ? "s" : ""}</strong> qu'on ne vous a pas vu sur notre boutique.</p>`;
    body += `<p style="font-size:13px; color:#475569; line-height:1.6; margin:0 0 16px;">Nous avons plein de nouveautés à vous montrer !</p>`;
  }

  body += `<ul style="list-style:none; padding:0; margin:0 0 16px;">
    <li style="padding:6px 0; font-size:13px; color:#334155; border-bottom:1px solid #f1f5f9;">✨ Nouvelle collection en ligne</li>
    <li style="padding:6px 0; font-size:13px; color:#334155; border-bottom:1px solid #f1f5f9;">💎 Nouveaux modèles en stock</li>
    <li style="padding:6px 0; font-size:13px; color:#334155;">🎁 Livraison offerte dès 200 € HT</li>
  </ul>`;

  body += ctaButton("Découvrir les nouveautés", `${shared.baseUrl}/fr/produits`);

  return {
    subject,
    html: wrapMail({
      title: subject,
      bannerGradient: "linear-gradient(135deg,#7dd3fc,#38bdf8)",
      bannerTitle: "On vous a pas vu depuis un moment 😴",
      bodyHtml: body,
      shared,
    }),
  };
}
