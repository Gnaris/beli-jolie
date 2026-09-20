import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import IssymaShell from "@/components/issyma/IssymaShell";
import ProductGridIssyma from "@/components/issyma/ProductGridIssyma";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";
import type { CarouselProduct } from "@/components/home/ProductCarousel";

const P = ISSYMA_PALETTE;

export interface CategoryDetailIssymaSubCategory {
  id: string;
  name: string;
  slug: string | null;
}

export interface CategoryDetailIssymaRelated {
  id: string;
  name: string;
  slug: string;
  productCount: number;
}

export default async function CategoryDetailIssymaLayout({
  shopName,
  categoryId,
  categoryName,
  heroMosaic,
  seoTitle,
  seoIntro,
  seoSecondary,
  subCategories,
  products,
  relatedCategories,
}: {
  shopName: string;
  categoryId: string;
  categoryName: string;
  heroMosaic: string[];
  seoTitle: string;
  seoIntro: string;
  seoSecondary: string;
  subCategories: CategoryDetailIssymaSubCategory[];
  products: CarouselProduct[];
  relatedCategories: CategoryDetailIssymaRelated[];
}) {
  const t = await getTranslations("categoryDetail");
  const tCommon = await getTranslations("nav");
  const tHome = await getTranslations("home");

  return (
    <IssymaShell shopName={shopName}>
      {/* Fil d'ariane bordeaux */}
      <section className="wine-panel">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-10 sm:pt-12">
          <nav
            className="text-[11px] tracking-[0.22em] uppercase flex items-center gap-2"
            style={{ color: `${P.cream2}b3` }}
          >
            <Link href="/" className="hover:opacity-80 transition">{tCommon("home")}</Link>
            <span>·</span>
            <Link href="/categories" className="hover:opacity-80 transition">{tCommon("categories")}</Link>
            <span>·</span>
            <span style={{ color: P.cream }}>{categoryName}</span>
          </nav>
        </div>

        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-8 pb-16 lg:pb-20">
          <div className={`grid ${heroMosaic.length >= 4 ? "lg:grid-cols-[1.35fr_1fr]" : "grid-cols-1"} gap-8 lg:gap-12 items-start`}>
            <div>
              <p className="eyebrow" style={{ color: `${P.cream2}cc` }}>
                {t("eyebrow", { count: products.length })}
              </p>
              <h1
                className="serif mt-6"
                style={{
                  color: P.cream,
                  fontSize: "clamp(2rem, 4.5vw, 3.6rem)",
                  lineHeight: 1.05,
                }}
              >
                {seoTitle}
              </h1>
              <p className="mt-6 text-[15px] leading-[1.7] font-light" style={{ color: `${P.cream}cc` }}>
                {seoIntro}
              </p>
              <p className="mt-4 text-[13px] leading-[1.7] font-light" style={{ color: `${P.cream2}b3` }}>
                {seoSecondary}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <span className="pill btn-outline-cream">{t("badgeStock")}</span>
                <span className="pill btn-outline-cream">{t("badgeShipping")}</span>
                <span className="pill btn-outline-cream">{t("badgeMinimum")}</span>
              </div>
            </div>

            {heroMosaic.length >= 4 && (
              <div className="grid grid-cols-2 gap-2">
                {heroMosaic.slice(0, 4).map((src, i) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={`${src}-${i}`}
                    src={src}
                    alt=""
                    className="aspect-square rounded-2xl object-cover w-full h-full"
                    loading="lazy"
                    style={{ border: `1px solid ${P.wine700}` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Chips sous-catégories */}
      {subCategories.length > 0 && (
        <section style={{ background: P.blush50 }}>
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[11px] tracking-[0.22em] uppercase font-semibold mr-3"
                style={{ color: P.muted }}
              >
                {t("filterByType")}
              </span>
              {subCategories.map((sub) => (
                <Link
                  key={sub.id}
                  href={`/produits?cat=${categoryId}&subcat=${sub.id}`}
                  className="pill btn-outline-wine"
                >
                  {sub.name}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Grille produits */}
      <section style={{ background: P.paper }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-16 lg:py-20">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-12">
            <div>
              <p className="eyebrow mb-4"><span className="wine-underline" />{tHome("issyma.newProductsEyebrow" as never)}</p>
              <h2 className="serif text-3xl sm:text-4xl leading-tight" style={{ color: P.ink }}>
                {t("productsHeading", { name: categoryName })}
              </h2>
            </div>
            <p className="text-[12px] tracking-[0.22em] uppercase font-semibold" style={{ color: P.muted }}>
              {t("productsCount", { count: products.length })}
            </p>
          </div>
          <ProductGridIssyma products={products} emptyLabel={t("empty")} />
        </div>
      </section>

      {/* Catégories liées */}
      {relatedCategories.length > 0 && (
        <section style={{ background: P.blush50 }}>
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-16 lg:py-20">
            <p className="eyebrow mb-4">
              <span className="wine-underline" />
              {t("relatedEyebrow")}
            </p>
            <h2 className="serif text-2xl sm:text-3xl leading-tight mb-8" style={{ color: P.ink }}>
              {t("relatedHeading")}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              {relatedCategories.map((rc) => (
                <Link
                  key={rc.id}
                  href={`/categories/${rc.slug}`}
                  className="cat-chip p-5 flex flex-col gap-2"
                >
                  <p className="serif text-lg font-semibold" style={{ color: P.ink }}>
                    {rc.name}
                  </p>
                  <p className="text-[12px]" style={{ color: P.inkSoft }}>
                    {t("productsCount", { count: rc.productCount })}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </IssymaShell>
  );
}
