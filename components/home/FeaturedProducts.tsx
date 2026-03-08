import Link from "next/link";

/**
 * Données fictives pour les produits mis en avant
 * À remplacer par un fetch Prisma en prod
 */
const FEATURED_PRODUCTS = [
  {
    id: 1,
    slug: "collier-chaine-or",
    name: "Collier Chaîne Dorée",
    reference: "COL-001",
    finish: "Doré",
    priceUnit: 8.5,
    priceWholesale: 5.9,
    minQty: 10,
    isNew: true,
    isBestseller: false,
  },
  {
    id: 2,
    slug: "bracelet-jonc-acier",
    name: "Bracelet Jonc Acier",
    reference: "BRA-042",
    finish: "Argenté",
    priceUnit: 6.9,
    priceWholesale: 4.5,
    minQty: 12,
    isNew: false,
    isBestseller: true,
  },
  {
    id: 3,
    slug: "bague-solitaire-cristal",
    name: "Bague Solitaire Cristal",
    reference: "BAG-018",
    finish: "Doré rosé",
    priceUnit: 9.2,
    priceWholesale: 6.3,
    minQty: 6,
    isNew: false,
    isBestseller: true,
  },
  {
    id: 4,
    slug: "boucles-creoles-larges",
    name: "Boucles Créoles Larges",
    reference: "BOU-037",
    finish: "Doré",
    priceUnit: 7.4,
    priceWholesale: 5.1,
    minQty: 10,
    isNew: true,
    isBestseller: false,
  },
];

/**
 * Carte produit individuelle
 */
function ProductCard({ product }: { product: typeof FEATURED_PRODUCTS[number] }) {
  return (
    <article className="group bg-[#FDFAF6] border border-[#D4CCBE] hover:border-[#8B7355] hover:shadow-lg transition-all duration-200">

      {/* Image placeholder */}
      <div className="relative aspect-square bg-[#EDE8DF] overflow-hidden">
        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5 z-10">
          {product.isNew && (
            <span className="bg-[#8B7355] text-[#FDFAF6] text-[10px] font-[family-name:var(--font-roboto)] font-semibold uppercase tracking-wider px-2.5 py-1">
              Nouveau
            </span>
          )}
          {product.isBestseller && (
            <span className="bg-[#2C2418] text-[#FDFAF6] text-[10px] font-[family-name:var(--font-roboto)] font-semibold uppercase tracking-wider px-2.5 py-1">
              Best seller
            </span>
          )}
        </div>

        {/* Placeholder visuel — remplacer par <Image /> */}
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <svg className="w-16 h-16 text-[#B8A48A]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          <span className="text-[#B8A48A] text-xs font-[family-name:var(--font-roboto)]">
            {product.reference}
          </span>
        </div>

        {/* Overlay CTA rapide au hover */}
        <div className="absolute inset-0 bg-[#2C2418]/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <Link
            href={`/produits/${product.slug}`}
            className="bg-[#FDFAF6] text-[#2C2418] text-xs font-[family-name:var(--font-roboto)] font-semibold uppercase tracking-widest px-5 py-2.5 hover:bg-[#8B7355] hover:text-[#FDFAF6] transition-colors"
          >
            Voir le produit
          </Link>
        </div>
      </div>

      {/* Infos produit */}
      <div className="p-4">
        {/* Finition */}
        <p className="text-[10px] font-[family-name:var(--font-roboto)] font-medium tracking-[0.15em] uppercase text-[#8B7355] mb-1">
          {product.finish}
        </p>

        {/* Nom */}
        <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#2C2418] leading-snug mb-3">
          <Link href={`/produits/${product.slug}`} className="hover:text-[#8B7355] transition-colors">
            {product.name}
          </Link>
        </h3>

        {/* Prix BtoB */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-[family-name:var(--font-roboto)] text-[#6B5B45] mb-0.5">
              À partir de {product.minQty} pcs
            </p>
            <p className="font-[family-name:var(--font-poppins)] text-lg font-semibold text-[#8B7355]">
              {product.priceWholesale.toFixed(2)} €
              <span className="text-xs text-[#6B5B45] font-[family-name:var(--font-roboto)] font-normal ml-1">/ unité</span>
            </p>
          </div>
          {/* Prix unitaire barré */}
          <p className="text-sm text-[#6B5B45] line-through font-[family-name:var(--font-roboto)]">
            {product.priceUnit.toFixed(2)} €
          </p>
        </div>
      </div>
    </article>
  );
}

/**
 * Section produits mis en avant — homepage
 */
export default function FeaturedProducts() {
  return (
    <section className="bg-[#EDE8DF] py-14 md:py-20" aria-labelledby="featured-title">
      <div className="container-site">

        {/* En-tête */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10 md:mb-12">
          <div>
            <p className="text-xs font-[family-name:var(--font-roboto)] font-medium tracking-[0.2em] uppercase text-[#8B7355] mb-3">
              Sélection
            </p>
            <h2
              id="featured-title"
              className="font-[family-name:var(--font-poppins)] text-3xl md:text-4xl font-semibold text-[#2C2418] section-title"
            >
              Produits Vedettes
            </h2>
          </div>
          <Link href="/boutique" className="text-sm font-[family-name:var(--font-roboto)] font-medium text-[#8B7355] hover:text-[#6B5640] transition-colors flex items-center gap-1 shrink-0">
            Voir tout
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>

        {/* Grille des produits */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
          {FEATURED_PRODUCTS.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}
