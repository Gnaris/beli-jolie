import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { getCachedShopName } from "@/lib/cached-data";
import { logger } from "@/lib/logger";
import { renderTransactionalEmail } from "@/lib/transactional-email-render";

export function parseUserAgent(ua: string | null | undefined): string {
  const raw = (ua ?? "").trim();
  if (!raw || raw === "inconnu") return "inconnu";

  const os =
    /Windows NT/i.test(raw) ? "Windows"
    : /iPhone|iPad|iPod/i.test(raw) ? (raw.includes("iPhone") ? "iPhone" : raw.includes("iPad") ? "iPad" : "iPod")
    : /Android/i.test(raw) ? "Android"
    : /Mac OS X/i.test(raw) ? "macOS"
    : /Linux/i.test(raw) ? "Linux"
    : null;

  const browser =
    /Edg\//i.test(raw) ? "Edge"
    : /OPR\/|Opera/i.test(raw) ? "Opera"
    : /Firefox\//i.test(raw) ? "Firefox"
    : /Chrome\//i.test(raw) && !/Edg\//i.test(raw) ? "Chrome"
    : /Safari\//i.test(raw) && !/Chrome\//i.test(raw) ? "Safari"
    : null;

  if (browser && os) return `${browser} sur ${os}`;
  return raw.slice(0, 100);
}

interface AdminLoginNotifyInput {
  tenantId: string;
  adminEmail: string;
  ip: string;
  userAgent: string;
}

const KEY_PERSONAL_EMAIL = "admin_personal_email";

export async function sendAdminLoginNotification(
  input: AdminLoginNotifyInput
): Promise<void> {
  try {
    const row = await prisma.siteConfig.findFirst({
      where: { key: KEY_PERSONAL_EMAIL },
      select: { value: true },
    });
    const personalEmail = (row?.value ?? "").trim();
    if (!personalEmail) {
      logger.info("[admin-login-notify] skip: pas de mail perso", {
        tenantId: input.tenantId,
      });
      return;
    }

    const shopName = await getCachedShopName();
    const browser = parseUserAgent(input.userAgent);
    const when = new Date().toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
      dateStyle: "full",
      timeStyle: "short",
    });

    const rendered = await renderTransactionalEmail({
      scenarioKey: "ADMIN_LOGIN_NOTIFICATION",
      vars: {
        shopName: escapeHtml(shopName),
        adminEmail: escapeHtml(input.adminEmail),
        ip: escapeHtml(input.ip),
        browser: escapeHtml(browser),
        when: escapeHtml(when),
      },
    });
    const result = await sendMail({
      fromName: shopName,
      to: personalEmail,
      subject: rendered.subject,
      html: rendered.html,
    });

    if (!result.sent) {
      logger.warn("[admin-login-notify] échec envoi", {
        reason: result.reason,
        error: "error" in result ? result.error : undefined,
      });
    }
  } catch (error) {
    logger.warn("[admin-login-notify] exception", { error });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
