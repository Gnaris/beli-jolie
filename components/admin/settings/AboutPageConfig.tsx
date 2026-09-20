"use client";

import { useState } from "react";
import { updateAboutPage } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  initialIntro: string;
  initialHistoryBody: string;
  initialShowroomBody: string;
  initialTeamBody: string;
  initialNewnessBody: string;
  initialDeliveryBody: string;
  /** Versions anglaises optionnelles — vide = fallback FR sur /en/a-propos. */
  initialIntroEn?: string;
  initialHistoryBodyEn?: string;
  initialShowroomBodyEn?: string;
  initialTeamBodyEn?: string;
  initialNewnessBodyEn?: string;
  initialDeliveryBodyEn?: string;
  /** Textes par défaut i18n (utilisés en placeholder pour montrer ce qui s'affiche si le champ est vide). */
  placeholders: {
    intro: string;
    historyBody: string;
    showroomBody: string;
    teamBody: string;
    newnessBody: string;
    deliveryBody: string;
  };
}

const SECTION_MAX = 2000;

type SectionKey =
  | "intro"
  | "historyBody"
  | "showroomBody"
  | "teamBody"
  | "newnessBody"
  | "deliveryBody";

interface SectionMeta {
  key: SectionKey;
  label: string;
  description: string;
  placeholderEn: string;
}

const SECTIONS: SectionMeta[] = [
  {
    key: "intro",
    label: "Introduction",
    description: "Paragraphe d'accroche affiché juste sous le titre principal de la page.",
    placeholderEn: "Ex: A short welcome paragraph shown right below the page title.",
  },
  {
    key: "historyBody",
    label: "Notre histoire",
    description: "Comment est née la boutique, ses valeurs, son parcours.",
    placeholderEn: "Ex: How the shop was born, its values, its journey.",
  },
  {
    key: "showroomBody",
    label: "Le showroom",
    description: "Où vous accueillez les revendeuses, les horaires, ce qu'elles peuvent voir sur place.",
    placeholderEn: "Ex: Where you welcome resellers, opening hours, what they can discover on site.",
  },
  {
    key: "teamBody",
    label: "L'équipe",
    description: "Qui compose l'équipe, ce qu'elle fait pour les clientes, les langues parlées.",
    placeholderEn: "Ex: Who's on the team, what they do for customers, languages spoken.",
  },
  {
    key: "newnessBody",
    label: "Nouveautés régulières",
    description: "Rythme des nouveautés, comment les clientes sont informées.",
    placeholderEn: "Ex: How often new arrivals drop, how customers are notified.",
  },
  {
    key: "deliveryBody",
    label: "Livraisons",
    description: "Zones desservies, délais, transporteurs. Section pleine largeur en bas.",
    placeholderEn: "Ex: Delivery areas, lead times, carriers. Full-width bottom section.",
  },
];

export default function AboutPageConfig({
  initialIntro,
  initialHistoryBody,
  initialShowroomBody,
  initialTeamBody,
  initialNewnessBody,
  initialDeliveryBody,
  initialIntroEn = "",
  initialHistoryBodyEn = "",
  initialShowroomBodyEn = "",
  initialTeamBodyEn = "",
  initialNewnessBodyEn = "",
  initialDeliveryBodyEn = "",
  placeholders,
}: Props) {
  const [valuesFr, setValuesFr] = useState({
    intro: initialIntro,
    historyBody: initialHistoryBody,
    showroomBody: initialShowroomBody,
    teamBody: initialTeamBody,
    newnessBody: initialNewnessBody,
    deliveryBody: initialDeliveryBody,
  });
  const [valuesEn, setValuesEn] = useState({
    intro: initialIntroEn,
    historyBody: initialHistoryBodyEn,
    showroomBody: initialShowroomBodyEn,
    teamBody: initialTeamBodyEn,
    newnessBody: initialNewnessBodyEn,
    deliveryBody: initialDeliveryBodyEn,
  });
  const [activeLang, setActiveLang] = useState<"fr" | "en">("fr");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function setField(key: SectionKey, value: string) {
    const trimmed = value.slice(0, SECTION_MAX);
    if (activeLang === "fr") {
      setValuesFr((prev) => ({ ...prev, [key]: trimmed }));
    } else {
      setValuesEn((prev) => ({ ...prev, [key]: trimmed }));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateAboutPage({
        intro: valuesFr.intro,
        historyBody: valuesFr.historyBody,
        showroomBody: valuesFr.showroomBody,
        teamBody: valuesFr.teamBody,
        newnessBody: valuesFr.newnessBody,
        deliveryBody: valuesFr.deliveryBody,
        introEn: valuesEn.intro,
        historyBodyEn: valuesEn.historyBody,
        showroomBodyEn: valuesEn.showroomBody,
        teamBodyEn: valuesEn.teamBody,
        newnessBodyEn: valuesEn.newnessBody,
        deliveryBodyEn: valuesEn.deliveryBody,
      });
      if (result.success) {
        toast({ type: "success", title: "Enregistré", message: "Page « Qui sommes-nous » mise à jour." });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de la sauvegarde." });
    } finally {
      setSaving(false);
    }
  }

  const activeValues = activeLang === "fr" ? valuesFr : valuesEn;
  const filledEnCount = Object.values(valuesEn).filter((v) => v.trim().length > 0).length;

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-muted font-body">
        Chaque section correspond à un bloc de la page <code className="font-mono text-[11px]">/a-propos</code>.
        Laissez un champ vide pour utiliser le texte générique par défaut. Les titres de section
        (« Notre histoire », « Le showroom »…) restent fixes — vous éditez uniquement le paragraphe.
      </p>

      {/* Onglets FR / EN globaux */}
      <div className="flex gap-1.5 border-b border-border">
        {(["fr", "en"] as const).map((lang) => {
          const isActive = activeLang === lang;
          return (
            <button
              key={lang}
              type="button"
              onClick={() => setActiveLang(lang)}
              className={`relative px-4 py-2 text-sm font-body font-semibold border-b-2 transition ${
                isActive
                  ? "border-text-primary text-text-primary"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              }`}
            >
              {lang === "fr" ? "🇫🇷 Français" : "🇬🇧 English"}
              {lang === "en" && (
                <span className="ml-2 text-[11px] font-normal text-text-muted">
                  {filledEnCount === 0
                    ? "(facultatif)"
                    : `(${filledEnCount}/6 rempli${filledEnCount > 1 ? "s" : ""})`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeLang === "en" && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 flex gap-3 items-start">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-sky-700 shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <div className="text-xs font-body text-sky-900 leading-relaxed">
            <p>Ces champs sont <span className="font-semibold">optionnels</span>. Une section vide en anglais affiche automatiquement la version française sur <code className="font-mono text-[11px]">/en/a-propos</code>.</p>
          </div>
        </div>
      )}

      {SECTIONS.map((section) => {
        const value = activeValues[section.key];
        const placeholder = activeLang === "fr" ? placeholders[section.key] : section.placeholderEn;
        return (
          <div key={`${activeLang}-${section.key}`}>
            <label htmlFor={`about-${activeLang}-${section.key}`} className="block text-sm font-body font-medium text-text-primary mb-1">
              {section.label}
              {activeLang === "en" && (
                <span className="ml-2 text-[11px] font-normal text-text-muted">(English)</span>
              )}
            </label>
            <p className="text-xs text-text-muted font-body mb-2">{section.description}</p>
            <textarea
              id={`about-${activeLang}-${section.key}`}
              value={value}
              onChange={(e) => setField(section.key, e.target.value)}
              rows={4}
              placeholder={placeholder}
              className="field-input resize-y min-h-[100px]"
            />
            <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
              {value.length} / {SECTION_MAX}
            </p>
          </div>
        );
      })}

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
