/**
 * lib/email.ts
 *
 * Envoi d'emails via nodemailer (SMTP).
 *
 * La configuration (hôte, port, TLS, identifiants, expéditeur) est lue
 * depuis les paramètres admin (SiteConfig) avec fallback sur les variables
 * d'environnement `SMTP_*`. Cela permet de brancher n'importe quel serveur
 * SMTP : Hostinger, Gmail, Resend SMTP, OVH, Mailjet, etc.
 *
 * Fire-and-forget : les erreurs sont loggées, jamais propagées aux callers.
 */

import fs from "fs/promises";
import path from "path";
import nodemailer, { type Transporter } from "nodemailer";
import { getCachedSmtpConfig } from "@/lib/cached-data";
import { logger } from "@/lib/logger";

export interface MailAttachment {
  filename: string;
  /** Chemin absolu ou relatif au process.cwd(). Ignoré si `content` fourni. */
  path?: string;
  /** Contenu direct (Buffer ou string base64). Priorité sur `path`. */
  content?: Buffer | string;
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
  const cfg = await getCachedSmtpConfig();

  const host = cfg.host || process.env.SMTP_HOST || null;
  const rawPort = cfg.port ?? process.env.SMTP_PORT ?? null;
  const port = parsePort(rawPort);
  const secureRaw = cfg.secure ?? process.env.SMTP_SECURE ?? null;
  const user = cfg.user || process.env.SMTP_USER || null;
  const password = cfg.password || process.env.SMTP_PASSWORD || null;

  const fromEmail =
    cfg.fromEmail || process.env.SMTP_FROM_EMAIL || user || null;
  const fromName = cfg.fromName || process.env.SMTP_FROM_NAME || null;

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
 * Envoie un email via SMTP (nodemailer).
 *
 * - Pas de config complète → `{ sent: false, reason: "no_config" }`.
 * - Pas d'adresse expéditeur → `{ sent: false, reason: "no_from" }`.
 * - Échec SMTP → log + `{ sent: false, reason: "smtp_error" }`.
 * - Succès → `{ sent: true, id }` (messageId renvoyé par nodemailer).
 */
export async function sendMail(
  params: SendMailParams
): Promise<SendMailResult> {
  const { connection, fromEmail: cfgFromEmail, fromName: cfgFromName } =
    await resolveSmtpConfig();

  if (!connection) {
    logger.warn("[email] Configuration SMTP incomplète — email ignoré.");
    return { sent: false, reason: "no_config" };
  }

  const fromEmail = params.fromEmail?.trim() || cfgFromEmail;
  if (!fromEmail) {
    logger.warn("[email] Aucune adresse expéditeur configurée — email ignoré.");
    return { sent: false, reason: "no_from" };
  }

  const fromName = params.fromName?.trim() || cfgFromName || undefined;
  const attachments = await buildAttachments(params.attachments);

  try {
    const transporter = buildTransporter(connection);
    const info = await transporter.sendMail({
      from: formatFrom(fromName, fromEmail),
      to: Array.isArray(params.to) ? params.to.join(", ") : params.to,
      subject: params.subject,
      html: params.html,
      replyTo: params.replyTo,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    return { sent: true, id: info.messageId || "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[email] Échec envoi SMTP", {
      error: msg,
      to: params.to,
      subject: params.subject,
    });
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
