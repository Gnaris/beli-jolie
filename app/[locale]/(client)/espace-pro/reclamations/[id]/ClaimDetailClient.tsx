"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useChatStream, type ChatEvent } from "@/hooks/useChatStream";
import { useActiveConversation } from "@/hooks/useActiveConversation";
import { sendClientMessage } from "@/app/actions/client/claims";

const MAX_ATTACHMENTS = 5;
const SYSTEM_PREFIX = "__system__:";
const SYSTEM_MSG_TEXT = "Un mail a été envoyé à l'administrateur. Il traitera votre demande sous quelques minutes.";

type Attachment = {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
};

type Message = {
  id: string;
  content: string;
  senderRole: "ADMIN" | "CLIENT";
  senderFirstName: string | null;
  createdAt: string;
  attachments: Attachment[];
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ClaimDetailClient({
  claimId,
  conversationId,
  initialMessages,
  initialStatus,
}: {
  claimId: string;
  conversationId: string;
  initialMessages: Message[];
  initialStatus: "OPEN" | "CLOSED";
}) {
  const router = useRouter();
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [status, setStatus] = useState<"OPEN" | "CLOSED">(initialStatus);
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, startSending] = useTransition();
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Déclare au serveur qu'on lit cette conversation → pas de mail 5 min si
  // l'admin répond pendant qu'on est là.
  useActiveConversation(conversationId);

  useChatStream((event: ChatEvent) => {
    if (event.conversationId !== conversationId) return;
    if (event.type === "NEW_MESSAGE" && event.messageData && event.messageData.senderRole === "ADMIN") {
      const md = event.messageData;
      setMessages((prev) => {
        if (prev.some((m) => m.id === md.id)) return prev;
        return [
          ...prev,
          {
            id: md.id,
            content: md.content,
            senderRole: "ADMIN",
            senderFirstName: md.senderName,
            createdAt: md.createdAt,
            attachments: md.attachments ?? [],
          },
        ];
      });
    }
    if (event.type === "CLAIM_STATUS_CHANGED" && event.claimData?.claimId === claimId) {
      setStatus(event.claimData.newStatus as "OPEN" | "CLOSED");
    }
    // Redirection propre quand l'admin supprime la conversation en direct
    if (event.type === "CONVERSATION_DELETED") {
      toast.info(
        "Conversation supprimée",
        "L'administrateur a supprimé cette conversation. Vous êtes redirigé(e) vers vos autres tickets.",
      );
      router.replace("/espace-pro/reclamations");
    }
  }, true);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    setPendingFiles((prev) => [...prev, ...arr].slice(0, MAX_ATTACHMENTS));
  }

  function removeFile(idx: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function uploadAttachments(): Promise<Attachment[]> {
    if (pendingFiles.length === 0) return [];
    setIsUploading(true);
    try {
      const fd = new FormData();
      for (const f of pendingFiles) fd.append("files", f);
      const res = await fetch("/api/chat/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Échec de l'upload.");
      }
      const data = (await res.json()) as { attachments: Omit<Attachment, "id">[] };
      return data.attachments.map((a, i) => ({ ...a, id: `tmp-${Date.now()}-${i}` }));
    } finally {
      setIsUploading(false);
    }
  }

  function handleSend() {
    if (!draft.trim() && pendingFiles.length === 0) return;

    startSending(async () => {
      let uploaded: Attachment[] = [];
      try {
        uploaded = await uploadAttachments();
      } catch (err) {
        toast.error("Échec de l'envoi", err instanceof Error ? err.message : undefined);
        return;
      }

      const res = await sendClientMessage(
        claimId,
        draft.trim(),
        uploaded.map((a) => ({
          fileName: a.fileName,
          filePath: a.filePath,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
        })),
      );

      if (!res.success) {
        toast.error("Échec de l'envoi", res.error);
        return;
      }

      const wasClosed = status === "CLOSED";
      if (wasClosed) setStatus("OPEN");

      setMessages((prev) => [
        ...prev,
        {
          id: `tmp-${Date.now()}`,
          content: draft.trim() || "📎 Pièce jointe",
          senderRole: "CLIENT",
          senderFirstName: null,
          createdAt: new Date().toISOString(),
          attachments: uploaded,
        },
      ]);
      setDraft("");
      setPendingFiles([]);

      if (wasClosed) {
        toast.success("Conversation rouverte", "Votre message vient d'être envoyé.");
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Entrée = envoie · Shift + Entrée = retour à la ligne
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden flex flex-col shadow-sm" style={{ minHeight: 480 }}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-text-muted italic py-10">Aucun message.</p>
        )}
        {messages.map((m) => {
          if (m.content.startsWith(SYSTEM_PREFIX)) {
            return (
              <div key={m.id} className="flex justify-center">
                <div className="px-3 py-1.5 rounded-full bg-zinc-100 text-[11.5px] italic text-text-muted max-w-md text-center">
                  {SYSTEM_MSG_TEXT}
                </div>
              </div>
            );
          }
          const isMe = m.senderRole === "CLIENT";
          return (
            <div key={m.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
              <div className={`w-8 h-8 rounded-full text-white font-bold flex items-center justify-center text-xs shrink-0 ${isMe ? "bg-zinc-500" : "bg-zinc-900"}`}>
                {isMe ? "V" : "S"}
              </div>
              <div className="max-w-[75%]">
                <div className={`px-4 py-3 whitespace-pre-wrap text-[14px] leading-relaxed ${
                  isMe
                    ? "bg-zinc-100 text-text-primary rounded-2xl rounded-br-md"
                    : "bg-zinc-900 text-white rounded-2xl rounded-bl-md"
                }`}>
                  {m.content}
                  <AttachmentGrid attachments={m.attachments} />
                </div>
                <p className={`text-[11px] mt-1 text-text-muted ${isMe ? "pr-1 text-right" : "pl-1"}`}>
                  {isMe ? "Vous" : (m.senderFirstName ?? "Support")} · {formatTime(m.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={`border-t border-border p-4 bg-bg-secondary transition-colors ${isDragging ? "bg-zinc-100" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
      >
        {status === "CLOSED" && (
          <div className="mb-3 rounded-xl bg-zinc-50 border border-zinc-200 p-3 text-xs text-text-secondary text-center">
            Cette conversation est fermée. Envoyez un nouveau message pour la rouvrir.
          </div>
        )}

        {pendingFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {pendingFiles.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-border text-xs">
                <span className="max-w-[180px] truncate">{f.name}</span>
                <button type="button" onClick={() => removeFile(i)} className="text-text-muted hover:text-red-600" aria-label="Retirer">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="rounded-2xl bg-white border border-border overflow-hidden shadow-sm">
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending || isUploading}
            placeholder="Votre message…"
            className="w-full px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-zinc-400 disabled:bg-zinc-50"
          />
          <div className="flex items-center justify-between px-3 py-2 border-t border-border">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pendingFiles.length >= MAX_ATTACHMENTS}
                className="w-9 h-9 rounded-lg hover:bg-zinc-100 flex items-center justify-center transition-colors disabled:opacity-40"
                title={`Joindre une image ou un PDF (max ${MAX_ATTACHMENTS})`}
              >
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || isUploading || (!draft.trim() && pendingFiles.length === 0)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-dark text-text-inverse text-sm font-semibold shadow-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSending || isUploading ? "Envoi…" : "Envoyer"}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
        <p className="text-[11px] text-text-muted mt-2 pl-1">
          Glissez-déposez une image · <kbd className="px-1.5 py-0.5 rounded border border-border bg-white font-mono text-[10px]">Entrée</kbd> pour envoyer · <kbd className="px-1.5 py-0.5 rounded border border-border bg-white font-mono text-[10px]">Shift</kbd> + <kbd className="px-1.5 py-0.5 rounded border border-border bg-white font-mono text-[10px]">Entrée</kbd> pour retour à la ligne.
        </p>
      </div>
    </section>
  );
}

function AttachmentGrid({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {attachments.map((a) => {
        const isImage = a.mimeType.startsWith("image/");
        return (
          <a
            key={a.id}
            href={a.filePath}
            target="_blank"
            rel="noopener noreferrer"
            className="block aspect-square rounded-lg border border-zinc-300 bg-zinc-200 overflow-hidden hover:opacity-90 transition-opacity"
            title={a.fileName}
          >
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.filePath} alt={a.fileName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[11px] font-medium text-zinc-700 p-2 text-center">
                {a.fileName}
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
}
