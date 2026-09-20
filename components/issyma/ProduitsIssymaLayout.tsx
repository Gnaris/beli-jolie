import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canSeePrices as canUserSeePrices } from "@/lib/price-visibility";
import { buildProductHandle } from "@/lib/product-url";
import IssymaShell from "@/components/issyma/IssymaShell";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";
import type { CarouselProduct } from "@/components/home/ProductCarousel";

const P = ISSYMA_PALETTE;

interface FilterOption {
  id: string;
  name: string;
  count?: number;
}
interface ColorFilter {
  id: string;
  name: string;
  hex: string | null;
}

interface SelectedFilters {
  cat?: string;
  collection?: string;
  color?: string;
  composition?: string;
  tag?: string;
  q?: string;
  bestseller?: boolean;
  isNew?: boolean;
}

function buildFilterHref(current: SelectedFilters, patch: Partial<SelectedFilters>) {
  const merged = { ...current, ...patch };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.cat) params.set("cat", merged.cat);
  if (merged.collection) params.set("collection", merged.collection);
  if (merged.color) params.set("color", merged.color);
  if (merged.composition) params.set("composition", merged.composition);
  if (merged.tag) params.set("tag", merged.tag);
  if (merged.bestseller) params.set("bestseller", "1");
  if (merged.isNew) params.set("new", "1");
  const qs = params.toString();
  return `/produits${qs ? `?${qs}` : ""}`;
}

function IconTruck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>
  );
}
function IconBox() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="12" rx="1"/><path d="M8 8V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/><path d="M3 13h18"/></svg>
  );
}
function IconStore() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v3h12V3"/><path d="M6 6l-2 3v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9l-2-3"/><path d="M9 12h6"/></svg>
  );
}
function IconTag() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12l-8 8-8-8V4h8z"/>
      <circle cx="8.5" cy="7.5" r="1.5"/>
    </svg>
  );
}
function IconTeam() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3"/>
      <path d="M3 20c0-3 2.5-5 6-5s6 2 6 5"/>
      <circle cx="17" cy="9" r="2.5"/>
      <path d="M15 20c0-2 1.5-3.5 4-3.5"/>
    </svg>
  );
}
function IconGarment() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l4-3h8l4 3-3 3-2-1v11H9V9l-2 1z"/>
    </svg>
  );
}
function IconHeart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

function FilterSection({
  title,
  currentValue,
  options,
  paramKey,
  selected,
}: {
  title: string;
  currentValue?: string;
  options: FilterOption[];
  paramKey: "cat" | "collection" | "composition" | "tag";
  selected: SelectedFilters;
}) {
  return (
    <div className="py-4" style={{ borderTop: `1px solid ${P.borderSoft}` }}>
      <p
        className="text-[10px] tracking-[0.28em] uppercase font-semibold mb-3"
        style={{ color: P.wine700 }}
      >
        {title}
      </p>
      <ul className="space-y-1.5">
        {options.slice(0, 12).map((opt) => {
          const isSelected = currentValue === opt.id;
          const href = buildFilterHref(selected, { [paramKey]: isSelected ? undefined : opt.id });
          return (
            <li key={opt.id}>
              <Link
                href={href}
                className="flex items-center gap-2.5 text-[13px] leading-tight py-0.5"
              >
                <span
                  aria-hidden
                  className="w-3.5 h-3.5 rounded-[3px] shrink-0 flex items-center justify-center transition"
                  style={{
                    border: `1px solid ${isSelected ? P.wine700 : P.borderSoft}`,
                    background: isSelected ? P.wine700 : "transparent",
                  }}
                >
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l2.5 2.5L10 3" stroke={P.cream} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
                <span
                  className="truncate"
                  style={{ color: isSelected ? P.ink : P.inkSoft }}
                >
                  {opt.name}
                </span>
                {opt.count != null && (
                  <span className="ml-auto text-[10px] tabular-nums" style={{ color: P.muted }}>
                    {opt.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ColorFilterSection({
  colors,
  currentValue,
  selected,
}: {
  colors: ColorFilter[];
  currentValue?: string;
  selected: SelectedFilters;
}) {
  return (
    <div className="py-4" style={{ borderTop: `1px solid ${P.borderSoft}` }}>
      <p
        className="text-[10px] tracking-[0.28em] uppercase font-semibold mb-3"
        style={{ color: P.wine700 }}
      >
        Couleur
      </p>
      <div className="flex flex-wrap gap-2">
        {colors.slice(0, 14).map((c) => {
          const isSelected = currentValue === c.id;
          const href = buildFilterHref(selected, { color: isSelected ? undefined : c.id });
          return (
            <Link
              key={c.id}
              href={href}
              className="w-6 h-6 rounded-full transition"
              title={c.name}
              style={{
                background: c.hex ?? "#fff",
                border: `2px solid ${isSelected ? P.wine700 : P.borderSoft}`,
                boxShadow: isSelected ? `0 0 0 2px ${P.cream}` : "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProductCardIssymaCatalogue({
  p,
  ctaLabel,
  pricePromptLabel,
  canSeePrices,
}: {
  p: CarouselProduct;
  ctaLabel: string;
  pricePromptLabel: string;
  canSeePrices: boolean;
}) {
  const primary = p.colors.find((c) => c.isPrimary) ?? p.colors[0];
  const href = `/produits/${buildProductHandle(p.name, p.reference)}`;
  const displayName = p.displayName ?? p.name;
  const image = primary?.firstImage ?? null;
  const price = primary?.unitPrice ?? null;

  return (
    <div className="product-card group">
      <Link href={href} className="block relative aspect-[3/4] overflow-hidden rounded-xl">
        {image ? (
          <Image src={image} alt={displayName} width={480} height={640} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 thumb-placeholder">
            <div
              className="rounded-full flex items-center justify-center"
              style={{
                width: "38%", aspectRatio: "1/1",
                background: "radial-gradient(60% 60% at 50% 40%, #f6ede8 0%, #e6d1cb 70%, #dcc4be 100%)",
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

        {/* Cœur favori en haut à droite */}
        <span
          aria-hidden
          className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition"
          style={{
            background: "rgba(255, 255, 255, 0.92)",
            color: P.wine700,
            boxShadow: "0 3px 10px -4px rgba(50, 15, 25, 0.35)",
          }}
        >
          <IconHeart />
        </span>

        {p.isBestSeller && (
          <span
            className="absolute top-2 left-2 text-[9px] tracking-[0.2em] uppercase font-semibold px-2 py-0.5 rounded-full"
            style={{ background: P.cream, color: P.wine800 }}
          >
            Coup de cœur
          </span>
        )}
      </Link>

      {/* Info sous la photo — pas de wrapper card, compact */}
      <div className="mt-2 px-0.5">
        <h3 className="serif text-[13px] leading-tight font-semibold line-clamp-2" style={{ color: P.ink }}>
          {displayName}
        </h3>
        <p className="mt-0.5 text-[9px] tracking-[0.2em] uppercase font-semibold" style={{ color: P.muted }}>
          Ref: {p.reference}
        </p>

        <div className="mt-1.5 flex items-center justify-between gap-1.5">
          {canSeePrices && price != null ? (
            <span className="text-[12px] font-semibold tabular-nums" style={{ color: P.wine700 }}>
              {price.toFixed(2).replace(".", ",")} €
            </span>
          ) : (
            <span className="text-[9px] tracking-[0.15em] uppercase font-semibold" style={{ color: P.wine700 }}>
              {pricePromptLabel}
            </span>
          )}
          <Link
            href={href}
            className="inline-flex items-center gap-1 px-2 py-1 text-[9px] tracking-[0.15em] uppercase font-semibold rounded-full transition"
            style={{ background: P.wine700, color: P.cream }}
          >
            {ctaLabel} <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default async function ProduitsIssymaLayout({
  shopName,
  products,
  totalCount,
  categories,
  collections,
  colors,
  compositions,
  tags,
  selectedFilters,
}: {
  shopName: string;
  products: CarouselProduct[];
  totalCount: number;
  categories: FilterOption[];
  collections: FilterOption[];
  colors: ColorFilter[];
  compositions: FilterOption[];
  tags: FilterOption[];
  selectedFilters: SelectedFilters;
}) {
  const t = await getTranslations("products");
  const tHome = await getTranslations("home");
  const session = await getServerSession(authOptions);
  const canSeePrices = canUserSeePrices(session);
  const pricePromptLabel = tHome("issyma.cardPricePro");
  const ctaLabel = "Ajouter au panier";

  const hasAnyFilter =
    !!(selectedFilters.cat || selectedFilters.collection || selectedFilters.color ||
       selectedFilters.composition || selectedFilters.tag || selectedFilters.q ||
       selectedFilters.bestseller || selectedFilters.isNew);

  return (
    <IssymaShell shopName={shopName}>
      {/* HERO compact — fond rose poudré, titre bordeaux à gauche, CTA + tuiles à droite */}
      <section style={{ background: P.blush50 }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-7">
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 items-center">
            <div>
              <p className="eyebrow" style={{ color: P.wine700, fontSize: "10px" }}>
                Professionnels
              </p>
              <h1
                className="serif mt-2"
                style={{
                  color: P.ink,
                  fontSize: "clamp(1.6rem, 3.4vw, 2.6rem)",
                  lineHeight: 1.05,
                }}
              >
                Notre catalogue
              </h1>
              <p className="mt-2 text-[11px] tracking-[0.18em] uppercase font-medium" style={{ color: P.muted }}>
                Vente à l&apos;unité · Minimum 100 € HT
              </p>
            </div>

            <div className="flex flex-col items-start lg:items-end gap-4">
              <Link
                href="/inscription"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[10px] tracking-[0.22em] uppercase font-semibold transition"
                style={{ background: P.wine700, color: P.cream }}
              >
                Créer mon compte pro <span aria-hidden>→</span>
              </Link>

              <div className="grid grid-cols-3 gap-2 w-full max-w-md">
                {[
                  { Icon: IconBox, title: "Expédition", desc: "sous 48h" },
                  { Icon: IconTag, title: "Vente", desc: "à l'unité" },
                  { Icon: IconTeam, title: "Une équipe", desc: "dédiée" },
                ].map(({ Icon, title, desc }, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-xl"
                    style={{ background: P.paper, border: `1px solid ${P.borderSoft}` }}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "#f2d9d3", color: P.wine700 }}
                    >
                      <Icon />
                    </span>
                    <div className="min-w-0 leading-tight">
                      <p className="text-[10px] font-semibold truncate" style={{ color: P.ink }}>{title}</p>
                      <p className="text-[9px] tracking-[0.12em] uppercase truncate" style={{ color: P.muted }}>
                        {desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CORPS — grille blanche, sidebar rose poudré */}
      <section style={{ background: P.paper }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-10 lg:py-14">
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8">

            {/* Sidebar filtres rose poudré — collapsible sur mobile, sticky sur desktop */}
            <details
              open
              className="rounded-2xl overflow-hidden self-start lg:sticky lg:top-4 lg:!block group"
              style={{ background: P.blush50, padding: "0", border: `1px solid ${P.borderSoft}` }}
            >
              <summary
                className="lg:hidden cursor-pointer flex items-center justify-between px-5 py-3 select-none"
                style={{ color: P.ink }}
              >
                <span className="text-[11px] tracking-[0.28em] uppercase font-bold">Filtres</span>
                <span
                  className="text-[11px] font-semibold group-open:rotate-180 transition-transform"
                  style={{ color: P.wine700 }}
                  aria-hidden
                >
                  ▾
                </span>
              </summary>
              <div style={{ padding: "12px 22px 20px 22px" }}>
              <div className="hidden lg:flex items-center justify-between mb-2">
                <p
                  className="text-[11px] tracking-[0.28em] uppercase font-bold"
                  style={{ color: P.ink }}
                >
                  Filtres
                </p>
                {hasAnyFilter && (
                  <Link
                    href="/produits"
                    className="text-[10px] tracking-[0.18em] uppercase"
                    style={{ color: P.wine700 }}
                  >
                    Effacer
                  </Link>
                )}
              </div>
              {hasAnyFilter && (
                <div className="lg:hidden mb-2 flex justify-end">
                  <Link
                    href="/produits"
                    className="text-[10px] tracking-[0.18em] uppercase"
                    style={{ color: P.wine700 }}
                  >
                    Effacer
                  </Link>
                </div>
              )}
              <FilterSection
                title="Catégories"
                currentValue={selectedFilters.cat}
                options={categories}
                paramKey="cat"
                selected={selectedFilters}
              />
              {collections.length > 0 && (
                <FilterSection
                  title="Collection"
                  currentValue={selectedFilters.collection}
                  options={collections}
                  paramKey="collection"
                  selected={selectedFilters}
                />
              )}
              <ColorFilterSection
                colors={colors}
                currentValue={selectedFilters.color}
                selected={selectedFilters}
              />
              {compositions.length > 0 && (
                <FilterSection
                  title="Matière"
                  currentValue={selectedFilters.composition}
                  options={compositions}
                  paramKey="composition"
                  selected={selectedFilters}
                />
              )}
              {tags.length > 0 && (
                <FilterSection
                  title="Style"
                  currentValue={selectedFilters.tag}
                  options={tags}
                  paramKey="tag"
                  selected={selectedFilters}
                />
              )}
              </div>
            </details>

            {/* Zone principale — fond blanc */}
            <div className="min-w-0">
              {/* Barre recherche + tri */}
              <form action="/produits" method="get" className="flex items-center gap-3 mb-6">
                <div
                  className="flex-1 flex items-center gap-2 rounded-full px-5 py-3"
                  style={{ background: P.paper, border: `1px solid ${P.borderSoft}` }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="1.75">
                    <circle cx="11" cy="11" r="7"/>
                    <path d="m20 20-3.5-3.5"/>
                  </svg>
                  <input
                    type="text"
                    name="q"
                    defaultValue={selectedFilters.q ?? ""}
                    placeholder="Rechercher un produit..."
                    className="flex-1 bg-transparent border-none outline-none text-[13px] font-body"
                    style={{ color: P.ink }}
                  />
                </div>
                <div
                  className="flex items-center gap-2 rounded-full px-4 py-3 text-[12px] tracking-[0.15em] uppercase font-semibold"
                  style={{ background: P.paper, border: `1px solid ${P.borderSoft}`, color: P.wine700 }}
                >
                  <span>Trier : Nouveauté</span>
                </div>
              </form>

              {/* Compteur */}
              <p className="text-[11px] tracking-[0.22em] uppercase font-semibold mb-5" style={{ color: P.muted }}>
                <span style={{ color: P.wine700 }}>{totalCount}</span>{" "}
                {totalCount > 1 ? t("productsCounterPlural") : t("productsCounterSingular")}
              </p>

              {/* Grille — cartes compactes, 4 colonnes en desktop */}
              {products.length === 0 ? (
                <div className="text-center py-20 text-[14px]" style={{ color: P.inkSoft }}>
                  {t("emptyState.description")}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
                  {products.map((p) => (
                    <ProductCardIssymaCatalogue
                      key={p.id}
                      p={p}
                      ctaLabel={ctaLabel}
                      pricePromptLabel={pricePromptLabel}
                      canSeePrices={canSeePrices}
                    />
                  ))}
                </div>
              )}

              {products.length < totalCount && (
                <div className="mt-10 flex justify-center">
                  <span className="text-[11px] tracking-[0.22em] uppercase font-semibold" style={{ color: P.muted }}>
                    {products.length} / {totalCount} produits
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </IssymaShell>
  );
}
