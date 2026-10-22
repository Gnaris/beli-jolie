"use client";

import { VALID_LOCALES, LOCALE_LABELS } from "@/i18n/locales";
import { compositionInitials } from "@/lib/composition-filters";
import { formatDate } from "@/lib/format-date";

export type CompositionDetailData = {
  id: string;
  name: string;
  translations: Record<string, string>;
  productCount: number;
  createdAt: Date;
  pfsLabel: string | null;
  efashionLabel: string | null;
};

type Marketplace = "pfs" | "efashion";

type Props = {
  composition: CompositionDetailData;
  showBackButton: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditMapping: (mp: Marketplace) => void;
};

const CHIP_STYLE: React.CSSProperties = {
  background: "linear-gradient(135deg, #FDE68A 0%, #F59E0B 100%)",
  color: "#78350F",
  boxShadow: "0 8px 20px rgba(180, 83, 9, 0.22), inset 0 1px 0 rgba(255,255,255,0.5)",
};

const MARKETPLACES: { key: Marketplace; label: string; initial: string; gradient: string }[] = [
  { key: "pfs",      label: "PFS",      initial: "P", gradient: "from-[#4f46e5] to-[#6366f1]" },
  { key: "efashion", label: "eFashion", initial: "E", gradient: "from-[#db2777] to-[#ec4899]" },
];

export default function CompositionDetail({
  composition,
  showBackButton,
  onBack,
  onEdit,
  onDelete,
  onEditMapping,
}: Props) {
  const initials = compositionInitials(composition.name);
  const deleteDisabled = composition.productCount > 0;

  const mktValues: Record<Marketplace, string | null> = {
    pfs: composition.pfsLabel,
    efashion: composition.efashionLabel,
  };

  return (
    <div className="flex flex-col bg-bg-primary border border-border rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
      {/* === HEADER === */}
      <header className="bg-bg-primary border-b border-border px-4 md:px-6 py-4">
        <div className="flex items-start gap-3 md:gap-4">
          {showBackButton && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Retour à la liste"
              className="md:hidden shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-bg-secondary text-text-secondary hover:text-text-primary mt-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          <span
            aria-hidden
            className="shrink-0 w-14 h-14 md:w-16 md:h-16 rounded-2xl inline-flex items-center justify-center text-[18px] md:text-[22px] font-bold"
            style={CHIP_STYLE}
          >
            {initials}
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] md:text-[20px] font-bold tracking-tight text-text-primary truncate">
              {composition.name}
            </h2>
            <div className="flex items-center gap-2 text-[12px] text-text-secondary mt-0.5 flex-wrap">
              <span className="font-medium">{composition.productCount} produit{composition.productCount > 1 ? "s" : ""}</span>
              <span aria-hidden className="hidden sm:inline w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span className="hidden sm:inline">créée le {formatDate(composition.createdAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              aria-label="Renommer la composition"
              title="Renommer"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleteDisabled}
              aria-label="Supprimer la composition"
              title={deleteDisabled ? "Impossible — utilisée par des produits" : "Supprimer"}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-[#BE123C] hover:bg-[#FFF1F2] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9M4.772 5.79l1.068 13.883A2.25 2.25 0 008.084 21.75h7.832a2.25 2.25 0 002.244-2.077L19.228 5.79M5.79 5.79a48.11 48.11 0 013.478-.397m0 0v-.916c0-1.18.91-2.164 2.09-2.201a51.964 51.964 0 013.32 0c1.18.037 2.09 1.022 2.09 2.201v.916m-7.5 0a48.667 48.667 0 017.5 0" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* === CORPS === */}
      <div className="px-4 md:px-6 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
          <section
            aria-label="Informations"
            className="rounded-2xl border border-border bg-bg-secondary/40 p-4 md:p-5 flex flex-col gap-5 min-w-0"
          >
            <header className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-primary border border-border text-text-secondary">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </span>
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-primary">
                Informations
              </h3>
            </header>

            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-2">
                Traductions
              </h4>
              <div className="flex flex-col gap-1.5">
                {VALID_LOCALES.map((code) => {
                  const value = composition.translations[code];
                  const filled = !!value && !!value.trim();
                  return (
                    <div
                      key={code}
                      title={value || `${code.toUpperCase()} : manquant`}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] ${
                        filled
                          ? "bg-bg-primary text-text-primary border border-border"
                          : "bg-amber-50 text-amber-800 border border-amber-200"
                      }`}
                    >
                      <span className="shrink-0 w-7 text-[10px] font-bold tracking-wider opacity-80">
                        {LOCALE_LABELS[code]}
                      </span>
                      <span className="flex-1 truncate font-medium">
                        {filled ? value : "manquant"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-text-muted mt-2">
                Pour corriger, cliquez sur l'icône crayon en haut à droite.
              </p>
            </div>
          </section>

          <section
            aria-label="Mappings marketplaces"
            className="rounded-2xl border border-border bg-bg-secondary/40 p-4 md:p-5 flex flex-col gap-3 min-w-0"
          >
            <header className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-primary border border-border text-text-secondary">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
              </span>
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-primary">
                Marketplaces
              </h3>
            </header>

            <ul className="flex flex-col gap-1.5">
              {MARKETPLACES.map((m) => {
                const value = mktValues[m.key];
                const mapped = !!value;
                return (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => onEditMapping(m.key)}
                      className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-bg-primary hover:border-border-dark hover:bg-bg-tertiary transition-colors text-left"
                    >
                      <span
                        aria-hidden
                        className={`shrink-0 w-8 h-8 rounded-full bg-gradient-to-br ${m.gradient} grid place-items-center text-white text-[12px] font-bold`}
                      >
                        {m.initial}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-text-primary">{m.label}</span>
                          <span
                            aria-hidden
                            className={`inline-block w-1.5 h-1.5 rounded-full ${mapped ? "bg-emerald-500" : "bg-amber-400"}`}
                            title={mapped ? "Mappé" : "Non mappé"}
                          />
                        </div>
                        <div
                          className={`text-[12px] truncate ${mapped ? "text-text-secondary" : "text-text-muted italic"}`}
                          title={value ?? "Non mappé"}
                        >
                          {value ?? "Non mappé"}
                        </div>
                      </div>
                      <span className="shrink-0 text-[12px] text-text-muted group-hover:text-text-primary font-medium inline-flex items-center gap-1">
                        <span className="hidden sm:inline">{mapped ? "Modifier" : "Choisir"}</span>
                        <span aria-hidden>→</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
