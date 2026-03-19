import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/heartbeat/disconnect
 * Marks the user as offline by setting lastSeenAt far in the past
 * and resetting session counters.
 * Called via navigator.sendBeacon when the browser/tab is closed.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    // Set lastSeenAt to 10 minutes ago so the user immediately appears offline
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    await prisma.userActivity.updateMany({
      where: { userId: session.user.id },
      data: {
        lastSeenAt: tenMinutesAgo,
        currentPage: null,
        cartAddsCount: 0,
        favAddsCount: 0,
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
