import { prisma } from "@/lib/prisma";
import { getCachedSiteConfig } from "@/lib/cached-data";
import AnkorstoreMappingClient from "@/components/admin/ankorstore/AnkorstoreMappingClient";

export const metadata = { title: "Ankorstore" };

export default async function AnkorstorePage() {
  // Check config status
  const [ankorsClientId, ankorsEnabled] = await Promise.all([
    getCachedSiteConfig("ankors_client_id"),
    getCachedSiteConfig("ankors_enabled"),
  ]);

  const isConfigured = !!ankorsClientId?.value;
  const isEnabled = ankorsEnabled?.value === "true";

  // Fetch match stats
  const [matchedCount, totalProducts] = await Promise.all([
    prisma.product.count({ where: { ankorsProductId: { not: null } } }),
    prisma.product.count({ where: { status: { not: "ARCHIVED" } } }),
  ]);

  // Fetch recently matched products (top 50)
  const matchedProducts = await prisma.product.findMany({
    where: { ankorsProductId: { not: null } },
    orderBy: { ankorsMatchedAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      reference: true,
      ankorsProductId: true,
      ankorsMatchedAt: true,
      colors: {
        where: { ankorsVariantId: { not: null } },
        select: { id: true },
      },
    },
  });

  const initialMatches = matchedProducts.map((p) => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    ankorsProductId: p.ankorsProductId!,
    ankorsMatchedAt: p.ankorsMatchedAt?.toISOString() ?? null,
    variantMatchCount: p.colors.length,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Ankorstore</h1>
        <p className="page-subtitle">Matching des produits avec le catalogue Ankorstore.</p>
      </div>
      <AnkorstoreMappingClient
        isConfigured={isConfigured}
        isEnabled={isEnabled}
        matchedCount={matchedCount}
        totalProducts={totalProducts}
        initialMatches={initialMatches}
      />
    </div>
  );
}
