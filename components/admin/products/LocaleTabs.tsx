interface LocaleTabsProps {
  locales: readonly string[];
  activeLocale: string;
  localeLabels: Record<string, string>;
  onChange: (locale: string) => void;
  /** Locales that have content filled in (shows green dot) */
  filledLocales?: Set<string>;
  /**
   * Locales that have NO saved translation in DB (shows ⚠️ badge with tooltip).
   * Only meaningful in edit mode — pass undefined in create mode.
   */
  missingDbLocales?: Set<string>;
}

export default function LocaleTabs({
  locales, activeLocale, localeLabels, onChange, filledLocales, missingDbLocales,
}: LocaleTabsProps) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {locales.map((locale) => {
        const isActive = locale === activeLocale;
        const isFilled = filledLocales?.has(locale) && !isActive;
        const isMissingDb = missingDbLocales?.has(locale) && !isActive;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => onChange(locale)}
            className={`relative px-3 py-1.5 text-xs font-semibold rounded-lg transition-all font-[family-name:var(--font-roboto)] ${
              isActive
                ? "bg-[#1A1A1A] text-white shadow-sm"
                : isMissingDb
                ? "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300"
                : "bg-[#F7F7F7] text-[#6B6B6B] hover:bg-[#EFEFEF] hover:text-[#1A1A1A] border border-[#E5E5E5]"
            }`}
          >
            {localeLabels[locale] ?? locale.toUpperCase()}
            {isFilled && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
            )}
            {isMissingDb && !isFilled && (
              <span
                className="absolute -top-1.5 -right-1.5 group/warn"
                title={`Traduction manquante — s'affiche en français par défaut`}
              >
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-white text-[9px] font-bold border border-white">
                  !
                </span>
                <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/warn:block w-52 bg-[#1A1A1A] text-white text-xs rounded-lg px-3 py-2 z-50 pointer-events-none shadow-lg whitespace-normal text-left font-normal">
                  Traduction manquante pour &ldquo;{localeLabels[locale]}&rdquo; — le produit s&apos;affichera en français pour cette langue
                  <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
