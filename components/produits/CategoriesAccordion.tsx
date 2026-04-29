"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

interface SubCategory {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  productCount: number;
  subCategories: SubCategory[];
}

interface Props {
  categories: Category[];
}

export default function CategoriesAccordion({ categories }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const t = useTranslations("categoriesPage");

  const toggle = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="card overflow-hidden divide-y divide-border/60">
      {/* Table header */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_120px_140px_44px] items-center px-5 py-3 bg-bg-secondary/60 text-[10px] font-semibold text-text-muted uppercase tracking-wider font-body">
        <span>{t("categoryName")}</span>
        <span className="text-center">{t("subCategoriesCount")}</span>
        <span className="text-center">{t("productsLabel")}</span>
        <span />
      </div>

      {categories.map((cat) => {
        const isOpen = openId === cat.id;
        const hasSubs = cat.subCategories.length > 0;

        return (
          <div key={cat.id}>
            {/* Category row */}
            <button
              type="button"
              onClick={() => hasSubs && toggle(cat.id)}
              className={`w-full grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_140px_44px] items-center px-5 py-4 text-left transition-all duration-200 group ${
                hasSubs ? "cursor-pointer hover:bg-bg-secondary/50" : "cursor-default"
              } ${isOpen ? "bg-bg-secondary/30" : ""}`}
            >
              {/* Name */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-[10px] bg-bg-secondary border border-border flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <span className="font-heading font-semibold text-sm text-text-primary group-hover:text-accent transition-colors truncate block">
                    {cat.name}
                  </span>
                  <span className="text-[11px] text-text-muted font-body sm:hidden">
                    {cat.subCategories.length} sous-cat. · {cat.productCount} produit{cat.productCount > 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {/* Sub-categories count */}
              <span className="hidden sm:flex items-center justify-center">
                {hasSubs ? (
                  <span className="badge badge-info text-[10px]">
                    {cat.subCategories.length}
                  </span>
                ) : (
                  <span className="text-xs text-text-muted">—</span>
                )}
              </span>

              {/* Product count */}
              <span className="hidden sm:flex items-center justify-center">
                <span className="text-xs font-medium text-text-secondary font-body">
                  {cat.productCount}
                </span>
              </span>

              {/* Chevron */}
              <div className="flex items-center justify-center">
                {hasSubs ? (
                  <svg
                    className={`w-4 h-4 text-text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                ) : (
                  <Link
                    href={`/produits?cat=${cat.id}`}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-accent hover:bg-bg-secondary transition-colors"
                    title={t("viewProducts")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>
                )}
              </div>
            </button>

            {/* Sub-categories drawer */}
            {isOpen && hasSubs && (
              <div className="bg-bg-secondary/40 border-t border-border/40 animate-[slide-in-right_0.25s_ease-out]">
                <div className="px-5 py-3 space-y-1">
                  {/* "All" link */}
                  <Link
                    href={`/produits?cat=${cat.id}`}
                    className="flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-bg-primary hover:shadow-sm transition-all duration-200 group/sub"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                        </svg>
                      </div>
                      <span className="text-sm font-medium text-text-primary group-hover/sub:text-accent transition-colors font-body">
                        {t("allProducts")} {cat.name}
                      </span>
                    </div>
                    <svg className="w-3.5 h-3.5 text-text-muted group-hover/sub:text-accent transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>

                  {/* Individual sub-categories */}
                  {cat.subCategories.map((sub) => (
                    <Link
                      key={sub.id}
                      href={`/produits?cat=${cat.id}&subcat=${sub.id}`}
                      className="flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-bg-primary hover:shadow-sm transition-all duration-200 group/sub"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-bg-tertiary shadow-sm flex items-center justify-center">
                          <span className="text-[10px] font-semibold text-text-muted font-body">
                            {sub.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm text-text-secondary group-hover/sub:text-accent transition-colors font-body">
                          {sub.name}
                        </span>
                      </div>
                      <svg className="w-3.5 h-3.5 text-text-muted group-hover/sub:text-accent transition-colors opacity-0 group-hover/sub:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
