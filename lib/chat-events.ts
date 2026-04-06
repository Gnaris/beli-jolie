/**
 * In-memory event emitter for real-time chat updates via SSE.
 * Uses globalThis to guarantee a single shared instance across
 * Next.js server actions, API routes, and middleware.
 */

export type ChatEventType = "NEW_MESSAGE" | "MESSAGE_READ" | "CONVERSATION_CLOSED" | "CLAIM_STATUS_CHANGED" | "TYPING_START" | "TYPING_STOP";

export interface ChatEvent {
  type: ChatEventType;
  conversationId: string;
  /** Owner of the conversation (client userId) */
  userId: string;
  /** Which role should receive this event */
  targetRole: "ADMIN" | "CLIENT";
  timestamp: number;
  /** Partial message data for NEW_MESSAGE events */
  messageData?: {
    id: string;
    content: string;
    senderRole: "ADMIN" | "CLIENT";
    senderName: string;
    createdAt: string;
  };
  /** Claim status data for CLAIM_STATUS_CHANGED events */
  claimData?: {
    claimId: string;
    newStatus: string;
  };
}

type Listener = (event: ChatEvent) => void;

const GLOBAL_KEY = "__bj_chat_event_listeners__" as const;

function getListeners(): Set<Listener> {
  const g = globalThis as unknown as Record<string, Set<Listener>>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Set<Listener>();
  }
  return g[GLOBAL_KEY];
}

export function emitChatEvent(event: Omit<ChatEvent, "timestamp">) {
  const full: ChatEvent = { ...event, timestamp: Date.now() };
  const listeners = getListeners();
  for (const listener of listeners) {
    try { listener(full); } catch { /* ignore */ }
  }
}

export function subscribeChatEvents(listener: Listener): () => void {
  const listeners = getListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
