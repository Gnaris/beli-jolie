import { wrapMail, ctaButton, absoluteUrl, formatEuros, escapeHtml, type SharedMailContext } from "./shared";
import type { FavoritePreview } from "@/app/actions/admin/user-mails";

export function renderRestockMail({
  firstName,
  favorites,
  shared,
}: {
  firstName: string;
  favorites: FavoritePreview[];
  shared: SharedMailContext;
}): { subject: string; html: string } {
  const empty = favorites.length === 0;
  const subject = empty
    ? `Découvrez nos nouveautés chez ${shared.shopName}`
    : `Vos favoris sont de retour chez ${shared.shopName}`;

  const bannerTitle = empty
    ? "Vos favoris ne sont pas encore là"
    : "Vos favoris sont revenus 🔔";

  let body = `<p style="font-size:14px; color:#0f172a; margin:0 0 12px;">Bonjour ${escapeHtml(firstName)},</p>`;

  if (empty) {
    body += `<p style="font-size:13px; color:#475569; line-height:1.6; margin:0 0 16px;">Aucun de vos favoris n'est actuellement disponible en stock. Nous vous préviendrons dès qu'ils reviendront !</p>`;
    body += ctaButton("Parcourir le catalogue", `${shared.baseUrl}/fr/produits`);
  } else {
    body += `<p style="font-size:13px; color:#475569; line-height:1.6; margin:0 0 16px;">Bonne nouvelle : <strong>${favorites.length} de vos favoris</strong> ${favorites.length > 1 ? "sont de nouveau disponibles" : "est de nouveau disponible"}.</p>`;

    body += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">`;
    const rows: FavoritePreview[][] = [];
    for (let i = 0; i < favorites.length; i += 2) rows.push(favorites.slice(i, i + 2));
    for (const row of rows) {
      body += `<tr>`;
      for (const f of row) {
        body += `<td width="50%" style="padding:6px; vertical-align:top;">
          <div style="border:1px solid #e2e8f0; border-radius:8px; padding:8px;">
            ${f.imagePath ? `<img src="${escapeHtml(absoluteUrl(shared.baseUrl, f.imagePath))}" width="100%" alt="" style="width:100%; height:120px; object-fit:cover; border-radius:6px; display:block; margin-bottom:6px;">` : `<div style="height:120px; background:#f1f5f9; border-radius:6px; margin-bottom:6px;"></div>`}
            <div style="font-size:12px; font-family:'Poppins', sans-serif; font-weight:600; color:#0f172a;">${escapeHtml(f.productName)}</div>
            ${f.colorName ? `<div style="font-size:11px; color:#64748b;">${escapeHtml(f.colorName)}</div>` : ""}
            <div style="font-size:12px; color:#0f172a; font-weight:700; margin-top:4px;">${formatEuros(f.priceCents)}</div>
          </div>
        </td>`;
      }
      if (row.length === 1) body += `<td width="50%"></td>`;
      body += `</tr>`;
    }
    body += `</table>`;
    body += ctaButton("Voir tous mes favoris", `${shared.baseUrl}/fr/favoris`);
  }

  return {
    subject,
    html: wrapMail({
      title: subject,
      bannerGradient: "linear-gradient(135deg,#6ee7b7,#10b981)",
      bannerTitle,
      bodyHtml: body,
      shared,
    }),
  };
}
