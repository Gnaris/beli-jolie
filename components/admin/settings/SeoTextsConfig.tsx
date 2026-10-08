"use client";

import { useState } from "react";
import { updateSeoTexts } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { NON_DEFAULT_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales";

type LocalizedTexts = {
  homeText: string;
  produitsText: string;
  produitsIntroText: string;
  tagline: string;
};

interface Props {
  initialHomeText: string;
  initialProduitsText: string;
  initialProduitsIntroText: string;
  initialTagline: string;
  /** Map locale → textes traduits. Clés attendues : locales dans NON_DEFAULT_LOCALES. */
  initialTranslations: Record<string, LocalizedTexts>;
}

const MAX = 5000;
const INTRO_MAX = 400;
const TAGLINE_MAX = 80;

const EMPTY_LOCALIZED: LocalizedTexts = {
  homeText: "",
  produitsText: "",
  produitsIntroText: "",
  tagline: "",
};

export default function SeoTextsConfig({
  initialHomeText,
  initialProduitsText,
  initialProduitsIntroText,
  initialTagline,
  initialTranslations,
}: Props) {
  const [locale, setLocale] = useState<Locale>("fr");

  const [homeText, setHomeText] = useState(initialHomeText);
  const [produitsText, setProduitsText] = useState(initialProduitsText);
  const [produitsIntroText, setProduitsIntroText] = useState(initialProduitsIntroText);
  const [tagline, setTagline] = useState(initialTagline);

  const [translations, setTranslations] = useState<Record<string, LocalizedTexts>>(() => {
    const out: Record<string, LocalizedTexts> = {};
    for (const loc of NON_DEFAULT_LOCALES) {
      out[loc] = { ...EMPTY_LOCALIZED, ...(initialTranslations[loc] ?? {}) };
    }
    return out;
  });

  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const isFr = locale === "fr";
  const currentLocaleTexts = isFr
    ? { homeText, produitsText, produitsIntroText, tagline }
    : translations[locale] ?? EMPTY_LOCALIZED;

  function setField(field: keyof LocalizedTexts, value: string) {
    if (isFr) {
      if (field === "homeText") setHomeText(value);
      else if (field === "produitsText") setProduitsText(value);
      else if (field === "produitsIntroText") setProduitsIntroText(value);
      else setTagline(value);
      return;
    }
    setTranslations((prev) => ({
      ...prev,
      [locale]: { ...(prev[locale] ?? EMPTY_LOCALIZED), [field]: value },
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateSeoTexts({
        homeText,
        produitsText,
        produitsIntroText,
        tagline,
        translations,
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

  const localeTabs: Locale[] = ["fr", ...NON_DEFAULT_LOCALES];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <p className="text-xs text-text-muted font-body">
          Rédigez chaque texte en français puis basculez sur une autre langue pour saisir la traduction. Si une case reste vide, la version française s&apos;affiche aux visiteurs de cette langue.
        </p>
        <div className="inline-flex rounded-full border border-border bg-bg-primary p-1 shrink-0 flex-wrap">
          {localeTabs.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => setLocale(loc)}
              className={`px-3 py-1 text-xs font-semibold rounded-full transition ${
                locale === loc ? "bg-bg-dark text-text-inverse" : "text-text-secondary"
              }`}
            >
              {LOCALE_LABELS[loc] ?? loc.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="seo-tagline" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          {isFr ? "Baseline pour Google" : `Baseline (${LOCALE_LABELS[locale] ?? locale.toUpperCase()})`}
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Petite phrase qui apparaît à côté du nom de la boutique dans les résultats Google et dans l&apos;onglet du navigateur. Décrivez votre activité en quelques mots.
        </p>
        <input
          id="seo-tagline"
          type="text"
          value={currentLocaleTexts.tagline}
          onChange={(e) => setField("tagline", e.target.value.slice(0, TAGLINE_MAX))}
          placeholder="Grossiste B2B"
          className="field-input"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {currentLocaleTexts.tagline.length} / {TAGLINE_MAX}
        </p>
      </div>

      <div>
        <label htmlFor="home-seo" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          {isFr ? "Texte d'accueil" : `Texte d'accueil (${LOCALE_LABELS[locale] ?? locale.toUpperCase()})`}
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affiché en bas de la page d&apos;accueil. Présentez votre activité, vos univers, votre savoir-faire — quelques phrases suffisent.
        </p>
        <textarea
          id="home-seo"
          value={currentLocaleTexts.homeText}
          onChange={(e) => setField("homeText", e.target.value.slice(0, MAX))}
          rows={6}
          placeholder="Beli & Jolie est votre grossiste B2B spécialisé dans…"
          className="field-input resize-y min-h-[140px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {currentLocaleTexts.homeText.length} / {MAX}
        </p>
      </div>

      <div>
        <label htmlFor="produits-intro" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          {isFr ? "Accroche courte du catalogue" : `Accroche courte (${LOCALE_LABELS[locale] ?? locale.toUpperCase()})`}
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affichée en haut de la page « Tous les produits », au-dessus des filtres. Une ou deux phrases suffisent.
        </p>
        <textarea
          id="produits-intro"
          value={currentLocaleTexts.produitsIntroText}
          onChange={(e) => setField("produitsIntroText", e.target.value.slice(0, INTRO_MAX))}
          rows={3}
          placeholder="Découvrez plus de 600 références réservées aux boutiques et revendeurs professionnels…"
          className="field-input resize-y min-h-[80px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {currentLocaleTexts.produitsIntroText.length} / {INTRO_MAX}
        </p>
      </div>

      <div>
        <label htmlFor="produits-seo" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          {isFr ? "Texte long du catalogue" : `Texte long (${LOCALE_LABELS[locale] ?? locale.toUpperCase()})`}
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Affiché en bas de la page « Tous les produits », sous la grille. Idéal pour donner du contexte à Google.
        </p>
        <textarea
          id="produits-seo"
          value={currentLocaleTexts.produitsText}
          onChange={(e) => setField("produitsText", e.target.value.slice(0, MAX))}
          rows={6}
          placeholder="Découvrez l'ensemble de notre catalogue grossiste…"
          className="field-input resize-y min-h-[140px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {currentLocaleTexts.produitsText.length} / {MAX}
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
