"use client";

import { useState, useEffect, useRef, useTransition, useCallback } from "react";
import { useChatStream } from "@/hooks/useChatStream";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  createSupportConversation,
  getActiveSupportChat,
  sendClientMessage,
  closeClientConversation,
} from "@/app/actions/client/messages";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import { isWithinBusinessHours, getNextOpenSlot, formatScheduleForDisplay } from "@/lib/business-hours";
import { playNotificationSound } from "@/lib/notification-sound";

// ── Types ──────────────────────────────────────
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
  // "loading" = fetching active conv, "new" = no conv yet, "conversation" = showing messages
  const [view, setView] = useState<"loading" | "new" | "conversation">("loading");

  // Active conversation
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConvSubject, setActiveConvSubject] = useState("");
  const [activeConvStatus, setActiveConvStatus] = useState<"OPEN" | "CLOSED">("OPEN");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // New conversation form
  const [subject, setSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");

  // Shared
  const [unreadCount, setUnreadCount] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isOnline = businessHours ? isWithinBusinessHours(businessHours) : true;
  const nextSlot = businessHours ? getNextOpenSlot(businessHours) : null;
  const scheduleRows = businessHours ? formatScheduleForDisplay(businessHours) : [];

  // ── Cross-tab: only one chat open at a time ──
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try {
      const ch = new BroadcastChannel("chat-widget-sync");
      channelRef.current = ch;
      ch.onmessage = (e) => {
        if (e.data === "chat-opened") {
          setIsOpen(false);
          setShowSchedule(false);
        }
      };
      return () => ch.close();
    } catch { /* BroadcastChannel not supported — single-tab fallback */ }
  }, []);

  // ── Stale request guard ──
  const requestIdRef = useRef(0);

  // ── Load the single active conversation when panel opens ──
  useEffect(() => {
    if (!isOpen) return;
    const reqId = ++requestIdRef.current;
    setView("loading");

    getActiveSupportChat()
      .then((conv) => {
        if (requestIdRef.current !== reqId) return;
        if (conv) {
          setActiveConvId(conv.id);
          setActiveConvSubject(conv.subject || "");
          setActiveConvStatus(conv.status as "OPEN" | "CLOSED");
          setMessages(
            conv.messages.map((m: { id: string; content: string; createdAt: string | Date; sender: { firstName: string; lastName: string; role: string } }) => ({
              id: m.id,
              content: m.content,
              senderRole: m.sender.role as "ADMIN" | "CLIENT",
              senderName: `${m.sender.firstName} ${m.sender.lastName}`,
              createdAt: typeof m.createdAt === "string" ? m.createdAt : (m.createdAt as Date).toISOString(),
            }))
          );
          setUnreadCount(0);
          setView("conversation");
        } else {
          setActiveConvId(null);
          setMessages([]);
          setView("new");
        }
      })
      .catch(() => {
        if (requestIdRef.current !== reqId) return;
        setView("new");
      });
  }, [isOpen]);

  // ── Scroll to bottom on new messages ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── SSE: always active for notifications ──
  const handleChatEvent = useCallback(
    (event: { type: string; conversationId: string; messageData?: ChatMessage }) => {
      if (event.type === "NEW_MESSAGE" && event.messageData) {
        if (event.messageData.senderRole === "ADMIN") {
          playNotificationSound();

          // Toast if panel is closed
          if (!isOpen) {
            toast.toast({
              type: "info",
              title: "Nouveau message du support",
              action: {
                label: "Ouvrir le chat",
                onClick: () => {
                  setIsOpen(true);
                  channelRef.current?.postMessage("chat-opened");
                },
              },
            });
          }
        }

        // Update messages if viewing this conversation
        if (activeConvId === event.conversationId && view === "conversation") {
          setMessages((prev) => {
            if (prev.some((m) => m.id === event.messageData!.id)) return prev;
            return [...prev, event.messageData!];
          });
        } else {
          setUnreadCount((c) => c + 1);
        }
      }
      if (event.type === "CONVERSATION_CLOSED" && event.conversationId === activeConvId) {
        // Conversation deleted by admin — reset to new form
        setActiveConvId(null);
        setActiveConvSubject("");
        setMessages([]);
        setView("new");
        toast.toast({ type: "info", title: "La conversation a été clôturée" });
      }
    },
    [activeConvId, view, isOpen, toast]
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
        // Switch to the newly created conversation
        setActiveConvId(result.conversationId);
        setActiveConvSubject(subject.trim());
        setActiveConvStatus("OPEN");
        setMessages([{
          id: "temp-initial",
          content: newMessage.trim(),
          senderRole: "CLIENT",
          senderName: "Vous",
          createdAt: new Date().toISOString(),
        }]);
        setSubject("");
        setNewMessage("");
        setView("conversation");
        toast.success("Message envoyé");
      } else {
        toast.error(result.error || "Erreur");
      }
    });
  }

  // ── Close conversation (delete) ──
  async function handleCloseConversation() {
    if (!activeConvId) return;
    const ok = await confirm({
      title: "Clôturer la conversation",
      message: "Voulez-vous vraiment clôturer cette conversation ? Les messages seront supprimés.",
      confirmLabel: "Clôturer",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await closeClientConversation(activeConvId);
      if (result.success) {
        setActiveConvId(null);
        setActiveConvSubject("");
        setMessages([]);
        setSubject("");
        setNewMessage("");
        setView("new");
        toast.success("Conversation clôturée");
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

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <>
      {/* ── Chat panel ── */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[380px] h-[480px] max-h-[80vh] bg-bg-primary border border-border rounded-2xl shadow-lg z-[60] flex flex-col overflow-hidden animate-blur-in">
          {/* ── Header ── */}
          <div className="px-4 py-3 border-b border-border bg-bg-primary flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <h3 className="font-heading text-sm font-semibold text-text-primary truncate">
                  {view === "new" ? "Nouveau message" : activeConvSubject || "Support"}
                </h3>
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
              </div>
            </div>
            <div className="flex items-center gap-1">
              {view === "conversation" && activeConvStatus === "OPEN" && (
                <button
                  onClick={handleCloseConversation}
                  title="Clôturer la conversation"
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => { setIsOpen(false); setShowSchedule(false); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
              >
                <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
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
            {view === "loading" ? (
              <div className="flex items-center justify-center h-full">
                <svg className="w-6 h-6 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
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
            )}
          </div>

          {/* ── Input area for conversation ── */}
          {view === "conversation" && (
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

        </div>
      )}

      {/* ── Floating bubble ── */}
      <button
        onClick={() => {
          const opening = !isOpen;
          setIsOpen(opening);
          if (opening) {
            setUnreadCount(0);
            setShowSchedule(false);
            channelRef.current?.postMessage("chat-opened");
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
