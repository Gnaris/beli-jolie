import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const running = await prisma.ankorstoreSyncJob.findFirst({
    where: { status: "RUNNING" },
  });

  if (!running) {
    return NextResponse.json({ error: "Aucune synchronisation en cours" }, { status: 404 });
  }

  await prisma.ankorstoreSyncJob.update({
    where: { id: running.id },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
