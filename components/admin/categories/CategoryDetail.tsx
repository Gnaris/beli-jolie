"use client";

import CategoryTranslationsLocked from "./CategoryTranslationsLocked";
import SubCategoryChips from "./SubCategoryChips";
import MarketplaceMappingCards from "./MarketplaceMappingCards";
import CategoryImageUploader from "./CategoryImageUploader";
import { formatDate } from "@/lib/format-date";

type Sub = {
  id: string;
  name: string;
  translations: Record<string, string>;
  orderchampCategoryPath?: string | null;
  orderchampLabel?: string | null;
  microstoreCategoryId?: number | null;
};
export type CategoryDetailData = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  translations: Record<string, string>;
  productCount: number;
  createdAt: Date;
  subCategories: Sub[];
  pfsLabel: string | null;
  efashionLabel: string | null;
  faireLabel: string | null;
  orderchampLabel: string | null;
  microstoreLabel: string | null;
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
  onSubOrderchamp: (sub: Sub) => void;
  onSubMicrostore: (sub: Sub) => void;
  onEditMapping: (mp: "pfs" | "efashion" | "faire" | "orderchamp" | "microstore") => void;
  onImageChange: (nextImage: string | null) => void;
  onEditSeo: () => void;
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
  onSubOrderchamp,
  onSubMicrostore,
  onEditMapping,
  onImageChange,
  onEditSeo,
}: Props) {
  return (
    <div className="flex flex-col gap-3 md:gap-4 p-3 md:p-7 bg-bg-primary overflow-y-auto md:h-full">
      {/* Header — sticky sur mobile pour toujours voir le titre + retour */}
      <div className="sticky top-0 -mx-3 -mt-3 px-3 pt-3 md:mx-0 md:mt-0 md:px-0 md:pt-0 md:static bg-bg-primary/95 md:bg-bg-primary backdrop-blur-sm md:backdrop-blur-none z-10 pb-3 md:pb-4 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            {showBackButton && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Retour à la liste"
                className="md:hidden shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-bg-secondary text-text-secondary hover:text-text-primary mt-0.5"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-[19px] md:text-[22px] font-bold tracking-tight text-text-primary truncate">{category.name}</h2>
              <div className="flex items-center gap-2 md:gap-2.5 text-[11.5px] md:text-[12px] text-text-secondary mt-1 md:mt-1.5 flex-wrap">
                <span>{category.productCount} produits</span>
                <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
                <span className="md:hidden">{category.subCategories.length} sous-cat.</span>
                <span className="hidden md:inline">{category.subCategories.length} sous-catégorie{category.subCategories.length > 1 ? "s" : ""}</span>
                <span aria-hidden className="hidden md:inline w-[3px] h-[3px] rounded-full bg-text-muted" />
                <span className="hidden md:inline">créée le {formatDate(category.createdAt)}</span>
              </div>
            </div>
          </div>
          {/* Actions desktop uniquement — sur mobile elles s'affichent en pleine largeur sous le header */}
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
        {/* Actions mobile — 2 boutons pleine largeur sous le header */}
        <div className="flex md:hidden gap-2 mt-3">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary text-[12.5px] font-semibold"
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

      {/* Image ronde (home + /categories) */}
      <section className="bg-bg-primary border border-border rounded-2xl p-3 md:p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">
          Image de catégorie
        </h3>
        <CategoryImageUploader
          categoryId={category.id}
          categoryName={category.name}
          initialImage={category.image}
          onChange={onImageChange}
        />
      </section>

      {/* Translations */}
      <section className="bg-bg-primary border border-border rounded-2xl p-3 md:p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">Traductions</h3>
        <CategoryTranslationsLocked translations={category.translations} />
      </section>

      {/* Sub-categories */}
      <section className="bg-bg-primary border border-border rounded-2xl p-3 md:p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5 flex items-center justify-between">
          Sous-catégories
          <span className="text-[11px] font-semibold text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full">{category.subCategories.length}</span>
        </h3>
        <SubCategoryChips
          subs={category.subCategories}
          onAdd={onSubAdd}
          onEdit={onSubEdit}
          onDelete={onSubDelete}
          onOrderchamp={onSubOrderchamp}
          onMicrostore={onSubMicrostore}
        />
      </section>

      {/* Page publique — SEO */}
      <section className="bg-bg-primary border border-border rounded-2xl p-3 md:p-4 shadow-[var(--shadow-sm)]">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary">
              Page publique — SEO
            </h3>
            <p className="text-[12px] text-text-muted mt-1">
              Personnalisez le titre H1, l'intro, le paragraphe secondaire et la FAQ affichés sur <code className="px-1 py-0.5 rounded bg-bg-secondary text-[11px]">/fr/categories/{category.slug}</code>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onEditSeo}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-border-dark text-[13px] font-semibold"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Personnaliser le SEO
          </button>
          <a
            href={`/fr/categories/${category.slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-text-secondary hover:text-text-primary text-[13px] font-semibold"
          >
            Voir la page <span aria-hidden>↗</span>
          </a>
        </div>
      </section>

      {/* Marketplaces */}
      <section className="bg-bg-primary border border-border rounded-2xl p-3 md:p-4 shadow-[var(--shadow-sm)]">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-secondary mb-3.5">Marketplaces</h3>
        <MarketplaceMappingCards
          pfsLabel={category.pfsLabel}
          efashionLabel={category.efashionLabel}
          faireLabel={category.faireLabel}
          orderchampLabel={category.orderchampLabel}
          microstoreLabel={category.microstoreLabel}
          onEditMapping={onEditMapping}
        />
      </section>
    </div>
  );
}
