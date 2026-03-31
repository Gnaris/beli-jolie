import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runAnkorstoreAnalyze } from "@/lib/ankorstore-analyze";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401 });
  }

  let limit = 0;
  try {
    const body = await req.json();
    limit = typeof body.limit === "number" ? body.limit : 0;
  } catch {
    // No body
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await runAnkorstoreAnalyze({
          limit: limit > 0 ? limit : undefined,
          onProgress: (msg) => send({ type: "progress", message: msg }),
        });

        send({ type: "result", ...result });
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
