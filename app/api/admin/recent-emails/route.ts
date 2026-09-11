import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/recent-emails
 *
 * Retourne les EmailSend récents (60 min) scopés au tenant courant, EXCLUANT
 * ceux liés à un `BulkMailJob` (leur progression est déjà affichée dans le
 * bloc « Envois groupés » du widget — pas de duplication).
 *
 * Utilisé par le widget « Envoi de mails » du rail admin pour montrer aussi
 * les mails auto (panier abandonné, retour en stock, inactivité, …) et les
 * mails envoyés manuellement à un client inscrit via <SendMailModal>.
 */

const WINDOW_MS = 60 * 60_000; // 60 min
const MAX_ROWS = 100;

async function guardAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  return null;
}

export async function GET() {
  const guard = await guardAdmin();
  if (guard) return guard;

  const cutoff = new Date(Date.now() - WINDOW_MS);

  // Charge les envois récents (scope tenant auto via extension Prisma) sans
  // htmlBody/textBody — payloads potentiellement lourds pour un feed live.
  const emails = await prisma.emailSend.findMany({
    where: { sentAt: { gte: cutoff } },
    orderBy: { sentAt: "desc" },
    take: MAX_ROWS,
    select: {
      id: true,
      recipientEmail: true,
      fromName: true,
      scenarioKey: true,
      subject: true,
      status: true,
      errorMessage: true,
      sentAt: true,
      metadata: true,
      userId: true,
    },
  });

  // Filtre les envois liés à un BulkMailJob — leur ligne est déjà rendue dans
  // le bloc dépliable du job côté widget.
  const filtered = emails.filter((e) => {
    const meta = (e.metadata ?? null) as { bulkMailJobId?: unknown } | null;
    return !meta || typeof meta.bulkMailJobId !== "string";
  });

  return NextResponse.json({
    emails: filtered.map((e) => ({
      id: e.id,
      recipientEmail: e.recipientEmail,
      fromName: e.fromName,
      scenarioKey: e.scenarioKey,
      subject: e.subject,
      status: e.status, // "SENT" | "FAILED"
      errorMessage: e.errorMessage,
      sentAt: e.sentAt.toISOString(),
      userId: e.userId,
    })),
  });
}
