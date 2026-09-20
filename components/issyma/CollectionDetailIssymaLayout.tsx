import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import IssymaShell from "@/components/issyma/IssymaShell";
import ProductGridIssyma from "@/components/issyma/ProductGridIssyma";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";
import type { CarouselProduct } from "@/components/home/ProductCarousel";

const P = ISSYMA_PALETTE;

export default async function CollectionDetailIssymaLayout({
  shopName,
  collectionName,
  collectionImage,
  products,
}: {
  shopName: string;
  collectionName: string;
  collectionImage: string | null;
  products: CarouselProduct[];
}) {
  const t = await getTranslations("collectionDetail");
  const tHome = await getTranslations("home");

  return (
    <IssymaShell shopName={shopName}>
      {/* Hero bordeaux avec image de couverture */}
      <section className="wine-panel relative overflow-hidden">
        {collectionImage && (
          <Image
            src={collectionImage}
            alt={collectionName}
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-25"
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(42, 15, 21, 0.6) 0%, rgba(42, 15, 21, 0.4) 100%)",
          }}
        />
        <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-16 sm:py-20 lg:py-24">
          <nav
            className="text-[11px] tracking-[0.22em] uppercase flex items-center gap-2 mb-6"
            style={{ color: `${P.cream2}b3` }}
          >
            <Link href="/collections" className="hover:opacity-80 transition">
              {t("breadcrumb")}
            </Link>
            <span>·</span>
            <span style={{ color: P.cream }}>{collectionName}</span>
          </nav>
          <p className="eyebrow" style={{ color: `${P.cream2}cc` }}>
            {tHome("issyma.catFeatureEyebrow")}
          </p>
          <h1
            className="serif mt-6"
            style={{
              color: P.cream,
              fontSize: "clamp(2rem, 4.5vw, 3.6rem)",
              lineHeight: 1.05,
            }}
          >
            {collectionName}
          </h1>
          <p
            className="mt-6 max-w-2xl text-[15px] leading-[1.7] font-light"
            style={{ color: `${P.cream}cc` }}
          >
            {products.length <= 1
              ? t("products", { count: products.length })
              : t("products_plural", { count: products.length })}
          </p>
        </div>
      </section>

      {/* Grille produits */}
      <section style={{ background: P.paper }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-16 lg:py-20">
          <ProductGridIssyma products={products} emptyLabel={t("empty")} />
        </div>
      </section>
    </IssymaShell>
  );
}
