"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import CategoryCircle from "@/components/ui/CategoryCircle";

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

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-8 lg:gap-x-6 lg:gap-y-10 max-w-5xl mx-auto">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/produits?cat=${cat.id}`}
              className="group flex flex-col items-center text-center"
            >
              <CategoryCircle name={cat.name} image={cat.image} size="md" />
              <p className="mt-3 text-sm font-heading font-medium text-text-primary">{tp(cat.name)}</p>
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
