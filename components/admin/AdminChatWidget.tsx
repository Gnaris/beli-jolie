"use client";

import { useState, useEffect, useRef, useTransition, useCallback } from "react";
import { useChatStream } from "@/hooks/useChatStream";
import { useToast } from "@/components/ui/Toast";
import {
  sendAdminReply,
  closeConversation,
  getAdminConversations,
  getAdminConversation,
  getAdminUnreadCount,
} from "@/app/actions/admin/messages";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { playNotificationSound } from "@/lib/notification-sound";

// ── Types ──────────────────────────────────────
interface ConversationSummary {
  id: string;
  subject: string | null;
  status: string;
  updatedAt: string | Date;
  user: { firstName: string; lastName: string; company: string | null; email: string };
  messages: { content: string; createdAt: string | Date; senderRole: string; readAt: Date | null }[];
  _count: { messages: number };
}

interface ChatMessage {
  id: string;
  content: string;
  senderRole: "ADMIN" | "CLIENT";
  senderName: string;
  createdAt: string;
}

// ── Component ──────────────────────────────────
export default function AdminChatWidget() {
  // Panel state
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"list" | "conversation">("list");

  // Conversation list
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);

  // Active conversation
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConvSubject, setActiveConvSubject] = useState<string>("");
  const [activeConvStatus, setActiveConvStatus] = useState<"OPEN" | "CLOSED">("OPEN");
  const [activeConvClient, setActiveConvClient] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convLoading, setConvLoading] = useState(false);

  // Input
  const [newMessage, setNewMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Typing
  const [clientTyping, setClientTyping] = useState(false);
  const clientTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unread badge
  const [totalUnread, setTotalUnread] = useState(0);

  const toast = useToast();
  const { confirm } = useConfirm();

  // ── Stale request guard (ignore results from outdated calls) ──
  const requestIdRef = useRef(0);

  // ── Poll unread count when panel is closed (no SSE) ──
  useEffect(() => {
    getAdminUnreadCount().then(setTotalUnread).catch(() => {});
    if (isOpen) return;
    const interval = setInterval(() => {
      getAdminUnreadCount().then(setTotalUnread).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // ── Load conversation list when panel opens ─
  useEffect(() => {
    if (!isOpen || view !== "list") return;
    let cancelled = false;
    setListLoading(true);
    getAdminConversations()
      .then((data) => {
        if (!cancelled) setConversations(data as ConversationSummary[]);
      })
      .catch(() => {
        if (!cancelled) toast.error("Impossible de charger les conversations");
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll to bottom on new messages ────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, clientTyping]);

  // ── Open a conversation ─────────────────────
  function openConversation(convId: string, subject: string, clientName: string) {
    const reqId = ++requestIdRef.current;
    setActiveConvId(convId);
    setActiveConvSubject(subject);
    setActiveConvClient(clientName);
    setView("conversation");
    setConvLoading(true);
    setMessages([]);

    getAdminConversation(convId)
      .then((data) => {
        if (requestIdRef.current !== reqId) return; // stale
        if (data) {
          setActiveConvStatus(data.status as "OPEN" | "CLOSED");
          setMessages(
            data.messages.map((m: { id: string; content: string; createdAt: string | Date; sender: { firstName: string; lastName: string; role: string } }) => ({
              id: m.id,
              content: m.content,
              senderRole: m.sender.role as "ADMIN" | "CLIENT",
              senderName: `${m.sender.firstName} ${m.sender.lastName}`,
              createdAt: typeof m.createdAt === "string" ? m.createdAt : (m.createdAt as Date).toISOString(),
            }))
          );
          const convInList = conversations.find((c) => c.id === convId);
          if (convInList && convInList._count.messages > 0) {
            setTotalUnread((prev) => Math.max(0, prev - convInList._count.messages));
          }
        }
      })
      .catch(() => {
        if (requestIdRef.current !== reqId) return;
        toast.error("Impossible de charger la conversation");
      })
      .finally(() => {
        if (requestIdRef.current !== reqId) return;
        setConvLoading(false);
      });
  }

  // ── SSE real-time events ────────────────────
  const handleChatEvent = useCallback(
    (event: { type: string; conversationId: string; messageData?: ChatMessage }) => {
      if (event.type === "NEW_MESSAGE" && event.messageData) {
        // Only handle client messages (admin messages are added optimistically)
        if (event.messageData.senderRole !== "CLIENT") return;

        // Play notification sound
        playNotificationSound();

        // Update total unread if not viewing this conversation
        if (!(isOpen && view === "conversation" && activeConvId === event.conversationId)) {
          setTotalUnread((c) => c + 1);
        }

        // Update messages if viewing this conversation
        if (activeConvId === event.conversationId && view === "conversation") {
          setMessages((prev) => {
            if (prev.some((m) => m.id === event.messageData!.id)) return prev;
            return [...prev, event.messageData!];
          });
          setClientTyping(false);
        }

        // Update conversation list preview
        setConversations((prev) =>
          prev.map((c) =>
            c.id === event.conversationId
              ? {
                  ...c,
                  messages: [
                    {
                      content: event.messageData!.content,
                      createdAt: event.messageData!.createdAt,
                      senderRole: "CLIENT",
                      readAt: null,
                    },
                  ],
                  _count: {
                    messages:
                      isOpen && view === "conversation" && activeConvId === event.conversationId
                        ? 0
                        : c._count.messages + 1,
                  },
                  updatedAt: event.messageData!.createdAt,
                }
              : c
          )
        );
      }

      // Typing indicators
      if (event.type === "TYPING_START" && event.conversationId === activeConvId) {
        setClientTyping(true);
        if (clientTypingTimerRef.current) clearTimeout(clientTypingTimerRef.current);
        clientTypingTimerRef.current = setTimeout(() => setClientTyping(false), 4000);
      }
      if (event.type === "TYPING_STOP" && event.conversationId === activeConvId) {
        setClientTyping(false);
        if (clientTypingTimerRef.current) clearTimeout(clientTypingTimerRef.current);
      }

      // Conversation closed
      if (event.type === "CONVERSATION_CLOSED" && event.conversationId === activeConvId) {
        setActiveConvStatus("CLOSED");
      }
    },
    [activeConvId, isOpen, view]
  );

  // Only open SSE connection when chat panel is open (saves HTTP connection slots)
  useChatStream(handleChatEvent, isOpen);

  // ── Typing emission ─────────────────────────
  function emitTyping(typing: boolean) {
    if (!activeConvId) return;
    fetch("/api/chat/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: activeConvId, userId: "", typing }),
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

  // ── Send reply ──────────────────────────────
  function handleSendReply() {
    if (!activeConvId || !newMessage.trim()) return;
    const content = newMessage.trim();
    setNewMessage("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    isTypingRef.current = false;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    emitTyping(false);

    // Optimistic add
    const tempId = "temp-" + Date.now();
    setMessages((prev) => [
      ...prev,
      { id: tempId, content, senderRole: "ADMIN", senderName: "Vous", createdAt: new Date().toISOString() },
    ]);

    startTransition(async () => {
      const result = await sendAdminReply(activeConvId, content);
      if (result.success && result.message) {
        // Replace temp message with real one
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: result.message!.id,
                  createdAt:
                    typeof result.message!.createdAt === "string"
                      ? result.message!.createdAt
                      : (result.message!.createdAt as Date).toISOString(),
                }
              : m
          )
        );
      } else {
        toast.error(result.error || "Erreur");
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setNewMessage(content);
      }
    });
  }

  // ── Close conversation ──────────────────────
  async function handleCloseConversation() {
    if (!activeConvId) return;
    const ok = await confirm({
      title: "Clôturer la conversation",
      message: "Voulez-vous vraiment clôturer cette conversation ?",
      confirmLabel: "Clôturer",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await closeConversation(activeConvId);
      if (result.success) {
        setActiveConvStatus("CLOSED");
        toast.success("Conversation clôturée");
      } else {
        toast.error(result.error || "Erreur");
      }
    });
  }

  // ── Key handler ─────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  }

  function handleTextareaInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 100) + "px";
  }

  // ── Helpers ─────────────────────────────────
  function formatTime(dateStr: string | Date) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(dateStr: string | Date) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "A l'instant";
    if (diffMin < 60) return `Il y a ${diffMin}min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Il y a ${diffH}h`;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  }

  function goBackToList() {
    requestIdRef.current++; // ignore any pending conversation fetch
    setView("list");
    setActiveConvId(null);
    setMessages([]);
    setNewMessage("");
    setClientTyping(false);
    setConvLoading(false);
  }

  return (
    <>
      {/* ── Chat panel ── */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[400px] h-[520px] max-h-[80vh] bg-bg-primary border border-border rounded-2xl shadow-lg z-[60] flex flex-col overflow-hidden animate-blur-in">
          {/* ── Header ── */}
          <div className="px-4 py-3 border-b border-border bg-bg-primary flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {view === "conversation" && (
                <button
                  onClick={goBackToList}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
                >
                  <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <div className="min-w-0">
                <h3 className="font-heading text-sm font-semibold text-text-primary truncate">
                  {view === "list" ? "Messages clients" : activeConvSubject || "Sans sujet"}
                </h3>
                {view === "conversation" && (
                  <p className="text-[11px] font-body text-text-muted truncate">{activeConvClient}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {view === "conversation" && activeConvStatus === "OPEN" && (
                <button
                  onClick={handleCloseConversation}
                  title="Cloturer la conversation"
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
              >
                <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-y-auto">
            {view === "list" ? (
              /* ── Conversation list ── */
              listLoading ? (
                <div className="flex items-center justify-center h-full">
                  <svg className="w-6 h-6 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-text-muted px-6">
                  <svg className="w-10 h-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.671 1.09-.085 2.17-.207 3.238-.364 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                  </svg>
                  <p className="text-sm font-body">Aucune conversation</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {conversations.map((conv) => {
                    const lastMsg = conv.messages[0];
                    const unread = conv._count.messages;
                    return (
                      <button
                        key={conv.id}
                        onClick={() =>
                          openConversation(
                            conv.id,
                            conv.subject || "Sans sujet",
                            `${conv.user.firstName} ${conv.user.lastName}${conv.user.company ? ` — ${conv.user.company}` : ""}`
                          )
                        }
                        className="w-full text-left px-4 py-3 hover:bg-bg-secondary/50 transition-colors flex items-start gap-3"
                      >
                        {/* Avatar circle */}
                        <div className="w-9 h-9 rounded-full bg-bg-secondary border border-border flex items-center justify-center shrink-0 text-xs font-semibold text-text-secondary uppercase">
                          {conv.user.firstName[0]}
                          {conv.user.lastName[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-body truncate ${unread > 0 ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
                              {conv.user.firstName} {conv.user.lastName}
                            </span>
                            <span className="text-[10px] font-body text-text-muted shrink-0">
                              {lastMsg ? formatDate(lastMsg.createdAt) : ""}
                            </span>
                          </div>
                          <p className="text-xs font-body text-text-muted truncate mt-0.5">
                            {conv.subject || "Sans sujet"}
                          </p>
                          {lastMsg && (
                            <p className={`text-xs font-body truncate mt-0.5 ${unread > 0 ? "text-text-primary font-medium" : "text-text-muted"}`}>
                              {lastMsg.senderRole === "ADMIN" ? "Vous : " : ""}
                              {lastMsg.content}
                            </p>
                          )}
                        </div>
                        {unread > 0 && (
                          <span className="shrink-0 flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-blue-500 text-white text-[11px] font-bold rounded-full">
                            {unread}
                          </span>
                        )}
                        {conv.status === "CLOSED" && (
                          <span className="shrink-0 badge badge-neutral text-[10px]">Clos</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              /* ── Conversation thread ── */
              convLoading ? (
                <div className="flex items-center justify-center h-full">
                  <svg className="w-6 h-6 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : (
                <div className="p-3 space-y-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.senderRole === "ADMIN" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm font-body ${
                          msg.senderRole === "ADMIN"
                            ? "bg-[#1A1A1A] text-white rounded-br-md"
                            : "bg-bg-secondary text-text-primary border border-border rounded-bl-md"
                        }`}
                      >
                        {msg.senderRole === "CLIENT" && (
                          <p className="text-[10px] font-medium text-text-muted mb-0.5">{msg.senderName}</p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        <p
                          className={`text-[10px] mt-1 ${
                            msg.senderRole === "ADMIN" ? "text-white/50" : "text-text-muted"
                          }`}
                        >
                          {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {clientTyping && (
                    <div className="flex justify-start">
                      <div className="bg-bg-secondary border border-border rounded-2xl rounded-bl-md px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )
            )}
          </div>

          {/* ── Closed banner ── */}
          {view === "conversation" && activeConvStatus === "CLOSED" && !convLoading && (
            <div className="border-t border-border px-4 py-3 bg-bg-secondary/50 shrink-0">
              <p className="text-xs font-body text-text-muted text-center">
                Cette conversation a ete cloturee.
              </p>
            </div>
          )}

          {/* ── Input area ── */}
          {view === "conversation" && activeConvStatus === "OPEN" && !convLoading && (
            <div className="border-t border-border px-3 py-2.5 shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    handleTextareaInput();
                    handleTypingChange();
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Repondre..."
                  disabled={isPending}
                  rows={1}
                  className="flex-1 resize-none border border-border bg-bg-primary rounded-xl px-3 py-2 text-sm text-text-primary font-body placeholder:text-text-muted focus:outline-none focus:border-[#1A1A1A] disabled:opacity-50"
                />
                <button
                  onClick={handleSendReply}
                  disabled={!newMessage.trim() || isPending}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-[#1A1A1A] text-white hover:bg-[#333] disabled:opacity-40 transition-colors"
                >
                  {isPending ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Floating bubble ── */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) {
            setView("list");
          }
        }}
        className="fixed bottom-6 right-4 sm:right-6 z-[60] w-14 h-14 bg-[#1A1A1A] text-white rounded-full shadow-lg hover:bg-[#333] transition-all hover:scale-105 flex items-center justify-center"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.671 1.09-.085 2.17-.207 3.238-.364 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
              />
            </svg>
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1 bg-red-500 text-white text-[11px] font-bold rounded-full animate-pulse">
                {totalUnread}
              </span>
            )}
          </>
        )}
      </button>
    </>
  );
}
