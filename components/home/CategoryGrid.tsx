"use client";

import { Link } from "@/i18n/navigation";
import Image from "next/image";
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
    <section ref={sectionRef} className="scroll-fade-up bg-bg-secondary py-16 lg:py-20">
      <div className="container-site" style={{ maxWidth: "1200px" }}>
        <div className="flex items-center gap-4 justify-center mb-10">
          <div className="h-px flex-1 max-w-[80px] bg-border" />
          <h2 className="font-heading text-lg font-semibold text-text-primary tracking-wide uppercase">{t("categoriesTitle")}</h2>
          <div className="h-px flex-1 max-w-[80px] bg-border" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          {categories.map((cat) => (
            <Link key={cat.id} href={`/produits?cat=${cat.id}`} className="group block">
              <article className="bg-bg-primary rounded-2xl border border-border p-6 flex flex-col items-center text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-accent/30">
                <div className="w-20 h-20 lg:w-[120px] lg:h-[120px] rounded-full overflow-hidden bg-bg-secondary mb-4 border border-border">
                  {cat.image ? (
                    <Image src={cat.image} alt={cat.name} width={120} height={120} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM2.25 13.125c0-.621.504-1.125 1.125-1.125h6c.621 0 1.125.504 1.125 1.125v6c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-6z" />
                      </svg>
                    </div>
                  )}
                </div>
                <p className="font-heading font-medium text-sm text-text-primary">{tp(cat.name)}</p>
                {cat._count.products > 0 && (
                  <p className="font-body text-xs text-text-muted mt-1">{t("categoriesProducts", { count: cat._count.products })}</p>
                )}
              </article>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
