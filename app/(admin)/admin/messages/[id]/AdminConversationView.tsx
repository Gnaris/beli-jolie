"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConversationThread from "@/components/shared/ConversationThread";
import MessageInput from "@/components/shared/MessageInput";
import { sendAdminReply, closeConversation } from "@/app/actions/admin/messages";
import { useToast } from "@/components/ui/Toast";
import type { ThreadMessage } from "@/components/shared/ConversationThread";

interface ConversationData {
  id: string;
  subject: string | null;
  status: string;
  messages: ThreadMessage[];
  user: { id: string; firstName: string; lastName: string; company: string | null; email: string };
}

export default function AdminConversationView({ conversation }: { conversation: ConversationData }) {
  const [messages, setMessages] = useState<ThreadMessage[]>(conversation.messages);
  const [status, setStatus] = useState(conversation.status);
  const { addToast } = useToast();
  const router = useRouter();

  async function handleSend(content: string) {
    const result = await sendAdminReply(conversation.id, content);
    if (result.success && result.message) {
      setMessages((prev) => [...prev, result.message as unknown as ThreadMessage]);
      router.refresh();
    } else {
      addToast(result.error || "Erreur", "error");
    }
  }

  async function handleClose() {
    const result = await closeConversation(conversation.id);
    if (result.success) {
      setStatus("CLOSED");
      addToast("Conversation fermee", "success");
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className={`badge ${status === "OPEN" ? "badge-success" : "badge-neutral"}`}>
          {status === "OPEN" ? "Ouvert" : "Ferme"}
        </span>
        {status === "OPEN" && (
          <button
            onClick={handleClose}
            className="text-xs text-text-muted hover:text-[#EF4444] font-body transition-colors"
          >
            Fermer la conversation
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <ConversationThread
          messages={messages}
          currentUserRole="ADMIN"
          subject={conversation.subject}
        />
      </div>
      <MessageInput onSend={handleSend} />
    </div>
  );
}
