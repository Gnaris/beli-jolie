"use client";

import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";
import { useProductTranslation } from "@/hooks/useProductTranslation";

interface CategoryItem {
  id: string;
  name: string;
  image?: string | null;
  _count: { products: number };
}

interface Props {
  categories: CategoryItem[];
}

export default function CategoryGrid({ categories }: Props) {
  const t = useTranslations("home");
  const { tp } = useProductTranslation();
  const sectionRef = useScrollReveal();

  if (categories.length === 0) return null;

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-primary py-24 lg:py-32">
      <div className="container-site max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* Header centré éditorial */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-[11px] uppercase tracking-[0.22em] text-text-muted font-medium mb-4">
            {t("categoriesEyebrow")}
          </p>
          <h2
            className="font-heading font-bold text-text-primary leading-tight"
            style={{ fontSize: "clamp(2rem, 3.5vw, 3rem)", letterSpacing: "-0.01em" }}
          >
            {t("categoriesTitle")}
          </h2>
        </div>

        {/* Grille ronds éditoriaux — 2/3/6 colonnes */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 lg:gap-6">
          {categories.map((cat) => (
            <Link key={cat.id} href={`/produits?cat=${cat.id}`} className="group text-center block">
              <div className="aspect-square rounded-full bg-bg-secondary mb-4 overflow-hidden">
                {cat.image ? (
                  <div className="w-full h-full transition-transform duration-500 group-hover:scale-105">
                    <Image
                      src={cat.image}
                      alt={cat.name}
                      width={280}
                      height={280}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM2.25 13.125c0-.621.504-1.125 1.125-1.125h6c.621 0 1.125.504 1.125 1.125v6c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-6z" />
                    </svg>
                  </div>
                )}
              </div>
              <h3 className="font-heading font-medium text-sm text-text-primary">{tp(cat.name)}</h3>
              {cat._count.products > 0 && (
                <p className="font-body text-xs text-text-muted mt-1">
                  {t("categoriesProducts", { count: cat._count.products })}
                </p>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
