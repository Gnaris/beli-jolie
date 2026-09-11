/**
 * lib/email.ts
 *
 * Envoi d'emails via nodemailer (SMTP).
 *
 * La configuration (hôte, port, TLS, identifiants, expéditeur) est lue
 * depuis les variables d'environnement `SMTP_*`. Le nom d'expéditeur par
 * défaut est repris du nom de boutique configuré en admin (CompanyInfo).
 *
 * Fire-and-forget : les erreurs sont loggées, jamais propagées aux callers.
 */

import fs from "fs/promises";
import path from "path";
import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "@/lib/logger";
import { getCachedShopName } from "@/lib/cached-data";
import type { EmailScenarioKey } from "@/lib/email-scenarios";

export interface MailAttachment {
  filename: string;
  /** Chemin absolu ou relatif au process.cwd(). Ignoré si `content` fourni. */
  path?: string;
  /** Contenu direct (Buffer ou string base64). Priorité sur `path`. */
  content?: Buffer | string;
}

/**
 * Métadonnées de traçage d'un envoi. Si présent, `sendMail` écrit un
 * enregistrement `EmailSend` en BDD (SENT ou FAILED). Sans `tracking`, aucun
 * log BDD n'est créé — utilisé pour les mails admin internes (login notify,
 * paiement orphelin, etc.) qu'on ne veut pas afficher dans le journal client.
 */
export interface SendMailTracking {
  scenarioKey: EmailScenarioKey;
  /** ID du client destinataire. Absent = mail lié à un email sans compte. */
  userId?: string | null;
  /** Info contextuelle stockée en JSON (ex. orderId, claimId, templateId). */
  metadata?: Record<string, unknown>;
  /** Nombre de tentatives (défaut 1). Utilisé pour les renvois. */
  attempts?: number;
  /** ID d'un précédent EmailSend dont celui-ci est le renvoi. */
  resendOfId?: string;
}

export interface SendMailParams {
  to: string | string[];
  subject: string;
  html: string;
  /** Nom d'affichage (ex. "Beli Jolie"). Défaut : config admin. */
  fromName?: string;
  /** Adresse expéditeur. Défaut : config admin (smtp_from_email). */
  fromEmail?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
  /** Si fourni, log l'envoi dans EmailSend (succès ou échec). */
  tracking?: SendMailTracking;
  /**
   * URL de désinscription 1-clic. Si fournie, on pose les en-têtes
   * `List-Unsubscribe` et `List-Unsubscribe-Post` (RFC 8058) — Gmail/Outlook
   * exigent ces headers pour maintenir la réputation d'un expéditeur de mails
   * marketing. Doit être une URL HTTPS absolue.
   */
  listUnsubscribeUrl?: string;
}

export type SendMailResult =
  | { sent: true; id: string }
  | {
      sent: false;
      reason: "no_config" | "no_from" | "smtp_error";
      error?: string;
    };

export interface SmtpConnectionConfig {
  host: string;
  port: number;
  /** true = TLS implicite (port 465), false = STARTTLS (port 587). */
  secure: boolean;
  user: string;
  password: string;
}

export interface SmtpValidationInput {
  host: string;
  port: number | string;
  secure: boolean;
  user: string;
  password: string;
  /** Si renseigné, envoie aussi un vrai email de test à cette adresse. */
  testTo?: string;
  /** Adresse expéditeur utilisée pour le test. Défaut = `user`. */
  fromEmail?: string;
  /** Nom affiché pour le test. */
  fromName?: string;
}

interface NodemailerAttachment {
  filename: string;
  content: Buffer;
}

/**
 * Pour les tests : permet d'injecter une fabrique de transporter (mock).
 * Non utilisé en prod.
 */
let transporterFactoryOverride:
  | ((cfg: SmtpConnectionConfig) => Transporter)
  | null = null;

export function __setTransporterFactoryForTests(
  factory: ((cfg: SmtpConnectionConfig) => Transporter) | null
): void {
  transporterFactoryOverride = factory;
}

function buildTransporter(cfg: SmtpConnectionConfig): Transporter {
  if (transporterFactoryOverride) return transporterFactoryOverride(cfg);
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
  });
}

async function buildAttachments(
  attachments: MailAttachment[] | undefined
): Promise<NodemailerAttachment[]> {
  if (!attachments || attachments.length === 0) return [];
  const out: NodemailerAttachment[] = [];
  for (const att of attachments) {
    let buf: Buffer;
    if (att.content !== undefined) {
      buf =
        typeof att.content === "string"
          ? Buffer.from(att.content, "base64")
          : att.content;
    } else if (att.path) {
      const absPath = path.isAbsolute(att.path)
        ? att.path
        : path.join(process.cwd(), att.path);
      buf = await fs.readFile(absPath);
    } else {
      logger.warn("[email] Pièce jointe ignorée — ni content ni path", {
        filename: att.filename,
      });
      continue;
    }
    out.push({ filename: att.filename, content: buf });
  }
  return out;
}

function formatFrom(name: string | undefined, email: string): string {
  const trimmedName = name?.trim();
  if (!trimmedName) return email;
  const safe = trimmedName.replace(/["<>]/g, "");
  return `${safe} <${email}>`;
}

function parsePort(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return null;
  return n;
}

function parseSecure(
  raw: string | null | undefined,
  port: number | null
): boolean {
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  // Défaut : 465 = TLS implicite (secure=true), autres = STARTTLS (secure=false).
  return port === 465;
}

async function resolveSmtpConfig(): Promise<{
  connection: SmtpConnectionConfig | null;
  fromEmail: string | null;
  fromName: string | null;
}> {
  // Lit d'abord SiteConfig (BDD chiffrée), fallback env.
  const { prisma } = await import("@/lib/prisma");
  const { decryptIfSensitive } = await import("@/lib/encryption");

  const DB_KEYS = [
    "smtp_host",
    "smtp_port",
    "smtp_secure",
    "smtp_user",
    "smtp_password",
    "smtp_from_email",
    "smtp_from_name",
  ] as const;

  let dbMap = new Map<string, string>();
  try {
    // Résout tenantId (ALS + fallback headers) pour scoper explicitement.
    // Sans ça, findMany peut fuiter les rows du tenant voisin et le décrypt
    // échoue si l'autre tenant a été chiffré avec une autre ENCRYPTION_KEY.
    let tid: string | null = null;
    try {
      const { getCurrentTenantIdSync } = await import("@/lib/tenant-als");
      tid = getCurrentTenantIdSync();
      if (!tid) {
        const { headers } = await import("next/headers");
        const h = await headers();
        tid = h.get("x-tenant-id");
      }
    } catch { /* hors requête */ }

    const rows = await prisma.siteConfig.findMany({
      where: tid
        ? { tenantId: tid, key: { in: [...DB_KEYS] } }
        : { key: { in: [...DB_KEYS] } },
    });
    dbMap = new Map(
      rows
        .filter((r) => r.value?.trim())
        .map((r) => [r.key, decryptIfSensitive(r.key, r.value).trim()]),
    );
  } catch {
    // BDD indisponible → fallback env pur.
  }

  const pick = (dbKey: string, envKey: string): string | null =>
    dbMap.get(dbKey) || process.env[envKey]?.trim() || null;

  const host = pick("smtp_host", "SMTP_HOST");
  const port = parsePort(pick("smtp_port", "SMTP_PORT"));
  const secureRaw = pick("smtp_secure", "SMTP_SECURE");
  const user = pick("smtp_user", "SMTP_USER");
  const password = pick("smtp_password", "SMTP_PASSWORD");
  const fromEmail = pick("smtp_from_email", "SMTP_FROM_EMAIL") || user;
  const fromName = pick("smtp_from_name", "SMTP_FROM_NAME");

  if (!host || !port || !user || !password) {
    return { connection: null, fromEmail, fromName };
  }

  return {
    connection: {
      host,
      port,
      secure: parseSecure(secureRaw, port),
      user,
      password,
    },
    fromEmail,
    fromName,
  };
}

/**
 * État détaillé pour l'UI admin.
 */
export async function getSmtpConfigStatus(): Promise<{
  hasHost: boolean;
  hasPort: boolean;
  hasUser: boolean;
  hasPassword: boolean;
  hasFromEmail: boolean;
  ready: boolean;
  host: string | null;
  port: string | null;
  user: string | null;
  fromEmail: string | null;
  fromName: string | null;
  source: "database" | "env" | "none";
}> {
  const { connection, fromEmail, fromName } = await resolveSmtpConfig();
  // Source
  let source: "database" | "env" | "none" = "none";
  try {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["smtp_host", "smtp_user", "smtp_password"] } },
      select: { key: true },
    });
    if (rows.length > 0) source = "database";
    else if (connection || process.env.SMTP_HOST) source = "env";
  } catch {
    if (connection || process.env.SMTP_HOST) source = "env";
  }
  return {
    hasHost: !!connection?.host,
    hasPort: !!connection?.port,
    hasUser: !!connection?.user,
    hasPassword: !!connection?.password,
    hasFromEmail: !!fromEmail,
    ready: !!connection,
    host: connection?.host ?? null,
    port: connection?.port ? String(connection.port) : null,
    user: connection?.user ?? null,
    fromEmail: fromEmail,
    fromName: fromName,
    source,
  };
}

/**
 * Écrit un log d'envoi dans EmailSend. Best-effort : n'échoue jamais
 * (les erreurs sont loggées mais pas propagées, on ne veut pas casser
 * un envoi de mail parce que la trace n'a pas pu s'écrire).
 */
async function persistEmailLog(input: {
  tracking: SendMailTracking;
  to: string;
  subject: string;
  html: string;
  fromEmail: string | null;
  fromName: string | null;
  status: "SENT" | "FAILED";
  messageId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const { getCurrentTenantIdSync } = await import("@/lib/tenant-als");

    let tenantId = getCurrentTenantIdSync();
    if (!tenantId) {
      try {
        const { headers } = await import("next/headers");
        const h = await headers();
        tenantId = h.get("x-tenant-id");
      } catch { /* hors requête */ }
    }
    if (!tenantId) {
      logger.warn("[email] Trace journal ignorée — tenant non résolu", {
        scenarioKey: input.tracking.scenarioKey,
        to: input.to,
      });
      return;
    }

    // Le HTML d'un mail réussi n'est pas stocké : la cliente reçoit le mail
    // sur sa boîte pro (forwardée sur son Gmail perso) et retrouve le
    // contenu réel côté messagerie. On garde uniquement le HTML des envois
    // FAILED — utile pour comprendre l'échec + permettre le bouton
    // « Renvoyer » du journal admin. Gros gain de stockage : ~50 Ko par
    // mail réussi × 1000 mails/mois × 2 ans = ~1,2 Go économisés par tenant.
    const shouldKeepHtml = input.status === "FAILED";
    await prisma.emailSend.create({
      data: {
        tenantId,
        userId: input.tracking.userId ?? null,
        recipientEmail: input.to.slice(0, 320),
        fromEmail: input.fromEmail?.slice(0, 320) ?? null,
        fromName: input.fromName?.slice(0, 200) ?? null,
        scenarioKey: input.tracking.scenarioKey,
        subject: input.subject.slice(0, 500),
        htmlBody: shouldKeepHtml ? input.html : null,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        messageId: input.messageId?.slice(0, 500) ?? null,
        attempts: input.tracking.attempts ?? 1,
        resendOfId: input.tracking.resendOfId ?? null,
        metadata: input.tracking.metadata
          ? (input.tracking.metadata as object)
          : undefined,
      },
    });
  } catch (err) {
    logger.error("[email] Écriture journal EmailSend échouée", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Envoie un email via SMTP (nodemailer).
 *
 * - Pas de config complète → `{ sent: false, reason: "no_config" }`.
 * - Pas d'adresse expéditeur → `{ sent: false, reason: "no_from" }`.
 * - Échec SMTP → log + `{ sent: false, reason: "smtp_error" }`.
 * - Succès → `{ sent: true, id }` (messageId renvoyé par nodemailer).
 *
 * Si `params.tracking` est fourni, chaque envoi (succès OU échec, y compris
 * config manquante) est enregistré dans `EmailSend` pour affichage dans le
 * journal client. Les mails admin internes ne passent pas `tracking`.
 */
export async function sendMail(
  params: SendMailParams
): Promise<SendMailResult> {
  const { connection, fromEmail: cfgFromEmail, fromName: cfgFromName } =
    await resolveSmtpConfig();

  const toString = Array.isArray(params.to) ? params.to.join(", ") : params.to;

  if (!connection) {
    logger.warn("[email] Configuration SMTP incomplète — email ignoré.");
    if (params.tracking) {
      await persistEmailLog({
        tracking: params.tracking,
        to: toString,
        subject: params.subject,
        html: params.html,
        fromEmail: params.fromEmail?.trim() || cfgFromEmail || null,
        fromName: params.fromName?.trim() || cfgFromName || null,
        status: "FAILED",
        errorMessage: "Configuration SMTP absente (aucun serveur d'envoi configuré).",
      });
    }
    return { sent: false, reason: "no_config" };
  }

  const fromEmail = params.fromEmail?.trim() || cfgFromEmail;
  if (!fromEmail) {
    logger.warn("[email] Aucune adresse expéditeur configurée — email ignoré.");
    if (params.tracking) {
      await persistEmailLog({
        tracking: params.tracking,
        to: toString,
        subject: params.subject,
        html: params.html,
        fromEmail: null,
        fromName: params.fromName?.trim() || cfgFromName || null,
        status: "FAILED",
        errorMessage: "Aucune adresse expéditeur configurée.",
      });
    }
    return { sent: false, reason: "no_from" };
  }

  let fromName = params.fromName?.trim() || cfgFromName || undefined;
  if (!fromName) {
    try {
      const shopName = (await getCachedShopName()).trim();
      fromName = shopName || undefined;
    } catch {
      fromName = undefined;
    }
  }
  const attachments = await buildAttachments(params.attachments);

  const listUnsubscribeUrl = params.listUnsubscribeUrl?.trim();
  const extraHeaders: Record<string, string> = {};
  if (listUnsubscribeUrl) {
    const isHttps = /^https?:\/\//i.test(listUnsubscribeUrl);
    const isMailto = /^mailto:/i.test(listUnsubscribeUrl);
    if (isHttps || isMailto) {
      extraHeaders["List-Unsubscribe"] = `<${listUnsubscribeUrl}>`;
      // List-Unsubscribe-Post (RFC 8058) n'a de sens qu'en HTTPS —
      // Gmail/Outlook postent en 1 clic à l'URL avec ce header. Pour un
      // mailto:, on ne pose que l'en-tête historique RFC 2369.
      if (isHttps) {
        extraHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      }
    }
  }

  try {
    const transporter = buildTransporter(connection);
    const info = await transporter.sendMail({
      from: formatFrom(fromName, fromEmail),
      to: toString,
      subject: params.subject,
      html: params.html,
      replyTo: params.replyTo,
      attachments: attachments.length > 0 ? attachments : undefined,
      headers: Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
    });
    if (params.tracking) {
      await persistEmailLog({
        tracking: params.tracking,
        to: toString,
        subject: params.subject,
        html: params.html,
        fromEmail,
        fromName: fromName ?? null,
        status: "SENT",
        messageId: info.messageId || null,
      });
    }
    return { sent: true, id: info.messageId || "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[email] Échec envoi SMTP", {
      error: msg,
      to: params.to,
      subject: params.subject,
    });
    if (params.tracking) {
      await persistEmailLog({
        tracking: params.tracking,
        to: toString,
        subject: params.subject,
        html: params.html,
        fromEmail,
        fromName: fromName ?? null,
        status: "FAILED",
        errorMessage: msg,
      });
    }
    return { sent: false, reason: "smtp_error", error: msg };
  }
}

/**
 * Teste une configuration SMTP :
 *   1. `transporter.verify()` — vérifie la connexion et l'authentification.
 *   2. Si `testTo` est fourni, envoie un vrai email de test à cette adresse
 *      (typiquement la boîte de l'admin pour vérifier de bout en bout).
 */
export async function validateSmtpConfig(
  input: SmtpValidationInput
): Promise<{ valid: boolean; error?: string; testMessageId?: string }> {
  const host = input.host?.trim();
  const user = input.user?.trim();
  const password = input.password;
  const port = parsePort(input.port);

  if (!host) return { valid: false, error: "Serveur SMTP requis." };
  if (!port) return { valid: false, error: "Port SMTP invalide (1-65535)." };
  if (!user) return { valid: false, error: "Identifiant requis." };
  if (!password) return { valid: false, error: "Mot de passe requis." };

  try {
    const transporter = buildTransporter({
      host,
      port,
      secure: input.secure,
      user,
      password,
    });
    await transporter.verify();

    const testTo = input.testTo?.trim();
    if (!testTo) return { valid: true };

    const fromEmail = input.fromEmail?.trim() || user;
    const info = await transporter.sendMail({
      from: formatFrom(input.fromName, fromEmail),
      to: testTo,
      subject: "Test de connexion SMTP — votre boutique",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="color:#1A1A1A;">Connexion SMTP réussie ✅</h2>
          <p>Ceci est un email de test envoyé depuis votre boutique pour vérifier
          la configuration SMTP.</p>
          <p>Si vous recevez ce message, votre site peut désormais envoyer
          des emails (confirmations de commande, mots de passe oubliés, etc.).</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
          <p style="color:#6b7280;font-size:12px;">
            Serveur : <strong>${host}:${port}</strong> ·
            Envoyé le ${new Date().toLocaleString("fr-FR")}
          </p>
        </div>
      `,
    });

    return { valid: true, testMessageId: info.messageId || "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue.";
    return { valid: false, error: msg };
  }
}
