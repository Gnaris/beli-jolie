"use client";

import CompositionTranslationsLocked from "./CompositionTranslationsLocked";
import CompositionMarketplaceMappingCards from "./CompositionMarketplaceMappingCards";
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

type Props = {
  composition: CompositionDetailData;
  showBackButton: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditMapping: (mp: "pfs" | "efashion") => void;
};

const CHIP_STYLE: React.CSSProperties = {
  background: "linear-gradient(135deg, #FDE68A 0%, #F59E0B 100%)",
  color: "#78350F",
  boxShadow: "0 8px 20px rgba(180, 83, 9, 0.22), inset 0 1px 0 rgba(255,255,255,0.5)",
};

export default function CompositionDetail({
  composition,
  showBackButton,
  onBack,
  onEdit,
  onDelete,
  onEditMapping,
}: Props) {
  const initials = compositionInitials(composition.name);

  return (
    <div className="flex flex-col gap-4 p-5 md:p-7 bg-bg-primary overflow-y-auto md:h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-border">
        <div className="flex items-center gap-4 min-w-0">
          {showBackButton && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Retour à la liste"
              className="md:hidden inline-flex items-center justify-center w-8 h-8 rounded-md border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink mt-0.5"
            >
              ←
            </button>
          )}
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="w-[72px] h-[72px] rounded-[20px] inline-flex items-center justify-center text-[26px] font-bold"
              style={CHIP_STYLE}
            >
              {initials}
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold tracking-tight text-text-primary truncate">{composition.name}</h2>
            <div className="flex items-center gap-2.5 text-[12px] text-text-secondary mt-1.5 flex-wrap">
              <span>{composition.productCount} produit{composition.productCount > 1 ? "s" : ""}</span>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span>créée le {formatDate(composition.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
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
            disabled={composition.productCount > 0}
            title={composition.productCount > 0 ? "Impossible — utilisée par des produits" : "Supprimer"}
            className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] disabled:opacity-40 disabled:cursor-not-allowed shadow-[var(--shadow-sm)] text-[13px] font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            Supprimer
          </button>
        </div>
      </div>

      {/* Traductions */}
      <section className="relative bg-bg-primary border border-border rounded-2xl p-4 shadow-[var(--shadow-sm)] overflow-hidden">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-300 to-sky-500" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">Traductions</h3>
        <CompositionTranslationsLocked translations={composition.translations} />
      </section>

      {/* Marketplaces */}
      <section className="relative bg-bg-primary border border-border rounded-2xl p-4 shadow-[var(--shadow-sm)] overflow-hidden">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-300 to-violet-500" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">Correspondances marketplaces</h3>
        <CompositionMarketplaceMappingCards
          pfsLabel={composition.pfsLabel}
          efashionLabel={composition.efashionLabel}
          onEditMapping={onEditMapping}
        />
      </section>
    </div>
  );
}
