import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { renderTransactionalEmail } from "@/lib/transactional-email-render";

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

  const rendered = await renderTransactionalEmail({
    scenarioKey: "EMAIL_CHANGE_CONFIRM",
    vars: { confirmUrl, newEmail, shopName },
  });

  const result = await sendMail({
    fromName: shopName,
    to: newEmail,
    subject: rendered.subject,
    html: rendered.html,
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

  const rendered = await renderTransactionalEmail({
    scenarioKey: "EMAIL_CHANGE_NOTICE",
    vars: { newEmail, resetUrl, shopName },
  });

  const result = await sendMail({
    fromName: shopName,
    to: oldEmail,
    subject: rendered.subject,
    html: rendered.html,
    tracking: {
      scenarioKey: "EMAIL_CHANGE_NOTICE",
      userId,
    },
  });

  if (!result.sent && result.reason === "no_config") {
    logger.warn("[email-change] Configuration SMTP manquante (notice)");
  }
}
