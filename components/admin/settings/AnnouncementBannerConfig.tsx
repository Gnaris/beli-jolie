"use client";

import { useState } from "react";
import { updateAnnouncementBanner } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import AnnouncementBanner from "@/components/layout/AnnouncementBanner";

interface AnnouncementBannerConfigProps {
  initialMessages: string[];
  initialBgColor: string;
  initialTextColor: string;
}

export default function AnnouncementBannerConfig({
  initialMessages,
  initialBgColor,
  initialTextColor,
}: AnnouncementBannerConfigProps) {
  const [messages, setMessages] = useState<string[]>(
    initialMessages.length > 0 ? initialMessages : [""]
  );
  const [bgColor, setBgColor] = useState(initialBgColor);
  const [textColor, setTextColor] = useState(initialTextColor);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function addMessage() {
    setMessages((prev) => [...prev, ""]);
  }

  function removeMessage(index: number) {
    setMessages((prev) => prev.filter((_, i) => i !== index));
  }

  function updateMessage(index: number, value: string) {
    setMessages((prev) => prev.map((m, i) => (i === index ? value : m)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateAnnouncementBanner({
        messages,
        bgColor,
        textColor,
      });
      if (result.success) {
        toast({ type: "success", title: "Succes", message: "Bandeau mis a jour." });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de la sauvegarde." });
    } finally {
      setSaving(false);
    }
  }

  const activeMessages = messages.filter((m) => m.trim().length > 0);

  return (
    <div className="space-y-5">
      {/* Messages list */}
      <div className="space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={msg}
              onChange={(e) => updateMessage(i, e.target.value)}
              placeholder={`Message ${i + 1}`}
              className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm font-body text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {messages.length > 1 && (
              <button
                type="button"
                onClick={() => removeMessage(i)}
                className="p-2 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/5"
                title="Supprimer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add button */}
      <button
        type="button"
        onClick={addMessage}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover transition-colors font-body"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Ajouter une annonce
      </button>

      {/* Color pickers */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-body text-text-secondary">Fond :</label>
          <input
            type="color"
            value={bgColor}
            onChange={(e) => setBgColor(e.target.value)}
            className="w-8 h-8 rounded border border-border cursor-pointer"
          />
          <span className="text-xs font-mono text-text-secondary">{bgColor}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-body text-text-secondary">Texte :</label>
          <input
            type="color"
            value={textColor}
            onChange={(e) => setTextColor(e.target.value)}
            className="w-8 h-8 rounded border border-border cursor-pointer"
          />
          <span className="text-xs font-mono text-text-secondary">{textColor}</span>
        </div>
      </div>

      {/* Live preview */}
      {activeMessages.length > 0 && (
        <div>
          <p className="text-xs font-body text-text-secondary mb-2">Apercu :</p>
          <div className="rounded-lg overflow-hidden border border-border">
            <AnnouncementBanner
              messages={activeMessages}
              bgColor={bgColor}
              textColor={textColor}
              preview
            />
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-bg-dark text-text-inverse hover:bg-primary-hover transition-colors disabled:opacity-50 font-body"
      >
        {saving && (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        Enregistrer
      </button>
    </div>
  );
}
