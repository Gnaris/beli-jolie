"use client";

import { useState } from "react";
import { updateAnnouncementBanner } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import AnnouncementBanner, { type AnnouncementBannerMode } from "@/components/layout/AnnouncementBanner";
import { useAutoTranslateEnabled, useDeeplEnabled } from "@/components/admin/DeeplConfigContext";
import TranslatingInput from "@/components/admin/TranslatingInput";

interface AnnouncementBannerMessageInit {
  fr: string;
  en?: string;
}

interface AnnouncementBannerConfigProps {
  initialMessages: AnnouncementBannerMessageInit[];
  initialBgColor: string;
  initialTextColor: string;
  initialSpeed: number;
  initialMode: AnnouncementBannerMode;
}

interface MessageRow {
  fr: string;
  en: string;
  translating: boolean;
}

export default function AnnouncementBannerConfig({
  initialMessages,
  initialBgColor,
  initialTextColor,
  initialSpeed,
  initialMode,
}: AnnouncementBannerConfigProps) {
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const translationEnabled = useDeeplEnabled();

  const [messages, setMessages] = useState<MessageRow[]>(
    initialMessages.length > 0
      ? initialMessages.map((m) => ({ fr: m.fr, en: m.en ?? "", translating: false }))
      : [{ fr: "", en: "", translating: false }],
  );
  const [bgColor, setBgColor] = useState(initialBgColor);
  const [textColor, setTextColor] = useState(initialTextColor);
  const [speed, setSpeed] = useState(initialSpeed);
  const [mode, setMode] = useState<AnnouncementBannerMode>(initialMode);
  const [previewLocale, setPreviewLocale] = useState<"fr" | "en">("fr");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function addMessage() {
    setMessages((prev) => [...prev, { fr: "", en: "", translating: false }]);
  }

  function removeMessage(index: number) {
    setMessages((prev) => prev.filter((_, i) => i !== index));
  }

  function updateMessage(index: number, field: "fr" | "en", value: string) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  async function handleFrBlur(index: number) {
    if (!autoTranslateEnabled || !translationEnabled) return;
    const current = messages[index];
    if (!current) return;
    const fr = current.fr.trim();
    if (!fr) return;
    // Ne pas écraser une saisie manuelle EN existante.
    if (current.en.trim()) return;
    if (current.translating) return;

    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, translating: true } : m)));
    try {
      const res = await fetch("/api/admin/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fr }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const en = (data?.translations?.en ?? "").toString().trim();
      if (!en) return;
      setMessages((prev) =>
        prev.map((m, i) =>
          i === index && !m.en.trim() ? { ...m, en } : m,
        ),
      );
    } catch {
      // silencieux — la cliente peut saisir manuellement
    } finally {
      setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, translating: false } : m)));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateAnnouncementBanner({
        messages: messages.map((m) => ({ fr: m.fr, en: m.en })),
        bgColor,
        textColor,
        speed,
        mode,
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

  const activePreviewMessages = messages
    .map((m) => (previewLocale === "en" && m.en.trim() ? m.en.trim() : m.fr.trim()))
    .filter((s) => s.length > 0);

  return (
    <div className="space-y-5">
      {/* Mode d'affichage */}
      <div className="space-y-2">
        <p className="text-sm font-body text-text-secondary">Mode d&apos;affichage</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              mode === "scroll"
                ? "border-primary bg-primary/5"
                : "border-border bg-bg-secondary hover:border-border-strong"
            }`}
          >
            <input
              type="radio"
              name="banner-mode"
              value="scroll"
              checked={mode === "scroll"}
              onChange={() => setMode("scroll")}
              className="mt-1 accent-primary"
            />
            <span className="flex-1">
              <span className="block text-sm font-semibold text-text-primary">Défilement</span>
              <span className="block text-xs text-text-secondary mt-0.5">
                Les messages défilent l&apos;un après l&apos;autre.
              </span>
            </span>
          </label>
          <label
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              mode === "static"
                ? "border-primary bg-primary/5"
                : "border-border bg-bg-secondary hover:border-border-strong"
            }`}
          >
            <input
              type="radio"
              name="banner-mode"
              value="static"
              checked={mode === "static"}
              onChange={() => setMode("static")}
              className="mt-1 accent-primary"
            />
            <span className="flex-1">
              <span className="block text-sm font-semibold text-text-primary">Statique</span>
              <span className="block text-xs text-text-secondary mt-0.5">
                Tous les messages visibles en même temps, séparés par un point.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Bandeau d'info sur la traduction */}
      <div className="rounded-lg border border-border bg-bg-secondary/60 px-3 py-2 text-[12px] font-body text-text-secondary">
        Saisis le message en français. La version anglaise est
        {autoTranslateEnabled && translationEnabled ? " remplie automatiquement " : " à saisir toi-même "}
        et s&apos;affichera sur la version anglaise du site.
      </div>

      {/* Messages list */}
      <div className="space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className="rounded-lg border border-border bg-bg-secondary/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                Annonce {i + 1}
              </span>
              {messages.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMessage(i)}
                  className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/5"
                  title="Supprimer cette annonce"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-tertiary text-text-secondary text-[10.5px] font-semibold">
                🇫🇷 FR
              </span>
              <input
                type="text"
                value={msg.fr}
                onChange={(e) => updateMessage(i, "fr", e.target.value)}
                onBlur={() => handleFrBlur(i)}
                placeholder="Ex : Livraison offerte dès 100 € — Nouveautés chaque semaine"
                className="flex-1 rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm font-body text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-tertiary text-text-secondary text-[10.5px] font-semibold">
                🇬🇧 EN
              </span>
              <TranslatingInput
                translating={msg.translating}
                type="text"
                value={msg.en}
                onChange={(e) => updateMessage(i, "en", e.target.value)}
                placeholder={
                  autoTranslateEnabled && translationEnabled
                    ? "Rempli automatiquement au moment de l'enregistrement"
                    : "Ex : Free shipping over €100 — New arrivals weekly"
                }
                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm font-body text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
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

      {/* Speed slider (mode scroll uniquement) */}
      {mode === "scroll" && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-body text-text-secondary whitespace-nowrap">Vitesse :</label>
          <input
            type="range"
            min={3}
            max={15}
            step={1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="flex-1 max-w-48 accent-primary"
          />
          <span className="text-xs font-mono text-text-secondary w-12">{speed}s</span>
        </div>
      )}

      {/* Live preview avec toggle FR / EN */}
      {activePreviewMessages.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-body text-text-secondary">Aperçu :</p>
            <div className="inline-flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setPreviewLocale("fr")}
                className={`px-2.5 py-1 transition-colors ${
                  previewLocale === "fr"
                    ? "bg-text-primary text-text-inverse"
                    : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                🇫🇷 FR
              </button>
              <button
                type="button"
                onClick={() => setPreviewLocale("en")}
                className={`px-2.5 py-1 transition-colors border-l border-border ${
                  previewLocale === "en"
                    ? "bg-text-primary text-text-inverse"
                    : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                🇬🇧 EN
              </button>
            </div>
          </div>
          <div className="rounded-lg overflow-hidden border border-border">
            <AnnouncementBanner
              messages={activePreviewMessages}
              bgColor={bgColor}
              textColor={textColor}
              speed={speed}
              mode={mode}
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
