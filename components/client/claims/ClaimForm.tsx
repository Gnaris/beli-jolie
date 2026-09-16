"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { createClaim } from "@/app/actions/client/claims";

const MAX_ATTACHMENTS = 5;
const MAX_SUBJECT = 200;

type Attachment = { fileName: string; filePath: string; fileSize: number; mimeType: string };

export default function ClaimForm() {
  const router = useRouter();
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        throw new Error(err.error || "Échec de l'upload des fichiers.");
      }
      const data = (await res.json()) as { attachments: Attachment[] };
      return data.attachments;
    } finally {
      setIsUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const s = subject.trim();
    const m = message.trim();
    if (!s) return toast.error("Sujet requis", "Résumez votre demande en quelques mots.");
    if (!m) return toast.error("Message requis", "Décrivez votre demande.");

    startTransition(async () => {
      let attachments: Attachment[] = [];
      try {
        attachments = await uploadAttachments();
      } catch (err) {
        toast.error("Échec de l'envoi", err instanceof Error ? err.message : undefined);
        return;
      }

      const res = await createClaim({
        subject: s,
        message: m,
        attachments,
      });

      if (!res.success) {
        toast.error("Échec de l'envoi", res.error);
        return;
      }
      toast.success("Demande envoyée", "Nous vous répondrons dans les meilleurs délais.");
      router.push(`/espace-pro/reclamations/${res.claimId}`);
    });
  }

  const disabled = isPending || isUploading;

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-bg-primary border border-border rounded-2xl shadow-sm p-5 sm:p-6 space-y-5"
    >
      <div>
        <label htmlFor="claim-subject" className="block text-sm font-semibold text-text-primary mb-1.5">
          Sujet
        </label>
        <input
          id="claim-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value.slice(0, MAX_SUBJECT))}
          disabled={disabled}
          placeholder="Ex : Colis endommagé à la livraison"
          maxLength={MAX_SUBJECT}
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-text-primary focus:ring-4 focus:ring-black/5 disabled:bg-zinc-50 disabled:cursor-not-allowed"
          required
        />
        <p className="text-[11px] text-text-muted mt-1">
          {subject.length}/{MAX_SUBJECT}
        </p>
      </div>

      <div>
        <label htmlFor="claim-message" className="block text-sm font-semibold text-text-primary mb-1.5">
          Votre message
        </label>
        <textarea
          id="claim-message"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={disabled}
          placeholder="Décrivez votre demande en détail. Nous vous répondrons rapidement."
          className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-text-primary focus:ring-4 focus:ring-black/5 disabled:bg-zinc-50 disabled:cursor-not-allowed resize-y"
          required
        />
      </div>

      <div
        className={`rounded-xl border-2 border-dashed p-4 transition-colors ${
          isDragging ? "border-text-primary bg-bg-secondary" : "border-border bg-bg-secondary"
        }`}
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-text-primary">Pièces jointes (optionnel)</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Images JPG/PNG/WEBP ou PDF, 10 Mo max, {MAX_ATTACHMENTS} fichiers max.
            </p>
          </div>
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
            disabled={disabled || pendingFiles.length >= MAX_ATTACHMENTS}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-border text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            Ajouter
          </button>
        </div>

        {pendingFiles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {pendingFiles.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-border text-xs"
              >
                <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
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
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button
          type="submit"
          disabled={disabled || !subject.trim() || !message.trim()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-bg-dark text-text-inverse text-sm font-semibold shadow-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isUploading ? "Envoi des pièces jointes…" : isPending ? "Envoi…" : "Envoyer ma demande"}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </form>
  );
}
