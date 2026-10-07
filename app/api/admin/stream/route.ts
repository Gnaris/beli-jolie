import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { subscribeAdminEvents } from "@/lib/admin-events";
import { getCurrentTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE temps réel pour l'interface admin. Reçoit CLIENT_NEW, CLIENT_STATUS
 * et ORDER_NEW. Filtré par tenant (fail-closed) : un event sans tenantId
 * est rejeté pour éviter qu'une boutique voie les notifications d'une
 * autre boutique sur le même serveur.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return new Response("Unauthorized", { status: 401 });
  }

  const requestTenantId = await getCurrentTenantId();
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); }
        catch { cleanup(); }
      }, 30_000);

      unsubscribe = subscribeAdminEvents((event) => {
        if (requestTenantId && event.tenantId !== requestTenantId) return;
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
