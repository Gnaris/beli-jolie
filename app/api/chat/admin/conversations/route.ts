import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { markAsRead } from "@/lib/messaging";
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/admin/conversations
 * Query params: ?id=xxx  → single conversation with messages
 *               (none)   → list all support conversations
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "ADMIN") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const convId = request.nextUrl.searchParams.get("id");

    // ── Single conversation with messages ──
    if (convId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: convId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, company: true, email: true } },
          messages: {
            include: {
              sender: { select: { firstName: true, lastName: true, role: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          },
        },
      });

      if (!conversation) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }

      // Reverse to chronological order (we fetched desc to get latest 100)
      conversation.messages.reverse();

      // Mark as read after building response (non-blocking)
      markAsRead(convId, "ADMIN").catch(() => {});

      return Response.json(conversation);
    }

    // ── Conversations list — paginated ──
    const cursor = request.nextUrl.searchParams.get("cursor");
    const take = 50;

    const conversations = await prisma.conversation.findMany({
      where: { type: "SUPPORT" },
      include: {
        user: { select: { firstName: true, lastName: true, company: true, email: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true, senderRole: true, readAt: true },
        },
        _count: {
          select: {
            messages: { where: { senderRole: "CLIENT", readAt: null } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = conversations.length > take;
    const items = hasMore ? conversations.slice(0, take) : conversations;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return Response.json({ items, nextCursor });
  } catch (err) {
    logger.error("[Chat API]", err instanceof Error ? { message: err.message } : {});
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
