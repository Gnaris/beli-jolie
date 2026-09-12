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

interface SectionMeta {
  key: keyof Props["placeholders"];
  label: string;
  description: string;
}

const SECTIONS: SectionMeta[] = [
  {
    key: "intro",
    label: "Introduction",
    description: "Paragraphe d'accroche affiché juste sous le titre principal de la page.",
  },
  {
    key: "historyBody",
    label: "Notre histoire",
    description: "Comment est née la boutique, ses valeurs, son parcours.",
  },
  {
    key: "showroomBody",
    label: "Le showroom",
    description: "Où vous accueillez les revendeuses, les horaires, ce qu'elles peuvent voir sur place.",
  },
  {
    key: "teamBody",
    label: "L'équipe",
    description: "Qui compose l'équipe, ce qu'elle fait pour les clientes, les langues parlées.",
  },
  {
    key: "newnessBody",
    label: "Nouveautés régulières",
    description: "Rythme des nouveautés, comment les clientes sont informées.",
  },
  {
    key: "deliveryBody",
    label: "Livraisons",
    description: "Zones desservies, délais, transporteurs. Section pleine largeur en bas.",
  },
];

export default function AboutPageConfig({
  initialIntro,
  initialHistoryBody,
  initialShowroomBody,
  initialTeamBody,
  initialNewnessBody,
  initialDeliveryBody,
  placeholders,
}: Props) {
  const [values, setValues] = useState({
    intro: initialIntro,
    historyBody: initialHistoryBody,
    showroomBody: initialShowroomBody,
    teamBody: initialTeamBody,
    newnessBody: initialNewnessBody,
    deliveryBody: initialDeliveryBody,
  });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function setField(key: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [key]: value.slice(0, SECTION_MAX) }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateAboutPage(values);
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

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-muted font-body">
        Chaque section correspond à un bloc de la page <code className="font-mono text-[11px]">/a-propos</code>.
        Laissez un champ vide pour utiliser le texte générique par défaut. Les titres de section
        (« Notre histoire », « Le showroom »…) restent fixes — vous éditez uniquement le paragraphe.
      </p>

      {SECTIONS.map((section) => {
        const value = values[section.key];
        const placeholder = placeholders[section.key];
        return (
          <div key={section.key}>
            <label htmlFor={`about-${section.key}`} className="block text-sm font-body font-medium text-text-primary mb-1">
              {section.label}
            </label>
            <p className="text-xs text-text-muted font-body mb-2">{section.description}</p>
            <textarea
              id={`about-${section.key}`}
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
