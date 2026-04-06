import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { emitChatEvent } from "@/lib/chat-events";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { conversationId, userId, typing } = body as {
    conversationId: string;
    userId: string;
    typing: boolean;
  };

  if (!conversationId) return new Response("Missing conversationId", { status: 400 });

  emitChatEvent({
    type: typing ? "TYPING_START" : "TYPING_STOP",
    conversationId,
    userId,
    targetRole: session.user.role === "ADMIN" ? "CLIENT" : "ADMIN",
  });

  return new Response("OK", { status: 200 });
}
