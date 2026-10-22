import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emitChatEvent } from "@/lib/chat-events";
import { getCurrentTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const tid = await getCurrentTenantId();

  const body = await request.json();
  const { conversationId, typing } = body as {
    conversationId: string;
    typing: boolean;
  };

  if (!conversationId) return new Response("Missing conversationId", { status: 400 });

  // userId de l'event = userId OWNER de la conv (le client). Le stream SSE
  // filtre les events CLIENT par `event.userId === session.user.id`, donc si
  // on passait "" ou l'id de l'admin, le client ne verrait jamais le typing.
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });
  if (!conv) return new Response("Conversation not found", { status: 404 });

  emitChatEvent({
    type: typing ? "TYPING_START" : "TYPING_STOP",
    conversationId,
    userId: conv.userId,
    targetRole: session.user.role === "ADMIN" ? "CLIENT" : "ADMIN",
    tenantId: tid ?? undefined,
  });

  return new Response("OK", { status: 200 });
}
