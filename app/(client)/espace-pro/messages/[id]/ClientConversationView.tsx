"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConversationThread from "@/components/shared/ConversationThread";
import MessageInput from "@/components/shared/MessageInput";
import { sendClientMessage } from "@/app/actions/client/messages";
import { useToast } from "@/components/ui/Toast";
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
  const toast = useToast();
  const router = useRouter();

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
      <ConversationThread
        messages={messages}
        currentUserRole="CLIENT"
        subject={conversation.subject}
      />
      <MessageInput
        onSend={handleSend}
        disabled={conversation.status === "CLOSED"}
        placeholder={conversation.status === "CLOSED" ? "Conversation fermee" : undefined}
      />
    </div>
  );
}
