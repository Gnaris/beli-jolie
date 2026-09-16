"use client";

import Link from "next/link";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ColorSwatch, isColorOutOfStock, isColorAllDisabled, computeShowStockBadges } from "./AdminProductsTable";
import type { AdminProduct } from "./AdminProductsTable";
import { MarketplaceStatusButtons } from "./MarketplaceStatusButtons";

type MarketplaceKey = "pfs" | "ankorstore" | "efashion" | "faire" | "orderchamp" | "microstore";

const CHIP_STYLE: Record<MarketplaceKey, { letter: string; label: string; gradient: string }> = {
  pfs:        { letter: "P", label: "Paris Fashion Shop", gradient: "linear-gradient(135deg,#4f46e5,#6366f1)" },
  ankorstore: { letter: "A", label: "Ankorstore",         gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)" },
  efashion:   { letter: "E", label: "eFashion",           gradient: "linear-gradient(135deg,#db2777,#ec4899)" },
  faire:      { letter: "F", label: "Faire",              gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)" },
  orderchamp: { letter: "O", label: "Orderchamp",         gradient: "linear-gradient(135deg,#F97316,#FDBA74)" },
  microstore: { letter: "M", label: "Microstore",         gradient: "linear-gradient(135deg,#0891b2,#22d3ee)" },
};

interface Props {
  products: AdminProduct[];
  hasPfsConfig: boolean;
  pfsGloballyEnabled: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  hasOrderchampConfig: boolean;
  orderchampEnabled: boolean;
  hasMicrostoreConfig: boolean;
  microstoreEnabled: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  pendingStatuses: Record<string, "ONLINE" | "OFFLINE" | "ARCHIVED">;
  deletingIds: Set<string>;
}

export default function AdminProductsGrid({
  products,
  hasPfsConfig,
  pfsGloballyEnabled,
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  hasEfashionConfig,
  efashionEnabled,
  hasFaireConfig,
  faireEnabled,
  hasOrderchampConfig,
  orderchampEnabled,
  hasMicrostoreConfig,
  microstoreEnabled,
  selectedIds,
  toggleSelect,
  pendingStatuses,
  deletingIds,
}: Props) {
  const marketplaceGlobal: Record<MarketplaceKey, boolean> = {
    pfs: hasPfsConfig && pfsGloballyEnabled,
    ankorstore: hasAnkorstoreConfig && ankorstoreEnabled,
    efashion: hasEfashionConfig && efashionEnabled,
    faire: hasFaireConfig && faireEnabled,
    orderchamp: hasOrderchampConfig && orderchampEnabled,
    microstore: hasMicrostoreConfig && microstoreEnabled,
  };

  // ─── Popover marketplaces ─────────────────────────────────────────────
  // Un clic sur la ligne de chips d'une carte ouvre un popover flottant
  // ancré à cette ligne. Il embarque le composant MarketplaceStatusButtons
  // complet — les mêmes actions que la fiche produit (publier, resync,
  // bloquer/débloquer, etc.). Un seul popover ouvert à la fois.
  const [popoverProductId, setPopoverProductId] = useState<string | null>(null);
  const [popoverCoords, setPopoverCoords] = useState<{ x: number; y: number; placement: "above" | "below" } | null>(null);

  const openPopover = useCallback((productId: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom;
    const spaceAbove = rect.top;
    // Estime la hauteur nécessaire pour le popover (~250px : 6 cartes qui wrappent
    // sur 2 rangées + padding). Sinon on ouvre au-dessus si le bas manque de place.
    const placement: "above" | "below" = spaceBelow > 260 || spaceBelow > spaceAbove ? "below" : "above";
    setPopoverProductId(productId);
    setPopoverCoords({ x: rect.left + rect.width / 2, y: placement === "below" ? rect.bottom + 8 : rect.top - 8, placement });
  }, []);
  const closePopover = useCallback(() => {
    setPopoverProductId(null);
    setPopoverCoords(null);
  }, []);

  // Fermeture ESC
  useEffect(() => {
    if (!popoverProductId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePopover();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popoverProductId, closePopover]);

  const popoverProduct = popoverProductId
    ? products.find((p) => p.id === popoverProductId) ?? null
    : null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            selected={selectedIds.has(product.id)}
            onToggle={() => toggleSelect(product.id)}
            pendingStatus={pendingStatuses[product.id]}
            deleting={deletingIds.has(product.id)}
            marketplaceGlobal={marketplaceGlobal}
            onOpenMarketplacePopover={openPopover}
          />
        ))}
      </div>

      {popoverProduct && popoverCoords && typeof document !== "undefined" && createPortal(
        <MarketplacesPopover
          coords={popoverCoords}
          onClose={closePopover}
          product={popoverProduct}
          hasPfsConfig={hasPfsConfig}
          pfsGloballyEnabled={pfsGloballyEnabled}
          hasAnkorstoreConfig={hasAnkorstoreConfig}
          ankorstoreEnabled={ankorstoreEnabled}
          hasEfashionConfig={hasEfashionConfig}
          efashionEnabled={efashionEnabled}
          hasFaireConfig={hasFaireConfig}
          faireEnabled={faireEnabled}
          hasOrderchampConfig={hasOrderchampConfig}
          orderchampEnabled={orderchampEnabled}
          hasMicrostoreConfig={hasMicrostoreConfig}
          microstoreEnabled={microstoreEnabled}
        />,
        document.body,
      )}
    </>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────

function ProductCard({
  product,
  selected,
  onToggle,
  pendingStatus,
  deleting,
  marketplaceGlobal,
  onOpenMarketplacePopover,
}: {
  product: AdminProduct;
  selected: boolean;
  onToggle: () => void;
  pendingStatus?: "ONLINE" | "OFFLINE" | "ARCHIVED";
  deleting: boolean;
  marketplaceGlobal: Record<MarketplaceKey, boolean>;
  onOpenMarketplacePopover: (productId: string, anchor: HTMLElement) => void;
}) {
  const chipsRowRef = useRef<HTMLButtonElement | null>(null);
  const effectiveStatus = pendingStatus ?? product.status;
  const minPrice = product.colors.length > 0
    ? Math.min(...product.colors.map((c) => c.unitPrice))
    : NaN;
  const totalStock = product.colors.reduce((sum, c) => sum + c.stock, 0);
  const isFullyOutOfStock = product.colors.length > 0 && product.colors.every((c) => c.stock === 0);

  const uniqueColors = [...new Map(
    product.colors
      .filter((c) => c.colorId && c.color)
      .map((c) => [c.colorId!, c] as const)
  ).values()];
  const displayedColors = uniqueColors.slice(0, 4);
  const extraColors = Math.max(0, uniqueColors.length - displayedColors.length);

  const isArchived = effectiveStatus === "ARCHIVED";
  const showRupture = isFullyOutOfStock && computeShowStockBadges(product, "rupture");

  // Marketplace linked map
  const linked: Record<MarketplaceKey, boolean> = {
    pfs: product.pfsProductId != null,
    ankorstore: product.ankorsProductId != null,
    efashion: product.efashionReferenceBase != null,
    faire: product.faireProductId != null,
    orderchamp: product.orderchampProductId != null,
    microstore: product.microstoreLastPushedAt != null,
  };
  const syncRequired: Record<MarketplaceKey, boolean> = {
    pfs: product.pfsSyncRequired,
    ankorstore: product.ankorsSyncRequired,
    efashion: product.efashionSyncRequired,
    faire: product.faireSyncRequired,
    orderchamp: product.orderchampSyncRequired,
    microstore: product.microstoreSyncRequired,
  };
  const perProductEnabled: Record<MarketplaceKey, boolean> = {
    pfs: product.pfsEnabled,
    ankorstore: product.ankorsEnabled,
    efashion: product.efashionEnabled,
    faire: product.faireEnabled,
    orderchamp: product.orderchampEnabled,
    microstore: product.microstoreEnabled,
  };

  const configuredMarketplaces = (Object.keys(marketplaceGlobal) as MarketplaceKey[])
    .filter((mk) => marketplaceGlobal[mk]);

  const cardClasses = [
    "group relative bg-bg-primary border rounded-2xl overflow-hidden shadow-sm transition-all duration-200",
    "hover:shadow-lg hover:-translate-y-0.5",
    selected ? "border-emerald-400 ring-2 ring-emerald-200" : "border-border",
    isArchived ? "opacity-75" : "",
    deleting ? "opacity-40 pointer-events-none" : "",
  ].join(" ");

  return (
    <article className={cardClasses}>
      {/* Zone image + overlays */}
      <div className="relative aspect-[3/4] bg-bg-tertiary overflow-hidden">
        <Link
          href={`/admin/produits/${product.id}/modifier`}
          className="absolute inset-0 block"
          aria-label={`Modifier ${product.name}`}
        >
          {product.firstImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.firstImage}
              alt={product.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm0 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 9V7.5a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121 7.5v9a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 21z" />
              </svg>
            </div>
          )}
        </Link>

        {/* Statut — pastille en overlay top-left */}
        <div className="absolute top-2 left-2 pointer-events-none">
          <StatusPill status={effectiveStatus} isIncomplete={product.isIncomplete} />
        </div>

        {/* Checkbox — top-right, visible si sélectionné, sinon au survol */}
        <label
          className={`absolute top-2 right-2 w-6 h-6 rounded-md bg-white/95 shadow-sm flex items-center justify-center cursor-pointer transition-opacity ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="checkbox-custom w-3.5 h-3.5"
            aria-label={`Sélectionner ${product.name}`}
          />
        </label>

        {/* Rupture — badge overlay bottom-left */}
        {showRupture && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200 shadow-sm">
            Rupture
          </span>
        )}

        {/* Verrouillé — cadenas overlay bottom-right */}
        {product.locked && (
          <span
            className="absolute bottom-2 right-2 w-6 h-6 rounded-md bg-white/95 shadow-sm flex items-center justify-center text-slate-600"
            title="Produit verrouillé"
            aria-label="Produit verrouillé"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </span>
        )}
      </div>

      {/* Infos */}
      <div className="p-3">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold font-mono truncate">
          {product.reference}
        </p>
        <Link
          href={`/admin/produits/${product.id}/modifier`}
          className="block no-underline"
        >
          <h3
            className="font-medium text-sm text-text-primary mt-0.5 leading-snug hover:text-emerald-700 transition-colors"
            title={product.name}
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {product.name}
          </h3>
        </Link>

        <div className="flex items-baseline justify-between mt-2 gap-2">
          <span className="font-heading font-bold text-base text-text-primary tabular-nums">
            {!isNaN(minPrice) ? `${minPrice.toFixed(2)} €` : "—"}
          </span>
          <span className={`text-xs tabular-nums ${isFullyOutOfStock ? "text-red-600 font-medium" : "text-text-muted"}`}>
            {totalStock} pcs
          </span>
        </div>

        {/* Couleurs pastilles */}
        {displayedColors.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2.5">
            {displayedColors.map((c) => (
              <ColorSwatch
                key={c.id}
                color={c.color}
                outOfStock={isColorOutOfStock(product.colors, c.colorId)}
                allDisabled={isColorAllDisabled(product.colors, c.colorId)}
              />
            ))}
            {extraColors > 0 && (
              <span className="text-[10px] text-text-muted ml-0.5">+{extraColors}</span>
            )}
          </div>
        )}

        {/* Marketplaces chips — cliquables : ouvre un popover avec toutes les
            actions (publier, resync, bloquer/débloquer). Même contenu que la
            fiche produit → MarketplaceStatusButtons. */}
        {configuredMarketplaces.length > 0 && (
          <button
            ref={chipsRowRef}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (chipsRowRef.current) {
                onOpenMarketplacePopover(product.id, chipsRowRef.current);
              }
            }}
            className="w-full flex items-center gap-1 mt-2.5 pt-2.5 border-t border-border-light hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-b-lg"
            aria-label="Gérer les marketplaces de ce produit"
            title="Cliquez pour gérer les marketplaces"
          >
            {configuredMarketplaces.map((mk) => (
              <BrandChip
                key={mk}
                marketplace={mk}
                linked={linked[mk]}
                syncRequired={syncRequired[mk]}
                blockedForProduct={!perProductEnabled[mk]}
              />
            ))}
            <svg className="w-3 h-3 text-text-muted ml-auto shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        )}
      </div>
    </article>
  );
}

// ─── Sous-composants ─────────────────────────────────────────────────────

function StatusPill({ status, isIncomplete }: { status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING"; isIncomplete: boolean }) {
  if (isIncomplete && status === "OFFLINE") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/95 text-amber-700 shadow-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Brouillon
      </span>
    );
  }
  if (status === "ONLINE") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/95 text-emerald-700 shadow-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        En ligne
      </span>
    );
  }
  if (status === "SYNCING") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/95 text-sky-700 shadow-sm">
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Sync…
      </span>
    );
  }
  if (status === "ARCHIVED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/95 text-slate-700 shadow-sm">
        Archivé
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/95 text-slate-600 shadow-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Hors ligne
    </span>
  );
}

function BrandChip({
  marketplace,
  linked,
  syncRequired,
  blockedForProduct,
}: {
  marketplace: MarketplaceKey;
  linked: boolean;
  syncRequired: boolean;
  blockedForProduct: boolean;
}) {
  const { letter, label, gradient } = CHIP_STYLE[marketplace];
  const dim = !linked || blockedForProduct;
  const title = blockedForProduct
    ? `${label} — bloqué pour ce produit`
    : linked
    ? syncRequired
      ? `${label} — sync nécessaire`
      : `${label} — publié`
    : `${label} — non publié`;

  return (
    <span
      className="relative inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-white text-[10px] font-bold shadow-sm"
      style={{
        background: gradient,
        opacity: dim ? 0.3 : 1,
        filter: dim ? "grayscale(0.6)" : undefined,
        fontFamily: "var(--font-poppins), sans-serif",
      }}
      title={title}
      aria-label={title}
    >
      {letter}
      {linked && syncRequired && !blockedForProduct && (
        <span
          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white"
          aria-hidden
        />
      )}
    </span>
  );
}

// ─── Popover marketplaces ────────────────────────────────────────────────

/**
 * Popover ancré à la ligne de chips d'une carte grille. Contient le composant
 * MarketplaceStatusButtons complet — même API et mêmes actions que la fiche
 * produit (publier, resynchroniser, bloquer, débloquer, lier / délier).
 *
 * Fermeture : clic sur le backdrop, clic sur la croix, touche ESC (gérée par
 * le parent).
 */
function MarketplacesPopover({
  coords,
  onClose,
  product,
  hasPfsConfig,
  pfsGloballyEnabled,
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  hasEfashionConfig,
  efashionEnabled,
  hasFaireConfig,
  faireEnabled,
  hasOrderchampConfig,
  orderchampEnabled,
  hasMicrostoreConfig,
  microstoreEnabled,
}: {
  coords: { x: number; y: number; placement: "above" | "below" };
  onClose: () => void;
  product: AdminProduct;
  hasPfsConfig: boolean;
  pfsGloballyEnabled: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  hasOrderchampConfig: boolean;
  orderchampEnabled: boolean;
  hasMicrostoreConfig: boolean;
  microstoreEnabled: boolean;
}) {
  // Largeur cible : 6 cartes marketplace × w-44 (176px) + gaps + padding ≈ 1140px.
  // On la clampe à la largeur du viewport et on wrappe si besoin.
  const cardWidth = Math.min(1140, typeof window !== "undefined" ? window.innerWidth - 24 : 1140);
  const halfWidth = cardWidth / 2;
  const paddedX = typeof window !== "undefined"
    ? Math.min(Math.max(coords.x, halfWidth + 12), window.innerWidth - halfWidth - 12)
    : coords.x;

  const style: React.CSSProperties = {
    position: "fixed",
    left: paddedX,
    top: coords.placement === "below" ? coords.y : undefined,
    bottom: coords.placement === "above" && typeof window !== "undefined"
      ? window.innerHeight - coords.y
      : undefined,
    transform: "translateX(-50%)",
    width: cardWidth,
    maxWidth: "calc(100vw - 24px)",
    maxHeight: "calc(100vh - 40px)",
    zIndex: 9997,
  };

  return (
    <>
      {/* Backdrop — clic ferme */}
      <div
        className="fixed inset-0 z-[9996] bg-slate-900/20"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Marketplaces — ${product.name}`}
        style={style}
        className="bg-bg-primary border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-secondary/50">
          {product.firstImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.firstImage}
              alt={product.name}
              className="w-10 h-10 rounded-lg object-cover shrink-0 border border-border"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-bg-tertiary shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700 font-semibold">
              Marketplaces
            </p>
            <p className="text-sm font-heading font-bold text-text-primary truncate">
              {product.name}{" "}
              <span className="font-normal text-text-muted font-body text-xs">
                · {product.reference}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="w-8 h-8 rounded-full bg-bg-primary hover:bg-bg-tertiary text-text-primary flex items-center justify-center transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Corps : les 6 cartes marketplaces (wrap automatique si étroit) */}
        <div className="p-4 overflow-auto">
          <div className="flex flex-wrap gap-2 justify-center">
            <MarketplaceStatusButtons
              productId={product.id}
              reference={product.reference}
              productName={product.name}
              firstImage={product.firstImage}
              pfsProductId={product.pfsProductId}
              pfsBrandName={product.pfsBrandName ?? null}
              hasPfsConfig={hasPfsConfig}
              pfsEnabled={pfsGloballyEnabled}
              ankorsProductId={product.ankorsProductId}
              hasAnkorstoreConfig={hasAnkorstoreConfig}
              ankorstoreEnabled={ankorstoreEnabled}
              efashionLinked={product.efashionReferenceBase != null}
              hasEfashionConfig={hasEfashionConfig}
              efashionEnabled={efashionEnabled}
              faireProductId={product.faireProductId}
              hasFaireConfig={hasFaireConfig}
              faireEnabled={faireEnabled}
              orderchampProductId={product.orderchampProductId}
              hasOrderchampConfig={hasOrderchampConfig}
              orderchampEnabled={orderchampEnabled}
              microstoreLastPushedAt={product.microstoreLastPushedAt}
              hasMicrostoreConfig={hasMicrostoreConfig}
              microstoreEnabled={microstoreEnabled}
              pfsSyncRequired={product.pfsSyncRequired}
              ankorsSyncRequired={product.ankorsSyncRequired}
              efashionSyncRequired={product.efashionSyncRequired}
              faireSyncRequired={product.faireSyncRequired}
              orderchampSyncRequired={product.orderchampSyncRequired}
              microstoreSyncRequired={product.microstoreSyncRequired}
              pfsEnabledForProduct={product.pfsEnabled}
              ankorsEnabledForProduct={product.ankorsEnabled}
              efashionEnabledForProduct={product.efashionEnabled}
              faireEnabledForProduct={product.faireEnabled}
              orderchampEnabledForProduct={product.orderchampEnabled}
              microstoreEnabledForProduct={product.microstoreEnabled}
              microstoreProductId={product.microstoreProductId ?? null}
            />
          </div>
        </div>
      </div>
    </>
  );
}
