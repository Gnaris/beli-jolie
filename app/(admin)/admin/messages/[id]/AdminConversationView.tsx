"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import ConversationThread from "@/components/shared/ConversationThread";
import MessageInput from "@/components/shared/MessageInput";
import { sendAdminReply, closeConversation, joinConversation } from "@/app/actions/admin/messages";
import { useToast } from "@/components/ui/Toast";
import { useChatStream } from "@/hooks/useChatStream";
import type { ThreadMessage } from "@/components/shared/ConversationThread";
import type { ChatAttachment } from "@/components/shared/MessageInput";

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
  // Admin has "joined" if they already sent at least one message in this conversation
  const [hasJoined, setHasJoined] = useState(
    conversation.messages.some((m) => m.senderRole === "ADMIN")
  );
  const [joining, setJoining] = useState(false);
  const [clientTyping, setClientTyping] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const clientTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real-time: receive new client messages via SSE
  const handleChatEvent = useCallback(
    (event: { type: string; conversationId: string; messageData?: { id: string; content: string; senderRole: string; senderName: string; createdAt: string } }) => {
      if (event.conversationId !== conversation.id) return;

      if (event.type === "NEW_MESSAGE" && event.messageData) {
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
        setClientTyping(false);
      }
      if (event.type === "TYPING_START") {
        setClientTyping(true);
        if (clientTypingTimerRef.current) clearTimeout(clientTypingTimerRef.current);
        clientTypingTimerRef.current = setTimeout(() => setClientTyping(false), 4000);
      }
      if (event.type === "TYPING_STOP") {
        setClientTyping(false);
        if (clientTypingTimerRef.current) clearTimeout(clientTypingTimerRef.current);
      }
    },
    [conversation.id]
  );
  useChatStream(handleChatEvent);

  // --- Typing emission ---
  function emitTyping(typing: boolean) {
    fetch("/api/chat/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: conversation.id, userId: conversation.user.id, typing }),
    }).catch(() => {});
  }

  function handleTypingChange() {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      emitTyping(true);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      emitTyping(false);
    }, 2000);
  }

  async function handleJoin() {
    setJoining(true);
    const result = await joinConversation(conversation.id);
    if (result.success && result.message) {
      setMessages((prev) => [...prev, result.message as unknown as ThreadMessage]);
      setHasJoined(true);
      router.refresh();
    } else {
      toast.error(result.error || "Erreur");
    }
    setJoining(false);
  }

  async function handleSend(content: string, attachments?: ChatAttachment[]) {
    // Stop typing
    isTypingRef.current = false;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    emitTyping(false);

    const result = await sendAdminReply(conversation.id, content, attachments);
    if (result.success && result.message) {
      setMessages((prev) => [...prev, result.message as unknown as ThreadMessage]);
      router.refresh();
    } else {
      toast.error(result.error || "Erreur");
    }
  }

  async function handleClose() {
    const result = await closeConversation(conversation.id);
    if (result.success) {
      setStatus("CLOSED");
      toast.success("Conversation fermée");
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className={`badge ${status === "OPEN" ? "badge-success" : "badge-neutral"}`}>
          {status === "OPEN" ? "Ouvert" : "Fermé"}
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
          typingName={clientTyping ? conversation.user.firstName : null}
        />
      </div>

      {/* If admin has not joined yet — show "Traiter la demande" button */}
      {status === "OPEN" && !hasJoined && (
        <div className="border-t border-border px-4 py-4 bg-bg-secondary/30">
          <div className="text-center space-y-3">
            <p className="text-sm font-body text-text-secondary">
              Le client attend une réponse. Prenez en charge la conversation pour commencer à répondre.
            </p>
            <button
              onClick={handleJoin}
              disabled={joining}
              className="px-6 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-xl hover:bg-[#333] disabled:opacity-50 transition-colors"
            >
              {joining ? "Prise en charge..." : "Traiter la demande"}
            </button>
          </div>
        </div>
      )}

      {/* If admin has joined — show input */}
      {status === "OPEN" && hasJoined && (
        <MessageInput onSend={handleSend} onTyping={handleTypingChange} />
      )}
    </div>
  );
}
