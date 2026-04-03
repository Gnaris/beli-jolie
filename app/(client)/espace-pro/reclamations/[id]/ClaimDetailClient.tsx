"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConversationThread from "@/components/shared/ConversationThread";
import MessageInput from "@/components/shared/MessageInput";
import { sendClientMessage } from "@/app/actions/client/messages";
import { confirmReturnShipped } from "@/app/actions/client/claims";
import { useToast } from "@/components/ui/Toast";
import type { ThreadMessage } from "@/components/shared/ConversationThread";

interface ClaimData {
  id: string;
  status: string;
  returnInfo: { id: string; method: string; status: string; trackingNumber: string | null } | null;
  conversation: {
    id: string;
    subject: string | null;
    status: string;
    messages: ThreadMessage[];
  } | null;
}

export default function ClaimDetailClient({ claim }: { claim: ClaimData }) {
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();
  const router = useRouter();

  async function handleSendMessage(content: string) {
    if (!claim.conversation) return;
    const result = await sendClientMessage(claim.conversation.id, content);
    if (!result.success) addToast(result.error || "Erreur", "error");
    else router.refresh();
  }

  function handleConfirmShipped() {
    startTransition(async () => {
      const result = await confirmReturnShipped(claim.id);
      if (result.success) {
        addToast("Retour confirme", "success");
        router.refresh();
      } else {
        addToast(result.error || "Erreur", "error");
      }
    });
  }

  return (
    <>
      {/* Return info */}
      {claim.returnInfo && claim.status === "RETURN_PENDING" && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-3">
          <h3 className="font-heading font-bold text-text-primary">Retour</h3>
          <p className="text-sm text-text-muted font-body">
            Methode : {claim.returnInfo.method === "EASY_EXPRESS" ? "Easy Express" : "Envoi personnel"}
          </p>
          <button
            onClick={handleConfirmShipped}
            disabled={isPending}
            className="px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] disabled:opacity-40 transition-colors"
          >
            {isPending ? "..." : "Confirmer l'envoi du retour"}
          </button>
        </div>
      )}

      {/* Conversation */}
      {claim.conversation && (
        <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden" style={{ maxHeight: "500px" }}>
          <div className="flex flex-col h-full">
            <ConversationThread
              messages={claim.conversation.messages}
              currentUserRole="CLIENT"
              subject="Echanges"
            />
            <MessageInput onSend={handleSendMessage} />
          </div>
        </div>
      )}
    </>
  );
}
