import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const POLL_INTERVAL_MS = 3_000; // push every 3 seconds

/**
 * GET /api/admin/live-clients
 * Server-Sent Events (SSE) endpoint that streams online client data
 * to the admin dashboard in real time.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      };

      const fetchAndSend = async () => {
        try {
          const threshold = new Date(Date.now() - ONLINE_THRESHOLD_MS);

          const onlineClients = await prisma.user.findMany({
            where: {
              role: "CLIENT",
              activity: { lastSeenAt: { gte: threshold } },
            },
            orderBy: { activity: { lastSeenAt: "desc" } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              company: true,
              activity: {
                select: {
                  lastSeenAt: true,
                  connectedAt: true,
                  currentPage: true,
                  cartAddsCount: true,
                  favAddsCount: true,
                },
              },
            },
          });

          send({
            type: "update",
            timestamp: new Date().toISOString(),
            clients: onlineClients.map((c) => ({
              id: c.id,
              firstName: c.firstName,
              lastName: c.lastName,
              company: c.company,
              currentPage: c.activity?.currentPage ?? null,
              connectedAt: c.activity?.connectedAt?.toISOString() ?? null,
              lastSeenAt: c.activity?.lastSeenAt?.toISOString() ?? null,
              cartAddsCount: c.activity?.cartAddsCount ?? 0,
              favAddsCount: c.activity?.favAddsCount ?? 0,
            })),
          });
        } catch {
          // DB error — skip this cycle
        }
      };

      // Send initial data immediately
      await fetchAndSend();

      // Poll and push every 3 seconds
      const interval = setInterval(fetchAndSend, POLL_INTERVAL_MS);

      // Clean up when the client disconnects
      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
