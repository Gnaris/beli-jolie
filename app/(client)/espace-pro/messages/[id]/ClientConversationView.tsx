"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConversationThread from "@/components/shared/ConversationThread";
import MessageInput from "@/components/shared/MessageInput";
import { sendClientMessage, closeClientConversation } from "@/app/actions/client/messages";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { ThreadMessage } from "@/components/shared/ConversationThread";
import type { ChatAttachment } from "@/components/shared/MessageInput";

interface ConversationData {
  id: string;
  subject: string | null;
  status: string;
  messages: ThreadMessage[];
}

export default function ClientConversationView({ conversation }: { conversation: ConversationData }) {
  const [messages, setMessages] = useState<ThreadMessage[]>(conversation.messages);
  const [status, setStatus] = useState(conversation.status);
  const toast = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();

  async function handleClose() {
    const ok = await confirm({
      title: "Clôturer la conversation",
      message: "Voulez-vous vraiment clôturer cette conversation ?",
      confirmLabel: "Clôturer",
    });
    if (!ok) return;
    const result = await closeClientConversation(conversation.id);
    if (result.success) {
      setStatus("CLOSED");
      toast.success("Conversation clôturée");
      router.refresh();
    } else {
      toast.error(result.error || "Erreur");
    }
  }

  async function handleSend(content: string, attachments?: ChatAttachment[]) {
    const result = await sendClientMessage(conversation.id, content, attachments);
    if (result.success && result.message) {
      setMessages((prev) => [...prev, result.message as unknown as ThreadMessage]);
      router.refresh();
    } else {
      toast.error(result.error || "Erreur");
    }
  }

  return (
    <div className="flex flex-col h-full">
      {status === "OPEN" && (
        <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0">
          <span className="badge badge-success">Ouvert</span>
          <button
            onClick={handleClose}
            className="text-xs text-text-muted hover:text-red-500 font-body transition-colors"
          >
            Cloturer la conversation
          </button>
        </div>
      )}
      {status === "CLOSED" && (
        <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0">
          <span className="badge badge-neutral">Clos</span>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ConversationThread
          messages={messages}
          currentUserRole="CLIENT"
          subject={conversation.subject}
        />
      </div>
      <MessageInput
        onSend={handleSend}
        disabled={status === "CLOSED"}
        placeholder={status === "CLOSED" ? "Conversation fermée" : undefined}
      />
    </div>
  );
}
