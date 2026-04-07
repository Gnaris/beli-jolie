import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * POST /api/heartbeat
 * Upserts the user's activity record with the current timestamp and page.
 * Called every 60 seconds by the HeartbeatTracker client component.
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
    const userId = session.user.id;
    const isAdmin = session.user.role === "ADMIN";

    // Track visit for non-admin users
    if (!isAdmin) {
      let shouldCreateVisit = isNewSession;

      if (!shouldCreateVisit) {
        // Check if lastSeenAt is stale (>30min) — means a new session
        const existing = await prisma.userActivity.findUnique({
          where: { userId },
          select: { lastSeenAt: true },
        });
        if (!existing || now.getTime() - existing.lastSeenAt.getTime() > 30 * 60 * 1000) {
          shouldCreateVisit = true;
        }
      }

      if (shouldCreateVisit) {
        await prisma.visit.create({ data: { userId } });
      }
    }

    if (isNewSession) {
      await prisma.userActivity.upsert({
        where: { userId },
        update: {
          lastSeenAt: now,
          connectedAt: now,
          currentPage,
          cartAddsCount: 0,
          favAddsCount: 0,
        },
        create: {
          userId,
          lastSeenAt: now,
          connectedAt: now,
          currentPage,
          cartAddsCount: 0,
          favAddsCount: 0,
        },
      });
    } else {
      await prisma.userActivity.upsert({
        where: { userId },
        update: {
          lastSeenAt: now,
          currentPage,
        },
        create: {
          userId,
          lastSeenAt: now,
          connectedAt: now,
          currentPage,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    // FK constraint error = user was deleted, JWT is stale → 401
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
