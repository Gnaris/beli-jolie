"use client";

import { useState } from "react";
import { updateSeoTexts } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  initialHomeText: string;
  initialProduitsText: string;
}

const MAX = 5000;

export default function SeoTextsConfig({ initialHomeText, initialProduitsText }: Props) {
  const [homeText, setHomeText] = useState(initialHomeText);
  const [produitsText, setProduitsText] = useState(initialProduitsText);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateSeoTexts({ homeText, produitsText });
      if (result.success) {
        toast({ type: "success", title: "Enregistré", message: "Textes SEO mis à jour." });
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
      <div>
        <label htmlFor="home-seo" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Texte d&apos;accueil
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affiché en bas de la page d&apos;accueil. Présentez votre activité, vos univers, votre savoir-faire — quelques phrases suffisent. Plus le texte est riche, plus Google comprend votre site.
        </p>
        <textarea
          id="home-seo"
          value={homeText}
          onChange={(e) => setHomeText(e.target.value.slice(0, MAX))}
          rows={6}
          placeholder="Beli & Jolie est votre grossiste B2B spécialisé dans…"
          className="field-input resize-y min-h-[140px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {homeText.length} / {MAX}
        </p>
      </div>

      <div>
        <label htmlFor="produits-seo" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Texte du catalogue
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affiché en haut de la page « Tous les produits ». Décrivez votre catalogue, les marques, les univers, ce qui vous distingue.
        </p>
        <textarea
          id="produits-seo"
          value={produitsText}
          onChange={(e) => setProduitsText(e.target.value.slice(0, MAX))}
          rows={6}
          placeholder="Découvrez l'ensemble de notre catalogue grossiste…"
          className="field-input resize-y min-h-[140px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {produitsText.length} / {MAX}
        </p>
      </div>

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
