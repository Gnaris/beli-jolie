"use client";

import { NON_DEFAULT_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales";
import TranslatingInput from "@/components/admin/TranslatingInput";

/**
 * Bloc de champs « Traductions » affichant un input par locale non-défaut
 * (en, de, it, es). Utilisé par les modales d'attribut (Catégorie, Couleur,
 * Composition, Saison, Sous-catégorie…) pour laisser l'utilisatrice saisir
 * ou corriger les traductions. Le bouton « Traduire » (quand l'auto-traduction
 * n'est pas activée) remplit les 4 locales en 1 call PFS.
 */

const LOCALE_FLAGS: Record<string, string> = {
  en: "🇬🇧",
  de: "🇩🇪",
  it: "🇮🇹",
  es: "🇪🇸",
};

/** Placeholders par locale pour les couleurs — pour aider à comprendre
 * quelle langue remplir. */
export const COLOR_LOCALE_PLACEHOLDERS: Record<string, string> = {
  en: "Ex : Gold, Rose gold, Black…",
  de: "Z. B. Gold, Roségold, Schwarz…",
  it: "Es. Oro, Oro rosa, Nero…",
  es: "Ej. Oro, Oro rosa, Negro…",
};

export const CATEGORY_LOCALE_PLACEHOLDERS: Record<string, string> = {
  en: "Ex : Ring, Necklace, Earrings…",
  de: "Z. B. Ring, Halskette, Ohrringe…",
  it: "Es. Anello, Collana, Orecchini…",
  es: "Ej. Anillo, Collar, Pendientes…",
};

export const COMPOSITION_LOCALE_PLACEHOLDERS: Record<string, string> = {
  en: "Ex : Silver 925, Brass, Stainless steel…",
  de: "Z. B. Silber 925, Messing, Edelstahl…",
  it: "Es. Argento 925, Ottone, Acciaio inox…",
  es: "Ej. Plata 925, Latón, Acero inoxidable…",
};

export const SEASON_LOCALE_PLACEHOLDERS: Record<string, string> = {
  en: "Ex : Spring/Summer 2026, Timeless…",
  de: "Z. B. Frühjahr/Sommer 2026, Zeitlos…",
  it: "Es. Primavera/Estate 2026, Senza tempo…",
  es: "Ej. Primavera/Verano 2026, Atemporal…",
};

interface Props {
  /** Map locale → valeur. La clé "fr" est ignorée ici (le champ FR vit à part). */
  names: Record<string, string>;
  /** Setter identique à celui d'un `useState<Record<string, string>>`. */
  setNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Renvoyée par `useAutoTranslateOnBlur` : true pendant qu'une locale se traduit. */
  isTranslating: (locale: string) => boolean;
  /** Placeholders par locale (voir constantes exportées pour les presets). */
  placeholders?: Record<string, string>;
}

export default function TranslationFieldsBlock({
  names,
  setNames,
  isTranslating,
  placeholders,
}: Props) {
  return (
    <div className="space-y-2.5">
      {NON_DEFAULT_LOCALES.map((locale) => (
        <TranslationFieldRow
          key={locale}
          locale={locale}
          value={names[locale] ?? ""}
          onChange={(val) => setNames((prev) => ({ ...prev, [locale]: val }))}
          translating={isTranslating(locale)}
          placeholder={placeholders?.[locale]}
        />
      ))}
    </div>
  );
}

interface RowProps {
  locale: Locale;
  value: string;
  onChange: (val: string) => void;
  translating: boolean;
  placeholder?: string;
}

function TranslationFieldRow({
  locale,
  value,
  onChange,
  translating,
  placeholder,
}: RowProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-tertiary text-text-secondary text-[10.5px] font-semibold"
        aria-label={`Langue ${LOCALE_LABELS[locale]}`}
      >
        <span aria-hidden>{LOCALE_FLAGS[locale] ?? ""}</span>
        {LOCALE_LABELS[locale]}
      </span>
      <TranslatingInput
        translating={translating}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field-input w-full text-sm"
        data-testid={`translation-input-${locale}`}
      />
    </div>
  );
}
