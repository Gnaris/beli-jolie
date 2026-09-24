"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useChatStream, type ChatEvent } from "@/hooks/useChatStream";
import {
  sendAdminMessage,
  closeClaim,
  deleteClaim,
} from "@/app/actions/admin/claims";

const SYSTEM_PREFIX = "__system__:";
const SYSTEM_MSG_TEXT = "Un mail a été envoyé à l'administrateur. Il traitera votre demande sous quelques minutes.";
const MAX_ATTACHMENTS = 5;

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
  readAt: string | null;
  attachments: Attachment[];
};

type ClaimSummary = {
  id: string;
  reference: string;
  subject: string;
  status: "OPEN" | "CLOSED";
  createdAt: string;
};

type ClientSummary = {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  createdAt: string;
  orderCount: number;
  totalSpent: number;
};

type PreviousClaim = {
  id: string;
  reference: string;
  subject: string;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  createdAt: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminClaimConversation({
  claim,
  client,
  conversation,
  previousClaims,
  adminName,
}: {
  claim: ClaimSummary;
  client: ClientSummary;
  conversation: { id: string; messages: Message[] } | null;
  previousClaims: PreviousClaim[];
  adminName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [status, setStatus] = useState<"OPEN" | "CLOSED">(claim.status);
  const [messages, setMessages] = useState<Message[]>(conversation?.messages ?? []);
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, startSending] = useTransition();
  const [isClosing, startClosing] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const conversationId = conversation?.id ?? null;

  // Autoscroll bas
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // SSE — écoute les nouveaux messages CLIENT et les MESSAGE_READ
  useChatStream((event: ChatEvent) => {
    if (event.conversationId !== conversationId) return;

    if (event.type === "NEW_MESSAGE" && event.messageData && event.messageData.senderRole === "CLIENT") {
      const md = event.messageData;
      setMessages((prev) => {
        if (prev.some((m) => m.id === md.id)) return prev;
        return [
          ...prev,
          {
            id: md.id,
            content: md.content,
            senderRole: "CLIENT",
            senderFirstName: md.senderName,
            createdAt: md.createdAt,
            readAt: null,
            attachments: md.attachments ?? [],
          },
        ];
      });
      // Réouverture auto (si la conv était CLOSED côté client → serveur remet à OPEN)
      if (status === "CLOSED") setStatus("OPEN");
    }

    if (event.type === "MESSAGE_READ") {
      const readAtIso = new Date(event.timestamp).toISOString();
      setMessages((prev) =>
        prev.map((m) => (m.senderRole === "ADMIN" && !m.readAt ? { ...m, readAt: readAtIso } : m)),
      );
    }
  }, Boolean(conversationId));

  async function handleUpload(files: File[]): Promise<Attachment[]> {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const res = await fetch("/api/chat/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Échec de l'upload.");
    }
    const data = (await res.json()) as { attachments: Omit<Attachment, "id">[] };
    return data.attachments.map((a, i) => ({ ...a, id: `tmp-${Date.now()}-${i}` }));
  }

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    const combined = [...pendingFiles, ...arr].slice(0, MAX_ATTACHMENTS);
    setPendingFiles(combined);
  }

  function removeFile(idx: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSend() {
    if (!draft.trim() && pendingFiles.length === 0) return;
    if (status === "CLOSED") {
      toast.error("Conversation fermée", "Le client peut la rouvrir en écrivant à nouveau.");
      return;
    }

    startSending(async () => {
      let uploaded: Attachment[] = [];
      if (pendingFiles.length > 0) {
        try {
          setIsUploading(true);
          uploaded = await handleUpload(pendingFiles);
        } catch (err) {
          setIsUploading(false);
          toast.error("Échec de l'envoi", err instanceof Error ? err.message : undefined);
          return;
        }
        setIsUploading(false);
      }

      const res = await sendAdminMessage(
        claim.id,
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

      // Ajout optimiste immédiat côté UI
      setMessages((prev) => [
        ...prev,
        {
          id: res.messageId ?? `tmp-${Date.now()}`,
          content: draft.trim() || "📎 Pièce jointe",
          senderRole: "ADMIN",
          senderFirstName: adminName,
          createdAt: new Date().toISOString(),
          readAt: null,
          attachments: uploaded,
        },
      ]);
      setDraft("");
      setPendingFiles([]);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Entrée = envoie · Shift + Entrée = retour à la ligne (WhatsApp-like)
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleClose() {
    const ok = await confirm({
      type: "warning",
      title: "Clôturer la conversation",
      message: "Le client pourra toujours vous relancer plus tard — sa réponse rouvrira automatiquement la conversation.",
      confirmLabel: "Clôturer",
    });
    if (!ok) return;

    startClosing(async () => {
      const res = await closeClaim(claim.id);
      if (!res.success) {
        toast.error("Impossible de clôturer", res.error);
        return;
      }
      setStatus("CLOSED");
      toast.success("Conversation clôturée");
      router.refresh();
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      type: "danger",
      title: "Supprimer définitivement la conversation ?",
      message: `Réf. ${claim.reference} — cette action est irréversible. Tous les messages et pièces jointes seront effacés.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;

    startDeleting(async () => {
      const res = await deleteClaim(claim.id);
      if (!res.success) {
        toast.error("Suppression impossible", res.error);
        return;
      }
      toast.success("Conversation supprimée");
      router.push("/admin/service-client");
    });
  }

  const clientDisplayName = client.company || `${client.firstName} ${client.lastName}`.trim() || client.email;
  const clientInitial = (clientDisplayName || "?").charAt(0).toUpperCase();

  return (
    <div className="space-y-5" data-admin-chat>
      {/* HEADER conversation */}
      <section
        className="relative rounded-3xl border border-border p-5 sm:p-6 overflow-hidden"
        style={{
          background: `
            radial-gradient(60% 80% at 12% 10%, rgba(24,24,27,0.06), transparent 60%),
            radial-gradient(50% 70% at 92% 20%, rgba(63,63,70,0.05), transparent 60%),
            linear-gradient(180deg, #F5F5F4 0%, var(--color-bg-primary) 60%, var(--color-bg-primary) 100%)
          `,
        }}
      >
        <div
          className="absolute -top-16 -right-10 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: "rgba(24,24,27,0.08)", filter: "blur(48px)" }}
        />
        <div className="relative flex flex-col md:flex-row md:items-start gap-4 md:gap-5">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="w-14 h-14 rounded-2xl bg-zinc-800 text-white font-bold flex items-center justify-center text-lg shrink-0">
              {clientInitial}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={status} />
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">{claim.reference}</span>
              </div>
              <h1 className="font-heading text-xl md:text-2xl font-bold tracking-tight mt-1 break-words">{claim.subject}</h1>
              <p className="text-sm mt-1 text-text-secondary truncate">
                <b>{client.company || `${client.firstName} ${client.lastName}`.trim()}</b>
                {client.company && (client.firstName || client.lastName) && ` · ${client.firstName} ${client.lastName}`}
                {" · "}
                <a href={`mailto:${client.email}`} className="hover:underline">{client.email}</a>
              </p>
              <p className="text-[12px] mt-1 text-text-muted">
                Ouverte le {formatDay(claim.createdAt)} · {messages.length} message{messages.length > 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {status === "OPEN" ? (
              <button
                type="button"
                onClick={handleClose}
                disabled={isClosing}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-sm font-medium shadow-sm disabled:opacity-60"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                {isClosing ? "Clôture…" : "Clôturer"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium shadow-sm disabled:opacity-60"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
                {isDeleting ? "Suppression…" : "Supprimer"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* GRID conversation + aside */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Conversation */}
        <section
          className="relative rounded-2xl bg-bg-primary border border-border overflow-hidden flex flex-col"
          style={{ minHeight: 560 }}
        >
          <div
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: "linear-gradient(90deg, #52525B, #18181B)" }}
          />

          <div className="px-5 pt-6 pb-3 border-b border-border flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
              <span
                className="w-[3px] h-[14px] rounded-[3px]"
                style={{ background: "linear-gradient(180deg, #52525B, #18181B)" }}
              />
              Discussion
            </span>
            <span className="text-[11px] text-text-muted">En temps réel</span>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-sm text-text-muted italic py-10">
                Aucun message pour l'instant.
              </div>
            )}
            {messages.map((m) => {
              // Message système (posé automatiquement à l'ouverture, marqué __system__:…)
              if (m.content.startsWith(SYSTEM_PREFIX)) {
                return (
                  <div key={m.id} className="flex justify-center">
                    <div className="px-3 py-1.5 rounded-full bg-zinc-100 text-[11.5px] italic text-text-muted max-w-md text-center">
                      {SYSTEM_MSG_TEXT}
                    </div>
                  </div>
                );
              }

              if (m.senderRole === "CLIENT") {
                return <ClientBubble key={m.id} message={m} clientInitial={clientInitial} />;
              }
              return <AdminBubble key={m.id} message={m} />;
            })}
          </div>

          {/* Zone de saisie */}
          <div
            className={`border-t border-border p-4 bg-bg-secondary transition-colors ${isDragging ? "bg-zinc-100" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
            }}
          >
            {pendingFiles.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {pendingFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-border text-xs">
                    <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                    <span className="max-w-[180px] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-text-muted hover:text-red-600"
                      aria-label="Retirer"
                    >
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
                placeholder={status === "CLOSED" ? "Conversation fermée. Le client peut la rouvrir en écrivant." : `Écrivez votre réponse à ${client.firstName || "votre client"}…`}
                disabled={status === "CLOSED" || isSending || isUploading}
                className="w-full px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-zinc-400 disabled:bg-zinc-50 disabled:cursor-not-allowed"
              />
              <div className="flex items-center justify-between px-3 py-2 border-t border-border">
                <div className="flex items-center gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={status === "CLOSED" || pendingFiles.length >= MAX_ATTACHMENTS}
                    className="w-9 h-9 rounded-lg hover:bg-zinc-100 flex items-center justify-center transition-colors disabled:opacity-40"
                    title={`Joindre une image ou un PDF (max ${MAX_ATTACHMENTS})`}
                  >
                    <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
                    </svg>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={status === "CLOSED" || isSending || isUploading || (!draft.trim() && pendingFiles.length === 0)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-sm font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending || isUploading ? "Envoi…" : "Envoyer"}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                </button>
              </div>
            </div>
            <p className="text-[11px] text-text-muted mt-2 pl-1">
              Glissez-déposez une image directement · <kbd className="px-1.5 py-0.5 rounded border border-border bg-white font-mono text-[10px]">Entrée</kbd> pour envoyer · <kbd className="px-1.5 py-0.5 rounded border border-border bg-white font-mono text-[10px]">Shift</kbd> + <kbd className="px-1.5 py-0.5 rounded border border-border bg-white font-mono text-[10px]">Entrée</kbd> pour retour à la ligne.
            </p>
          </div>
        </section>

        {/* Colonne droite */}
        <aside className="space-y-4">
          {/* Fiche client */}
          <div className="relative rounded-2xl bg-bg-primary border border-border p-5 overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, #52525B, #18181B)" }} />
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
              <span className="w-[3px] h-[14px] rounded-[3px]" style={{ background: "linear-gradient(180deg, #52525B, #18181B)" }} />
              Fiche client
            </span>
            <div className="mt-4 space-y-2 text-sm">
              <RowSpan label="Société" value={client.company || "—"} />
              <RowSpan label="Contact" value={`${client.firstName} ${client.lastName}`.trim() || "—"} />
              <RowSpan label="Email" value={client.email} />
              <RowSpan label="Depuis" value={formatDay(client.createdAt)} />
              <RowSpan label="Total commandé" value={`${client.totalSpent.toFixed(2)} €`} />
              <RowSpan label="Commandes" value={String(client.orderCount)} />
            </div>
          </div>

          {/* Notification client — auto (chronomètre 5 min + présence) */}
          <div className="relative rounded-2xl bg-bg-primary border border-border p-5 overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, #52525B, #18181B)" }} />
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
              <span className="w-[3px] h-[14px] rounded-[3px]" style={{ background: "linear-gradient(180deg, #52525B, #18181B)" }} />
              Notification client
            </span>
            <p className="text-sm mt-3 text-text-secondary leading-relaxed">
              Chaque réponse prévient <b>{client.firstName || "le client"}</b> automatiquement :
            </p>
            <ul className="mt-2 text-[12.5px] text-text-secondary space-y-1.5 leading-snug">
              <li className="flex gap-2"><span className="text-text-muted">•</span>hors ligne → email envoyé tout de suite</li>
              <li className="flex gap-2"><span className="text-text-muted">•</span>en ligne mais ailleurs → email 5 min plus tard s'il n'a pas lu</li>
              <li className="flex gap-2"><span className="text-text-muted">•</span>en train de lire la conversation → aucun email (il voit en direct)</li>
            </ul>
          </div>

          {/* Historique */}
          {previousClaims.length > 0 && (
            <div className="relative rounded-2xl bg-bg-primary border border-border p-5 overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, #52525B, #18181B)" }} />
              <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
                <span className="w-[3px] h-[14px] rounded-[3px]" style={{ background: "linear-gradient(180deg, #52525B, #18181B)" }} />
                Autres demandes
              </span>
              <ul className="mt-3 text-sm space-y-2.5">
                {previousClaims.map((pc) => (
                  <li key={pc.id} className="flex items-start gap-2">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${pc.status === "OPEN" ? "bg-zinc-800" : "bg-zinc-400"}`} />
                    <Link href={`/admin/service-client/${pc.id}`} className="flex-1 group">
                      <p className="font-medium text-text-primary group-hover:underline truncate">{pc.subject}</p>
                      <p className="text-[11px] text-text-muted">
                        {pc.status === "OPEN" ? "Ouverte" : `Fermée · ${pc.closedAt ? formatDay(pc.closedAt) : formatDay(pc.createdAt)}`}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function RowSpan({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-right truncate max-w-[60%]">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: "OPEN" | "CLOSED" }) {
  if (status === "OPEN") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-800 text-xs font-semibold border border-zinc-200">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />Ouverte
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-50 text-zinc-500 text-xs font-semibold border border-zinc-200">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />Fermée
    </span>
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
            className="block aspect-square rounded-lg border border-zinc-300 bg-zinc-200 overflow-hidden hover:opacity-90 transition-opacity relative"
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

function ClientBubble({ message, clientInitial }: { message: Message; clientInitial: string }) {
  const isUnread = !message.readAt;
  return (
    <div className="flex items-end gap-2">
      <div
        className={`w-8 h-8 rounded-full bg-zinc-800 text-white font-bold flex items-center justify-center text-xs shrink-0 ${
          isUnread ? "ring-2 ring-red-500 ring-offset-2" : ""
        }`}
      >
        {clientInitial}
      </div>
      <div className="max-w-[75%]">
        <div className={`rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 ${isUnread ? "border-l-2 border-red-500" : ""}`}>
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-text-primary">{message.content}</p>
          <AttachmentGrid attachments={message.attachments} />
        </div>
        <p className="text-[11px] mt-1 pl-1 flex items-center gap-1 text-text-muted">
          {message.senderFirstName ?? "Client"} · {formatTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

function AdminBubble({ message }: { message: Message }) {
  return (
    <div className="flex items-end gap-2 flex-row-reverse">
      <div className="w-8 h-8 rounded-full bg-zinc-900 text-white font-bold flex items-center justify-center text-xs shrink-0">
        A
      </div>
      <div className="max-w-[75%]">
        <div className="rounded-2xl rounded-br-md bg-zinc-900 text-white px-4 py-3">
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
          <AttachmentGrid attachments={message.attachments} />
        </div>
        <p className="text-[11px] mt-1 pr-1 text-right flex items-center justify-end gap-1 text-text-muted">
          Vous · {formatTime(message.createdAt)}
          <span className={`inline-flex items-center gap-0.5 font-medium ml-1 ${message.readAt ? "text-text-primary" : "text-text-muted"}`}>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/></svg>
            {message.readAt ? (
              <>
                <svg className="w-3 h-3 -ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/></svg>
                Lu à {formatTime(message.readAt)}
              </>
            ) : (
              "Envoyé — non lu"
            )}
          </span>
        </p>
      </div>
    </div>
  );
}
