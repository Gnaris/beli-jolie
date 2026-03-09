import Link from "next/link";

/**
 * Section catégories de produits
 * Grille responsive : 2 colonnes mobile → 3 colonnes tablet → 5 colonnes desktop
 */

const CATEGORIES = [
  {
    slug: "colliers",
    label: "Colliers",
    count: 120,
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
          d="M12 21a9 9 0 100-18 9 9 0 000 18z M12 3v2m0 14v2M3 12h2m14 0h2" />
      </svg>
    ),
  },
  {
    slug: "bracelets",
    label: "Bracelets",
    count: 95,
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
          d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      </svg>
    ),
  },
  {
    slug: "bagues",
    label: "Bagues",
    count: 78,
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
          d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
      </svg>
    ),
  },
  {
    slug: "boucles-oreilles",
    label: "Boucles d'oreilles",
    count: 110,
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
          d="M12 3v10m0 0a3 3 0 100 6 3 3 0 000-6z" />
      </svg>
    ),
  },
  {
    slug: "pendentifs",
    label: "Pendentifs",
    count: 65,
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
          d="M12 2v4m0 0l-2 2m2-2l2 2M8 8l4 8 4-8" />
      </svg>
    ),
  },
];

export default function CategoriesSection() {
  return (
    <section className="bg-[#FFFFFF] py-14 md:py-20" aria-labelledby="categories-title">
      <div className="container-site">

        {/* En-tête de section */}
        <div className="text-center mb-10 md:mb-12">
          <p className="text-xs font-[family-name:var(--font-roboto)] font-medium tracking-[0.2em] uppercase text-[#0F3460] mb-3">
            Notre catalogue
          </p>
          <h2
            id="categories-title"
            className="font-[family-name:var(--font-poppins)] text-3xl md:text-4xl font-semibold text-[#0F172A] section-title-center"
          >
            Nos Collections
          </h2>
          <p className="mt-5 text-[#475569] font-[family-name:var(--font-roboto)] text-base max-w-lg mx-auto">
            Explorez notre sélection de bijoux acier inoxydable — tendance, durables et abordables pour votre clientèle.
          </p>
        </div>

        {/* Grille des catégories */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
          {CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              href={`/collections/${category.slug}`}
              className="group flex flex-col items-center text-center gap-4 bg-[#FFFFFF] border border-[#E2E8F0] p-6 md:p-8 hover:border-[#0F3460] hover:shadow-md transition-all duration-200"
            >
              {/* Icône dans un cercle */}
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-[#F1F5F9] flex items-center justify-center text-[#0F3460] group-hover:bg-[#0F3460] group-hover:text-[#FFFFFF] transition-all duration-200">
                {category.icon}
              </div>

              {/* Nom de la catégorie */}
              <div>
                <p className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#0F172A] group-hover:text-[#0F3460] transition-colors">
                  {category.label}
                </p>
                <p className="text-xs font-[family-name:var(--font-roboto)] text-[#475569] mt-1">
                  {category.count} références
                </p>
              </div>

              {/* Flèche "Explorer" */}
              <span className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#0F3460] flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                Explorer
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </span>
            </Link>
          ))}
        </div>

        {/* CTA global */}
        <div className="text-center mt-10">
          <Link href="/boutique" className="btn-outline">
            Voir tout le catalogue
          </Link>
        </div>
      </div>
    </section>
  );
}
