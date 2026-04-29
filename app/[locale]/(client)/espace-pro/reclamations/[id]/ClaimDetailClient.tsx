"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ConversationThread from "@/components/shared/ConversationThread";
import MessageInput from "@/components/shared/MessageInput";
import ClaimTimeline from "@/components/client/claims/ClaimTimeline";
import { sendClientMessage } from "@/app/actions/client/messages";
import { useToast } from "@/components/ui/Toast";
import { useChatStream } from "@/hooks/useChatStream";
import type { ChatEvent } from "@/hooks/useChatStream";
import type { ThreadMessage } from "@/components/shared/ConversationThread";
import type { ChatAttachment } from "@/components/shared/MessageInput";

interface ClaimData {
  id: string;
  status: string;
  conversation: {
    id: string;
    subject: string | null;
    status: string;
    messages: ThreadMessage[];
  } | null;
}

export default function ClaimDetailClient({ claim }: { claim: ClaimData }) {
  const [messages, setMessages] = useState<ThreadMessage[]>(claim.conversation?.messages || []);
  const [status, setStatus] = useState(claim.status);
  const toast = useToast();
  const router = useRouter();

  // Real-time: receive new admin messages + status changes via SSE
  const handleChatEvent = useCallback(
    (event: ChatEvent) => {
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

      if (event.type === "CLAIM_STATUS_CHANGED" && event.claimData?.claimId === claim.id) {
        setStatus(event.claimData.newStatus);
      }
    },
    [claim.conversation, claim.id]
  );
  useChatStream(handleChatEvent);

  async function handleSendMessage(content: string, attachments?: ChatAttachment[]) {
    if (!claim.conversation) return;
    const result = await sendClientMessage(claim.conversation.id, content, attachments);
    if (result.success && result.message) {
      setMessages((prev) => [...prev, result.message as unknown as ThreadMessage]);
      router.refresh();
    } else {
      toast.error(result.error || "Erreur");
    }
  }

  return (
    <>
      {/* Real-time timeline */}
      <ClaimTimeline status={status} />

      {/* Conversation */}
      {claim.conversation && (
        <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden flex flex-col" style={{ height: "500px" }}>
          <div className="flex flex-col h-full flex-1 min-h-0">
            <ConversationThread
              messages={messages}
              currentUserRole="CLIENT"
              subject="Échanges"
            />
            {status === "CLOSED" ? (
              <div className="border-t border-border px-4 py-3 text-center">
                <p className="text-sm text-text-muted font-body">Cette réclamation est clôturée.</p>
              </div>
            ) : (
              <MessageInput onSend={handleSendMessage} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
