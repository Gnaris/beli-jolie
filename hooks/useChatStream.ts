"use client";

import { useEffect, useRef } from "react";

export type ChatEventType = "NEW_MESSAGE" | "MESSAGE_READ" | "CONVERSATION_CLOSED" | "CLAIM_STATUS_CHANGED" | "TYPING_START" | "TYPING_STOP";

export interface ChatEvent {
  type: ChatEventType;
  conversationId: string;
  userId: string;
  targetRole: "ADMIN" | "CLIENT";
  timestamp: number;
  messageData?: {
    id: string;
    content: string;
    senderRole: "ADMIN" | "CLIENT";
    senderName: string;
    createdAt: string;
  };
  claimData?: {
    claimId: string;
    newStatus: string;
  };
}

/**
 * Subscribe to real-time chat events via SSE.
 * Calls `onEvent` for each incoming event. Auto-reconnects on disconnect.
 */
export function useChatStream(onEvent: (event: ChatEvent) => void) {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let alive = true;

    function connect() {
      if (!alive) return;
      es = new EventSource("/api/chat/stream");

      es.onmessage = (msg) => {
        try {
          const event: ChatEvent = JSON.parse(msg.data);
          onEventRef.current(event);
        } catch { /* ignore malformed */ }
      };

      es.onerror = () => {
        es?.close();
        if (alive) reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);
}
