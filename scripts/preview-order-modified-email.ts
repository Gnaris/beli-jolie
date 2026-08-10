// Envoie une copie du mail « Modification de commande » (tel qu'envoyé
// automatiquement à la cliente Hart pour la commande 9XXH8JT6 le 10/08 à 12h29)
// vers borischen91@gmail.com, pour prévisualisation par l'admin.
//
// Usage : npx tsx scripts/preview-order-modified-email.ts
import { PrismaClient } from "@prisma/client";
import { bindTenantId } from "@/lib/tenant-als";
import { sendMail } from "@/lib/email";

const prisma = new PrismaClient();
const ORDER_ID = "cmslziw3v00lzo2ognkgj1zbp";
const PREVIEW_TO = "borischen91@gmail.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function main() {
  const order = await prisma.order.findUnique({
    where: { id: ORDER_ID },
    select: {
      id: true,
      orderNumber: true,
      clientCompany: true,
      tenantId: true,
      tenant: { select: { slug: true, name: true } },
    },
  });
  if (!order?.tenantId) throw new Error("Commande ou tenantId introuvable.");

  bindTenantId(order.tenantId);

  const shopName = order.tenant?.name ?? "Beli & Jolie";
  const baseUrl = "https://www.beliandjolie.com";

  const modifications = [
    {
      productName: "Bracelets",
      originalQuantity: 1,
      newQuantity: 0,
      reason: "OUT_OF_STOCK" as const,
      creditAmount: 2.8,
    },
  ];
  const reasonLabels: Record<string, string> = {
    OUT_OF_STOCK: "Rupture de stock",
    CLIENT_REQUEST: "À votre demande",
    COMMERCIAL_GESTURE: "Geste commercial",
  };
  const totalCredit = modifications.reduce((s, m) => s + m.creditAmount, 0);

  const rows = modifications
    .map(
      (m) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E5E5;">
          <strong>${escapeHtml(m.productName)}</strong><br/>
          <small style="color:#6B6B6B;">${escapeHtml(reasonLabels[m.reason] || m.reason)}</small>
        </td>
        <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #E5E5E5;">
          ${m.originalQuantity} → <strong>${m.newQuantity}</strong>
        </td>
        <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #E5E5E5;">
          ${m.creditAmount.toFixed(2)} €
        </td>
      </tr>`,
    )
    .join("");

  const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#F59E0B;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
            <div style="font-size:32px;margin-bottom:8px;">📝</div>
            <h2 style="margin:0;font-size:20px;">Modification de commande</h2>
            <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">N° ${escapeHtml(order.orderNumber)}</p>
          </div>
          <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
            <p style="font-size:15px;line-height:1.6;">
              Bonjour${order.clientCompany ? ` <strong>${escapeHtml(order.clientCompany)}</strong>` : ""},
            </p>
            <p style="font-size:15px;line-height:1.6;">
              Nous avons dû ajuster certains articles de votre commande
              <strong>${escapeHtml(order.orderNumber)}</strong> :
            </p>
            <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;">
              <thead>
                <tr style="background:#F7F7F8;">
                  <th style="padding:8px 12px;text-align:left;">Article</th>
                  <th style="padding:8px 12px;text-align:center;">Quantité</th>
                  <th style="padding:8px 12px;text-align:right;">Avoir HT</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr style="border-top:2px solid #1A1A1A;">
                  <td colspan="2" style="padding:8px 12px;font-weight:bold;">Total avoir</td>
                  <td style="padding:8px 12px;text-align:right;font-weight:bold;">${totalCredit.toFixed(2)} €</td>
                </tr>
              </tfoot>
            </table>
            <p style="margin-top:20px;font-size:14px;color:#4B5563;">
              Le montant correspondant vous sera remboursé ou crédité prochainement.
            </p>
            <div style="text-align:center;margin-top:24px;">
              <a href="${baseUrl}/fr/commandes/${order.id}"
                 style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
                Voir ma commande →
              </a>
            </div>
          </div>
          <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
            ${escapeHtml(shopName)} — Email automatique, ne pas répondre.
          </p>
        </div>
      `;

  const result = await sendMail({
    fromName: shopName,
    to: PREVIEW_TO,
    subject: `[APERÇU] ${shopName} — Modification de votre commande ${order.orderNumber}`,
    html,
  });
  console.log("Envoi :", result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
