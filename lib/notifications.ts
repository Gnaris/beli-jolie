/**
 * lib/notifications.ts
 *
 * Envoi d'un email à l'admin lors d'une nouvelle inscription client.
 * Le Kbis est joint en pièce jointe.
 *
 * Variables d'environnement requises (voir .env) :
 *   GMAIL_USER          — adresse Gmail expéditrice
 *   GMAIL_APP_PASSWORD  — mot de passe d'application Gmail (pas le mdp du compte)
 *   NOTIFY_EMAIL        — adresse admin destinataire
 */

import nodemailer from "nodemailer";
import path from "path";

interface NewClientInfo {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  siret: string;
  kbisPath: string; // chemin relatif stocké en base, ex: private/uploads/kbis/kbis_XXX.pdf
}

export async function notifyNewClientRegistration(
  client: NewClientInfo
): Promise<void> {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_EMAIL } = process.env;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !NOTIFY_EMAIL) {
    console.warn("[notifications] Variables Gmail manquantes — email ignoré.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  // Chemin absolu du Kbis pour la pièce jointe
  const kbisAbsolutePath = path.join(process.cwd(), client.kbisPath);
  const kbisFilename = path.basename(client.kbisPath);

  await transporter.sendMail({
    from: `"Beli & Jolie" <${GMAIL_USER}>`,
    to: NOTIFY_EMAIL,
    subject: `Nouvelle inscription client — ${client.company}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#0F172A;">
        <h2 style="color:#0F3460;border-bottom:2px solid #E2E8F0;padding-bottom:10px;">
          Nouvelle demande d'inscription
        </h2>
        <p>Un nouveau client vient de s'inscrire sur la plateforme B2B Beli &amp; Jolie.</p>
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
        </table>
        <p style="margin-top:16px;color:#475569;font-size:13px;">
          Le document Kbis est joint à cet email.
        </p>
        <div style="margin-top:20px;">
          <a href="${process.env.NEXTAUTH_URL}/admin/utilisateurs"
             style="background:#0F3460;color:#ffffff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;">
            Examiner le dossier →
          </a>
        </div>
        <p style="margin-top:24px;color:#94A3B8;font-size:12px;">
          Beli &amp; Jolie — Administration
        </p>
      </div>
    `,
    attachments: [
      {
        filename: kbisFilename,
        path: kbisAbsolutePath,
      },
    ],
  });
}
