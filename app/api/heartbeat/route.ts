import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/heartbeat
 * Upserts the user's activity record with the current timestamp and page.
 * Called every 30 seconds by the HeartbeatTracker client component.
 *
 * Body: { page?: string, isNewSession?: boolean }
 * When isNewSession is true, resets connectedAt and session counters.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const currentPage = typeof body.page === "string" ? body.page : null;
    const isNewSession = body.isNewSession === true;

    const now = new Date();

    // Verify user still exists (JWT may outlive deleted users)
    const userExists = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true },
    });
    if (!userExists) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    if (isNewSession) {
      // New session: reset connectedAt and counters
      await prisma.userActivity.upsert({
        where: { userId: session.user.id },
        update: {
          lastSeenAt: now,
          connectedAt: now,
          currentPage,
          cartAddsCount: 0,
          favAddsCount: 0,
        },
        create: {
          userId: session.user.id,
          lastSeenAt: now,
          connectedAt: now,
          currentPage,
          cartAddsCount: 0,
          favAddsCount: 0,
        },
      });
    } else {
      // Regular heartbeat: update lastSeenAt + currentPage only
      await prisma.userActivity.upsert({
        where: { userId: session.user.id },
        update: {
          lastSeenAt: now,
          currentPage,
        },
        create: {
          userId: session.user.id,
          lastSeenAt: now,
          connectedAt: now,
          currentPage,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
