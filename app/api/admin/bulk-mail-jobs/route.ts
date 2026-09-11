import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  listRecentBulkMailJobs,
  dismissBulkMailJob,
} from "@/lib/bulk-mail-worker";
import { prisma } from "@/lib/prisma";

/**
 * Routes de la file d'envoi groupé de newsletter aux fiches.
 *
 * GET    /api/admin/bulk-mail-jobs        → jobs récents (poll widget)
 * DELETE /api/admin/bulk-mail-jobs?id=X   → dismiss un job (hide)
 * DELETE /api/admin/bulk-mail-jobs?status=done → dismiss tous les COMPLETED/FAILED
 */

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
  const jobs = await listRecentBulkMailJobs();
  return NextResponse.json({ jobs });
}

export async function DELETE(req: NextRequest) {
  const guard = await guardAdmin();
  if (guard) return guard;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const status = url.searchParams.get("status");

  if (id) {
    await dismissBulkMailJob(id);
    return NextResponse.json({ ok: true });
  }
  if (status === "done") {
    const res = await prisma.bulkMailJob.updateMany({
      where: {
        status: { in: ["COMPLETED", "FAILED"] },
        dismissedAt: null,
      },
      data: { dismissedAt: new Date() },
    });
    return NextResponse.json({ removed: res.count });
  }
  return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
}
