"use client";

import { useRouter } from "next/navigation";
import ConversationThread from "@/components/shared/ConversationThread";
import MessageInput from "@/components/shared/MessageInput";
import { sendAdminReply } from "@/app/actions/admin/messages";
import { useToast } from "@/components/ui/Toast";
import type { ThreadMessage } from "@/components/shared/ConversationThread";

interface ClaimWithConversation {
  conversation: {
    id: string;
    subject: string | null;
    messages: ThreadMessage[];
  } | null;
}

export default function AdminClaimView({ claim }: { claim: ClaimWithConversation }) {
  const { addToast } = useToast();
  const router = useRouter();

  if (!claim.conversation) return null;

  async function handleSend(content: string) {
    const result = await sendAdminReply(claim.conversation!.id, content);
    if (!result.success) addToast(result.error || "Erreur", "error");
    else router.refresh();
  }

  return (
    <div className="flex flex-col h-full">
      <ConversationThread
        messages={claim.conversation.messages}
        currentUserRole="ADMIN"
        subject="Echanges"
      />
      <MessageInput onSend={handleSend} />
    </div>
  );
}
