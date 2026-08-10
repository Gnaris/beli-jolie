import { wrapMail, ctaButton, absoluteUrl, formatEuros, escapeHtml, type SharedMailContext } from "./shared";
import type { CartItemPreview } from "@/app/actions/admin/user-mails";

export function renderAbandonedCartMail({
  firstName,
  items,
  totalCents,
  shared,
}: {
  firstName: string;
  items: CartItemPreview[];
  totalCents: number;
  shared: SharedMailContext;
}): { subject: string; html: string } {
  const empty = items.length === 0;
  const subject = empty
    ? `Nos nouveautés vous attendent chez ${shared.shopName}`
    : `Votre panier vous attend chez ${shared.shopName}`;

  const bannerTitle = empty
    ? "On vous a pas vu depuis un moment 👋"
    : "Votre panier vous attend 🛒";

  let body = `<p style="font-size:14px; color:#0f172a; margin:0 0 12px;">Bonjour ${escapeHtml(firstName)},</p>`;

  if (empty) {
    body += `<p style="font-size:13px; color:#475569; line-height:1.6; margin:0 0 16px;">Vous n'avez actuellement <strong>rien dans votre panier</strong>. Nos nouveautés vous attendent — venez jeter un œil à notre catalogue !</p>`;
    body += ctaButton("Découvrir nos nouveautés", `${shared.baseUrl}/fr/produits`);
  } else {
    body += `<p style="font-size:13px; color:#475569; line-height:1.6; margin:0 0 16px;">Vous avez laissé <strong>${items.length} article${items.length > 1 ? "s" : ""}</strong> dans votre panier. Ils vous attendent toujours !</p>`;

    body += `<div style="background:#f8fafc; border-radius:10px; padding:12px; margin-bottom:16px;">`;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const border = i < items.length - 1 ? "border-bottom:1px solid #e2e8f0;" : "";
      body += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${border} padding:6px 0;"><tr>`;
      if (it.imagePath) {
        body += `<td width="48" style="padding-right:10px; vertical-align:top;"><img src="${escapeHtml(absoluteUrl(shared.baseUrl, it.imagePath))}" width="40" height="40" alt="" style="width:40px; height:40px; border-radius:6px; object-fit:cover; display:block;"></td>`;
      }
      body += `<td style="vertical-align:top;">
        <div style="font-size:12px; color:#0f172a; font-weight:600;">${escapeHtml(it.productName)}</div>
        <div style="font-size:10.5px; color:#64748b;">${it.colorName ? escapeHtml(it.colorName) + " · " : ""}x${it.quantity}</div>
      </td>
      <td align="right" style="vertical-align:top; white-space:nowrap;">
        <div style="font-size:12px; color:#0f172a; font-weight:700;">${formatEuros(it.totalCents)}</div>
      </td>`;
      body += `</tr></table>`;
    }
    body += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:2px solid #cbd5e1; padding-top:8px; margin-top:6px;"><tr>
      <td style="font-size:13px; font-weight:700; color:#0f172a;">Total</td>
      <td align="right" style="font-size:14px; font-weight:700; color:#0f172a;">${formatEuros(totalCents)}</td>
    </tr></table>`;
    body += `</div>`;
    body += ctaButton("Reprendre ma commande", `${shared.baseUrl}/fr/panier`);
  }

  return {
    subject,
    html: wrapMail({
      title: subject,
      bannerGradient: "linear-gradient(135deg,#d4a574,#b8895d)",
      bannerTitle,
      bodyHtml: body,
      shared,
    }),
  };
}
