"use client";

import ColorTranslationsLocked from "./ColorTranslationsLocked";
import ColorMarketplaceMappingCards from "./ColorMarketplaceMappingCards";
import { formatDate } from "@/lib/format-date";

export type ColorDetailData = {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  translations: Record<string, string>;
  productCount: number;
  createdAt: Date;
  pfsLabel: string | null;
  pfsSharedCount: number;
  efashionLabel: string | null;
  microstoreLabel: string | null;
};

type Props = {
  color: ColorDetailData;
  showBackButton: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditMapping: (mp: "pfs" | "efashion" | "microstore") => void;
};

export default function ColorDetail({
  color,
  showBackButton,
  onBack,
  onEdit,
  onDelete,
  onEditMapping,
}: Props) {
  const isPattern = !!color.patternImage;
  const swatchStyle: React.CSSProperties = isPattern
    ? { backgroundImage: `url(${color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { backgroundColor: color.hex ?? "#9CA3AF" };
  const typeBadge = isPattern ? "Motif" : "Hex";
  const valueLabel = isPattern ? "Motif image" : color.hex ?? "—";

  return (
    <div className="flex flex-col gap-3 md:gap-4 p-3 md:p-7 bg-bg-primary overflow-y-auto md:h-full">
      {/* Header — sticky sur mobile */}
      <div className="sticky top-0 -mx-3 -mt-3 px-3 pt-3 md:mx-0 md:mt-0 md:px-0 md:pt-0 md:static bg-bg-primary/95 md:bg-bg-primary backdrop-blur-sm md:backdrop-blur-none z-10 pb-3 md:pb-4 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
            {showBackButton && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Retour à la liste"
                className="md:hidden shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-bg-secondary text-text-secondary hover:text-text-primary"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div className="relative shrink-0">
              <span
                aria-hidden
                className="block w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl border border-border shadow-[var(--shadow-inset)]"
                style={swatchStyle}
              />
              <span
                className="absolute -bottom-1 -right-1 h-5 md:h-6 min-w-[20px] md:min-w-[24px] px-1 md:px-1.5 rounded-full bg-white border border-border shadow-[var(--shadow-sm)] flex items-center justify-center text-[9px] md:text-[10px] font-bold text-text-secondary"
                title={isPattern ? "Motif image" : "Couleur unie"}
              >
                {typeBadge}
              </span>
            </div>
            <div className="min-w-0">
              <h2 className="text-[19px] md:text-[22px] font-bold tracking-tight text-text-primary truncate">{color.name}</h2>
              <div className="flex items-center gap-2 md:gap-2.5 text-[11.5px] md:text-[12px] text-text-secondary mt-1 md:mt-1.5 flex-wrap">
                <span>{color.productCount} produit{color.productCount > 1 ? "s" : ""}</span>
                <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
                <span className={isPattern ? "" : "font-mono"}>{valueLabel}</span>
                <span aria-hidden className="hidden md:inline w-[3px] h-[3px] rounded-full bg-text-muted" />
                <span className="hidden md:inline">créée le {formatDate(color.createdAt)}</span>
              </div>
            </div>
          </div>
          {/* Actions desktop uniquement */}
          <div className="hidden md:flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink shadow-[var(--shadow-sm)] text-[13px] font-semibold transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              Modifier
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] shadow-[var(--shadow-sm)] text-[13px] font-semibold transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Supprimer
            </button>
          </div>
        </div>
        {/* Actions mobile — pleine largeur */}
        <div className="flex md:hidden gap-2 mt-3">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-secondary text-[12.5px] font-semibold"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
            Modifier
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex-1 inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C] text-[12.5px] font-semibold"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9M4.772 5.79l1.068 13.883A2.25 2.25 0 008.084 21.75h7.832a2.25 2.25 0 002.244-2.077L19.228 5.79M5.79 5.79a48.11 48.11 0 013.478-.397m0 0v-.916c0-1.18.91-2.164 2.09-2.201a51.964 51.964 0 013.32 0c1.18.037 2.09 1.022 2.09 2.201v.916m-7.5 0a48.667 48.667 0 017.5 0" />
            </svg>
            Supprimer
          </button>
        </div>
      </div>

      {/* Aperçu */}
      <section className="bg-bg-primary border border-border rounded-2xl p-3 md:p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">Aperçu</h3>
        <div className="flex items-stretch gap-3 flex-wrap">
          <div className="flex-1 min-w-[180px] rounded-xl border border-border overflow-hidden flex flex-col">
            <div className="h-24" style={swatchStyle} aria-hidden />
            <div className="px-3 py-2 text-[11px] text-text-muted flex items-center justify-between">
              <span>Aplat</span>
              <span className={isPattern ? "" : "font-mono text-text-secondary"}>{valueLabel}</span>
            </div>
          </div>
          <div className="flex-1 min-w-[180px] rounded-xl border border-border overflow-hidden flex flex-col">
            <div className="h-24 flex items-center justify-center bg-bg-secondary">
              <span
                aria-hidden
                className="w-14 h-14 rounded-full block ring-4 ring-white shadow-[var(--shadow-card)]"
                style={swatchStyle}
              />
            </div>
            <div className="px-3 py-2 text-[11px] text-text-muted flex items-center justify-between">
              <span>Pastille produit</span>
              <span>—</span>
            </div>
          </div>
        </div>
      </section>

      {/* Translations */}
      <section className="bg-bg-primary border border-border rounded-2xl p-3 md:p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">Traductions</h3>
        <ColorTranslationsLocked translations={color.translations} />
      </section>

      {/* Marketplaces */}
      <section className="bg-bg-primary border border-border rounded-2xl p-3 md:p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">Marketplaces</h3>
        <ColorMarketplaceMappingCards
          pfsLabel={color.pfsLabel}
          pfsSharedCount={color.pfsSharedCount}
          efashionLabel={color.efashionLabel}
          microstoreLabel={color.microstoreLabel}
          onEditMapping={onEditMapping}
        />
      </section>
    </div>
  );
}
