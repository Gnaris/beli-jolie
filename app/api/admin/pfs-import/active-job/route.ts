import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET — Check if there's an active or recent PFS import job
 * Returns the most recent PFS_IMPORT job (active or completed in the last hour)
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const job = await prisma.importJob.findFirst({
    where: {
      adminId: session.user.id,
      type: "PFS_IMPORT",
      OR: [
        { status: { in: ["PENDING", "PROCESSING"] } },
        { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] }, updatedAt: { gte: oneHourAgo } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ job });
}
