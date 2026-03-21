import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { closePlaywright } from "@/lib/pfs-sync";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const jobId = body.jobId as string;

    if (!jobId) {
      return NextResponse.json({ error: "jobId requis" }, { status: 400 });
    }

    const job = await prisma.pfsSyncJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
    }

    // Force status to FAILED
    await prisma.pfsSyncJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: "Annulé manuellement par l'admin",
      },
    });

    // Also set any SYNCING products back to OFFLINE
    await prisma.product.updateMany({
      where: { status: "SYNCING" },
      data: { status: "OFFLINE" },
    });

    // Close Playwright if running
    await closePlaywright();

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
