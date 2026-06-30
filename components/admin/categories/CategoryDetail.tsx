"use client";

import CategoryTranslationsLocked from "./CategoryTranslationsLocked";
import SubCategoryChips from "./SubCategoryChips";
import MarketplaceMappingCards from "./MarketplaceMappingCards";
import { formatDate } from "@/lib/format-date";

type Sub = { id: string; name: string; translations: Record<string, string> };
export type CategoryDetailData = {
  id: string;
  name: string;
  translations: Record<string, string>;
  productCount: number;
  createdAt: Date;
  subCategories: Sub[];
  pfsLabel: string | null;
  efashionLabel: string | null;
  faireLabel: string | null;
};

type Props = {
  category: CategoryDetailData;
  showBackButton: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSubAdd: () => void;
  onSubEdit: (sub: Sub) => void;
  onSubDelete: (sub: Sub) => void;
  onEditMapping: (mp: "pfs" | "efashion" | "faire") => void;
};

export default function CategoryDetail({
  category,
  showBackButton,
  onBack,
  onEdit,
  onDelete,
  onSubAdd,
  onSubEdit,
  onSubDelete,
  onEditMapping,
}: Props) {
  return (
    <div className="flex flex-col gap-4 p-5 md:p-7 bg-bg-primary overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-border">
        <div className="flex items-start gap-2 min-w-0">
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
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold tracking-tight text-text-primary truncate">{category.name}</h2>
            <div className="flex items-center gap-2.5 text-[12px] text-text-secondary mt-1.5 flex-wrap">
              <span>{category.productCount} produits</span>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span>{category.subCategories.length} sous-catégorie{category.subCategories.length > 1 ? "s" : ""}</span>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span>créée le {formatDate(category.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Modifier la catégorie"
            className="w-[34px] h-[34px] rounded-md border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink shadow-[var(--shadow-sm)] inline-flex items-center justify-center"
          >
            ✏︎
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Supprimer la catégorie"
            className="w-[34px] h-[34px] rounded-md border border-border bg-bg-primary text-text-secondary hover:text-[#DC2626] hover:border-[#FCA5A5] hover:bg-[#FEF2F2] shadow-[var(--shadow-sm)] inline-flex items-center justify-center"
          >
            🗑
          </button>
        </div>
      </div>

      {/* Translations */}
      <section className="bg-bg-primary border border-border rounded-2xl p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">Traductions</h3>
        <CategoryTranslationsLocked translations={category.translations} />
      </section>

      {/* Sub-categories */}
      <section className="bg-bg-primary border border-border rounded-2xl p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5 flex items-center justify-between">
          Sous-catégories
          <span className="text-[11px] font-semibold text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full">{category.subCategories.length}</span>
        </h3>
        <SubCategoryChips subs={category.subCategories} onAdd={onSubAdd} onEdit={onSubEdit} onDelete={onSubDelete} />
      </section>

      {/* Marketplaces */}
      <section className="bg-bg-primary border border-border rounded-2xl p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">Marketplaces</h3>
        <MarketplaceMappingCards
          pfsLabel={category.pfsLabel}
          efashionLabel={category.efashionLabel}
          faireLabel={category.faireLabel}
          onEditMapping={onEditMapping}
        />
      </section>
    </div>
  );
}
