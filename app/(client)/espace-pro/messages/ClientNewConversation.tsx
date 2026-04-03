"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupportConversation } from "@/app/actions/client/messages";
import { useToast } from "@/components/ui/Toast";

export default function ClientNewConversation() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    startTransition(async () => {
      const result = await createSupportConversation(subject, message);
      if (result.success && result.conversationId) {
        addToast("Message envoye", "success");
        setOpen(false);
        setSubject("");
        setMessage("");
        router.push(`/espace-pro/messages/${result.conversationId}`);
      } else {
        addToast(result.error || "Erreur", "error");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] transition-colors"
      >
        Nouveau message
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
      <div className="bg-bg-primary border border-border rounded-2xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-heading text-lg font-bold text-text-primary mb-4">Nouveau message</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Sujet</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Objet de votre message"
              className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-[#1A1A1A] text-text-primary font-body"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ecrivez votre message..."
              rows={4}
              className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-[#1A1A1A] text-text-primary font-body resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-body text-text-muted hover:text-text-primary">
              Annuler
            </button>
            <button
              type="submit"
              disabled={!subject.trim() || !message.trim() || isPending}
              className="px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] disabled:opacity-40 transition-colors"
            >
              {isPending ? "..." : "Envoyer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
