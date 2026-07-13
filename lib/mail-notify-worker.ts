/**
 * lib/mail-notify-worker.ts
 *
 * Worker "notifications mails non lus". Tourne en fond dès le démarrage du
 * serveur (via instrumentation-node.ts). Pour chaque tenant actif :
 *  1. Lit sa config `mail_notify_*`
 *  2. Compte les mails non lus via IMAP sur sa boîte pro
 *  3. Envoie un mail de notification si l'intervalle est écoulé ET qu'il y a
 *     de nouveaux mails non lus (mode "each") ou au moins un non-lu (mode
 *     "interval").
 *  4. Persiste `mail_notify_last_sent_at` + `mail_notify_last_unread_count`.
 *
 * Le tick tourne toutes les 60s. La granularité minimale exposée à la
 * cliente est aussi la minute — les secondes sont interdites côté UI pour
 * éviter les bannissements Gmail/Outlook pour spam.
 */
import { ImapFlow } from "imapflow";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { decryptIfSensitive } from "@/lib/encryption";
import { tenantALS } from "@/lib/tenant-als";
import { logger } from "@/lib/logger";

export type MailNotifyUnit = "minute" | "hour" | "day";

interface TenantNotifyConfig {
  tenantId: string;
  shopName: string | null;
  notifyEmail: string;
  intervalMs: number;
  lastSentAt: number | null;
  lastUnreadCount: number;
  mode: "off" | "summary" | "forward";
  lastForwardedUid: number;
  imapHost: string;
  imapUser: string;
  imapPass: string;
}

const UNIT_MS: Record<MailNotifyUnit, number> = {
  minute: 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
};

const TICK_INTERVAL_MS = 60_000; // Vérification toutes les 60 s
const START_DELAY_MS = 15_000;   // Laisse au serveur le temps de démarrer
const WEBMAIL_URL = "https://mail.beliandjolie.com";

function parseImapHost(raw: string): { host: string; port: number } {
  const s = raw.replace(/^ssl:\/\//, "").replace(/^tls:\/\//, "");
  const idx = s.lastIndexOf(":");
  if (idx === -1) return { host: s, port: 993 };
  const host = s.slice(0, idx);
  const port = parseInt(s.slice(idx + 1), 10);
  return { host, port: Number.isFinite(port) ? port : 993 };
}

async function loadTenantConfig(tenantId: string): Promise<TenantNotifyConfig | null> {
  const keys = [
    "mail_notify_mode",
    "admin_personal_email",
    "mail_notify_interval_value",
    "mail_notify_interval_unit",
    "mail_notify_last_sent_at",
    "mail_notify_last_unread_count",
    "mail_notify_last_forwarded_uid",
    "smtp_host",
    "smtp_user",
    "smtp_password",
    "shop_name",
  ];
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: keys } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const rawMode = map.get("mail_notify_mode");
  const mode: "off" | "summary" | "forward" =
    rawMode === "summary" || rawMode === "forward" ? rawMode : "off";
  if (mode === "off") return null;

  const notifyEmail = (map.get("admin_personal_email") || "").trim();
  if (!notifyEmail) return null;

  const rawHost = decryptIfSensitive("smtp_host", map.get("smtp_host") || "").trim();
  const rawUser = decryptIfSensitive("smtp_user", map.get("smtp_user") || "").trim();
  const rawPass = decryptIfSensitive("smtp_password", map.get("smtp_password") || "").trim();
  if (!rawHost || !rawUser || !rawPass) return null;

  const rawValue = parseInt(map.get("mail_notify_interval_value") || "30", 10);
  const rawUnit = map.get("mail_notify_interval_unit");
  const unit: MailNotifyUnit =
    rawUnit === "minute" || rawUnit === "hour" || rawUnit === "day" ? rawUnit : "minute";
  const intervalMs =
    Math.max(1, Number.isFinite(rawValue) ? rawValue : 30) * UNIT_MS[unit];

  const parsedLastSent = parseInt(map.get("mail_notify_last_sent_at") || "0", 10);
  const parsedLastUnread = parseInt(map.get("mail_notify_last_unread_count") || "0", 10);
  const parsedLastForwardedUid = parseInt(map.get("mail_notify_last_forwarded_uid") || "0", 10);

  return {
    tenantId,
    shopName: map.get("shop_name") || null,
    notifyEmail,
    intervalMs,
    lastSentAt: Number.isFinite(parsedLastSent) && parsedLastSent > 0 ? parsedLastSent : null,
    lastUnreadCount: Number.isFinite(parsedLastUnread) ? parsedLastUnread : 0,
    mode,
    lastForwardedUid: Number.isFinite(parsedLastForwardedUid) ? parsedLastForwardedUid : 0,
    imapHost: rawHost,
    imapUser: rawUser,
    imapPass: rawPass,
  };
}

function makeClient(cfg: TenantNotifyConfig): ImapFlow {
  const { host, port } = parseImapHost(cfg.imapHost);
  return new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: cfg.imapUser, pass: cfg.imapPass },
    logger: false,
  });
}

async function countUnread(cfg: TenantNotifyConfig): Promise<number> {
  const client = makeClient(cfg);
  await client.connect();
  try {
    await client.mailboxOpen("INBOX", { readOnly: true });
    const uids = await client.search({ seen: false });
    return Array.isArray(uids) ? uids.length : 0;
  } finally {
    await client.logout().catch(() => {});
  }
}

interface MailForForward {
  uid: number;
  subject: string;
  from: string;
  source: Buffer;
}

/**
 * Récupère tous les mails d'UID > lastForwardedUid dans INBOX en mode read-only
 * (pour ne pas marquer comme lu). Retourne le source RFC822 complet pour
 * pouvoir le joindre au mail de forward en pièce jointe .eml.
 */
async function fetchNewMails(cfg: TenantNotifyConfig): Promise<MailForForward[]> {
  const client = makeClient(cfg);
  await client.connect();
  try {
    await client.mailboxOpen("INBOX", { readOnly: true });
    // Récupère toutes les nouvelles UIDs (> lastForwardedUid)
    const range = cfg.lastForwardedUid > 0
      ? `${cfg.lastForwardedUid + 1}:*`
      : "1:*";
    const uids = await client.search({ uid: range }, { uid: true });
    if (!Array.isArray(uids) || uids.length === 0) return [];
    // Sécurité : plafonne à 20 pour éviter un run explosif
    const toProcess = uids.filter((u) => u > cfg.lastForwardedUid).slice(0, 20);

    const results: MailForForward[] = [];
    for (const uid of toProcess) {
      const msg = await client.fetchOne(uid.toString(), { uid: true, envelope: true, source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const subject = msg.envelope?.subject || "(sans objet)";
      const fromArr = msg.envelope?.from || [];
      const from = fromArr.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ") || "(inconnu)";
      results.push({
        uid: msg.uid ?? uid,
        subject,
        from,
        source: msg.source,
      });
    }
    return results;
  } finally {
    await client.logout().catch(() => {});
  }
}

function buildNotificationHtml(p: {
  shopName: string | null;
  mailboxAddress: string;
  unreadCount: number;
}): string {
  const shop = p.shopName || "Votre boutique";
  const s = p.unreadCount > 1 ? "s" : "";
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;padding:16px;background:#F1F5F9">
      <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06)">
        <div style="padding:20px 24px;border-bottom:1px solid #E2E8F0">
          <div style="font-size:11px;color:#64748B;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${shop} · Boîte pro</div>
          <div style="font-size:18px;font-weight:700;color:#0F172A;margin-top:8px;line-height:1.3">
            ${p.unreadCount} mail${s} non lu${s} dans ${p.mailboxAddress}
          </div>
        </div>
        <div style="padding:28px 24px;font-size:14px;line-height:1.6;color:#334155">
          <p style="margin:0 0 16px">Bonjour,</p>
          <p style="margin:0 0 16px">
            Il y a actuellement <strong>${p.unreadCount}</strong> message${s} non lu${s} dans la boîte
            <strong>${p.mailboxAddress}</strong>.
          </p>
          <p style="margin:0 0 20px">Cliquez ci-dessous pour ouvrir votre messagerie et les consulter.</p>
          <a href="${WEBMAIL_URL}" style="display:inline-block;background:#0F172A;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">
            Ouvrir la messagerie
          </a>
        </div>
      </div>
      <p style="font-size:11px;color:#94A3B8;text-align:center;padding:12px 24px;margin:0">
        Vous recevez ce mail parce que vous avez activé les notifications dans les paramètres de ${shop}.
      </p>
    </div>
  `;
}

async function persistLastSent(tenantId: string, unread: number): Promise<void> {
  const now = Date.now();
  await Promise.all([
    prisma.siteConfig.upsert({
      where: { tenantId_key: { tenantId, key: "mail_notify_last_sent_at" } },
      update: { value: String(now) },
      create: { tenantId, key: "mail_notify_last_sent_at", value: String(now) },
    }),
    prisma.siteConfig.upsert({
      where: { tenantId_key: { tenantId, key: "mail_notify_last_unread_count" } },
      update: { value: String(unread) },
      create: { tenantId, key: "mail_notify_last_unread_count", value: String(unread) },
    }),
  ]);
}

async function updateLastUnreadOnly(tenantId: string, unread: number): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: "mail_notify_last_unread_count" } },
    update: { value: String(unread) },
    create: { tenantId, key: "mail_notify_last_unread_count", value: String(unread) },
  });
}

async function persistLastForwardedUid(tenantId: string, uid: number): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: "mail_notify_last_forwarded_uid" } },
    update: { value: String(uid) },
    create: { tenantId, key: "mail_notify_last_forwarded_uid", value: String(uid) },
  });
}

async function forwardMail(cfg: TenantNotifyConfig, mail: MailForForward): Promise<void> {
  const shop = cfg.shopName || "Votre boutique";
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;padding:16px;background:#F1F5F9">
      <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06)">
        <div style="padding:20px 24px;border-bottom:1px solid #E2E8F0">
          <div style="font-size:11px;color:#64748B;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${shop} · Boîte pro</div>
          <div style="font-size:16px;font-weight:700;color:#0F172A;margin-top:8px;line-height:1.3">
            Nouveau mail reçu dans ${cfg.imapUser}
          </div>
        </div>
        <div style="padding:20px 24px;font-size:13px;line-height:1.6;color:#334155">
          <p style="margin:0 0 6px"><strong>De :</strong> ${mail.from.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
          <p style="margin:0 0 6px"><strong>Objet :</strong> ${mail.subject.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
          <p style="margin:16px 0 6px;color:#64748B;font-size:12px">Le message original est joint (.eml) — ouvrez-le pour le consulter.</p>
        </div>
      </div>
    </div>
  `;
  const safeSubj = mail.subject.replace(/[\r\n]/g, " ").slice(0, 200);
  await tenantALS.run(cfg.tenantId, () =>
    sendMail({
      to: cfg.notifyEmail,
      subject: `[Fwd] ${safeSubj}`,
      html,
      attachments: [
        {
          filename: `mail-${mail.uid}.eml`,
          content: mail.source,
        },
      ],
    })
  );
}

async function sendNotification(cfg: TenantNotifyConfig, unread: number): Promise<void> {
  await tenantALS.run(cfg.tenantId, () =>
    sendMail({
      to: cfg.notifyEmail,
      subject: `📬 ${unread} mail${unread > 1 ? "s" : ""} non lu${unread > 1 ? "s" : ""} — ${cfg.shopName || "Votre boutique"}`,
      html: buildNotificationHtml({
        shopName: cfg.shopName,
        mailboxAddress: cfg.imapUser,
        unreadCount: unread,
      }),
    })
  );
}

/**
 * Traite un tenant : renvoie la décision + éventuellement envoie le mail.
 * `forceSend` court-circuite intervalle + comparaison unread pour un envoi
 * de test à la demande.
 */
export async function processTenantOnce(
  tenantId: string,
  opts?: { forceSend?: boolean }
): Promise<
  | { action: "notified"; unread: number }
  | { action: "forwarded-only"; forwarded: number }
  | { action: "skip"; reason: string; unread?: number }
  | { action: "error"; error: string }
> {
  try {
    const cfg = await loadTenantConfig(tenantId);
    if (!cfg) return { action: "skip", reason: "not-enabled" };

    // Mode "forward" : uniquement le transfert instantané.
    if (cfg.mode === "forward") {
      let forwardedCount = 0;
      try {
        const newMails = await fetchNewMails(cfg);
        // Si c'est la 1ʳᵉ activation (lastForwardedUid = 0), on ne rejoue pas
        // tout l'historique — on se contente d'enregistrer la borne max.
        if (cfg.lastForwardedUid === 0 && newMails.length > 0) {
          const maxUid = Math.max(...newMails.map((m) => m.uid));
          await persistLastForwardedUid(cfg.tenantId, maxUid);
          logger.info("[MailNotify] Forward initialisé", { tenantId, initialUid: maxUid });
        } else {
          for (const m of newMails) {
            try {
              await forwardMail(cfg, m);
              forwardedCount++;
              await persistLastForwardedUid(cfg.tenantId, m.uid);
            } catch (err) {
              logger.warn("[MailNotify] Forward échoué", { tenantId, uid: m.uid, error: err });
            }
          }
        }
      } catch (err) {
        logger.warn("[MailNotify] Fetch new mails échoué", { tenantId, error: err });
      }
      if (forwardedCount > 0) return { action: "forwarded-only", forwarded: forwardedCount };
      return { action: "skip", reason: "no-new-mails" };
    }

    // Mode "summary" : résumé périodique du nombre de non-lus.
    const now = Date.now();
    const elapsed = cfg.lastSentAt ? now - cfg.lastSentAt : Infinity;

    if (!opts?.forceSend && elapsed < cfg.intervalMs) {
      return {
        action: "skip",
        reason: `interval (${Math.round(elapsed / 1000)}s < ${cfg.intervalMs / 1000}s)`,
      };
    }

    const unread = await countUnread(cfg);
    if (!opts?.forceSend && unread === 0) {
      return { action: "skip", reason: "zero-unread" };
    }

    await sendNotification(cfg, unread);
    await persistLastSent(cfg.tenantId, unread);
    if (unread < cfg.lastUnreadCount) {
      await updateLastUnreadOnly(cfg.tenantId, unread);
    }
    return { action: "notified", unread };
  } catch (e) {
    return { action: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

async function tick(): Promise<void> {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const t of tenants) {
      const res = await processTenantOnce(t.id);
      if (res.action === "notified") {
        logger.info("[MailNotify] Notification envoyée", { tenantId: t.id, unread: res.unread });
      } else if (res.action === "forwarded-only") {
        logger.info("[MailNotify] Mails transférés", { tenantId: t.id, forwarded: res.forwarded });
      } else if (res.action === "error") {
        logger.warn("[MailNotify] Erreur tenant", { tenantId: t.id, error: res.error });
      }
    }
  } catch (err) {
    logger.error("[MailNotify] Tick global échoué", { error: err as Error });
  }
}

let started = false;
export function startMailNotifyWorker(): void {
  if (started) return;
  started = true;
  logger.info("[MailNotify] Worker démarré (tick 60s)");
  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, TICK_INTERVAL_MS);
  }, START_DELAY_MS);
}
