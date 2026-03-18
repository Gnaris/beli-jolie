import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/heartbeat
 * Upserts the user's activity record with the current timestamp and page.
 * Called every 30 seconds by the HeartbeatTracker client component.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const currentPage = typeof body.page === "string" ? body.page : null;

    await prisma.userActivity.upsert({
      where: { userId: session.user.id },
      update: {
        lastSeenAt: new Date(),
        currentPage,
      },
      create: {
        userId: session.user.id,
        lastSeenAt: new Date(),
        currentPage,
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
