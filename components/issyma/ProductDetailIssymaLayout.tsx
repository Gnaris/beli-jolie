import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { buildProductHandle } from "@/lib/product-url";
import IssymaShell from "@/components/issyma/IssymaShell";
import ProductDetailIssymaClient, {
  type IssymaVariant,
  type IssymaImageGroup,
} from "@/components/issyma/ProductDetailIssymaClient";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";

const P = ISSYMA_PALETTE;

export interface IssymaSimilarProduct {
  id: string;
  name: string;
  reference: string;
  primaryImage: string | null;
  minPrice: number;
}

function IconTruck() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h11v9H2z"/><path d="M13 11h4l4 3v3h-8"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>
    </svg>
  );
}
function IconBoxLine() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>
    </svg>
  );
}
function IconHeadset() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14v-2a9 9 0 0 1 18 0v2"/>
      <rect x="3" y="14" width="4" height="6" rx="1"/>
      <rect x="17" y="14" width="4" height="6" rx="1"/>
    </svg>
  );
}

export default async function ProductDetailIssymaLayout({
  shopName,
  categorySlug,
  categoryName,
  productId,
  productName,
  reference,
  description,
  compositionsText,
  variants,
  imageGroups,
  similarProducts,
  showPrices,
  isAuthenticated,
  isRevoked,
  jsonLdBlocks,
}: {
  shopName: string;
  categorySlug: string;
  categoryName: string;
  productId: string;
  productName: string;
  reference: string;
  description: string;
  compositionsText: string;
  variants: IssymaVariant[];
  imageGroups: IssymaImageGroup[];
  similarProducts: IssymaSimilarProduct[];
  showPrices: boolean;
  isAuthenticated: boolean;
  isRevoked: boolean;
  jsonLdBlocks?: object[];
}) {
  const [tProducts, tDetail] = await Promise.all([
    getTranslations("products"),
    getTranslations("productDetailIssyma"),
  ]);

  return (
    <IssymaShell shopName={shopName} jsonLdBlocks={jsonLdBlocks}>
      {/* Fil d'ariane bordeaux court */}
      <section style={{ background: P.blush50 }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-6">
          <nav
            className="text-[11px] tracking-[0.22em] uppercase flex items-center gap-2 flex-wrap"
            style={{ color: P.muted }}
          >
            <Link href="/produits" className="hover:opacity-80 transition" style={{ color: P.wine700 }}>
              {tProducts("breadcrumb")}
            </Link>
            <span>·</span>
            <Link href={`/categories/${categorySlug}`} className="hover:opacity-80 transition" style={{ color: P.wine700 }}>
              {categoryName}
            </Link>
            <span>·</span>
            <span className="truncate max-w-[50vw]" style={{ color: P.ink }}>
              {productName}
            </span>
          </nav>
        </div>

        {/* SECTION PRODUIT — 2 colonnes */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8 lg:py-10">
          <ProductDetailIssymaClient
            productId={productId}
            name={productName}
            reference={reference}
            category={categoryName}
            compositionsText={compositionsText}
            variants={variants}
            imageGroups={imageGroups}
            isAuthenticated={isAuthenticated}
            showPrices={showPrices}
            isRevoked={isRevoked}
          />

          {/* Bandeau réassurance — 3 tuiles avec icônes bordeaux, dégradé rose,
              séparateurs verticaux. Positionné juste au-dessus des accordions. */}
          <div className="mt-10">
            <div
              className="rounded-3xl grid grid-cols-1 sm:grid-cols-3 overflow-hidden"
              style={{
                background: `linear-gradient(90deg, #fbf1ee 0%, #f8e6e0 50%, #fbf1ee 100%)`,
                border: `1px solid ${P.borderSoft}`,
              }}
            >
              {[
                { Icon: IconTruck, title: tDetail("tileUnitTitle"), desc: tDetail("tileUnitDesc") },
                { Icon: IconBoxLine, title: tDetail("tileMinTitle"), desc: tDetail("tileMinDesc") },
                { Icon: IconHeadset, title: tDetail("tilePrepTitle"), desc: tDetail("tilePrepDesc") },
              ].map(({ Icon, title, desc }, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-6 sm:px-8 py-6"
                  style={{
                    borderLeft: i > 0 ? `1px solid rgba(122, 42, 60, 0.15)` : "none",
                  }}
                >
                  <span
                    className="shrink-0"
                    style={{ color: P.wine700 }}
                  >
                    <Icon />
                  </span>
                  <div className="leading-tight">
                    <p className="text-[14px] font-semibold" style={{ color: P.ink }}>{title}</p>
                    <p className="text-[12px] mt-0.5" style={{ color: P.inkSoft }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Accordions — Description, Tailles et mesures, Livraison */}
          <div className="mt-10 max-w-3xl mx-auto">
            <details
              open
              className="rounded-xl overflow-hidden"
              style={{ background: P.paper, border: `1px solid ${P.borderSoft}` }}
            >
              <summary
                className="flex items-center justify-between cursor-pointer px-5 py-4 text-[13px] tracking-[0.2em] uppercase font-semibold"
                style={{ color: P.ink }}
              >
                <span>{tDetail("accordionDescription")}</span>
                <span className="plus text-xl leading-none" style={{ color: P.wine700 }} aria-hidden />
              </summary>
              <div className="px-5 pb-5 text-[13px] leading-relaxed whitespace-pre-line" style={{ color: P.inkSoft }}>
                {description || tDetail("accordionDescriptionEmpty")}
              </div>
            </details>

            <details
              className="mt-3 rounded-xl overflow-hidden"
              style={{ background: P.paper, border: `1px solid ${P.borderSoft}` }}
            >
              <summary
                className="flex items-center justify-between cursor-pointer px-5 py-4 text-[13px] tracking-[0.2em] uppercase font-semibold"
                style={{ color: P.ink }}
              >
                <span>{tDetail("accordionSizes")}</span>
                <span className="plus text-xl leading-none" style={{ color: P.wine700 }} aria-hidden />
              </summary>
              <div className="px-5 pb-5 text-[13px] leading-relaxed" style={{ color: P.inkSoft }}>
                {tDetail("accordionSizesContent")}
              </div>
            </details>

            <details
              className="mt-3 rounded-xl overflow-hidden"
              style={{ background: P.paper, border: `1px solid ${P.borderSoft}` }}
            >
              <summary
                className="flex items-center justify-between cursor-pointer px-5 py-4 text-[13px] tracking-[0.2em] uppercase font-semibold"
                style={{ color: P.ink }}
              >
                <span>{tDetail("accordionShipping")}</span>
                <span className="plus text-xl leading-none" style={{ color: P.wine700 }} aria-hidden />
              </summary>
              <div className="px-5 pb-5 text-[13px] leading-relaxed" style={{ color: P.inkSoft }}>
                {tDetail("accordionShippingContent")}
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* PRODUITS SIMILAIRES */}
      {similarProducts.length > 0 && (
        <section style={{ background: P.paper }}>
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-14">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
              <div>
                <p className="text-[10px] tracking-[0.32em] uppercase font-semibold" style={{ color: P.wine700 }}>
                  {tDetail("similarEyebrow")}
                </p>
                <h2 className="serif mt-2 text-[26px] sm:text-[32px] font-semibold" style={{ color: P.ink, lineHeight: 1.05 }}>
                  {tDetail("similarHeading")}
                </h2>
              </div>
              <Link
                href="/produits"
                className="text-[11px] tracking-[0.22em] uppercase font-semibold self-start sm:self-end"
                style={{ color: P.wine700 }}
              >
                {tDetail("similarSeeAll")}
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              {similarProducts.slice(0, 6).map((sp) => (
                <Link
                  key={sp.id}
                  href={`/produits/${buildProductHandle(sp.name, sp.reference)}`}
                  className="group block"
                >
                  <div className="relative aspect-[3/4] overflow-hidden rounded-xl" style={{ background: P.blush100 }}>
                    {sp.primaryImage ? (
                      <Image
                        src={sp.primaryImage}
                        alt={sp.name}
                        fill
                        sizes="(max-width: 640px) 50vw, 17vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="serif font-bold" style={{ color: P.wine700, fontSize: "2rem", lineHeight: 1 }}>
                          {sp.name.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 px-0.5">
                    <h3 className="serif text-[12px] leading-tight font-semibold line-clamp-2" style={{ color: P.ink }}>
                      {sp.name}
                    </h3>
                    <p className="mt-0.5 text-[9px] tracking-[0.2em] uppercase font-semibold" style={{ color: P.muted }}>
                      {tDetail("similarRefLabel")} {sp.reference}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </IssymaShell>
  );
}
