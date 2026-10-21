import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { renderTransactionalEmail } from "@/lib/transactional-email-render";

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createPasswordResetToken(email: string): Promise<string> {
  // Invalider les anciens tokens
  await prisma.passwordResetToken.updateMany({
    where: { email, used: false },
    data: { used: true },
  });
  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
  await prisma.passwordResetToken.create({
    data: { email, token, expiresAt },
  });
  return token;
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const shopName = await getCachedShopName();
  const baseUrl = await getCurrentTenantBaseUrl();
  const resetUrl = `${baseUrl}/reinitialiser-mot-de-passe?token=${token}`;

  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim() },
    select: { id: true },
  });

  const rendered = await renderTransactionalEmail({
    scenarioKey: "PASSWORD_RESET",
    vars: { resetUrl, shopName },
  });

  const result = await sendMail({
    fromName: shopName,
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    tracking: {
      scenarioKey: "PASSWORD_RESET",
      userId: user?.id ?? null,
    },
  });

  if (!result.sent && result.reason === "no_config") {
    logger.warn("[password-reset] Configuration SMTP manquante");
  }
}
