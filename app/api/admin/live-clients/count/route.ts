import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * GET /api/admin/live-clients/count
 * Lightweight endpoint returning just the online client count.
 * Used by LiveCountBadge (polling) to avoid holding a persistent SSE connection.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return Response.json({ count: 0 }, { status: 401 });
  }

  try {
    const threshold = new Date(Date.now() - ONLINE_THRESHOLD_MS);
    const count = await prisma.user.count({
      where: {
        role: "CLIENT",
        activity: { lastSeenAt: { gte: threshold } },
      },
    });
    return Response.json({ count });
  } catch {
    return Response.json({ count: 0 });
  }
}
