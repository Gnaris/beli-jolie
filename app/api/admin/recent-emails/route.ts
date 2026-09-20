import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantId } from "@/lib/tenant";

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
 *
 * Filtre `tenantId` explicite en plus de l'extension Prisma : ceinture +
 * bretelles. Historique 2026-09-12 : `EmailSend` avait été oublié dans
 * `TENANT_SCOPED_MODELS`, ce qui faisait fuiter les envois de l'autre
 * boutique dans le widget rail. La liste est corrigée, on garde le filtre
 * en dur ici pour verrouiller la surface en cas de future régression.
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

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return NextResponse.json({ emails: [] });
  }

  const cutoff = new Date(Date.now() - WINDOW_MS);

  const emails = await prisma.emailSend.findMany({
    where: { tenantId, sentAt: { gte: cutoff } },
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

/**
 * DELETE /api/admin/recent-emails
 *   ?id=<emailId>  → supprime UN envoi précis
 *   (sans param)   → vide toute la fenêtre visible (60 min, hors bulk)
 *
 * Sert au bouton « corbeille » de chaque ligne + au bouton « Vider tout »
 * du widget. Suppression scopée au tenant (defense en profondeur).
 */
export async function DELETE(req: Request) {
  const guard = await guardAdmin();
  if (guard) return guard;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const res = await prisma.emailSend.deleteMany({
      where: { id, tenantId },
    });
    return NextResponse.json({ ok: true, deleted: res.count });
  }

  // Sinon : vide tous les mails visibles dans le widget (60 min, hors bulk).
  const cutoff = new Date(Date.now() - WINDOW_MS);
  const visible = await prisma.emailSend.findMany({
    where: { tenantId, sentAt: { gte: cutoff } },
    select: { id: true, metadata: true },
  });
  const idsToDelete = visible
    .filter((e) => {
      const meta = (e.metadata ?? null) as { bulkMailJobId?: unknown } | null;
      return !meta || typeof meta.bulkMailJobId !== "string";
    })
    .map((e) => e.id);
  const res = await prisma.emailSend.deleteMany({
    where: { id: { in: idsToDelete }, tenantId },
  });
  return NextResponse.json({ ok: true, deleted: res.count });
}
