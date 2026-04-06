"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ConversationThread from "@/components/shared/ConversationThread";
import MessageInput from "@/components/shared/MessageInput";
import { sendAdminReply } from "@/app/actions/admin/messages";
import { useToast } from "@/components/ui/Toast";
import { useChatStream } from "@/hooks/useChatStream";
import type { ThreadMessage } from "@/components/shared/ConversationThread";
import type { ChatAttachment } from "@/components/shared/MessageInput";

interface ClaimWithConversation {
  id: string;
  status: string;
  conversation: {
    id: string;
    subject: string | null;
    messages: ThreadMessage[];
  } | null;
}

export default function AdminClaimView({ claim }: { claim: ClaimWithConversation }) {
  const toast = useToast();
  const router = useRouter();
  const [messages, setMessages] = useState<ThreadMessage[]>(claim.conversation?.messages || []);

  // Real-time: receive new client messages via SSE
  const handleChatEvent = useCallback(
    (event: { type: string; conversationId: string; messageData?: { id: string; content: string; senderRole: string; senderName: string; createdAt: string } }) => {
      if (event.type === "NEW_MESSAGE" && claim.conversation && event.conversationId === claim.conversation.id && event.messageData) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === event.messageData!.id)) return prev;
          return [
            ...prev,
            {
              id: event.messageData!.id,
              content: event.messageData!.content,
              senderRole: event.messageData!.senderRole as "ADMIN" | "CLIENT",
              sender: {
                firstName: event.messageData!.senderName.split(" ")[0] || "",
                lastName: event.messageData!.senderName.split(" ").slice(1).join(" ") || "",
                role: event.messageData!.senderRole as "ADMIN" | "CLIENT",
              },
              createdAt: event.messageData!.createdAt,
            },
          ];
        });
      }
    },
    [claim.conversation]
  );
  useChatStream(handleChatEvent);

  if (!claim.conversation) return null;

  async function handleSend(content: string, attachments?: ChatAttachment[]) {
    const result = await sendAdminReply(claim.conversation!.id, content, attachments);
    if (result.success && result.message) {
      setMessages((prev) => [...prev, result.message as unknown as ThreadMessage]);
      router.refresh();
    } else {
      toast.error(result.error || "Erreur");
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ConversationThread
        messages={messages}
        currentUserRole="ADMIN"
        subject="Échanges"
      />
      {claim.status === "CLOSED" ? (
        <div className="border-t border-border px-4 py-3 text-center">
          <p className="text-sm text-text-muted font-body">Réclamation clôturée — rouvrez-la pour écrire.</p>
        </div>
      ) : (
        <MessageInput onSend={handleSend} />
      )}
    </div>
  );
}
