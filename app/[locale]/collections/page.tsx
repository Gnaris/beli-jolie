import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { getCurrentTenantSlug } from "@/lib/tenant";
import { buildAlternates } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import { PUBLIC_SELLABLE_COLORS_CLAUSE } from "@/lib/public-product-visibility";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import CollectionsIssymaLayout from "@/components/issyma/CollectionsIssymaLayout";

export const revalidate = 7200; // ISR: revalidate every 2 hours

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tMeta, alternates] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
    buildAlternates("/collections", locale),
  ]);
  return {
    title: tMeta("collectionsTitle", { shopName }),
    description: tMeta("collectionsDescription"),
    alternates,
  };
}

export default async function CollectionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [t, shopName, tenantSlug] = await Promise.all([
    getTranslations("collectionsPage"),
    getCachedShopName(),
    getCurrentTenantSlug(),
  ]);
  const collections = await prisma.collection.findMany({
    where: { visible: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    include: {
      translations: {
        where: { locale },
        select: { name: true },
        take: 1,
      },
      _count: {
        select: {
          products: {
            where: {
              product: {
                status: "ONLINE",
                colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
              },
            },
          },
        },
      },
    },
  });

  // Fallback FR : si aucune CollectionTranslation pour la locale demandée,
  // on affiche le nom source (français).
  const customCollections = collections.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.translations[0]?.name ?? c.name,
    image: c.image,
  }));

  // Cartes "système" virtuelles : pas des Collection en BDD, mais des raccourcis
  // vers /produits filtré. L'ordre et les gradients sont figés ici.
  const systemCards = [
    {
      key: "bestseller",
      href: "/produits?bestseller=1",
      name: t("systemBestsellerName"),
      subtitle: t("systemBestsellerSubtitle"),
      gradient: "from-amber-400 via-orange-400 to-rose-400",
      icon: (
        <svg className="w-14 h-14 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z" />
        </svg>
      ),
    },
    {
      key: "trending",
      href: "/produits?trending=1",
      name: t("systemTrendingName"),
      subtitle: t("systemTrendingSubtitle"),
      gradient: "from-fuchsia-400 via-pink-400 to-rose-400",
      icon: (
        <svg className="w-14 h-14 text-white drop-shadow-md" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 7h7v7" />
        </svg>
      ),
    },
    {
      key: "new",
      href: "/produits?new=1",
      name: t("systemNewName"),
      subtitle: t("systemNewSubtitle"),
      gradient: "from-emerald-400 via-teal-400 to-sky-400",
      icon: (
        <svg className="w-14 h-14 text-white drop-shadow-md" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M3 12h18" />
        </svg>
      ),
    },
  ] as const;

  // Dispatch tenant : Issyma reçoit son propre layout bordeaux. BJ reste
  // inchangé (grille actuelle).
  const effectiveSlug = await getEffectiveTenantSlug();
  if (effectiveSlug === "issyma") {
    return (
      <CollectionsIssymaLayout shopName={shopName} collections={customCollections.map((c) => ({ ...c, productCount: 0 }))} />
    );
  }

  return (
    <div className="min-h-screen relative">
      <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />

      <div className="min-w-0 relative z-10">
        {/* Header */}
        <div className="bg-bg-primary border-b border-border relative overflow-hidden">
          <div className="container-site py-8 relative">
            <h1 className="font-heading text-2xl font-semibold text-text-primary">
              {t("title")}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-text-secondary font-body leading-relaxed">
              {t("intro", { shopName })}
            </p>
            <p className="mt-3 text-xs text-text-muted font-body">
              {customCollections.length <= 1
                ? t("available", { count: customCollections.length })
                : t("available_plural", { count: customCollections.length })}
            </p>
          </div>
        </div>

        <main className="container-site py-8 relative overflow-hidden">
          {/* Grille 1 : raccourcis système (Best-sellers, Tendance, Nouveautés) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {systemCards.map((card) => (
              <Link
                key={card.key}
                href={card.href}
                className="group card overflow-hidden transition-all duration-300 hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)] hover:-translate-y-1 hover:border-accent/30"
              >
                <div className={`aspect-[16/9] bg-gradient-to-br ${card.gradient} overflow-hidden relative flex items-center justify-center`}>
                  <div className="transition-transform duration-300 group-hover:scale-110">
                    {card.icon}
                  </div>
                </div>

                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <h2 className="font-heading font-semibold text-text-primary text-base group-hover:text-accent transition-colors">
                      {card.name}
                    </h2>
                    <p className="text-xs text-text-muted font-body mt-0.5">
                      {card.subtitle}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>

          {/* Grille 2 : collections personnalisées */}
          {customCollections.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-20">
              {customCollections.map((col) => (
                <Link
                  key={col.id}
                  href={`/collections/${col.slug ?? col.id}`}
                  aria-label={col.name}
                  className="group card overflow-hidden transition-all duration-300 hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)] hover:-translate-y-1 hover:border-accent/30"
                >
                  <div className="aspect-[16/9] bg-gradient-to-br from-bg-tertiary to-bg-secondary overflow-hidden relative">
                    {col.image ? (
                      <Image
                        src={col.image}
                        alt={col.name}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-12 h-12 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="px-4 py-3 flex items-center justify-between">
                    <h2 className="font-heading font-semibold text-text-primary text-base group-hover:text-accent transition-colors">
                      {col.name}
                    </h2>
                    <svg className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </main>

        <Footer shopName={shopName} />
      </div>
    </div>
  );
}
