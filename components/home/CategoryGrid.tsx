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
    <section ref={sectionRef} className="scroll-fade-up bg-bg-secondary py-20 lg:py-24 border-y border-border">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="text-center max-w-xl mx-auto mb-14">
          <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-2">{t("categoriesEyebrow")}</p>
          <h2
            className="font-heading font-bold text-text-primary"
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", letterSpacing: "-0.02em" }}
          >
            {t("categoriesTitle")}
          </h2>
        </div>

        {/* Pastilles noires — jaune au hover */}
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4 lg:gap-6 max-w-4xl mx-auto">
          {categories.map((cat) => (
            <Link key={cat.id} href={`/produits?cat=${cat.id}`} className="group flex flex-col items-center">
              <div className="w-full aspect-square rounded-full bg-bg-darker text-white grid place-items-center overflow-hidden transition-colors duration-200 group-hover:bg-gold group-hover:text-bg-darker">
                {cat.image ? (
                  <Image
                    src={cat.image}
                    alt={cat.name}
                    width={200}
                    height={200}
                    className="w-full h-full object-cover mix-blend-luminosity opacity-90 group-hover:opacity-100 group-hover:mix-blend-normal"
                    loading="lazy"
                  />
                ) : (
                  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <circle cx="12" cy="12" r="9" />
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                )}
              </div>
              <p className="mt-3 text-sm font-heading font-medium text-text-primary text-center">{tp(cat.name)}</p>
              {cat._count.products > 0 && (
                <p className="text-[11px] text-text-muted mt-0.5">
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
