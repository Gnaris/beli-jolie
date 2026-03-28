/**
 * lib/notifications.ts
 *
 * Envoi d'un email à l'admin lors d'une nouvelle inscription client.
 * Le Kbis est joint en pièce jointe.
 *
 * Configuration email lue depuis les paramètres admin (SiteConfig),
 * avec fallback sur les variables d'environnement.
 */

import nodemailer from "nodemailer";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getCachedShopName, getCachedCompanyInfo, getCachedGmailConfig } from "@/lib/cached-data";

interface NewClientInfo {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  siret: string;
  kbisPath?: string; // chemin relatif stocké en base, ex: private/uploads/kbis/kbis_XXX.pdf
  documentPath?: string; // document complémentaire, ex: private/uploads/documents/doc_XXX.pdf
  registrationMessage?: string; // message libre saisi lors de l'inscription
}

export async function notifyNewClientRegistration(
  client: NewClientInfo
): Promise<void> {
  const [shopName, companyInfo, gmailCfg] = await Promise.all([
    getCachedShopName(), getCachedCompanyInfo(), getCachedGmailConfig(),
  ]);
  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;

  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    console.warn("[notifications] Configuration Gmail manquante — email ignoré.");
    return;
  }

  const notifyEmail = gmailCfg.notifyEmail || companyInfo?.email || process.env.NOTIFY_EMAIL;
  if (!notifyEmail) {
    console.warn("[notifications] Aucun email destinataire configuré — email ignoré.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  // Pièce jointe Kbis (optionnelle)
  const attachments: { filename: string; path: string }[] = [];
  if (client.kbisPath) {
    attachments.push({
      filename: path.basename(client.kbisPath),
      path: path.join(process.cwd(), client.kbisPath),
    });
  }
  if (client.documentPath) {
    attachments.push({
      filename: path.basename(client.documentPath),
      path: path.join(process.cwd(), client.documentPath),
    });
  }

  const messageBlock = client.registrationMessage
    ? `<tr>
        <td style="padding:10px 14px;font-weight:bold;vertical-align:top;">Message</td>
        <td style="padding:10px 14px;white-space:pre-wrap;">${client.registrationMessage}</td>
       </tr>`
    : "";

  const kbisNote = client.kbisPath
    ? `<p style="margin-top:16px;color:#475569;font-size:13px;">Le document Kbis est joint à cet email.</p>`
    : `<p style="margin-top:16px;color:#F59E0B;font-size:13px;">Aucun Kbis fourni lors de l'inscription.</p>`;

  const docNote = client.documentPath
    ? `<p style="margin-top:8px;color:#475569;font-size:13px;">Un document complémentaire est également joint.</p>`
    : "";

  await transporter.sendMail({
    from: `"${shopName}" <${GMAIL_USER}>`,
    to: notifyEmail,
    subject: `Nouvelle inscription client — ${client.company}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#0F172A;">
        <h2 style="color:#0F3460;border-bottom:2px solid #E2E8F0;padding-bottom:10px;">
          Nouvelle demande d'inscription
        </h2>
        <p>Un nouveau client vient de s'inscrire sur la plateforme B2B ${shopName}.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <tr style="background:#F1F5F9;">
            <td style="padding:10px 14px;font-weight:bold;width:40%;">Prénom / Nom</td>
            <td style="padding:10px 14px;">${client.firstName} ${client.lastName}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Société</td>
            <td style="padding:10px 14px;">${client.company}</td>
          </tr>
          <tr style="background:#F1F5F9;">
            <td style="padding:10px 14px;font-weight:bold;">Email</td>
            <td style="padding:10px 14px;">${client.email}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Téléphone</td>
            <td style="padding:10px 14px;">${client.phone}</td>
          </tr>
          <tr style="background:#F1F5F9;">
            <td style="padding:10px 14px;font-weight:bold;">SIRET</td>
            <td style="padding:10px 14px;">${client.siret}</td>
          </tr>
          ${messageBlock}
        </table>
        ${kbisNote}
        ${docNote}
        <div style="margin-top:20px;">
          <a href="${process.env.NEXTAUTH_URL}/admin/utilisateurs"
             style="background:#0F3460;color:#ffffff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;">
            Examiner le dossier →
          </a>
        </div>
        <p style="margin-top:24px;color:#94A3B8;font-size:12px;">
          ${shopName} — Administration
        </p>
      </div>
    `,
    attachments,
  });
}

// ─────────────────────────────────────────────
// Alerte de réassort — envoi email aux clients inscrits
// ─────────────────────────────────────────────

/**
 * Check and notify clients subscribed to restock alerts for a given variant.
 * Called after stock is updated from 0 to > 0.
 * Fire-and-forget — errors are logged but do not propagate.
 */
export async function notifyRestockAlerts(productColorId: string): Promise<void> {
  try {
    const gmailCfg = await getCachedGmailConfig();
    const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
    const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
    if (!GMAIL_USER || !GMAIL_PASSWORD) return;

    // Find all pending alerts for this variant
    const alerts = await prisma.restockAlert.findMany({
      where: { productColorId, notified: false },
      include: {
        user: { select: { email: true, firstName: true } },
        product: { select: { id: true, name: true, reference: true } },
        productColor: {
          select: { color: { select: { name: true } } },
        },
      },
    });

    if (alerts.length === 0) return;

    const shopName = await getCachedShopName();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    for (const alert of alerts) {
      const productUrl = `${baseUrl}/produits/${alert.product.id}`;
      const colorName = alert.productColor.color?.name ?? "";

      await transporter.sendMail({
        from: `"${shopName}" <${GMAIL_USER}>`,
        to: alert.user.email,
        subject: `🔔 Réassort — ${alert.product.name} (${colorName})`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px;">
            <h2 style="color:#1A1A1A;">Bonne nouvelle, ${alert.user.firstName} !</h2>
            <p>Le produit que vous surveillez est de nouveau en stock :</p>
            <div style="background:#F7F7F8;border:1px solid #E5E5E5;border-radius:12px;padding:16px;margin:16px 0;">
              <p style="margin:0;font-weight:600;">${alert.product.name}</p>
              <p style="margin:4px 0 0;color:#6B7280;">Réf. ${alert.product.reference} — ${colorName}</p>
            </div>
            <a href="${productUrl}"
               style="background:#1A1A1A;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
              Voir le produit →
            </a>
            <p style="margin-top:24px;color:#94A3B8;font-size:12px;">
              ${shopName} — Vous recevez cet email car vous avez activé une alerte de réassort.
            </p>
          </div>
        `,
      });

      // Mark as notified
      await prisma.restockAlert.update({
        where: { id: alert.id },
        data: { notified: true },
      });
    }

    console.log(`[restock] ${alerts.length} alerte(s) envoyée(s) pour variant ${productColorId}`);
  } catch (err) {
    console.error("[restock] Erreur envoi alertes:", err);
  }
}
