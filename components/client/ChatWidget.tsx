"use client";

import { useState, useEffect, useRef, useTransition, useCallback } from "react";
import { useChatStream } from "@/hooks/useChatStream";
import { useToast } from "@/components/ui/Toast";
import {
  createSupportConversation,
  getClientConversations,
  getClientConversation,
  sendClientMessage,
} from "@/app/actions/client/messages";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import { isWithinBusinessHours, getNextOpenSlot, formatScheduleForDisplay } from "@/lib/business-hours";
import Link from "next/link";
import { playNotificationSound } from "@/lib/notification-sound";

// ── Types ──────────────────────────────────────
interface ConversationSummary {
  id: string;
  subject: string | null;
  status: string;
  updatedAt: string | Date;
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

interface Props {
  businessHours: BusinessHoursSchedule | null;
}

export default function ChatWidget({ businessHours }: Props) {
  // Panel state
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"list" | "conversation" | "new">("list");

  // Conversation list
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);

  // Active conversation
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConvSubject, setActiveConvSubject] = useState("");
  const [activeConvStatus, setActiveConvStatus] = useState<"OPEN" | "CLOSED">("OPEN");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convLoading, setConvLoading] = useState(false);

  // New conversation form
  const [subject, setSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");

  // Shared
  const [unreadCount, setUnreadCount] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isOnline = businessHours ? isWithinBusinessHours(businessHours) : true;
  const nextSlot = businessHours ? getNextOpenSlot(businessHours) : null;
  const scheduleRows = businessHours ? formatScheduleForDisplay(businessHours) : [];

  // ── Load conversation list when panel opens on list view ──
  useEffect(() => {
    if (!isOpen || view !== "list") return;
    let cancelled = false;
    setListLoading(true);
    getClientConversations()
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

  // ── Scroll to bottom on new messages ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Stale request guard ──
  const requestIdRef = useRef(0);

  // ── Open a conversation ──
  function openConversation(convId: string, convSubject: string) {
    const reqId = ++requestIdRef.current;
    setActiveConvId(convId);
    setActiveConvSubject(convSubject);
    setView("conversation");
    setConvLoading(true);
    setMessages([]);

    getClientConversation(convId)
      .then((data) => {
        if (requestIdRef.current !== reqId) return;
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
          // Decrease unread for this conversation
          const convInList = conversations.find((c) => c.id === convId);
          if (convInList && convInList._count.messages > 0) {
            setUnreadCount((prev) => Math.max(0, prev - convInList._count.messages));
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

  // ── SSE: always active for notifications ──
  const handleChatEvent = useCallback(
    (event: { type: string; conversationId: string; messageData?: ChatMessage }) => {
      if (event.type === "NEW_MESSAGE" && event.messageData) {
        const isCurrentConv = activeConvId === event.conversationId && view === "conversation";

        if (event.messageData.senderRole === "ADMIN") {
          playNotificationSound();

          // Toast with "Voir" button for messages in a different conversation
          if (!isCurrentConv) {
            const convSubject = conversations.find((c) => c.id === event.conversationId)?.subject;
            const convId = event.conversationId;
            toast.toast({
              type: "info",
              title: `Nouveau message dans « ${convSubject || "Sans sujet"} »`,
              action: {
                label: "Voir la conversation",
                onClick: () => {
                  setIsOpen(true);
                  openConversation(convId, convSubject || "Sans sujet");
                },
              },
            });
          }
        }

        // Update messages if viewing this conversation
        if (isCurrentConv) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === event.messageData!.id)) return prev;
            return [...prev, event.messageData!];
          });
        } else {
          setUnreadCount((c) => c + 1);
        }

        // Update list preview
        setConversations((prev) =>
          prev.map((c) =>
            c.id === event.conversationId
              ? {
                  ...c,
                  messages: [{
                    content: event.messageData!.content,
                    createdAt: event.messageData!.createdAt,
                    senderRole: event.messageData!.senderRole,
                    readAt: null,
                  }],
                  _count: {
                    messages: isCurrentConv ? 0 : c._count.messages + 1,
                  },
                  updatedAt: event.messageData!.createdAt,
                }
              : c
          )
        );
      }
      if (event.type === "CONVERSATION_CLOSED" && event.conversationId === activeConvId) {
        setActiveConvStatus("CLOSED");
      }
    },
    [activeConvId, view, conversations, toast]
  );

  useChatStream(handleChatEvent);

  // ── Send message in existing conversation ──
  function handleSendMessage() {
    if (!activeConvId || !newMessage.trim()) return;
    const content = newMessage.trim();
    setNewMessage("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Optimistic add
    const tempId = "temp-" + Date.now();
    setMessages((prev) => [
      ...prev,
      { id: tempId, content, senderRole: "CLIENT", senderName: "Vous", createdAt: new Date().toISOString() },
    ]);

    startTransition(async () => {
      const result = await sendClientMessage(activeConvId, content);
      if (result.success && result.message) {
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

  // ── Create new conversation ──
  function handleCreateConversation() {
    if (!subject.trim() || !newMessage.trim()) return;
    startTransition(async () => {
      const result = await createSupportConversation(subject.trim(), newMessage.trim());
      if (result.success && result.conversationId) {
        setSubject("");
        setNewMessage("");
        // Go back to list to see the new conversation
        setView("list");
        toast.success("Message envoyé");
      } else {
        toast.error(result.error || "Erreur");
      }
    });
  }

  // ── Key handlers ──
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (view === "conversation") handleSendMessage();
      else handleCreateConversation();
    }
  }

  function handleTextareaInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 100) + "px";
  }

  // ── Navigation ──
  function goBackToList() {
    requestIdRef.current++;
    setView("list");
    setActiveConvId(null);
    setMessages([]);
    setNewMessage("");
    setConvLoading(false);
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
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

  return (
    <>
      {/* ── Chat panel ── */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[380px] h-[480px] max-h-[80vh] bg-bg-primary border border-border rounded-2xl shadow-lg z-[60] flex flex-col overflow-hidden animate-blur-in">
          {/* ── Header ── */}
          <div className="px-4 py-3 border-b border-border bg-bg-primary flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {(view === "conversation" || view === "new") && (
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
                  {view === "list" ? "Mes conversations" : view === "new" ? "Nouveau message" : activeConvSubject || "Sans sujet"}
                </h3>
                {view === "list" && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-green-500" : "bg-red-400"}`} />
                    <span className="text-[11px] font-body text-text-muted">
                      {isOnline ? "En ligne" : "Hors ligne"}
                    </span>
                    {!isOnline && nextSlot && (
                      <button
                        onClick={() => setShowSchedule(!showSchedule)}
                        className="text-[11px] font-body text-text-muted hover:text-text-secondary underline ml-1"
                      >
                        Horaires
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => { setIsOpen(false); setShowSchedule(false); }}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
            >
              <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Schedule dropdown */}
          {showSchedule && businessHours && (
            <div className="px-4 py-3 border-b border-border bg-bg-secondary/50 space-y-1.5 shrink-0">
              <p className="text-xs font-medium font-body text-text-secondary mb-2">Horaires d&apos;ouverture</p>
              {scheduleRows.map((row) => (
                <div key={row.day} className="flex items-center justify-between text-xs font-body">
                  <span className="text-text-secondary">{row.day}</span>
                  <span className={row.hours === "Fermé" ? "text-text-muted italic" : "text-text-primary"}>
                    {row.hours}
                  </span>
                </div>
              ))}
              {nextSlot && (
                <p className="text-xs font-body text-text-muted mt-2 pt-2 border-t border-border">
                  Prochaine ouverture : {nextSlot.day} à {nextSlot.time}
                </p>
              )}
            </div>
          )}

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
                  <p className="text-sm font-body mb-3">Aucune conversation</p>
                  <button
                    onClick={() => setView("new")}
                    className="text-xs font-body text-text-muted hover:text-text-secondary underline transition-colors"
                  >
                    Envoyer un premier message
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {conversations.map((conv) => {
                    const lastMsg = conv.messages[0];
                    const unread = conv._count.messages;
                    return (
                      <button
                        key={conv.id}
                        onClick={() => openConversation(conv.id, conv.subject || "Sans sujet")}
                        className="w-full text-left px-4 py-3 hover:bg-bg-secondary/50 transition-colors flex items-start gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-body truncate ${unread > 0 ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
                              {conv.subject || "Sans sujet"}
                            </span>
                            <span className="text-[10px] font-body text-text-muted shrink-0">
                              {lastMsg ? formatDate(lastMsg.createdAt) : ""}
                            </span>
                          </div>
                          {lastMsg && (
                            <p className={`text-xs font-body truncate mt-0.5 ${unread > 0 ? "text-text-primary font-medium" : "text-text-muted"}`}>
                              {lastMsg.senderRole === "CLIENT" ? "Vous : " : ""}
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
            ) : view === "new" ? (
              /* ── New conversation form ── */
              <div className="p-4 space-y-4">
                {!isOnline && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    <p className="text-xs font-body text-amber-800">
                      Nous sommes actuellement fermés. Vous pouvez laisser un message, nous vous répondrons dès que possible.
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium font-body text-text-secondary mb-1">Sujet</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Ex: Question sur une commande"
                    className="w-full px-3 py-2 border border-border bg-bg-primary rounded-xl text-sm font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[#1A1A1A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium font-body text-text-secondary mb-1">Message</label>
                  <textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Écrivez votre message..."
                    rows={3}
                    className="w-full px-3 py-2 border border-border bg-bg-primary rounded-xl text-sm font-body text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-[#1A1A1A]"
                  />
                </div>
                <button
                  onClick={handleCreateConversation}
                  disabled={!subject.trim() || !newMessage.trim() || isPending}
                  className="w-full py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-xl hover:bg-[#333] disabled:opacity-40 transition-colors"
                >
                  {isPending ? "Envoi..." : "Envoyer"}
                </button>
              </div>
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
                      className={`flex ${msg.senderRole === "CLIENT" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm font-body ${
                          msg.senderRole === "CLIENT"
                            ? "bg-[#1A1A1A] text-white rounded-br-md"
                            : "bg-bg-secondary text-text-primary border border-border rounded-bl-md"
                        }`}
                      >
                        {msg.senderRole === "ADMIN" && (
                          <p className="text-[10px] font-medium text-text-muted mb-0.5">{msg.senderName}</p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        <p
                          className={`text-[10px] mt-1 ${
                            msg.senderRole === "CLIENT" ? "text-white/50" : "text-text-muted"
                          }`}
                        >
                          {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )
            )}
          </div>

          {/* ── Closed banner ── */}
          {view === "conversation" && activeConvStatus === "CLOSED" && !convLoading && (
            <div className="border-t border-border px-4 py-3 bg-bg-secondary/50 shrink-0">
              <p className="text-xs font-body text-text-muted text-center">
                Cette conversation a été clôturée.
              </p>
            </div>
          )}

          {/* ── Input area for existing OPEN conversation ── */}
          {view === "conversation" && activeConvStatus === "OPEN" && !convLoading && (
            <div className="border-t border-border px-3 py-2.5 shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    handleTextareaInput();
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Écrivez votre message..."
                  disabled={isPending}
                  rows={1}
                  className="flex-1 resize-none border border-border bg-bg-primary rounded-xl px-3 py-2 text-sm text-text-primary font-body placeholder:text-text-muted focus:outline-none focus:border-[#1A1A1A] disabled:opacity-50"
                />
                <button
                  onClick={handleSendMessage}
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

          {/* ── Footer ── */}
          <div className="border-t border-border px-4 py-2 shrink-0 flex items-center justify-between">
            <Link
              href="/espace-pro/messages"
              className="text-xs font-body text-text-muted hover:text-text-secondary transition-colors"
              onClick={() => setIsOpen(false)}
            >
              Voir tous les messages
            </Link>
            {view === "list" && (
              <button
                onClick={() => setView("new")}
                className="text-xs font-body font-medium text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Nouveau
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Floating bubble ── */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) {
            setView("list");
            setUnreadCount(0);
            setShowSchedule(false);
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
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1 bg-red-500 text-white text-[11px] font-bold rounded-full">
                {unreadCount}
              </span>
            )}
          </>
        )}
      </button>
    </>
  );
}
