"use server";

/**
 * Server actions du Journal des emails (par client).
 *
 * Alimente la modale « Journal » ouverte depuis /admin/clients?view=mails :
 *  - listUserEmailJournal : liste paginée + filtres type/statut/période
 *  - getEmailSendDetail : détail complet d'un mail (HTML inclus)
 *  - resendEmail : renvoie un mail à partir de sa trace (crée un nouveau
 *    EmailSend avec resendOfId pointant vers l'original)
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/email";
import { getCachedShopName } from "@/lib/cached-data";
import type { EmailScenarioKey } from "@/lib/email-scenarios";

export interface EmailJournalRow {
  id: string;
  sentAt: string; // ISO
  scenarioKey: string;
  subject: string;
  status: "SENT" | "FAILED";
  errorMessage: string | null;
  attempts: number;
  isResend: boolean;
}

export interface EmailJournalFilters {
  /** null = tous types */
  scenarioKey?: string | null;
  /** null = tous statuts */
  status?: "SENT" | "FAILED" | null;
  /** Fenêtre en jours (7/30/90). null = tout l'historique. */
  windowDays?: number | null;
  /** Pagination — page 1-indexée, taille par défaut 25. */
  page?: number;
  pageSize?: number;
}

export interface EmailJournalListResult {
  success: true;
  rows: EmailJournalRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: {
    total: number;
    sent: number;
    failed: number;
    lastSentAt: string | null;
  };
}

export async function listUserEmailJournal(
  userId: string,
  filters: EmailJournalFilters = {},
): Promise<EmailJournalListResult | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    if (!userId) return { success: false, error: "Client introuvable." };

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {
      tenantId: tenant.id,
      userId,
    };
    if (filters.scenarioKey) where.scenarioKey = filters.scenarioKey;
    if (filters.status) where.status = filters.status;
    if (filters.windowDays && filters.windowDays > 0) {
      where.sentAt = {
        gte: new Date(Date.now() - filters.windowDays * 24 * 60 * 60 * 1000),
      };
    }

    const [rows, total, statsAll, lastSent] = await Promise.all([
      prisma.emailSend.findMany({
        where,
        orderBy: { sentAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          sentAt: true,
          scenarioKey: true,
          subject: true,
          status: true,
          errorMessage: true,
          attempts: true,
          resendOfId: true,
        },
      }),
      prisma.emailSend.count({ where }),
      // Stats globales (indépendantes des filtres actifs)
      prisma.emailSend.groupBy({
        by: ["status"],
        where: { tenantId: tenant.id, userId },
        _count: { _all: true },
      }),
      prisma.emailSend.findFirst({
        where: { tenantId: tenant.id, userId },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
    ]);

    const sent = statsAll.find((s) => s.status === "SENT")?._count._all ?? 0;
    const failed = statsAll.find((s) => s.status === "FAILED")?._count._all ?? 0;

    return {
      success: true,
      rows: rows.map((r) => ({
        id: r.id,
        sentAt: r.sentAt.toISOString(),
        scenarioKey: r.scenarioKey,
        subject: r.subject,
        status: (r.status === "FAILED" ? "FAILED" : "SENT") as "SENT" | "FAILED",
        errorMessage: r.errorMessage,
        attempts: r.attempts,
        isResend: r.resendOfId !== null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      stats: {
        total: sent + failed,
        sent,
        failed,
        lastSentAt: lastSent?.sentAt.toISOString() ?? null,
      },
    };
  } catch (err) {
    logger.error("[listUserEmailJournal]", { userId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export interface EmailSendDetail {
  id: string;
  sentAt: string;
  scenarioKey: string;
  subject: string;
  status: "SENT" | "FAILED";
  errorMessage: string | null;
  fromEmail: string | null;
  fromName: string | null;
  recipientEmail: string;
  htmlBody: string | null;
  messageId: string | null;
  attempts: number;
  resendOfId: string | null;
  metadata: unknown;
}

export async function getEmailSendDetail(
  emailSendId: string,
): Promise<
  | { success: true; detail: EmailSendDetail }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    const row = await prisma.emailSend.findFirst({
      where: { id: emailSendId, tenantId: tenant.id },
    });
    if (!row) return { success: false, error: "Mail introuvable." };
    return {
      success: true,
      detail: {
        id: row.id,
        sentAt: row.sentAt.toISOString(),
        scenarioKey: row.scenarioKey,
        subject: row.subject,
        status: (row.status === "FAILED" ? "FAILED" : "SENT") as "SENT" | "FAILED",
        errorMessage: row.errorMessage,
        fromEmail: row.fromEmail,
        fromName: row.fromName,
        recipientEmail: row.recipientEmail,
        htmlBody: row.htmlBody,
        messageId: row.messageId,
        attempts: row.attempts,
        resendOfId: row.resendOfId,
        metadata: row.metadata,
      },
    };
  } catch (err) {
    logger.error("[getEmailSendDetail]", { emailSendId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function resendEmail(
  emailSendId: string,
): Promise<
  | { success: true; message: string; newSendId: string }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();
    const original = await prisma.emailSend.findFirst({
      where: { id: emailSendId, tenantId: tenant.id },
    });
    if (!original) return { success: false, error: "Mail introuvable." };
    if (!original.htmlBody) {
      return {
        success: false,
        error: "Le contenu du mail original n'a pas été conservé (mail historique).",
      };
    }

    const shopName = await getCachedShopName();
    const result = await sendMail({
      to: original.recipientEmail,
      subject: original.subject,
      html: original.htmlBody,
      fromName: original.fromName || shopName,
      fromEmail: original.fromEmail || undefined,
      tracking: {
        scenarioKey: original.scenarioKey as EmailScenarioKey,
        userId: original.userId,
        metadata: {
          ...((original.metadata as Record<string, unknown>) || {}),
          resend: true,
        },
        attempts: (original.attempts ?? 1) + 1,
        resendOfId: original.id,
      },
    });

    if (!result.sent) {
      const reason =
        result.reason === "no_config"
          ? "Configuration SMTP absente."
          : result.reason === "no_from"
            ? "Adresse expéditeur non configurée."
            : `Serveur SMTP a refusé l'envoi (${result.error ?? "raison inconnue"}).`;
      return { success: false, error: reason };
    }

    revalidatePath("/admin/clients");
    // Le nouvel EmailSend est créé par sendMail — on relit pour renvoyer l'id.
    const created = await prisma.emailSend.findFirst({
      where: {
        tenantId: tenant.id,
        resendOfId: original.id,
      },
      orderBy: { sentAt: "desc" },
      select: { id: true },
    });
    return {
      success: true,
      message: `Mail renvoyé à ${original.recipientEmail}.`,
      newSendId: created?.id ?? "",
    };
  } catch (err) {
    logger.error("[resendEmail]", { emailSendId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}
