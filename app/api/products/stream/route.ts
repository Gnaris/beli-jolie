import { subscribeProductEvents } from "@/lib/product-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); }
        catch { cleanup(); }
      }, 30_000);

      unsubscribe = subscribeProductEvents((event) => {
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
