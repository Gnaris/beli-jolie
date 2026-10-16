import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildProductHandle } from "@/lib/product-url";
import { getImageSrc } from "@/lib/image-utils";

interface Props {
  userId: string;
}

/**
 * Liste les produits que la cliente a consultés : regroupés par produit, avec
 * total de vues (jours distincts) et la date de la dernière vue. Masque les
 * produits supprimés / archivés (eux apparaîtront si vous le voulez plus tard).
 */
export default async function ClientProductViewsPanel({ userId }: Props) {
  const views = await prisma.productView.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      productId: true,
      createdAt: true,
      product: {
        select: {
          id: true,
          reference: true,
          name: true,
          status: true,
          colors: {
            where: { disabled: false, isPrimary: true },
            take: 1,
            select: {
              id: true,
              images: {
                orderBy: { order: "asc" },
                take: 1,
                select: { path: true },
              },
            },
          },
        },
      },
    },
  });

  type Agg = {
    productId: string;
    reference: string;
    name: string;
    status: string;
    firstImage: string | null;
    viewsCount: number;
    lastViewedAt: Date;
  };
  const byProduct = new Map<string, Agg>();
  for (const v of views) {
    if (!v.product) continue;
    const existing = byProduct.get(v.productId);
    const firstImage = v.product.colors[0]?.images[0]?.path ?? null;
    if (existing) {
      existing.viewsCount += 1;
      if (v.createdAt > existing.lastViewedAt) existing.lastViewedAt = v.createdAt;
    } else {
      byProduct.set(v.productId, {
        productId: v.product.id,
        reference: v.product.reference,
        name: v.product.name,
        status: v.product.status,
        firstImage,
        viewsCount: 1,
        lastViewedAt: v.createdAt,
      });
    }
  }

  const rows = [...byProduct.values()].sort(
    (a, b) => b.lastViewedAt.getTime() - a.lastViewedAt.getTime(),
  );

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h3 className="font-heading text-lg font-bold text-text-primary leading-tight">
            Produits vus
          </h3>
          <p className="text-sm text-text-muted mt-1">
            Fiches que la cliente a consultées (listing ou page produit).
            Maximum 1 vue par jour et par produit.
          </p>
        </div>
        <span className="text-xs text-text-muted font-body tabular-nums">
          {rows.length} {rows.length > 1 ? "produits différents" : "produit"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-text-muted font-body">
            La cliente n&apos;a encore vu aucun produit.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-secondary">
              <tr>
                <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Produit</th>
                <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Référence</th>
                <th className="px-4 py-2.5 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Vues</th>
                <th className="px-4 py-2.5 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Dernière vue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {rows.map((r) => {
                const handle = buildProductHandle(r.name, r.reference);
                const imageSrc = r.firstImage ? getImageSrc(r.firstImage, "thumb") : null;
                return (
                  <tr key={r.productId} className="hover:bg-bg-secondary/50">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/produits/${handle}`}
                        className="flex items-center gap-3 group"
                      >
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-bg-tertiary border border-border shrink-0 flex items-center justify-center">
                          {imageSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={imageSrc} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-text-muted text-xs">—</span>
                          )}
                        </div>
                        <span className="font-medium text-text-primary font-body group-hover:underline">
                          {r.name}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{r.reference}</td>
                    <td className="px-4 py-2.5 text-center font-heading font-semibold text-text-primary tabular-nums">
                      {r.viewsCount}
                    </td>
                    <td className="px-4 py-2.5 text-right text-text-secondary font-body text-xs">
                      {r.lastViewedAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
