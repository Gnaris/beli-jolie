import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";

const EMAIL_CHANGE_TOKEN_TTL_MS = 60 * 60 * 1000;

export function generateEmailChangeToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createEmailChangeToken(params: {
  userId: string;
  oldEmail: string;
  newEmail: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const { userId, oldEmail, newEmail } = params;

  await prisma.emailChangeToken.updateMany({
    where: { userId, used: false },
    data: { used: true },
  });

  const token = generateEmailChangeToken();
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TOKEN_TTL_MS);

  await prisma.emailChangeToken.create({
    data: { userId, oldEmail, newEmail, token, expiresAt },
  });

  return { token, expiresAt };
}

export async function sendEmailChangeConfirmationEmail(params: {
  userId: string;
  newEmail: string;
  token: string;
}): Promise<void> {
  const { userId, newEmail, token } = params;
  const shopName = await getCachedShopName();
  const baseUrl = await getCurrentTenantBaseUrl();
  const confirmUrl = `${baseUrl}/confirmer-email?token=${token}`;

  const result = await sendMail({
    fromName: shopName,
    to: newEmail,
    subject: `Confirmez votre nouvelle adresse email — ${shopName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#1A1A1A;margin-bottom:8px">Confirmez votre nouvelle adresse email</h2>
        <p style="color:#6B6B6B;margin-bottom:24px">Vous avez demandé à utiliser cette adresse comme nouvel email de connexion sur <strong>${shopName}</strong>. Cliquez sur le bouton ci-dessous pour valider le changement. Ce lien est valable <strong>1 heure</strong>.</p>
        <p style="margin-bottom:24px"><a href="${confirmUrl}" style="display:inline-block;background:#1A1A1A;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Confirmer mon nouvel email</a></p>
        <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. Aucune modification ne sera faite.</p>
        <p style="color:#9CA3AF;font-size:11px;margin-top:8px">Lien direct : ${confirmUrl}</p>
      </div>
    `,
    tracking: {
      scenarioKey: "EMAIL_CHANGE_CONFIRM",
      userId,
    },
  });

  if (!result.sent && result.reason === "no_config") {
    logger.warn("[email-change] Configuration SMTP manquante (confirm)");
  }
}

export async function sendEmailChangeNoticeToOldEmail(params: {
  userId: string;
  oldEmail: string;
  newEmail: string;
}): Promise<void> {
  const { userId, oldEmail, newEmail } = params;
  const shopName = await getCachedShopName();
  const baseUrl = await getCurrentTenantBaseUrl();
  const resetUrl = `${baseUrl}/mot-de-passe-oublie`;

  const result = await sendMail({
    fromName: shopName,
    to: oldEmail,
    subject: `Demande de changement d'email sur votre compte — ${shopName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#1A1A1A;margin-bottom:8px">Demande de changement d'email</h2>
        <p style="color:#6B6B6B;margin-bottom:16px">Nous vous informons qu'une demande a été faite pour remplacer l'adresse email de votre compte <strong>${shopName}</strong> par :</p>
        <p style="margin:0 0 24px;font-weight:600;color:#1A1A1A">${newEmail}</p>
        <p style="color:#6B6B6B;margin-bottom:24px">Le changement ne sera effectif qu'après confirmation via un lien envoyé à cette nouvelle adresse.</p>
        <div style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:12px 16px;margin-bottom:24px">
          <p style="color:#78350F;margin:0;font-size:13px"><strong>Ce n'est pas vous ?</strong> Changez votre mot de passe immédiatement en cliquant <a href="${resetUrl}" style="color:#78350F;text-decoration:underline">ici</a>, puis contactez-nous.</p>
        </div>
        <p style="color:#9CA3AF;font-size:12px">Ce message est purement informatif, aucune action n'est nécessaire de votre côté si vous êtes bien à l'origine de la demande.</p>
      </div>
    `,
    tracking: {
      scenarioKey: "EMAIL_CHANGE_NOTICE",
      userId,
    },
  });

  if (!result.sent && result.reason === "no_config") {
    logger.warn("[email-change] Configuration SMTP manquante (notice)");
  }
}
