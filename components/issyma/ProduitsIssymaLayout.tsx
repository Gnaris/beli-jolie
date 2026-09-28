import { Suspense } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canSeePrices as canUserSeePrices } from "@/lib/price-visibility";
import IssymaShell from "@/components/issyma/IssymaShell";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";
import ProduitsIssymaGridClient from "@/components/issyma/ProduitsIssymaGridClient";
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
  title,
  colors,
  currentValue,
  selected,
}: {
  title: string;
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
        {title}
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

export default async function ProduitsIssymaLayout({
  shopName,
  products,
  totalCount,
  initialHasMore,
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
  initialHasMore: boolean;
  categories: FilterOption[];
  collections: FilterOption[];
  colors: ColorFilter[];
  compositions: FilterOption[];
  tags: FilterOption[];
  selectedFilters: SelectedFilters;
}) {
  const t = await getTranslations("products");
  const tHome = await getTranslations("home");
  const locale = await getLocale();
  const session = await getServerSession(authOptions);
  const canSeePrices = canUserSeePrices(session);
  const gridLabels = {
    ctaLabel:         t("issymaAddToCart"),
    pricePromptLabel: tHome("issyma.cardPricePro"),
    badgeLabel:       t("issymaBestSellerBadge"),
    refLabel:         t("issymaRefLabel"),
    loadMoreLabel:    t("loadMore"),
    loadingLabel:     t("loading"),
    loadErrorLabel:   t("loadError"),
    retryLabel:       t("retry"),
    emptyLabel:       t("issymaEmptyLabel"),
  };

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
                {t("issymaEyebrow")}
              </p>
              <h1
                className="serif mt-2"
                style={{
                  color: P.ink,
                  fontSize: "clamp(1.6rem, 3.4vw, 2.6rem)",
                  lineHeight: 1.05,
                }}
              >
                {t("title")}
              </h1>
              <p className="mt-2 text-[11px] tracking-[0.18em] uppercase font-medium" style={{ color: P.muted }}>
                {t("issymaHeroSubtitle")}
              </p>
            </div>

            <div className="flex flex-col items-start lg:items-end gap-4">
              <Link
                href="/inscription"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[10px] tracking-[0.22em] uppercase font-semibold transition"
                style={{ background: P.wine700, color: P.cream }}
              >
                {t("issymaCtaPro")} <span aria-hidden>→</span>
              </Link>

              <div className="grid grid-cols-3 gap-2 w-full max-w-md">
                {[
                  { Icon: IconBox, title: t("issymaTile1Title"), desc: t("issymaTile1Desc") },
                  { Icon: IconTag, title: t("issymaTile2Title"), desc: t("issymaTile2Desc") },
                  { Icon: IconTeam, title: t("issymaTile3Title"), desc: t("issymaTile3Desc") },
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
                <span className="text-[11px] tracking-[0.28em] uppercase font-bold">{t("issymaFiltersTitle")}</span>
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
                  {t("issymaFiltersTitle")}
                </p>
                {hasAnyFilter && (
                  <Link
                    href="/produits"
                    className="text-[10px] tracking-[0.18em] uppercase"
                    style={{ color: P.wine700 }}
                  >
                    {t("issymaFiltersClear")}
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
                    {t("issymaFiltersClear")}
                  </Link>
                </div>
              )}
              <FilterSection
                title={t("issymaFilterCategories")}
                currentValue={selectedFilters.cat}
                options={categories}
                paramKey="cat"
                selected={selectedFilters}
              />
              {collections.length > 0 && (
                <FilterSection
                  title={t("issymaFilterCollection")}
                  currentValue={selectedFilters.collection}
                  options={collections}
                  paramKey="collection"
                  selected={selectedFilters}
                />
              )}
              <ColorFilterSection
                title={t("issymaFilterColor")}
                colors={colors}
                currentValue={selectedFilters.color}
                selected={selectedFilters}
              />
              {compositions.length > 0 && (
                <FilterSection
                  title={t("issymaFilterMaterial")}
                  currentValue={selectedFilters.composition}
                  options={compositions}
                  paramKey="composition"
                  selected={selectedFilters}
                />
              )}
              {tags.length > 0 && (
                <FilterSection
                  title={t("issymaFilterStyle")}
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
              {/* Barre recherche */}
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
                    placeholder={t("issymaSearchPlaceholder")}
                    className="flex-1 bg-transparent border-none outline-none text-[13px] font-body"
                    style={{ color: P.ink }}
                  />
                </div>
              </form>

              {/* Compteur */}
              <p className="text-[11px] tracking-[0.22em] uppercase font-semibold mb-5" style={{ color: P.muted }}>
                <span style={{ color: P.wine700 }}>{totalCount}</span>{" "}
                {totalCount > 1 ? t("productsCounterPlural") : t("productsCounterSingular")}
              </p>

              {/* Grille + load-more — client component pour brancher /api/products.
                  Suspense obligatoire autour de useSearchParams (Next 16). */}
              <Suspense>
                <ProduitsIssymaGridClient
                  initialProducts={products}
                  initialHasMore={initialHasMore}
                  totalCount={totalCount}
                  canSeePrices={canSeePrices}
                  locale={locale}
                  labels={gridLabels}
                />
              </Suspense>
            </div>
          </div>
        </div>
      </section>
    </IssymaShell>
  );
}
