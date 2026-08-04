/**
 * lib/mail-notify-worker.ts
 *
 * Worker « transfert instantané » de la boîte pro vers l'adresse perso
 * vérifiée de l'admin. Tourne en fond dès le démarrage du serveur (via
 * instrumentation-node.ts), tick toutes les 60 s :
 *   1. Liste les tenants actifs
 *   2. Pour chacun, si une adresse perso est vérifiée + SMTP configuré,
 *      relit INBOX (IMAP read-only) et transfère les mails d'UID >
 *      `mail_notify_last_forwarded_uid` vers l'adresse perso.
 *   3. Persiste le dernier UID transféré pour ne rien renvoyer 2 fois.
 *
 * Historique : la version précédente exposait 3 modes (off/summary/forward)
 * via l'admin. On a supprimé le choix : dès qu'une adresse perso est
 * vérifiée, le transfert est activé automatiquement.
 */
import { ImapFlow } from "imapflow";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { decryptIfSensitive } from "@/lib/encryption";
import { tenantALS } from "@/lib/tenant-als";
import { logger } from "@/lib/logger";

interface TenantForwardConfig {
  tenantId: string;
  shopName: string | null;
  notifyEmail: string;
  lastForwardedUid: number;
  imapHost: string;
  imapUser: string;
  imapPass: string;
}

const TICK_INTERVAL_MS = 60_000;
const START_DELAY_MS = 15_000;

function parseImapHost(raw: string): { host: string; port: number } {
  const s = raw.replace(/^ssl:\/\//, "").replace(/^tls:\/\//, "");
  const idx = s.lastIndexOf(":");
  if (idx === -1) return { host: s, port: 993 };
  const host = s.slice(0, idx);
  const port = parseInt(s.slice(idx + 1), 10);
  return { host, port: Number.isFinite(port) ? port : 993 };
}

async function loadTenantConfig(tenantId: string): Promise<TenantForwardConfig | null> {
  const keys = [
    "admin_personal_email",
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

  const notifyEmail = (map.get("admin_personal_email") || "").trim();
  if (!notifyEmail) return null;

  const rawHost = decryptIfSensitive("smtp_host", map.get("smtp_host") || "").trim();
  const rawUser = decryptIfSensitive("smtp_user", map.get("smtp_user") || "").trim();
  const rawPass = decryptIfSensitive("smtp_password", map.get("smtp_password") || "").trim();
  if (!rawHost || !rawUser || !rawPass) return null;

  const parsedLastForwardedUid = parseInt(map.get("mail_notify_last_forwarded_uid") || "0", 10);

  return {
    tenantId,
    shopName: map.get("shop_name") || null,
    notifyEmail,
    lastForwardedUid: Number.isFinite(parsedLastForwardedUid) ? parsedLastForwardedUid : 0,
    imapHost: rawHost,
    imapUser: rawUser,
    imapPass: rawPass,
  };
}

function makeClient(cfg: TenantForwardConfig): ImapFlow {
  const { host, port } = parseImapHost(cfg.imapHost);
  return new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: cfg.imapUser, pass: cfg.imapPass },
    logger: false,
  });
}

interface MailForForward {
  uid: number;
  subject: string;
  from: string;
  source: Buffer;
}

async function fetchNewMails(cfg: TenantForwardConfig): Promise<MailForForward[]> {
  const client = makeClient(cfg);
  await client.connect();
  try {
    await client.mailboxOpen("INBOX", { readOnly: true });
    const range = cfg.lastForwardedUid > 0 ? `${cfg.lastForwardedUid + 1}:*` : "1:*";
    const uids = await client.search({ uid: range }, { uid: true });
    if (!Array.isArray(uids) || uids.length === 0) return [];
    // Plafond de sécurité pour éviter un run explosif
    const toProcess = uids.filter((u) => u > cfg.lastForwardedUid).slice(0, 20);

    const results: MailForForward[] = [];
    for (const uid of toProcess) {
      const msg = await client.fetchOne(
        uid.toString(),
        { uid: true, envelope: true, source: true },
        { uid: true }
      );
      if (!msg || !msg.source) continue;
      const subject = msg.envelope?.subject || "(sans objet)";
      const fromArr = msg.envelope?.from || [];
      const from =
        fromArr.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ") ||
        "(inconnu)";
      results.push({ uid: msg.uid ?? uid, subject, from, source: msg.source });
    }
    return results;
  } finally {
    await client.logout().catch(() => {});
  }
}

async function persistLastForwardedUid(tenantId: string, uid: number): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: "mail_notify_last_forwarded_uid" } },
    update: { value: String(uid) },
    create: { tenantId, key: "mail_notify_last_forwarded_uid", value: String(uid) },
  });
}

async function forwardMail(cfg: TenantForwardConfig, mail: MailForForward): Promise<void> {
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
      attachments: [{ filename: `mail-${mail.uid}.eml`, content: mail.source }],
    })
  );
}

/**
 * Traite un tenant : transfère les nouveaux mails depuis la boîte pro vers
 * l'adresse perso vérifiée. `forceSend` envoie un mail de test bidon
 * immédiatement (pour le bouton « Envoyer un test »).
 */
export async function processTenantOnce(
  tenantId: string,
  opts?: { forceSend?: boolean }
): Promise<
  | { action: "forwarded"; forwarded: number }
  | { action: "test-sent" }
  | { action: "skip"; reason: string }
  | { action: "error"; error: string }
> {
  try {
    const cfg = await loadTenantConfig(tenantId);
    if (!cfg) return { action: "skip", reason: "not-configured" };

    if (opts?.forceSend) {
      await tenantALS.run(cfg.tenantId, () =>
        sendMail({
          to: cfg.notifyEmail,
          subject: `[Test] Transfert de ${cfg.imapUser} vers ${cfg.notifyEmail}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#111">
              <h2 style="margin:0 0 12px;font-size:18px">Le transfert fonctionne 🎉</h2>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.6">
                Ce mail confirme que les nouveaux messages reçus sur
                <strong>${cfg.imapUser}</strong> seront bien retransférés
                automatiquement vers <strong>${cfg.notifyEmail}</strong>.
              </p>
              <p style="margin:16px 0 0;font-size:12px;color:#64748B">
                Vous pouvez maintenant configurer Gmail pour répondre en tant
                que ${cfg.imapUser} — voir le tutoriel dans les paramètres.
              </p>
            </div>
          `,
        })
      );
      return { action: "test-sent" };
    }

    let forwardedCount = 0;
    try {
      const newMails = await fetchNewMails(cfg);
      if (cfg.lastForwardedUid === 0 && newMails.length > 0) {
        // 1ʳᵉ activation : on ne rejoue pas tout l'historique, on borne au max.
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

    if (forwardedCount > 0) return { action: "forwarded", forwarded: forwardedCount };
    return { action: "skip", reason: "no-new-mails" };
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
      if (res.action === "forwarded") {
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
