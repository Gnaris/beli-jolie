/**
 * lib/email.ts
 *
 * Envoi d'emails via l'API HTTP Resend (https://resend.com).
 * Remplace nodemailer/Gmail : chaque déploiement configure sa propre clé Resend
 * + son adresse expéditeur dans les paramètres admin.
 *
 * Fire-and-forget : les erreurs sont loggées, jamais propagées aux callers.
 */

import fs from "fs/promises";
import path from "path";
import { getCachedResendConfig } from "@/lib/cached-data";
import { logger } from "@/lib/logger";

const RESEND_API_URL = "https://api.resend.com/emails";

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
  /** Adresse expéditeur. Défaut : config admin (resend_from_email). */
  fromEmail?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
}

export type SendMailResult =
  | { sent: true; id: string }
  | { sent: false; reason: "no_config" | "no_from" | "api_error"; error?: string };

interface ResendAttachment {
  filename: string;
  content: string; // base64
}

async function buildResendAttachments(
  attachments: MailAttachment[] | undefined
): Promise<ResendAttachment[]> {
  if (!attachments || attachments.length === 0) return [];
  const out: ResendAttachment[] = [];
  for (const att of attachments) {
    let base64: string;
    if (att.content !== undefined) {
      base64 =
        typeof att.content === "string"
          ? att.content
          : att.content.toString("base64");
    } else if (att.path) {
      const absPath = path.isAbsolute(att.path)
        ? att.path
        : path.join(process.cwd(), att.path);
      const buf = await fs.readFile(absPath);
      base64 = buf.toString("base64");
    } else {
      logger.warn("[email] Pièce jointe ignorée — ni content ni path", {
        filename: att.filename,
      });
      continue;
    }
    out.push({ filename: att.filename, content: base64 });
  }
  return out;
}

function formatFrom(name: string | undefined, email: string): string {
  const trimmedName = name?.trim();
  if (!trimmedName) return email;
  // Enlève les guillemets du nom pour éviter de casser le format
  const safe = trimmedName.replace(/["<>]/g, "");
  return `${safe} <${email}>`;
}

/**
 * Envoie un email via l'API Resend.
 *
 * - Si aucune clé API Resend n'est configurée → ne jette pas, retourne `{ sent: false, reason: "no_config" }`.
 * - Si l'API retourne une erreur → log + retourne `{ sent: false, reason: "api_error" }`.
 * - En cas de succès → `{ sent: true, id }` (id = identifiant Resend du message).
 */
export async function sendMail(
  params: SendMailParams
): Promise<SendMailResult> {
  const cfg = await getCachedResendConfig();

  const apiKey = cfg.apiKey || process.env.RESEND_API_KEY || null;
  if (!apiKey) {
    logger.warn("[email] Aucune clé API Resend configurée — email ignoré.");
    return { sent: false, reason: "no_config" };
  }

  const fromEmail =
    params.fromEmail?.trim() ||
    cfg.fromEmail ||
    process.env.RESEND_FROM_EMAIL ||
    null;
  if (!fromEmail) {
    logger.warn(
      "[email] Aucune adresse expéditeur (resend_from_email) configurée — email ignoré."
    );
    return { sent: false, reason: "no_from" };
  }

  const fromName =
    params.fromName?.trim() ||
    cfg.fromName ||
    process.env.RESEND_FROM_NAME ||
    undefined;

  const resendAttachments = await buildResendAttachments(params.attachments);

  const body: Record<string, unknown> = {
    from: formatFrom(fromName, fromEmail),
    to: Array.isArray(params.to) ? params.to : [params.to],
    subject: params.subject,
    html: params.html,
  };
  if (params.replyTo) body.reply_to = params.replyTo;
  if (resendAttachments.length > 0) body.attachments = resendAttachments;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    let parsed: unknown = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      /* non-JSON response */
    }

    if (!res.ok) {
      const errMsg =
        (parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as { message: unknown }).message)
          : null) || `HTTP ${res.status}`;
      logger.error("[email] Échec envoi Resend", {
        status: res.status,
        error: errMsg,
        to: params.to,
        subject: params.subject,
      });
      return { sent: false, reason: "api_error", error: errMsg };
    }

    const id =
      parsed && typeof parsed === "object" && "id" in parsed
        ? String((parsed as { id: unknown }).id)
        : "";
    return { sent: true, id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[email] Exception envoi Resend", { error: msg });
    return { sent: false, reason: "api_error", error: msg };
  }
}

/**
 * Valide une clé API Resend en appelant un endpoint bénin.
 * Utilisé par l'UI admin pour vérifier la clé avant enregistrement.
 */
export async function validateResendApiKey(
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { valid: false, error: "Clé API vide." };
  if (!trimmed.startsWith("re_")) {
    return {
      valid: false,
      error: "La clé Resend doit commencer par « re_ ».",
    };
  }
  try {
    const res = await fetch("https://api.resend.com/domains", {
      method: "GET",
      headers: { Authorization: `Bearer ${trimmed}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Clé API invalide." };
    }
    if (!res.ok) {
      return { valid: false, error: `Erreur ${res.status}` };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Impossible de contacter Resend.",
    };
  }
}
