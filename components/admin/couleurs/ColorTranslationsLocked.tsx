type Props = {
  translations: Record<string, string>;
};

const LANGS: { code: string; label: string }[] = [
  { code: "fr", label: "FR" },
  { code: "en", label: "EN" },
];

export default function ColorTranslationsLocked({ translations }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {LANGS.map(({ code, label }) => {
        const value = translations[code];
        return (
          <div
            key={code}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-bg-secondary border border-border shadow-[var(--shadow-inset)]"
          >
            <span className="flex-shrink-0 w-7 h-[22px] rounded-md bg-ink text-text-inverse text-[10px] font-bold tracking-wider inline-flex items-center justify-center">
              {label}
            </span>
            <span className={`flex-1 text-[13.5px] font-medium ${value ? "text-text-primary" : "text-text-muted italic"}`}>
              {value || "manquant"}
            </span>
            <svg aria-hidden="true" className="w-3.5 h-3.5 text-text-muted/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
