import { getTranslations } from "next-intl/server";
import ProductCardIssyma from "@/components/issyma/ProductCardIssyma";
import type { CarouselProduct } from "@/components/home/ProductCarousel";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canSeePrices as canUserSeePrices } from "@/lib/price-visibility";

/**
 * Grille de produits Issyma — utilisée sur la fiche collection, la fiche
 * catégorie et la page catalogue. Wrap plusieurs `ProductCardIssyma`, gère
 * l'état vide et affiche les prix conditionnellement selon la session.
 */
export default async function ProductGridIssyma({
  products,
  emptyLabel,
  showBadgeNew = false,
}: {
  products: CarouselProduct[];
  emptyLabel: string;
  showBadgeNew?: boolean;
}) {
  const t = await getTranslations("home");
  const session = await getServerSession(authOptions);
  const canSeePrices = canUserSeePrices(session);
  const pricePromptLabel = t("issyma.cardPricePro");
  const pricePromptHint = t("issyma.cardPriceHint");
  const badgeNew = t("issyma.badgeNew");

  if (products.length === 0) {
    return (
      <div className="text-center py-20 text-[14px]" style={{ color: "#6b5d5d" }}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      {products.map((p, i) => (
        <ProductCardIssyma
          key={p.id}
          p={p}
          badge={showBadgeNew && i < 2 ? badgeNew : undefined}
          canSeePrices={canSeePrices}
          pricePromptLabel={pricePromptLabel}
          pricePromptHint={pricePromptHint}
        />
      ))}
    </div>
  );
}
