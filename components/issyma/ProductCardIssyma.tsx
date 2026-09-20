import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { buildProductHandle } from "@/lib/product-url";
import type { CarouselProduct } from "@/components/home/ProductCarousel";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";

const P = ISSYMA_PALETTE;

function IconGarment() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l4-3h8l4 3-3 3-2-1v11H9V9l-2 1z"/>
    </svg>
  );
}

/**
 * Carte produit — variante Issyma. Utilisée par HomeIssymaLayout et par
 * toutes les pages catalogue Issyma (liste, catégorie, collection).
 * Attend un `CarouselProduct` (shape déjà produit par les pages catalogue BJ).
 */
export default function ProductCardIssyma({
  p,
  badge,
  canSeePrices,
  pricePromptLabel,
  pricePromptHint,
}: {
  p: CarouselProduct;
  badge?: string;
  canSeePrices: boolean;
  pricePromptLabel: string;
  pricePromptHint: string;
}) {
  const primary = p.colors.find((c) => c.isPrimary) ?? p.colors[0];
  const href = `/produits/${buildProductHandle(p.name, p.reference)}`;
  const displayName = p.displayName ?? p.name;
  const displayCategory = p.displayCategory ?? p.category;
  const image = primary?.firstImage ?? null;
  const price = primary ? primary.unitPrice : null;

  return (
    <Link href={href} className="product-card group block">
      <div className="relative aspect-square overflow-hidden rounded-2xl">
        {image ? (
          <Image src={image} alt={displayName} width={800} height={800} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 thumb-placeholder">
            <div
              className="rounded-full flex items-center justify-center"
              style={{
                width: "38%", aspectRatio: "1/1",
                background: "radial-gradient(60% 60% at 50% 40%, #f6ede8 0%, #e6d1cb 70%, #dcc4be 100%)",
                boxShadow: "inset 0 -6px 20px rgba(122, 42, 60, 0.08)",
                color: "#c98a8a",
                opacity: 0.6,
              }}
            >
              <div style={{ width: "36%" }}>
                <IconGarment />
              </div>
            </div>
          </div>
        )}
        {badge && (
          <span className="pill-new absolute top-4 left-4">
            {badge}
          </span>
        )}
      </div>
      <div className="mt-4">
        <p className="text-[10px] tracking-[0.24em] uppercase font-semibold" style={{ color: P.muted }}>
          {p.reference} · {displayCategory}
        </p>
        <h3 className="serif text-base mt-1.5 font-semibold" style={{ color: P.ink }}>
          {displayName}
        </h3>
        {canSeePrices ? (
          price != null && (
            <p className="text-sm mt-2 tracking-wide" style={{ color: P.wine700 }}>
              {price.toFixed(2).replace(".", ",")} €
            </p>
          )
        ) : (
          <div className="mt-2">
            <span
              className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.14em] uppercase font-semibold"
              style={{ color: P.wine700 }}
            >
              {pricePromptLabel}
              <span aria-hidden="true">→</span>
            </span>
            <p className="text-[11px] mt-0.5" style={{ color: P.muted }}>
              {pricePromptHint}
            </p>
          </div>
        )}
      </div>
    </Link>
  );
}
