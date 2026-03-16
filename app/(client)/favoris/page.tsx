import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import FavoriteToggle from "@/components/client/FavoriteToggle";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Mes favoris — Beli & Jolie",
  robots: { index: false, follow: false },
};

export default async function FavorisPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion?callbackUrl=/favoris");

  const t = await getTranslations("favorites");

  const favorites = await prisma.favorite.findMany({
    where: { userId: session.user.id },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          reference: true,
          category: { select: { name: true } },
          colors: {
            orderBy: { isPrimary: "desc" },
            select: {
              id: true,
              unitPrice: true,
              stock: true,
              color: { select: { name: true, hex: true } },
              images: { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
              saleOptions: { select: { saleType: true, packQuantity: true }, take: 2 },
            },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      {/* En-tete */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A]">
            {t("title")}
          </h1>
          <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] mt-0.5">
            {favorites.length !== 1 ? t("count_plural", { count: favorites.length }) : t("count", { count: favorites.length })}
          </p>
        </div>
        {favorites.length > 0 && (
          <Link href="/produits" className="inline-flex items-center px-4 py-2 border border-[#E5E5E5] rounded-lg text-xs font-[family-name:var(--font-roboto)] font-medium text-[#6B6B6B] hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-colors shrink-0">
            {t("viewCatalogue")}
          </Link>
        )}
      </div>

      {favorites.length === 0 ? (
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-12 text-center">
          <svg className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          <p className="font-[family-name:var(--font-roboto)] font-medium text-[#6B6B6B] mb-1">
            {t("empty")}
          </p>
          <p className="text-sm font-[family-name:var(--font-roboto)] text-[#9CA3AF] mb-6">
            {t("emptyDesc")}
          </p>
          <Link href="/produits" className="inline-flex items-center justify-center px-5 py-2.5 bg-[#1A1A1A] text-white text-sm font-[family-name:var(--font-roboto)] font-medium rounded-lg hover:bg-[#333] transition-colors">
            {t("browseCatalogue")}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {favorites.map((fav) => {
            const product = fav.product;
            const color = product.colors[0];
            const img = color?.images[0]?.path;
            const hasPack = color?.saleOptions.some((o) => o.saleType === "PACK");
            const packQty = color?.saleOptions.find((o) => o.saleType === "PACK")?.packQuantity;

            return (
              <div
                key={fav.id}
                className="bg-white border border-[#E5E5E5] rounded-xl overflow-hidden group hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] transition-shadow"
              >
                {/* Image */}
                <div className="relative aspect-square bg-[#EFEFEF]">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-10 h-10 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                      </svg>
                    </div>
                  )}

                  {/* Badge stock */}
                  {color && color.stock === 0 && (
                    <span className="absolute top-2 left-2 bg-[#1A1A1A]/80 text-white text-[10px] font-[family-name:var(--font-roboto)] font-medium px-2 py-0.5 rounded-full">
                      {t("outOfStock")}
                    </span>
                  )}

                  {/* Bouton retirer favori */}
                  <div className="absolute top-2 right-2">
                    <FavoriteToggle productId={product.id} isFavorite={true} />
                  </div>
                </div>

                {/* Infos */}
                <div className="p-4">
                  <p className="text-[11px] font-[family-name:var(--font-roboto)] text-[#9CA3AF] uppercase tracking-wider mb-1">
                    {product.category.name} . {product.reference}
                  </p>
                  <Link
                    href={`/produits/${product.id}`}
                    className="font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] text-sm hover:text-[#6B6B6B] transition-colors line-clamp-2"
                  >
                    {product.name}
                  </Link>

                  {color && (
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div>
                        <p className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A]">
                          {color.unitPrice.toFixed(2)} {"\u20AC"} <span className="text-xs font-normal text-[#9CA3AF]">{t("perUnit")}</span>
                        </p>
                        {hasPack && packQty && (
                          <p className="text-xs font-[family-name:var(--font-roboto)] text-[#9CA3AF]">
                            {t("packOf", { qty: packQty })} — {(color.unitPrice * packQty).toFixed(2)} {"\u20AC"}
                          </p>
                        )}
                      </div>

                      <Link
                        href={`/produits/${product.id}`}
                        className="inline-flex items-center px-3 py-1.5 bg-[#1A1A1A] text-white text-xs font-[family-name:var(--font-roboto)] font-medium rounded-lg hover:bg-[#333] transition-colors shrink-0"
                      >
                        {t("viewProduct")}
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
