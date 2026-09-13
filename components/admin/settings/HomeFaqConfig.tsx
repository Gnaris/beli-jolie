"use client";

import { useState } from "react";
import { updateHomeFaq } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { MAX_HOME_FAQ_ITEMS, DEFAULT_HOME_FAQ_ITEMS, type HomeFaqItem } from "@/lib/home-faq";

interface Props {
  initialItems: HomeFaqItem[];
}

interface DraftItem {
  key: string;
  question: string;
  answer: string;
}

const QUESTION_MAX = 200;
const ANSWER_MAX = 800;

function nextKey() {
  return `faq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function toDraft(it: HomeFaqItem): DraftItem {
  return { key: nextKey(), question: it.question, answer: it.answer };
}

function emptyDraft(): DraftItem {
  return { key: nextKey(), question: "", answer: "" };
}

export default function HomeFaqConfig({ initialItems }: Props) {
  // Si la cliente n'a JAMAIS édité de FAQ, on pré-remplit avec 4 questions
  // types (pas encore sauvées) — elle voit tout de suite ce que ça donne et
  // peut modifier / supprimer. Si elle a déjà des items, on garde les siens.
  const [drafts, setDrafts] = useState<DraftItem[]>(() =>
    initialItems.length > 0
      ? initialItems.map(toDraft)
      : DEFAULT_HOME_FAQ_ITEMS.map(toDraft)
  );
  const [saved, setSaved] = useState(initialItems.length > 0);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function updateField(key: string, patch: Partial<DraftItem>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function addItem() {
    if (drafts.length >= MAX_HOME_FAQ_ITEMS) return;
    setDrafts((prev) => [...prev, emptyDraft()]);
  }

  function removeItem(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  function moveItem(key: string, direction: "up" | "down") {
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.key === key);
      if (idx === -1) return prev;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateHomeFaq({
        items: drafts.map((d) => ({ question: d.question, answer: d.answer })),
      });
      if (result.success) {
        setSaved(true);
        toast({ type: "success", title: "Enregistré", message: "FAQ mise à jour sur la page d'accueil." });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de la sauvegarde." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-muted font-body">
        Questions / réponses affichées dans la section « Questions fréquentes »
        en bas de la page d&apos;accueil. Google indexe cette FAQ pour ses rich
        results (schema.org FAQPage). Jusqu&apos;à {MAX_HOME_FAQ_ITEMS} questions.
        Vide = section masquée.
      </p>

      {!saved && drafts.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3 items-start">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-amber-700 shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div className="text-xs font-body text-amber-900 leading-relaxed">
            <p className="font-semibold mb-0.5">Ces {drafts.length} questions sont des propositions — rien n&apos;est encore publié.</p>
            <p>Ajustez-les si besoin puis cliquez sur <span className="font-semibold">« Enregistrer »</span> en bas pour les faire apparaître sur la page d&apos;accueil.</p>
          </div>
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-bg-secondary p-8 text-center">
          <p className="text-sm text-text-muted font-body">
            Aucune question pour le moment. La section « Questions fréquentes » est masquée sur la page d&apos;accueil.
          </p>
          <button
            type="button"
            onClick={addItem}
            className="btn-primary mt-4"
          >
            + Ajouter une première question
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((d, index) => (
            <div key={d.key} className="rounded-2xl border border-border bg-bg-primary p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-bg-secondary border border-border text-xs font-body font-semibold text-text-primary">
                    {index + 1}
                  </span>
                  <span className="text-sm font-body font-semibold text-text-primary">
                    Question n°{index + 1}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveItem(d.key, "up")}
                    disabled={index === 0}
                    className="p-1.5 rounded-lg border border-border hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Monter"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(d.key, "down")}
                    disabled={index === drafts.length - 1}
                    className="p-1.5 rounded-lg border border-border hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Descendre"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(d.key)}
                    className="p-1.5 rounded-lg border border-border hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700"
                    aria-label="Supprimer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                  Question
                </label>
                <input
                  type="text"
                  value={d.question}
                  onChange={(e) => updateField(d.key, { question: e.target.value.slice(0, QUESTION_MAX) })}
                  placeholder="Ex : Les articles sont-ils vendus à l'unité ?"
                  className="field-input"
                />
                <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                  {d.question.length} / {QUESTION_MAX}
                </p>
              </div>

              <div>
                <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                  Réponse
                </label>
                <textarea
                  value={d.answer}
                  onChange={(e) => updateField(d.key, { answer: e.target.value.slice(0, ANSWER_MAX) })}
                  rows={3}
                  placeholder="Ex : Oui, nos modèles peuvent être commandés à l'unité, sans lot imposé."
                  className="field-input resize-y min-h-[80px]"
                />
                <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                  {d.answer.length} / {ANSWER_MAX}
                </p>
              </div>
            </div>
          ))}

          {drafts.length < MAX_HOME_FAQ_ITEMS && (
            <button
              type="button"
              onClick={addItem}
              className="w-full rounded-2xl border-2 border-dashed border-border py-4 text-sm font-body font-medium text-text-secondary hover:bg-bg-secondary hover:border-text-muted transition"
            >
              + Ajouter une question ({drafts.length} / {MAX_HOME_FAQ_ITEMS})
            </button>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary px-5 disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
