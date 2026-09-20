"use client";

import { useState } from "react";
import { updateSeoTexts } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  initialHomeText: string;
  initialProduitsText: string;
  initialProduitsIntroText: string;
  initialTagline: string;
  initialHomeTextEn: string;
  initialProduitsTextEn: string;
  initialProduitsIntroTextEn: string;
  initialTaglineEn: string;
}

const MAX = 5000;
const INTRO_MAX = 400;
const TAGLINE_MAX = 80;

type Locale = "fr" | "en";

export default function SeoTextsConfig({
  initialHomeText,
  initialProduitsText,
  initialProduitsIntroText,
  initialTagline,
  initialHomeTextEn,
  initialProduitsTextEn,
  initialProduitsIntroTextEn,
  initialTaglineEn,
}: Props) {
  const [locale, setLocale] = useState<Locale>("fr");
  const [homeText, setHomeText] = useState(initialHomeText);
  const [produitsText, setProduitsText] = useState(initialProduitsText);
  const [produitsIntroText, setProduitsIntroText] = useState(initialProduitsIntroText);
  const [tagline, setTagline] = useState(initialTagline);
  const [homeTextEn, setHomeTextEn] = useState(initialHomeTextEn);
  const [produitsTextEn, setProduitsTextEn] = useState(initialProduitsTextEn);
  const [produitsIntroTextEn, setProduitsIntroTextEn] = useState(initialProduitsIntroTextEn);
  const [taglineEn, setTaglineEn] = useState(initialTaglineEn);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const isEn = locale === "en";
  const currentTagline = isEn ? taglineEn : tagline;
  const currentHome = isEn ? homeTextEn : homeText;
  const currentIntro = isEn ? produitsIntroTextEn : produitsIntroText;
  const currentProduits = isEn ? produitsTextEn : produitsText;
  const setCurrentTagline = isEn ? setTaglineEn : setTagline;
  const setCurrentHome = isEn ? setHomeTextEn : setHomeText;
  const setCurrentIntro = isEn ? setProduitsIntroTextEn : setProduitsIntroText;
  const setCurrentProduits = isEn ? setProduitsTextEn : setProduitsText;

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateSeoTexts({
        homeText,
        produitsText,
        produitsIntroText,
        tagline,
        homeTextEn,
        produitsTextEn,
        produitsIntroTextEn,
        taglineEn,
      });
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
      {/* Sélecteur de langue */}
      <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <p className="text-xs text-text-muted font-body">
          Rédigez chaque texte en français puis basculez sur « English » pour saisir la traduction affichée aux visiteurs anglophones. Si l&apos;anglais reste vide, la version française est utilisée par défaut.
        </p>
        <div className="inline-flex rounded-full border border-border bg-bg-primary p-1 shrink-0">
          <button
            type="button"
            onClick={() => setLocale("fr")}
            className={`px-3 py-1 text-xs font-semibold rounded-full transition ${
              locale === "fr" ? "bg-bg-dark text-text-inverse" : "text-text-secondary"
            }`}
          >
            Français
          </button>
          <button
            type="button"
            onClick={() => setLocale("en")}
            className={`px-3 py-1 text-xs font-semibold rounded-full transition ${
              locale === "en" ? "bg-bg-dark text-text-inverse" : "text-text-secondary"
            }`}
          >
            English
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="seo-tagline" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          {isEn ? "Tagline for Google (EN)" : "Baseline pour Google"}
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Petite phrase qui apparaît à côté du nom de la boutique dans les résultats Google et dans l&apos;onglet du navigateur. Décrivez votre activité en quelques mots (ex : « Grossiste maroquinerie et accessoires »). Laissez vide pour utiliser « Grossiste B2B ».
        </p>
        <input
          id="seo-tagline"
          type="text"
          value={currentTagline}
          onChange={(e) => setCurrentTagline(e.target.value.slice(0, TAGLINE_MAX))}
          placeholder={isEn ? "B2B wholesaler" : "Grossiste B2B"}
          className="field-input"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {currentTagline.length} / {TAGLINE_MAX}
        </p>
      </div>

      <div>
        <label htmlFor="home-seo" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          {isEn ? "Home welcome text (EN)" : "Texte d'accueil"}
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affiché en bas de la page d&apos;accueil. Présentez votre activité, vos univers, votre savoir-faire — quelques phrases suffisent. Plus le texte est riche, plus Google comprend votre site.
        </p>
        <textarea
          id="home-seo"
          value={currentHome}
          onChange={(e) => setCurrentHome(e.target.value.slice(0, MAX))}
          rows={6}
          placeholder={isEn ? "Beli & Jolie is your B2B wholesaler specialising in…" : "Beli & Jolie est votre grossiste B2B spécialisé dans…"}
          className="field-input resize-y min-h-[140px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {currentHome.length} / {MAX}
        </p>
      </div>

      <div>
        <label htmlFor="produits-intro" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          {isEn ? "Catalog short intro (EN)" : "Accroche courte du catalogue"}
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affichée en haut de la page « Tous les produits », au-dessus des filtres. Une ou deux phrases suffisent — invitez à créer un compte, précisez à qui s&apos;adresse le catalogue.
        </p>
        <textarea
          id="produits-intro"
          value={currentIntro}
          onChange={(e) => setCurrentIntro(e.target.value.slice(0, INTRO_MAX))}
          rows={3}
          placeholder={isEn ? "Discover 600+ wholesale references reserved for professional stores and resellers…" : "Découvrez plus de 600 références réservées aux boutiques et revendeurs professionnels…"}
          className="field-input resize-y min-h-[80px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {currentIntro.length} / {INTRO_MAX}
        </p>
      </div>

      <div>
        <label htmlFor="produits-seo" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          {isEn ? "Catalog long text (EN)" : "Texte long du catalogue"}
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affiché en bas de la page « Tous les produits », sous la grille. Idéal pour donner du contexte à Google : marques, univers, ce qui vous distingue.
        </p>
        <textarea
          id="produits-seo"
          value={currentProduits}
          onChange={(e) => setCurrentProduits(e.target.value.slice(0, MAX))}
          rows={6}
          placeholder={isEn ? "Explore our full wholesale catalog…" : "Découvrez l'ensemble de notre catalogue grossiste…"}
          className="field-input resize-y min-h-[140px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {currentProduits.length} / {MAX}
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
