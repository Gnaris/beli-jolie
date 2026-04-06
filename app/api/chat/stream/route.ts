import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { subscribeChatEvents } from "@/lib/chat-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userRole = session.user.role;
  const userId = session.user.id;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); }
        catch { cleanup(); }
      }, 30_000);

      unsubscribe = subscribeChatEvents((event) => {
        // Filter: ADMIN gets all ADMIN-targeted events, CLIENT gets only their own
        if (userRole === "ADMIN" && event.targetRole !== "ADMIN") return;
        if (userRole === "CLIENT" && (event.targetRole !== "CLIENT" || event.userId !== userId)) return;

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      });

      controller.enqueue(encoder.encode(": connected\n\n"));
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
