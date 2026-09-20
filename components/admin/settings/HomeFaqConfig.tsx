"use client";

import { useState } from "react";
import { updateHomeFaq } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import {
  useAutoTranslateEnabled,
  useDeeplEnabled,
} from "@/components/admin/DeeplConfigContext";
import { MAX_HOME_FAQ_ITEMS, DEFAULT_HOME_FAQ_ITEMS, type HomeFaqItem } from "@/lib/home-faq";

interface Props {
  initialItems: HomeFaqItem[];
}

interface DraftItem {
  key: string;
  question: string;
  answer: string;
  questionEn: string;
  answerEn: string;
  /** Onglet actif dans l'UI ("fr" ou "en"). Non persisté. */
  activeLang: "fr" | "en";
}

const QUESTION_MAX = 200;
const ANSWER_MAX = 800;

function nextKey() {
  return `faq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function toDraft(it: HomeFaqItem): DraftItem {
  return {
    key: nextKey(),
    question: it.question,
    answer: it.answer,
    questionEn: it.questionEn ?? "",
    answerEn: it.answerEn ?? "",
    activeLang: "fr",
  };
}

function emptyDraft(): DraftItem {
  return { key: nextKey(), question: "", answer: "", questionEn: "", answerEn: "", activeLang: "fr" };
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
  // Suivi des champs en cours d'auto-traduction : clé draft + nom du champ EN
  // ciblé ("questionEn" / "answerEn"). Sert à afficher un mini-spinner sur
  // l'onglet EN correspondant + à éviter les traductions concurrentes.
  const [translating, setTranslating] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  // Même contrat que `useAutoTranslateOnBlur` (utilisé partout dans l'admin) :
  // on ne déclenche l'auto-traduction que si (1) le toggle admin est ON et
  // (2) le fournisseur PFS est bien configuré. Sinon, la cliente saisit à la
  // main via l'onglet 🇬🇧 English.
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const translationProviderConfigured = useDeeplEnabled();

  function updateField(key: string, patch: Partial<DraftItem>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  /**
   * Traduit un texte FR via l'API PFS et remplit le champ EN correspondant
   * SI celui-ci est encore vide. Appelée sur `onBlur` des inputs FR : ça
   * n'écrase jamais une saisie manuelle et ne fait rien si la cliente
   * commence par vider le champ FR.
   */
  async function autoTranslateOnBlur(
    draftKey: string,
    frenchText: string,
    targetField: "questionEn" | "answerEn",
  ) {
    // Respecte les mêmes toggles que le reste de l'admin (Paramètres →
    // Traduction) : si la cliente a coupé l'auto-traduction ou si le compte
    // PFS n'est pas configuré, on skippe et elle saisit à la main.
    if (!autoTranslateEnabled || !translationProviderConfigured) return;

    const trimmed = frenchText.trim();
    if (trimmed.length < 2) return; // trop court, la traduction n'a pas de sens

    // Snapshot du draft courant — on ne veut pas écraser une saisie manuelle EN.
    const draft = drafts.find((d) => d.key === draftKey);
    if (!draft) return;
    const currentEn = draft[targetField];
    if (currentEn && currentEn.trim().length > 0) return;

    const spinnerKey = `${draftKey}:${targetField}`;
    if (translating.has(spinnerKey)) return; // déjà en cours

    setTranslating((prev) => {
      const next = new Set(prev);
      next.add(spinnerKey);
      return next;
    });

    try {
      const res = await fetch("/api/admin/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { translations?: Record<string, string> };
      const translatedEn = data.translations?.en?.trim();
      if (!translatedEn) return;

      // Re-vérifie au moment du set : la cliente a pu commencer à taper
      // manuellement dans le champ EN pendant l'appel API — on ne l'écrase pas.
      setDrafts((prev) =>
        prev.map((d) => {
          if (d.key !== draftKey) return d;
          const existing = d[targetField];
          if (existing && existing.trim().length > 0) return d;
          const max = targetField === "questionEn" ? QUESTION_MAX : ANSWER_MAX;
          return { ...d, [targetField]: translatedEn.slice(0, max) };
        }),
      );
    } catch {
      // Échec silencieux : la cliente peut toujours saisir manuellement.
      // Pas de toast pour ne pas polluer l'UI sur chaque blur raté.
    } finally {
      setTranslating((prev) => {
        const next = new Set(prev);
        next.delete(spinnerKey);
        return next;
      });
    }
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
        items: drafts.map((d) => ({
          question: d.question,
          answer: d.answer,
          questionEn: d.questionEn,
          answerEn: d.answerEn,
        })),
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
      {autoTranslateEnabled && translationProviderConfigured ? (
        <p className="text-xs text-sky-800 font-body bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
          💡 <span className="font-semibold">Traduction automatique</span> : dès que vous quittez un champ français (question ou réponse), l&apos;anglais correspondant est rempli automatiquement s&apos;il est vide. Vous pouvez toujours retoucher la version 🇬🇧 English à la main.
        </p>
      ) : (
        <p className="text-xs text-text-muted font-body bg-bg-secondary border border-border rounded-lg px-3 py-2">
          ℹ️ <span className="font-semibold">Traduction automatique désactivée.</span> Pour la ré-activer, allez dans <em>Paramètres → Traduction</em> et vérifiez que le compte est configuré. En attendant, saisissez les traductions anglaises à la main via l&apos;onglet 🇬🇧 English.
        </p>
      )}

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

              {/* Onglets FR / EN : la version anglaise est facultative — si vide,
                  la version française est affichée sur /en. Un mini spinner
                  apparaît sur l'onglet EN pendant l'auto-traduction. */}
              <div className="flex gap-1.5 border-b border-border">
                {(["fr", "en"] as const).map((lang) => {
                  const isActive = d.activeLang === lang;
                  const hasContent = lang === "fr"
                    ? d.question.length > 0 && d.answer.length > 0
                    : d.questionEn.length > 0 && d.answerEn.length > 0;
                  const isTranslating = lang === "en" && (
                    translating.has(`${d.key}:questionEn`) ||
                    translating.has(`${d.key}:answerEn`)
                  );
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => updateField(d.key, { activeLang: lang })}
                      className={`relative px-3 py-1.5 text-xs font-body font-semibold border-b-2 transition ${
                        isActive
                          ? "border-text-primary text-text-primary"
                          : "border-transparent text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {lang === "fr" ? "🇫🇷 Français" : "🇬🇧 English"}
                      {lang === "en" && isTranslating && (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-normal text-sky-700">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="animate-spin">
                            <path d="M12 2v4" strokeLinecap="round"/>
                            <path d="M12 18v4" strokeLinecap="round" opacity="0.3"/>
                            <path d="M4.93 4.93l2.83 2.83" strokeLinecap="round" opacity="0.6"/>
                            <path d="M16.24 16.24l2.83 2.83" strokeLinecap="round" opacity="0.3"/>
                            <path d="M2 12h4" strokeLinecap="round" opacity="0.5"/>
                            <path d="M18 12h4" strokeLinecap="round" opacity="0.3"/>
                          </svg>
                          Traduction…
                        </span>
                      )}
                      {lang === "en" && !isTranslating && !hasContent && (
                        <span className="ml-1.5 text-[10px] font-normal text-text-muted">
                          {autoTranslateEnabled && translationProviderConfigured
                            ? "(auto-rempli au blur)"
                            : "(facultatif)"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {d.activeLang === "fr" ? (
                <>
                  <div>
                    <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                      Question (français)
                    </label>
                    <input
                      type="text"
                      value={d.question}
                      onChange={(e) => updateField(d.key, { question: e.target.value.slice(0, QUESTION_MAX) })}
                      onBlur={(e) => autoTranslateOnBlur(d.key, e.target.value, "questionEn")}
                      placeholder="Ex : Les articles sont-ils vendus à l'unité ?"
                      className="field-input"
                    />
                    <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                      {d.question.length} / {QUESTION_MAX}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                      Réponse (français)
                    </label>
                    <textarea
                      value={d.answer}
                      onChange={(e) => updateField(d.key, { answer: e.target.value.slice(0, ANSWER_MAX) })}
                      onBlur={(e) => autoTranslateOnBlur(d.key, e.target.value, "answerEn")}
                      rows={3}
                      placeholder="Ex : Oui, nos modèles peuvent être commandés à l'unité, sans lot imposé."
                      className="field-input resize-y min-h-[80px]"
                    />
                    <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                      {d.answer.length} / {ANSWER_MAX}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-text-muted font-body -mt-2">
                    Optionnel : si laissé vide, la version française s&apos;affiche sur la page d&apos;accueil en anglais.
                  </p>
                  <div>
                    <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                      Question (English)
                    </label>
                    <input
                      type="text"
                      value={d.questionEn}
                      onChange={(e) => updateField(d.key, { questionEn: e.target.value.slice(0, QUESTION_MAX) })}
                      placeholder="Ex: Do you sell items individually?"
                      className="field-input"
                    />
                    <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                      {d.questionEn.length} / {QUESTION_MAX}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                      Answer (English)
                    </label>
                    <textarea
                      value={d.answerEn}
                      onChange={(e) => updateField(d.key, { answerEn: e.target.value.slice(0, ANSWER_MAX) })}
                      rows={3}
                      placeholder="Ex: Yes, our items can be ordered individually, no minimum quantity required."
                      className="field-input resize-y min-h-[80px]"
                    />
                    <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                      {d.answerEn.length} / {ANSWER_MAX}
                    </p>
                  </div>
                </>
              )}
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
