import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runAnkorstoreSync } from "@/lib/ankorstore-sync";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    let limit = 0;
    try {
      const body = await req.json();
      limit = typeof body.limit === "number" ? body.limit : 0;
    } catch {
      // No body
    }

    const running = await prisma.ankorstoreSyncJob.findFirst({
      where: { status: "RUNNING" },
      select: { id: true },
    });
    if (running) {
      return NextResponse.json(
        { error: "Une synchronisation Ankorstore est déjà en cours.", jobId: running.id },
        { status: 409 },
      );
    }

    const job = await prisma.ankorstoreSyncJob.create({
      data: { adminId: session.user.id },
    });

    runAnkorstoreSync(job.id, { limit: limit > 0 ? limit : undefined }).catch(() => {});

    return NextResponse.json({ jobId: job.id, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const job = await prisma.ankorstoreSyncJob.findFirst({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ job });
}
