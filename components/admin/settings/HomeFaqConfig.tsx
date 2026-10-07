"use client";

import { useState } from "react";
import { updateHomeFaq } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import {
  useAutoTranslateEnabled,
  useDeeplEnabled,
} from "@/components/admin/DeeplConfigContext";
import { MAX_HOME_FAQ_ITEMS, DEFAULT_HOME_FAQ_ITEMS, type HomeFaqItem } from "@/lib/home-faq";
import { NON_DEFAULT_LOCALES, LOCALE_LABELS, LOCALE_FULL_NAMES, type Locale } from "@/i18n/locales";

interface Props {
  initialItems: HomeFaqItem[];
}

type TabLang = "fr" | Locale;

interface Translation {
  question: string;
  answer: string;
}

interface DraftItem {
  key: string;
  question: string;
  answer: string;
  /** Traductions par locale (en/de/it/es). Vide = fallback FR sur /xx. */
  translations: Record<string, Translation>;
  /** Onglet actif dans l'UI. Non persisté. */
  activeLang: TabLang;
}

const QUESTION_MAX = 200;
const ANSWER_MAX = 800;

const LOCALE_FLAGS: Record<TabLang, string> = {
  fr: "🇫🇷",
  en: "🇬🇧",
  de: "🇩🇪",
  it: "🇮🇹",
  es: "🇪🇸",
};

function nextKey() {
  return `faq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyTranslation(): Translation {
  return { question: "", answer: "" };
}

function toDraft(it: HomeFaqItem): DraftItem {
  const translations: Record<string, Translation> = {};
  for (const locale of NON_DEFAULT_LOCALES) {
    const fromMap = it.translations?.[locale];
    // Legacy : les anciennes FAQ n'avaient que `questionEn/answerEn` plats, à
    // remettre dans `translations.en` pour que l'UI les montre dans l'onglet EN.
    const legacyEn = locale === "en" ? { question: it.questionEn ?? "", answer: it.answerEn ?? "" } : null;
    const q = fromMap?.question ?? legacyEn?.question ?? "";
    const a = fromMap?.answer ?? legacyEn?.answer ?? "";
    translations[locale] = { question: q, answer: a };
  }
  return {
    key: nextKey(),
    question: it.question,
    answer: it.answer,
    translations,
    activeLang: "fr",
  };
}

function emptyDraft(): DraftItem {
  const translations: Record<string, Translation> = {};
  for (const locale of NON_DEFAULT_LOCALES) translations[locale] = emptyTranslation();
  return { key: nextKey(), question: "", answer: "", translations, activeLang: "fr" };
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
  // Suivi des champs en cours d'auto-traduction : clé draft + "field:locale"
  // (ex. "faq-xyz:question:de"). Sert à afficher un mini-spinner sur l'onglet
  // correspondant + à éviter les traductions concurrentes.
  const [translating, setTranslating] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  // Même contrat que `useAutoTranslateOnBlur` (utilisé partout dans l'admin) :
  // on ne déclenche l'auto-traduction que si (1) le toggle admin est ON et
  // (2) le fournisseur PFS est bien configuré. Sinon, la cliente saisit à la
  // main via l'onglet de chaque langue.
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const translationProviderConfigured = useDeeplEnabled();

  function updateField(key: string, patch: Partial<DraftItem>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function updateTranslationField(key: string, locale: Locale, field: keyof Translation, value: string) {
    const max = field === "question" ? QUESTION_MAX : ANSWER_MAX;
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.key !== key) return d;
        const current = d.translations[locale] ?? emptyTranslation();
        return {
          ...d,
          translations: {
            ...d.translations,
            [locale]: { ...current, [field]: value.slice(0, max) },
          },
        };
      }),
    );
  }

  /**
   * Appel PFS unique qui renvoie les 4 langues cibles (en/de/it/es) et remplit
   * TOUTES les traductions vides pour le champ ciblé. Déclenché sur `onBlur`
   * des inputs FR : une saisie manuelle existante n'est jamais écrasée.
   */
  async function autoTranslateOnBlur(
    draftKey: string,
    frenchText: string,
    targetField: keyof Translation,
  ) {
    if (!autoTranslateEnabled || !translationProviderConfigured) return;

    const trimmed = frenchText.trim();
    if (trimmed.length < 2) return;

    // Snapshot du draft courant — on identifie les locales encore vides pour
    // le champ ciblé et pas déjà en cours de traduction.
    const draft = drafts.find((d) => d.key === draftKey);
    if (!draft) return;

    const localesToFill = NON_DEFAULT_LOCALES.filter((locale) => {
      const current = draft.translations[locale]?.[targetField] ?? "";
      const spinnerKey = `${draftKey}:${targetField}:${locale}`;
      return current.trim().length === 0 && !translating.has(spinnerKey);
    });
    if (localesToFill.length === 0) return;

    const spinnerKeys = localesToFill.map((l) => `${draftKey}:${targetField}:${l}`);
    setTranslating((prev) => {
      const next = new Set(prev);
      for (const k of spinnerKeys) next.add(k);
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
      const translations = data.translations ?? {};

      // Re-vérifie au moment du set : la cliente a pu commencer à taper
      // manuellement dans un champ pendant l'appel API — on ne l'écrase pas.
      setDrafts((prev) =>
        prev.map((d) => {
          if (d.key !== draftKey) return d;
          const nextTranslations = { ...d.translations };
          for (const locale of localesToFill) {
            const translated = translations[locale]?.trim();
            if (!translated) continue;
            const existing = nextTranslations[locale]?.[targetField] ?? "";
            if (existing.trim().length > 0) continue;
            const max = targetField === "question" ? QUESTION_MAX : ANSWER_MAX;
            nextTranslations[locale] = {
              ...(nextTranslations[locale] ?? emptyTranslation()),
              [targetField]: translated.slice(0, max),
            };
          }
          return { ...d, translations: nextTranslations };
        }),
      );
    } catch {
      // Échec silencieux : la cliente peut saisir manuellement.
    } finally {
      setTranslating((prev) => {
        const next = new Set(prev);
        for (const k of spinnerKeys) next.delete(k);
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
        items: drafts.map((d) => {
          const translations: Record<string, { question?: string; answer?: string }> = {};
          for (const locale of NON_DEFAULT_LOCALES) {
            const t = d.translations[locale];
            if (!t) continue;
            const q = t.question.trim();
            const a = t.answer.trim();
            if (q || a) {
              translations[locale] = {};
              if (q) translations[locale].question = q;
              if (a) translations[locale].answer = a;
            }
          }
          return {
            question: d.question,
            answer: d.answer,
            translations,
          };
        }),
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

  const tabLangs: TabLang[] = ["fr", ...NON_DEFAULT_LOCALES];

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
          💡 <span className="font-semibold">Traduction automatique</span> : dès que vous quittez un champ français (question ou réponse), les versions 🇬🇧 EN · 🇩🇪 DE · 🇮🇹 IT · 🇪🇸 ES sont remplies automatiquement si elles sont vides. Vous pouvez retoucher chaque langue à la main.
        </p>
      ) : (
        <p className="text-xs text-text-muted font-body bg-bg-secondary border border-border rounded-lg px-3 py-2">
          ℹ️ <span className="font-semibold">Traduction automatique désactivée.</span> Pour la ré-activer, allez dans <em>Paramètres → Traduction</em> et vérifiez que le compte est configuré. En attendant, saisissez les traductions à la main dans chaque onglet de langue.
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

              {/* Onglets FR / EN / DE / IT / ES. Chaque langue non-FR est
                  facultative — si vide, la version française est affichée sur
                  la locale correspondante. Un mini spinner apparaît sur
                  l'onglet pendant l'auto-traduction. */}
              <div className="flex gap-1.5 border-b border-border flex-wrap">
                {tabLangs.map((lang) => {
                  const isActive = d.activeLang === lang;
                  const hasContent = lang === "fr"
                    ? d.question.length > 0 && d.answer.length > 0
                    : (d.translations[lang]?.question.length ?? 0) > 0 && (d.translations[lang]?.answer.length ?? 0) > 0;
                  const isTranslating = lang !== "fr" && (
                    translating.has(`${d.key}:question:${lang}`) ||
                    translating.has(`${d.key}:answer:${lang}`)
                  );
                  const label = lang === "fr" ? "Français" : LOCALE_LABELS[lang] ?? lang.toUpperCase();
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
                      {LOCALE_FLAGS[lang]} {label}
                      {lang !== "fr" && isTranslating && (
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
                      {lang !== "fr" && !isTranslating && !hasContent && (
                        <span className="ml-1.5 text-[10px] font-normal text-text-muted">
                          {autoTranslateEnabled && translationProviderConfigured
                            ? "(auto)"
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
                      onBlur={(e) => autoTranslateOnBlur(d.key, e.target.value, "question")}
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
                      onBlur={(e) => autoTranslateOnBlur(d.key, e.target.value, "answer")}
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
                (() => {
                  const locale = d.activeLang as Locale;
                  const t = d.translations[locale] ?? emptyTranslation();
                  const languageName = LOCALE_FULL_NAMES[locale] ?? locale;
                  return (
                    <>
                      <p className="text-[11px] text-text-muted font-body -mt-2">
                        Optionnel : si laissé vide, la version française s&apos;affiche sur la page d&apos;accueil en {languageName.toLowerCase()}.
                      </p>
                      <div>
                        <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                          Question ({languageName})
                        </label>
                        <input
                          type="text"
                          value={t.question}
                          onChange={(e) => updateTranslationField(d.key, locale, "question", e.target.value)}
                          placeholder="…"
                          className="field-input"
                        />
                        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                          {t.question.length} / {QUESTION_MAX}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                          Réponse ({languageName})
                        </label>
                        <textarea
                          value={t.answer}
                          onChange={(e) => updateTranslationField(d.key, locale, "answer", e.target.value)}
                          rows={3}
                          placeholder="…"
                          className="field-input resize-y min-h-[80px]"
                        />
                        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                          {t.answer.length} / {ANSWER_MAX}
                        </p>
                      </div>
                    </>
                  );
                })()
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
