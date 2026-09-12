"use client";

import { useState } from "react";
import { updateSeoTexts } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  initialHomeText: string;
  initialProduitsText: string;
  initialProduitsIntroText: string;
  initialTagline: string;
}

const MAX = 5000;
const INTRO_MAX = 400;
const TAGLINE_MAX = 80;

export default function SeoTextsConfig({ initialHomeText, initialProduitsText, initialProduitsIntroText, initialTagline }: Props) {
  const [homeText, setHomeText] = useState(initialHomeText);
  const [produitsText, setProduitsText] = useState(initialProduitsText);
  const [produitsIntroText, setProduitsIntroText] = useState(initialProduitsIntroText);
  const [tagline, setTagline] = useState(initialTagline);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateSeoTexts({ homeText, produitsText, produitsIntroText, tagline });
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
        <label htmlFor="seo-tagline" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Baseline pour Google
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Petite phrase qui apparaît à côté du nom de la boutique dans les résultats Google et dans l&apos;onglet du navigateur. Décrivez votre activité en quelques mots (ex : « Grossiste maroquinerie et accessoires »). Laissez vide pour utiliser « Grossiste B2B ».
        </p>
        <input
          id="seo-tagline"
          type="text"
          value={tagline}
          onChange={(e) => setTagline(e.target.value.slice(0, TAGLINE_MAX))}
          placeholder="Grossiste B2B"
          className="field-input"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {tagline.length} / {TAGLINE_MAX}
        </p>
      </div>

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
        <label htmlFor="produits-intro" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Accroche courte du catalogue
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affichée en haut de la page « Tous les produits », au-dessus des filtres. Une ou deux phrases suffisent — invitez à créer un compte, précisez à qui s&apos;adresse le catalogue.
        </p>
        <textarea
          id="produits-intro"
          value={produitsIntroText}
          onChange={(e) => setProduitsIntroText(e.target.value.slice(0, INTRO_MAX))}
          rows={3}
          placeholder="Découvrez plus de 600 références réservées aux boutiques et revendeurs professionnels…"
          className="field-input resize-y min-h-[80px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {produitsIntroText.length} / {INTRO_MAX}
        </p>
      </div>

      <div>
        <label htmlFor="produits-seo" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Texte long du catalogue
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affiché en bas de la page « Tous les produits », sous la grille. Idéal pour donner du contexte à Google : marques, univers, ce qui vous distingue.
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
