import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { getCachedShopName } from "@/lib/cached-data";
import { logger } from "@/lib/logger";

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

    const result = await sendMail({
      fromName: shopName,
      to: personalEmail,
      subject: `🔐 Nouvelle connexion admin — ${shopName}`,
      html: buildAdminLoginNotifyHtml({
        shopName,
        adminEmail: input.adminEmail,
        ip: input.ip,
        browser,
        when,
      }),
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

function buildAdminLoginNotifyHtml(p: {
  shopName: string;
  adminEmail: string;
  ip: string;
  browser: string;
  when: string;
}): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;background:#F1F5F9;padding:16px">
      <div style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06)">
        <div style="background:#EEF2FF;padding:20px 24px;border-bottom:1px solid #C7D2FE">
          <div style="font-size:11px;color:#4338CA;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${escapeHtml(p.shopName)} · Sécurité</div>
          <div style="font-size:18px;font-weight:700;color:#0F172A;margin-top:8px;line-height:1.3">🔐 Nouvelle connexion admin</div>
        </div>
        <div style="padding:28px 24px">
          <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 16px">
            Une connexion vient d'être effectuée sur l'espace admin de <strong>${escapeHtml(p.shopName)}</strong>.
          </p>
          <table style="width:100%;font-size:14px;color:#334155;border-collapse:collapse;margin:8px 0 20px">
            <tr><td style="padding:6px 0;color:#64748B;width:130px">Compte&nbsp;:</td><td style="padding:6px 0"><strong>${escapeHtml(p.adminEmail)}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#64748B">Date&nbsp;:</td><td style="padding:6px 0">${escapeHtml(p.when)} (heure de Paris)</td></tr>
            <tr><td style="padding:6px 0;color:#64748B">Adresse IP&nbsp;:</td><td style="padding:6px 0">${escapeHtml(p.ip)}</td></tr>
            <tr><td style="padding:6px 0;color:#64748B">Navigateur&nbsp;:</td><td style="padding:6px 0">${escapeHtml(p.browser)}</td></tr>
          </table>
          <div style="background:#FFFBEB;border:1px solid #FED7AA;border-radius:10px;padding:14px 16px;margin:20px 0">
            <div style="font-size:13px;color:#78350F;line-height:1.5">
              <strong>⚠️ Ce n'était pas vous&nbsp;?</strong><br />
              Changez immédiatement votre mot de passe admin depuis les paramètres et vérifiez qu'aucune commande ou modification suspecte n'a été passée.
            </div>
          </div>
          <p style="font-size:11px;color:#94A3B8;margin:16px 0 0">
            Cet e-mail est envoyé automatiquement à chaque connexion réussie sur votre compte admin.
          </p>
        </div>
      </div>
      <p style="font-size:11px;color:#94A3B8;text-align:center;padding:12px 24px;margin:0">
        ${escapeHtml(p.shopName)} — Notification de sécurité automatique
      </p>
    </div>
  `;
}
