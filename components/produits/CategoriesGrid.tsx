"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import CategoryCircle from "@/components/ui/CategoryCircle";

interface SubCategory {
  id: string;
  name: string;
}

interface CategoryItem {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  productCount: number;
  subCategories: SubCategory[];
}

interface Props {
  categories: CategoryItem[];
}

/**
 * Nb max de sous-catégories affichées avant de replier derrière un bouton
 * « +N ». Au-delà, la cellule devient trop haute et casse l'alignement
 * visuel de la grille.
 */
const VISIBLE_SUBS = 6;

/**
 * Grille de catégories (page /categories publique). Cercle image ou monogramme
 * + nom + compteur produits + chips sous-catégories cliquables (filtre direct
 * /produits?cat=X&subcat=Y). Sous-catégories retirées de la home.
 */
export default function CategoriesGrid({ categories }: Props) {
  const t = useTranslations("categoriesPage");
  const { tp } = useProductTranslation();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-12 lg:gap-x-6 lg:gap-y-14 items-start">
      {categories.map((cat) => (
        <CategoryCell key={cat.id} cat={cat} tp={tp} t={t} />
      ))}
    </div>
  );
}

interface CellProps {
  cat: CategoryItem;
  tp: (label: string) => string;
  t: ReturnType<typeof useTranslations>;
}

function CategoryCell({ cat, tp, t }: CellProps) {
  const [expanded, setExpanded] = useState(false);
  const subs = cat.subCategories;
  const overflow = subs.length - VISIBLE_SUBS;
  const visibleSubs = expanded || overflow <= 0 ? subs : subs.slice(0, VISIBLE_SUBS);

  return (
    <div className="flex flex-col items-center text-center">
      <Link
        href={`/categories/${cat.slug}`}
        className="group flex flex-col items-center"
      >
        <CategoryCircle name={cat.name} image={cat.image} size="lg" />
        <p className="mt-4 text-[15px] font-heading font-semibold text-text-primary">
          {tp(cat.name)}
        </p>
        {cat.productCount > 0 && (
          <p className="text-[11.5px] text-text-muted mt-0.5">
            {t("productsCount", { count: cat.productCount })}
          </p>
        )}
      </Link>

      {subs.length > 0 && (
        <ul className="mt-3 flex flex-wrap justify-center gap-1.5 max-w-[220px]">
          {visibleSubs.map((sub) => (
            <li key={sub.id}>
              <Link
                href={`/produits?cat=${cat.id}&subcat=${sub.id}`}
                className="inline-flex items-center h-6 px-2.5 rounded-full border border-border bg-bg-primary text-[11px] text-text-secondary hover:border-text-primary hover:text-text-primary transition-colors"
              >
                {tp(sub.name)}
              </Link>
            </li>
          ))}
          {overflow > 0 && !expanded && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="inline-flex items-center h-6 px-2.5 rounded-full border border-dashed border-border bg-transparent text-[11px] text-text-muted hover:border-text-primary hover:text-text-primary transition-colors"
                aria-label={t("showMoreSubs", { count: overflow })}
              >
                +{overflow}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
