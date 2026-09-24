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
import { useRightRail } from "@/components/admin/widgets-rail";
import ChatAttachmentPreview, { type PendingFile } from "@/components/shared/ChatAttachmentPreview";
import ChatMessageAttachments, { type ChatAttachment } from "@/components/shared/ChatMessageAttachments";
import { ALLOWED_MIMES } from "@/lib/chat-upload-security";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPT_ATTR = ALLOWED_MIMES.join(",");

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
  attachments?: ChatAttachment[];
}

// ── Component ──────────────────────────────────
export default function AdminChatWidget() {
  // Panel state — piloté par le rail droit unifié (useRightRail).
  const rail = useRightRail();
  const isOpen = rail.openWidget === "chat";
  const setIsOpen = useCallback(
    (next: boolean) => {
      if (next) rail.open("chat");
      else rail.close();
    },
    [rail],
  );
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
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Typing
  const [clientTyping, setClientTyping] = useState(false);
  const clientTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unread badge
  const [totalUnread, setTotalUnread] = useState(0);

  const toast = useToast();
  const { confirm } = useConfirm();

  // Alimente le badge du rail avec le nombre de messages non lus.
  useEffect(() => {
    rail.setBadge("chat", { count: totalUnread, pulse: totalUnread > 0 });
  }, [totalUnread, rail]);

  // ── Cross-tab: only one chat open at a time ──
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try {
      const ch = new BroadcastChannel("admin-chat-widget-sync");
      channelRef.current = ch;
      ch.onmessage = (e) => {
        if (e.data === "chat-opened") {
          setIsOpen(false);
        }
      };
      return () => ch.close();
    } catch { /* BroadcastChannel not supported — single-tab fallback */ }
  }, []);

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
            data.messages.map((m: {
              id: string;
              content: string;
              createdAt: string | Date;
              sender: { firstName: string; lastName: string; role: string };
              attachments?: { id: string; fileName: string; filePath: string; fileSize: number; mimeType: string }[];
            }) => ({
              id: m.id,
              content: m.content,
              senderRole: m.sender.role as "ADMIN" | "CLIENT",
              senderName: `${m.sender.firstName} ${m.sender.lastName}`,
              createdAt: typeof m.createdAt === "string" ? m.createdAt : (m.createdAt as Date).toISOString(),
              attachments: m.attachments,
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

  // ── File picker helpers ─────────────────────
  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    const remaining = MAX_FILES - pendingFiles.length;
    const accepted: PendingFile[] = [];
    for (const file of selected.slice(0, remaining)) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} dépasse 10 Mo.`);
        continue;
      }
      accepted.push({ file, url: URL.createObjectURL(file) });
    }
    if (accepted.length > 0) setPendingFiles((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[index].url);
      copy.splice(index, 1);
      return copy;
    });
  }

  async function uploadPendingFiles(): Promise<ChatAttachment[] | null> {
    if (pendingFiles.length === 0) return [];
    const fd = new FormData();
    for (const f of pendingFiles) fd.append("files", f.file);
    const res = await fetch("/api/chat/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(data?.error || "Envoi des pièces jointes impossible.");
      return null;
    }
    const data = (await res.json()) as { attachments: ChatAttachment[] };
    for (const f of pendingFiles) URL.revokeObjectURL(f.url);
    setPendingFiles([]);
    return data.attachments;
  }

  // ── SSE real-time events ────────────────────
  const handleChatEvent = useCallback(
    (event: { type: string; conversationId: string; context?: "claim"; messageData?: ChatMessage }) => {
      // Ignorer TOUS les événements Service Client — géré par sa propre page.
      // Sans ce filtre, le widget Chat sonnait à chaque réponse Service Client.
      if (event.context === "claim") return;

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

      // Conversation closed (deleted) — remove from list, go back if viewing it
      if (event.type === "CONVERSATION_CLOSED") {
        setConversations((prev) => prev.filter((c) => c.id !== event.conversationId));
        if (event.conversationId === activeConvId) {
          setView("list");
          setActiveConvId(null);
          setMessages([]);
          setClientTyping(false);
          toast.toast({ type: "info", title: "La conversation a été clôturée" });
        }
      }
    },
    [activeConvId, isOpen, view]
  );

  // SSE always active so we receive notifications (sound + badge) even when panel is closed
  useChatStream(handleChatEvent);

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
    if (!activeConvId) return;
    const content = newMessage.trim();
    const hasFiles = pendingFiles.length > 0;
    if (!content && !hasFiles) return;

    const filesSnapshot = pendingFiles;
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
      const uploaded = await uploadPendingFiles();
      if (uploaded === null) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setNewMessage(content);
        setPendingFiles(filesSnapshot);
        return;
      }
      const result = await sendAdminReply(activeConvId, content, uploaded);
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
                  attachments: result.message!.attachments?.map((a) => ({
                    id: a.id,
                    fileName: a.fileName,
                    filePath: a.filePath,
                    fileSize: a.fileSize,
                    mimeType: a.mimeType,
                  })),
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

  // ── Close conversation (delete) ──────────────
  async function handleCloseConversation() {
    if (!activeConvId) return;
    const ok = await confirm({
      title: "Clôturer la conversation",
      message: "Voulez-vous vraiment clôturer cette conversation ? Les messages seront supprimés définitivement.",
      confirmLabel: "Clôturer",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await closeConversation(activeConvId);
      if (result.success) {
        setConversations((prev) => prev.filter((c) => c.id !== activeConvId));
        goBackToList();
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
    setPendingFiles((prev) => {
      for (const f of prev) URL.revokeObjectURL(f.url);
      return [];
    });
  }

  return (
    <>
      {/* ── Chat panel ── */}
      {isOpen && (
        <div className="admin-drawer-frame fixed z-[9000] bg-bg-primary shadow-2xl flex flex-col overflow-hidden animate-blur-in
          /* Desktop + tablette ≥ md : mode fullscreen aligné sur DrawerShell —
             tous les tiroirs du widget flottant partagent la même dimension
             depuis 2026-08-14 (demande cliente). Sur ≥ lg on garde la sidebar
             admin (300 px) et le rail FAB (360 px) visibles. */
          md:inset-0 md:border md:border-border
          lg:inset-auto lg:top-5 lg:right-[360px] lg:bottom-5 lg:left-[300px] lg:rounded-3xl
          /* Mobile < md : plein écran */
          max-md:inset-0">
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
                        {msg.content && (
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        )}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <ChatMessageAttachments
                            attachments={msg.attachments}
                            isSelf={msg.senderRole === "ADMIN"}
                          />
                        )}
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
              <ChatAttachmentPreview files={pendingFiles} onRemove={removePendingFile} />
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pendingFiles.length >= MAX_FILES || isPending}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border border-border text-text-muted hover:text-text-primary hover:border-[#1A1A1A]/30 disabled:opacity-40 transition-colors"
                  title="Joindre un fichier"
                  aria-label="Joindre un fichier"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                </button>
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
                  disabled={(!newMessage.trim() && pendingFiles.length === 0) || isPending}
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
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTR}
                multiple
                onChange={handleFilePick}
                className="hidden"
              />
            </div>
          )}
        </div>
      )}

      {/* Le bouton flottant a été retiré : le chat s'ouvre via l'icône « Messages
          clients » du rail droit. Le rail affiche le badge (totalUnread) via
          setBadge("chat", ...) plus haut dans ce composant. */}
    </>
  );
}
