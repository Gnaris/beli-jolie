import { VALID_LOCALES, LOCALE_LABELS } from "@/i18n/locales";

type Props = {
  translations: Record<string, string>;
};

/**
 * Section « Traductions » affichée en lecture seule sur la fiche détail
 * d'un attribut (couleur, catégorie, composition, saison). Liste chaque
 * locale ouverte sur le site (fr, en, de, it, es) avec sa valeur ou le
 * marqueur « manquant ». Pour corriger, l'utilisatrice ouvre la modale
 * d'édition — c'est pour ça qu'une petite icône cadenas est affichée.
 */
export default function AttributeTranslationsLocked({ translations }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {VALID_LOCALES.map((code) => {
        const value = translations[code];
        return (
          <div
            key={code}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-bg-secondary border border-border shadow-[var(--shadow-inset)]"
          >
            <span className="flex-shrink-0 w-7 h-[22px] rounded-md bg-ink text-text-inverse text-[10px] font-bold tracking-wider inline-flex items-center justify-center">
              {LOCALE_LABELS[code]}
            </span>
            <span
              className={`flex-1 text-[13.5px] font-medium truncate ${
                value ? "text-text-primary" : "text-text-muted italic"
              }`}
              title={value || undefined}
            >
              {value || "manquant"}
            </span>
            <svg
              aria-hidden="true"
              className="w-3.5 h-3.5 text-text-muted/70 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
