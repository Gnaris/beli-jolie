"use client";

import React, { useState, useTransition, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  bulkUpdateProductStatus,
  bulkDeleteProducts,
  previewProductDeletion,
  updateVariantQuick,
  bulkUpdateVariants,
} from "@/app/actions/admin/products";
import {
  refreshProductOnMarketplaces,
  refreshProductsOnMarketplaces,
  type MarketplaceRefreshOutcome,
  type MarketplaceRefreshOptions,
} from "@/app/actions/admin/marketplace-refresh";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useProductStream } from "@/hooks/useProductStream";
import { useRefreshMarketplaceDialog } from "@/components/admin/products/useRefreshMarketplaceDialog";

// ─── Rule helpers ──────────────────────────────────────────────────────────────

/**
 * Products in draft (OFFLINE or isIncomplete) and archived products don't
 * expose a "rupture" / "stock partiel" signal — they're not sellable, so stock
 * is irrelevant. Exported for unit testing.
 */
export function computeShowStockBadges(p: { status: string; isIncomplete: boolean }): boolean {
  if (p.isIncomplete) return false;
  if (p.status === "OFFLINE") return false;
  if (p.status === "ARCHIVED") return false;
  return true;
}

// ─── Marketplace publish badge ─────────────────────────────────────────────────

function MarketplaceBadge({
  marketplace,
  published,
}: {
  marketplace: "PFS" | "Ankorstore";
  published: boolean;
}) {
  const label = marketplace === "PFS" ? "PFS" : "Ankorstore";
  if (published) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
        title={`Publié sur ${marketplace === "PFS" ? "Paris Fashion Shop" : "Ankorstore"}`}
      >
        <span className="w-1 h-1 rounded-full bg-[#22C55E]" />
        {label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bg-secondary text-text-muted border border-border"
      title={`Non publié sur ${marketplace === "PFS" ? "Paris Fashion Shop" : "Ankorstore"}`}
    >
      <span className="w-1 h-1 rounded-full bg-[#9CA3AF]" />
      {label}
    </span>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VariantSizeEntry {
  quantity: number;
  size: { name: string };
}

interface ColorVariant {
  id: string;
  colorId: string | null;
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variantSizes?: VariantSizeEntry[];
  color: { name: string; hex: string | null; patternImage?: string | null };
}

interface ProductTranslation {
  locale: string;
}

interface AdminProduct {
  id: string;
  reference: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  categoryName: string;
  subCategoryName: string | null;
  createdAt: string;
  lastRefreshedAt: string | null;
  firstImage: string | null;
  pfsProductId: string | null;
  ankorsProductId: string | null;
  colors: ColorVariant[];
  translations: ProductTranslation[];
}

interface Props {
  products: AdminProduct[];
  totalCount: number;
}

// ─── Variant Editor Row ────────────────────────────────────────────────────────

function VariantRow({
  variant,
  productName,
  checked,
  onCheck,
  onSaved,
}: {
  variant: ColorVariant;
  productName: string;
  checked: boolean;
  onCheck: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(variant.unitPrice));
  const [stock, setStock] = useState(String(variant.stock));
  const [weight, setWeight] = useState(String(variant.weight));
  const [saleType, setSaleType] = useState(variant.saleType);
  const [packQuantity, setPackQuantity] = useState(String(variant.packQuantity ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await updateVariantQuick(variant.id, {
        unitPrice: parseFloat(price) || 0,
        stock: parseInt(stock) || 0,
        weight: parseFloat(weight) || 0,
        saleType,
        packQuantity: saleType === "PACK" ? (parseInt(packQuantity) || null) : null,
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <tr className={`transition-colors border-t border-border-light ${checked ? "bg-[#EEF2FF]" : "hover:bg-bg-primary/80"}`}
      >
        {/* Checkbox */}
        <td className="pl-5 pr-2 py-2.5 w-10">
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            className="checkbox-custom checkbox-sm"
            title={`Sélectionner ${variant.color.name} — ${productName}`}
          />
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            {(() => {
              const mainHex = variant.color.hex ?? "#9CA3AF";
              const fullName = variant.color.name;
              const swatchStyle: React.CSSProperties = variant.color.patternImage
                ? { backgroundImage: `url(${variant.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { backgroundColor: mainHex };
              return (
                <>
                  <span
                    className="w-5 h-5 rounded-full shrink-0"
                    style={{
                      ...swatchStyle,
                      border: '2px solid #fff',
                      boxShadow: '0 0 0 1px #D1D1D1, 0 1px 2px rgba(0,0,0,0.08)',
                    }}
                    title={fullName}
                  />
                  <span className="text-xs font-medium font-body text-text-primary">
                    {fullName}
                  </span>
                </>
              );
            })()}
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs font-body">
          <span className={`badge text-[10px] ${variant.saleType === "UNIT" ? "badge-info" : "badge-purple"}`}>
            {variant.saleType === "UNIT" ? "Unité" : `Pack ×${variant.packQuantity}`}
          </span>
          {variant.variantSizes && variant.variantSizes.length > 0 && (
            <span className="badge badge-neutral text-[10px] ml-1.5">
              {variant.variantSizes.map(vs => vs.quantity > 1 ? `${vs.size.name}\u00D7${vs.quantity}` : vs.size.name).join(", ")}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs font-body font-semibold text-text-primary">
          {Number(variant.unitPrice).toFixed(2)} €
        </td>
        <td className="px-3 py-2.5 text-xs font-body">
          {variant.stock === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[#DC2626] font-bold">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#DC2626', display: 'inline-block' }} className="animate-pulse" />
              {variant.stock}
            </span>
          ) : variant.stock <= 5 ? (
            <span className="inline-flex items-center gap-1.5 text-[#D97706] font-semibold">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D97706', display: 'inline-block' }} />
              {variant.stock}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[#16A34A] font-medium">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} />
              {variant.stock}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs font-body text-text-secondary">
          {variant.weight} kg
        </td>
        <td className="px-3 py-2.5 text-right">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium font-body transition-all px-2.5 py-1 bg-bg-primary text-text-secondary border border-border-dark rounded-md shadow-sm hover:border-text-primary hover:text-text-primary"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Modifier
          </button>
        </td>
      </tr>
    );
  }

  // ── Mode édition ──
  const inputClass = "variant-input w-full";


  return (
    <>
      <tr className="border-t-[1.5px] border-t-[#FDE68A] bg-[#FFFBEB]">
        <td className="pl-5 pr-2 py-2.5 w-10">
          <input type="checkbox" checked={checked} onChange={onCheck} className="checkbox-custom checkbox-sm" />
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full shrink-0"
              style={{
                ...(variant.color.patternImage
                  ? { backgroundImage: `url(${variant.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : { backgroundColor: variant.color.hex ?? "#9CA3AF" }),
                border: '2px solid #fff', boxShadow: '0 0 0 1px #D1D1D1',
              }}
            />
            <span className="text-xs font-medium font-body text-text-primary">
              {variant.color.name}
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <CustomSelect
              value={saleType}
              onChange={(v) => setSaleType(v as "UNIT" | "PACK")}
              options={[
                { value: "UNIT", label: "Unité" },
                { value: "PACK", label: "Pack" },
              ]}
              size="sm"
              className="w-[90px]"
            />
            {saleType === "PACK" && (
              <input type="number" min={2} value={packQuantity} onChange={(e) => setPackQuantity(e.target.value)} placeholder="Qté" className={`${inputClass} !w-14`} />
            )}
            {variant.variantSizes && variant.variantSizes.length > 0 && (
              <span className="badge badge-neutral text-[10px]">
                {variant.variantSizes.map(vs => vs.quantity > 1 ? `${vs.size.name}\u00D7${vs.quantity}` : vs.size.name).join(", ")}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputClass} !w-20`} />
        </td>
        <td className="px-3 py-2.5">
          <input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} className={`${inputClass} !w-16`} />
        </td>
        <td className="px-3 py-2.5">
          <input type="number" step="0.01" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} className={`${inputClass} !w-16`} />
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex items-center gap-1.5 justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`inline-flex items-center gap-1 font-body transition-colors px-3 py-1.5 text-[11px] font-semibold bg-bg-dark text-text-inverse rounded-md border-none ${saving ? "cursor-wait opacity-60" : "cursor-pointer"}`}
            >
              {saving ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {saving ? "..." : "OK"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="font-body transition-colors px-2.5 py-1.5 text-[11px] text-text-secondary bg-transparent border-none rounded-md cursor-pointer hover:bg-bg-primary hover:text-text-primary"
            >
              Annuler
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr className="bg-[#FEF2F2]">
          <td colSpan={9} className="px-5 py-2 text-xs font-body text-error">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Actions Dropdown (portal) ────────────────────────────────────────────────

function ActionsDropdown({
  productId,
  expanded,
  refreshing,
  anchorRef,
  onClose,
  onExpandToggle,
  onRefresh,
}: {
  productId: string;
  expanded: boolean;
  refreshing: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onExpandToggle: () => void;
  onRefresh: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Position the menu below the anchor button, aligned right
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.right - 176, // 176px = w-44
    });
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        anchorRef.current && !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      className="w-44 bg-bg-primary border border-border rounded-xl shadow-lg py-1 animate-fadeIn"
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
    >
      <Link
        href={`/admin/produits/${productId}/modifier`}
        className="block w-full text-left px-4 py-2 text-xs font-body text-text-primary hover:bg-bg-tertiary transition-colors no-underline"
        onClick={onClose}
      >
        Modifier
      </Link>
      <Link
        href={`/fr/produits/${productId}`}
        target="_blank"
        className="block w-full text-left px-4 py-2 text-xs font-body text-text-primary hover:bg-bg-tertiary transition-colors no-underline"
        onClick={onClose}
      >
        Voir côté client
      </Link>
      <Link
        href={`/admin/produits/${productId}/dupliquer`}
        className="block w-full text-left px-4 py-2 text-xs font-body text-text-primary hover:bg-bg-tertiary transition-colors no-underline"
        onClick={onClose}
      >
        Dupliquer
      </Link>
      <button
        type="button"
        onClick={onExpandToggle}
        className="block w-full text-left px-4 py-2 text-xs font-body text-text-primary hover:bg-bg-tertiary transition-colors border-none bg-transparent cursor-pointer"
      >
        {expanded ? "Masquer les variantes" : "Voir les variantes"}
      </button>
      <div className="border-t border-border my-1" />
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className={`block w-full text-left px-4 py-2 text-xs font-body text-text-primary hover:bg-bg-tertiary transition-colors border-none bg-transparent cursor-pointer ${refreshing ? "opacity-50 cursor-wait" : ""}`}
      >
        {refreshing ? "Rafraîchissement…" : "Rafraîchir"}
      </button>
    </div>
  );
}

// ─── Product Row (expandable) ──────────────────────────────────────────────────

function ProductRow({
  product,
  selected,
  onToggle,
  expanded,
  onExpandToggle,
  selectedVariantIds,
  onToggleVariant,
  onToggleAllVariants,
  isNew = false,
  isDeleting = false,
}: {
  product: AdminProduct;
  selected: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpandToggle: () => void;
  selectedVariantIds: Set<string>;
  onToggleVariant: (id: string) => void;
  onToggleAllVariants: (ids: string[], select: boolean) => void;
  isNew?: boolean;
  isDeleting?: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const { confirm } = useConfirm();
  const { refreshSingle } = useRefreshMarketplaceDialog();

  // Grouper les variantes UNIT par colorId. PACK exclus.
  const uniqueColors = [...new Map(product.colors
    .filter((c) => c.saleType !== "PACK" && c.colorId && c.color)
    .map((c) => [c.colorId!, c] as const)
  ).values()];
  const packCount = product.colors.filter((c) => c.saleType === "PACK").length;
  const minPrice = product.colors.length > 0
    ? Math.min(...product.colors.map((c) => c.unitPrice))
    : NaN;

  // Stock status
  const isFullyOutOfStock = product.colors.length > 0 && product.colors.every((c) => c.stock === 0);
  const hasPartialOutOfStock = !isFullyOutOfStock && product.colors.some((c) => c.stock === 0);
  // Drafts & archived products don't expose a "rupture" state — they're not live.
  const showStockBadges = computeShowStockBadges({ status: product.status, isIncomplete: product.isIncomplete });

  const allNonFrLocales = ["en", "ar", "zh", "de", "es", "it"];
  const existingLocales = new Set(product.translations.map((t) => t.locale));
  const missingLocales = allNonFrLocales.filter((l) => !existingLocales.has(l));
  const hasMissingTranslations = missingLocales.length > 0;

  const variantIds = product.colors.map((c) => c.id);
  const allVariantsSelected = variantIds.length > 0 && variantIds.every((id) => selectedVariantIds.has(id));

  return (
    <>
      <tr
        className={`table-row transition-all duration-150 ${selected ? "bg-[#EEF2FF]" : ""} ${expanded ? "border-b-0" : ""} ${isNew ? "animate-product-pop" : ""} ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
      >
        {/* Checkbox */}
        <td className="px-4 py-3.5 w-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="checkbox-custom"
          />
        </td>

        {/* Photo — clickable for expand */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
          {product.firstImage ? (
            <img
              src={product.firstImage}
              alt={product.name}
              className="w-12 h-12 object-cover rounded-xl border border-border shadow-sm"
            />
          ) : (
            <div className="w-12 h-12 bg-bg-tertiary rounded-xl flex items-center justify-center border border-border">
              <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm0 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 9V7.5a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121 7.5v9a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 21z" />
              </svg>
            </div>
          )}
        </td>

        {/* Référence */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
          <span className="font-mono text-[11px] bg-bg-tertiary px-2 py-1 rounded-md text-text-secondary whitespace-nowrap border border-border-light">
            {product.reference}
          </span>
        </td>

        {/* Nom + prix */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-text-primary text-sm whitespace-nowrap">{product.name}</p>
            {hasMissingTranslations && (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold shrink-0" title={`Traductions manquantes: ${missingLocales.join(", ")}`}>
                ⓘ
              </span>
            )}
          </div>
          {!isNaN(minPrice) && (
            <p className="text-[11px] text-text-muted whitespace-nowrap mt-0.5">
              à partir de <span className="font-semibold text-text-secondary">{minPrice.toFixed(2)} €</span>
            </p>
          )}
        </td>

        {/* Catégorie */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
          <span className="text-xs font-medium text-text-secondary whitespace-nowrap">{product.categoryName}</span>
          {product.subCategoryName && (
            <p className="text-[11px] text-text-muted whitespace-nowrap mt-0.5">{product.subCategoryName}</p>
          )}
        </td>

        {/* Couleurs */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
          <div className="flex items-center gap-1 flex-nowrap">
            {uniqueColors.slice(0, 6).map((c) => {
              const mainHex = c.color.hex ?? "#9CA3AF";
              const fullName = c.color.name;
              const swatchStyle: React.CSSProperties = c.color.patternImage
                ? { backgroundImage: `url(${c.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { backgroundColor: mainHex };
              const isOos = c.stock === 0 && showStockBadges;
              return (
                <span
                  key={c.colorId}
                  title={`${fullName}${isOos ? " — Rupture" : ""}`}
                  className="inline-block w-5 h-5 rounded-full relative shrink-0"
                  style={{
                    ...swatchStyle,
                    border: '2px solid #fff',
                    boxShadow: '0 0 0 1px #D1D1D1',
                  }}
                >
                  {isOos && (
                    <span className="absolute inset-[-2px] rounded-full border-[2.5px] border-[#EF4444] pointer-events-none" />
                  )}
                </span>
              );
            })}
            {uniqueColors.length > 6 && (
              <span className="text-[10px] text-text-muted font-semibold whitespace-nowrap">+{uniqueColors.length - 6}</span>
            )}
            {packCount > 0 && (
              <span className="badge badge-purple text-[10px] shrink-0">
                {packCount} pack{packCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </td>

        {/* Statut */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 flex-nowrap">
              {product.isIncomplete && product.status !== "ONLINE" ? (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#F3E8FF] text-[#7C3AED] border border-[#DDD6FE]"
                  title="Brouillon — produit en cours de création"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
                  Brouillon
                </span>
              ) : (
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                  product.status === "ONLINE"
                    ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]"
                    : product.status === "SYNCING"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : product.status === "ARCHIVED"
                    ? "bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]"
                    : "bg-bg-secondary text-text-secondary border-border"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    product.status === "ONLINE" ? "bg-[#22C55E]"
                    : product.status === "SYNCING" ? "bg-blue-500 animate-pulse"
                    : product.status === "ARCHIVED" ? "bg-[#F59E0B]"
                    : "bg-[#9CA3AF]"
                  }`} />
                  {product.status === "ONLINE" ? "En ligne"
                    : product.status === "SYNCING" ? "Importation en cours depuis Paris Fashion Shop"
                    : product.status === "ARCHIVED" ? "Archivé"
                    : "Hors ligne"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-nowrap">
              {showStockBadges && isFullyOutOfStock && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]"
                  title="Toutes les variantes sont en rupture de stock"
                >
                  Rupture
                </span>
              )}
              {showStockBadges && hasPartialOutOfStock && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]"
                  title="Certaines variantes sont en rupture de stock"
                >
                  Stock partiel
                </span>
              )}
              {isDeleting && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Suppression...
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-nowrap">
              <MarketplaceBadge marketplace="PFS" published={!!product.pfsProductId} />
              <MarketplaceBadge marketplace="Ankorstore" published={!!product.ankorsProductId} />
            </div>
          </div>
        </td>

        {/* Date de création + dernier rafraîchissement */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-text-muted font-body whitespace-nowrap">
              {new Date(product.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
            {product.lastRefreshedAt && (
              <span
                className="inline-flex items-center gap-1 text-[10px] text-[#4F46E5] font-body whitespace-nowrap"
                title={`Dernier rafraîchissement : ${new Date(product.lastRefreshedAt).toLocaleString("fr-FR")}`}
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
                {new Date(product.lastRefreshedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
              </span>
            )}
          </div>
        </td>

        {/* Actions */}
        <td className="px-3 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
          <div ref={actionsRef} className="relative inline-block">
            <button
              type="button"
              onClick={() => setActionsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-lg hover:border-border-dark hover:text-text-primary transition-all shadow-sm"
            >
              Actions
              <svg className={`w-3 h-3 transition-transform duration-200 ${actionsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {actionsOpen && createPortal(
              <ActionsDropdown
                productId={product.id}
                expanded={expanded}
                refreshing={refreshing}
                anchorRef={actionsRef}
                onClose={() => setActionsOpen(false)}
                onExpandToggle={() => { onExpandToggle(); setActionsOpen(false); }}
                onRefresh={async () => {
                  setActionsOpen(false);
                  if (refreshing) return;
                  setRefreshing(true);
                  try {
                    await refreshSingle({
                      productId: product.id,
                      reference: product.reference,
                      productName: product.name,
                      firstImage: product.firstImage,
                    });
                  } finally {
                    setRefreshing(false);
                  }
                }}
              />,
              document.body
            )}
          </div>
        </td>
      </tr>

      {/* ── Tiroir variantes ── */}
      {expanded && (
        <tr>
          <td colSpan={9} className="p-0">
            <div className="drawer-variant-container" style={{ position: 'relative' }}>
              {/* En-tête du tiroir */}
              <div
                className="flex items-center justify-between drawer-variant-header"
                style={{ padding: '12px 20px' }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-[3px] h-4 rounded-sm bg-bg-dark" />
                    <span className="font-heading text-[11px] font-bold text-text-primary uppercase tracking-wider"
                    >
                      {product.colors.length} variante{product.colors.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  {product.colors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onToggleAllVariants(variantIds, !allVariantsSelected)}
                      className={`inline-flex items-center gap-1.5 font-body transition-all px-2.5 py-1 text-[10px] font-semibold rounded-md border cursor-pointer ${
                        allVariantsSelected
                          ? "border-bg-dark bg-bg-dark text-text-inverse"
                          : "border-border-dark bg-bg-primary text-text-secondary"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={allVariantsSelected}
                        readOnly
                        className="checkbox-custom checkbox-sm pointer-events-none"
                        tabIndex={-1}
                      />
                      {allVariantsSelected ? "Désélectionner tout" : "Sélectionner tout"}
                    </button>
                  )}
                </div>
                <Link
                  href={`/admin/produits/${product.id}/modifier`}
                  className="inline-flex items-center gap-1.5 font-body transition-colors text-[11px] text-text-secondary hover:text-text-primary no-underline"
                >
                  Édition complète
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>

              {/* Table des variantes */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="drawer-variant-th">
                    <th className="w-10 py-2 pl-5 pr-2"></th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Couleur</th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Type</th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Prix HT</th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Stock</th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Poids</th>
                    <th className="px-3 py-2 text-right text-[10px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {product.colors.map((variant) => (
                    <VariantRow
                      key={variant.id}
                      variant={variant}
                      productName={product.name}
                      checked={selectedVariantIds.has(variant.id)}
                      onCheck={() => onToggleVariant(variant.id)}
                      onSaved={() => {}}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Bulk Variant Edit Bar ──────────────────────────────────────────────────────

const BULK_FIELDS: { value: string; label: string; icon: string }[] = [
  { value: "stock", label: "Stock", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { value: "price", label: "Prix HT", icon: "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { value: "weight", label: "Poids", icon: "M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" },
];

function BulkVariantBar({
  count,
  onApply,
  onClear,
  isPending,
}: {
  count: number;
  onApply: (data: Record<string, unknown>) => void;
  onClear: () => void;
  isPending: boolean;
}) {
  const [field, setField] = useState<string>("stock");
  const [mode, setMode] = useState<"set" | "add">("set");
  const [value, setValue] = useState("");
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);

  const handleApply = () => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;

    if (field === "stock") {
      onApply(mode === "set" ? { stock: Math.max(0, Math.round(numVal)) } : { stock: { increment: Math.round(numVal) } });
    } else if (field === "price") {
      if (mode === "set") onApply({ unitPrice: Math.max(0, numVal) });
      else onApply({ unitPrice: { increment: numVal } });
    } else if (field === "weight") {
      onApply({ weight: Math.max(0, numVal) });
    }
  };

  const barInputStyle: React.CSSProperties = {
    padding: '7px 12px',
    fontSize: '12px',
    fontFamily: 'var(--font-roboto), sans-serif',
    color: '#FFFFFF',
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '8px',
    outline: 'none',
    width: 140,
  };

  return (
    <div
      className="bulk-variant-bar"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#1A1A1A',
        color: '#fff',
        borderRadius: 16,
        padding: '14px 20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      {/* Count badge */}
      <div className="flex items-center gap-2">
        <span className="font-heading"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            background: 'rgba(255,255,255,0.15)',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {count}
        </span>
        <span className="font-body" style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
          variante{count > 1 ? "s" : ""}
        </span>
      </div>

      <div style={{ height: 24, width: 1, background: 'rgba(255,255,255,0.15)' }} />

      {/* Field selector — custom dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setFieldMenuOpen(!fieldMenuOpen)}
          className="font-body"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 10,
            cursor: 'pointer',
            transition: 'all 0.15s',
            minWidth: 150,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
        >
          <svg className="w-3.5 h-3.5 shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={BULK_FIELDS.find(f => f.value === field)?.icon ?? ""} />
          </svg>
          <span className="flex-1 text-left">{BULK_FIELDS.find(f => f.value === field)?.label}</span>
          <svg className={`w-3 h-3 shrink-0 opacity-50 transition-transform duration-200 ${fieldMenuOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {fieldMenuOpen && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setFieldMenuOpen(false)} />
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 6,
                minWidth: 200,
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 12px 40px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06)',
                overflow: 'hidden',
                zIndex: 61,
                animation: 'confirmSlideUp 0.15s ease-out',
              }}
            >
              <div style={{ padding: '6px 0' }}>
                {BULK_FIELDS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => { setField(f.value); setValue(""); setFieldMenuOpen(false); }}
                    className="font-body"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '9px 14px',
                      fontSize: 12,
                      fontWeight: field === f.value ? 700 : 500,
                      color: field === f.value ? '#1A1A1A' : '#6B6B6B',
                      background: field === f.value ? '#F7F7F8' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.1s',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => { if (field !== f.value) e.currentTarget.style.background = '#F7F7F8'; }}
                    onMouseLeave={(e) => { if (field !== f.value) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} style={{ color: field === f.value ? '#1A1A1A' : '#9CA3AF' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                    </svg>
                    <span className="flex-1">{f.label}</span>
                    {field === f.value && (
                      <svg className="w-3.5 h-3.5 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Mode (set / add) — only for stock & price */}
      {(field === "stock" || field === "price") && (
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
          <button
            type="button"
            onClick={() => setMode("set")}
            className="font-body"
            style={{
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: mode === "set" ? '#fff' : 'transparent',
              color: mode === "set" ? '#1A1A1A' : 'rgba(255,255,255,0.5)',
              transition: 'all 0.15s',
            }}
          >
            Définir
          </button>
          <button
            type="button"
            onClick={() => setMode("add")}
            className="font-body"
            style={{
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: mode === "add" ? '#fff' : 'transparent',
              color: mode === "add" ? '#1A1A1A' : 'rgba(255,255,255,0.5)',
              transition: 'all 0.15s',
            }}
          >
            +/−
          </button>
        </div>
      )}

      {/* Value input */}
      {(
        <input
          type="number"
          step={field === "stock" ? "1" : "0.01"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            field === "stock" ? (mode === "set" ? "Nouveau stock" : "+10 ou -5")
            : field === "price" ? (mode === "set" ? "Nouveau prix" : "+1.50 ou -0.50")
            : field === "weight" ? "Poids (kg)"
            : "Valeur"
          }
          style={barInputStyle}
        />
      )}

      {/* Apply button */}
      <button
        type="button"
        onClick={handleApply}
        disabled={isPending || (!value)}
        className="flex items-center gap-1.5 font-body"
        style={{
          padding: '7px 16px',
          fontSize: 12,
          fontWeight: 700,
          background: '#fff',
          color: '#1A1A1A',
          border: 'none',
          borderRadius: 8,
          cursor: isPending || (!value) ? 'not-allowed' : 'pointer',
          opacity: isPending || (!value) ? 0.4 : 1,
          transition: 'all 0.15s',
        }}
      >
        {isPending ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        Appliquer
      </button>

      <div style={{ height: 24, width: 1, background: 'rgba(255,255,255,0.15)' }} />

      {/* Clear */}
      <button
        type="button"
        onClick={onClear}
        className="font-body"
        style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.4)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
      >
        Désélectionner
      </button>
    </div>
  );
}

// ─── Table with synchronized top + bottom scrollbar ─────────────────────────────

function TableWithTopScroll({
  products, selectedIds, allSelected, toggleSelectAll, toggleSelect, expandedIds, toggleExpand, selectedVariantIds, toggleVariant, toggleAllVariants, newProductIds, deletingIds,
}: {
  products: AdminProduct[];
  selectedIds: Set<string>;
  allSelected: boolean;
  toggleSelectAll: () => void;
  toggleSelect: (id: string) => void;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  selectedVariantIds: Set<string>;
  toggleVariant: (id: string) => void;
  toggleAllVariants: (ids: string[], select: boolean) => void;
  newProductIds: Set<string>;
  deletingIds: Set<string>;
}) {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topInnerRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef<"top" | "bottom" | null>(null);

  // Sync widths & show/hide top scrollbar
  useEffect(() => {
    const tableEl = tableScrollRef.current;
    const topEl = topScrollRef.current;
    const topInner = topInnerRef.current;
    if (!tableEl || !topEl || !topInner) return;

    const syncWidth = () => {
      const scrollW = tableEl.scrollWidth;
      const clientW = tableEl.clientWidth;
      topInner.style.width = `${scrollW}px`;
      // Hide top scrollbar when no overflow
      topEl.style.display = scrollW > clientW ? "block" : "none";
    };

    syncWidth();

    const ro = new ResizeObserver(syncWidth);
    ro.observe(tableEl);
    return () => ro.disconnect();
  }, [products]);

  // Sync scroll positions
  useEffect(() => {
    const topEl = topScrollRef.current;
    const tableEl = tableScrollRef.current;
    if (!topEl || !tableEl) return;

    const onTopScroll = () => {
      if (isSyncingRef.current === "bottom") return;
      isSyncingRef.current = "top";
      tableEl.scrollLeft = topEl.scrollLeft;
      requestAnimationFrame(() => { isSyncingRef.current = null; });
    };
    const onTableScroll = () => {
      if (isSyncingRef.current === "top") return;
      isSyncingRef.current = "bottom";
      topEl.scrollLeft = tableEl.scrollLeft;
      requestAnimationFrame(() => { isSyncingRef.current = null; });
    };

    topEl.addEventListener("scroll", onTopScroll);
    tableEl.addEventListener("scroll", onTableScroll);
    return () => {
      topEl.removeEventListener("scroll", onTopScroll);
      tableEl.removeEventListener("scroll", onTableScroll);
    };
  }, []);

  return (
    <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Top scrollbar */}
      <div ref={topScrollRef} className="overflow-x-auto" style={{ height: 12 }}>
        <div ref={topInnerRef} style={{ height: 1 }} />
      </div>
      {/* Table */}
      <div ref={tableScrollRef} className="overflow-x-auto">
        <table className="w-full text-sm font-body" style={{ minWidth: 800 }}>
          <thead>
            <tr className="table-header">
              <th className="px-4 py-3.5 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="checkbox-custom"
                  title="Tout sélectionner"
                />
              </th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Photo</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Réf.</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Produit</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Catégorie</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Couleurs</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Statut</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Date</th>
              <th className="px-3 py-3.5 text-right text-[10px] w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                selected={selectedIds.has(product.id)}
                onToggle={() => toggleSelect(product.id)}
                expanded={expandedIds.has(product.id)}
                onExpandToggle={() => toggleExpand(product.id)}
                selectedVariantIds={selectedVariantIds}
                onToggleVariant={toggleVariant}
                onToggleAllVariants={toggleAllVariants}
                isNew={newProductIds.has(product.id)}
                isDeleting={deletingIds.has(product.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Table ────────────────────────────────────────────────────────────────

export default function AdminProductsTable({ products, totalCount: _totalCount }: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const { confirm } = useConfirm();
  const { refreshBulk } = useRefreshMarketplaceDialog();
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // ─── Real-time new products via SSE ──
  const [liveProducts, setLiveProducts] = useState<AdminProduct[]>([]);
  const [newProductIds, setNewProductIds] = useState<Set<string>>(new Set());
  const existingIdsRef = useRef<Set<string>>(new Set(products.map((p) => p.id)));

  // Keep existingIds in sync with server-rendered products
  useEffect(() => {
    existingIdsRef.current = new Set(products.map((p) => p.id));
    // Clean up live products that are already in the server list (after navigation/revalidation)
    setLiveProducts((prev) => prev.filter((p) => !existingIdsRef.current.has(p.id)));
  }, [products]);

  // Clear "new" animation after 4 seconds
  useEffect(() => {
    if (newProductIds.size === 0) return;
    const timer = setTimeout(() => {
      setNewProductIds(new Set());
    }, 4000);
    return () => clearTimeout(timer);
  }, [newProductIds]);

  // Track whether an import is in progress so we can refresh when it finishes
  const importInProgressRef = useRef(false);

  useProductStream(useCallback((event) => {
    // When an import finishes, reload the full page data (counts, statuses, etc.)
    if (event.type === "IMPORT_PROGRESS" && event.importProgress) {
      const { status } = event.importProgress;
      if (status === "PROCESSING") {
        importInProgressRef.current = true;
      } else if (status === "COMPLETED" || status === "FAILED") {
        if (importInProgressRef.current) {
          importInProgressRef.current = false;
          // Small delay to let DB settle after last product insert
          setTimeout(() => router.refresh(), 1500);
        }
      }
      return;
    }

    if (event.type !== "PRODUCT_CREATED") return;
    const productId = event.productId;

    // Skip if already in the list
    if (existingIdsRef.current.has(productId)) return;

    // Fetch the product data and add it to the table
    fetch(`/api/admin/products/${productId}`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((product: AdminProduct | null) => {
        if (!product) return;
        // Avoid duplicates
        if (existingIdsRef.current.has(product.id)) return;
        existingIdsRef.current.add(product.id);
        setLiveProducts((prev) => [product, ...prev]);
        setNewProductIds((prev) => new Set(prev).add(product.id));
      })
      .catch(() => {});
  }, [router]));

  // Merge live products (prepended) with server products
  const allProducts = [...liveProducts, ...products.filter((p) => !liveProducts.some((lp) => lp.id === p.id))];

  const allPageIds = allProducts.map((p) => p.id);
  const allSelected = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;
  const variantCount = selectedVariantIds.size;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allPageIds));
    }
  }, [allSelected, allPageIds]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleVariant = useCallback((variantId: string) => {
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }, []);

  const toggleAllVariants = useCallback((ids: string[], select: boolean) => {
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      if (select) {
        ids.forEach((id) => next.add(id));
      } else {
        ids.forEach((id) => next.delete(id));
      }
      return next;
    });
  }, []);

  const clearSelectedVariants = useCallback(() => {
    setSelectedVariantIds(new Set());
  }, []);

  // ─── Bulk product actions ──
  const handleBulkStatus = useCallback(async (status: "ONLINE" | "OFFLINE" | "ARCHIVED") => {
    const ids = [...selectedIds];
    const count = ids.length;
    const statusLabels: Record<string, { verb: string; title: string; type: "info" | "warning" }> = {
      ONLINE:   { verb: "mis en ligne", title: "Mettre en ligne", type: "info" },
      OFFLINE:  { verb: "mis hors ligne", title: "Mettre hors ligne", type: "warning" },
      ARCHIVED: { verb: "archivé(s)", title: "Archiver", type: "warning" },
    };
    const label = statusLabels[status];

    const confirmed = await confirm({
      type: label.type,
      title: `${label.title} ${count} produit${count > 1 ? "s" : ""} ?`,
      message: status === "ARCHIVED"
        ? "Les produits archivés ne seront plus visibles en ligne."
        : `${count} produit${count > 1 ? "s seront" : " sera"} ${label.verb}.`,
      confirmLabel: label.title,
      cancelLabel: "Annuler",
    });
    if (!confirmed) return;

    setBulkMessage(null);
    showLoading();
    startTransition(async () => {
      try {
        const result = await bulkUpdateProductStatus(ids, status);

        const msgs: string[] = [];
        if (result.success.length > 0) {
          msgs.push(`${result.success.length} produit${result.success.length > 1 ? "s" : ""} ${label.verb}`);
        }
        if (result.errors.length > 0) {
          const refs = result.errors.map((e) => `${e.reference} (${e.reason})`).join(", ");
          msgs.push(`Erreurs : ${refs}`);
        }
        setBulkMessage({
          type: result.errors.length > 0 ? "error" : "success",
          text: msgs.join(" — "),
        });
        setSelectedIds(new Set());
      } catch (e) {
        setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
      } finally {
        hideLoading();
      }
    });
  }, [selectedIds, startTransition, showLoading, hideLoading, confirm]);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    const count = ids.length;

    // Ask the server which products will be deleted vs archived so we can show
    // the admin exactly what the action will do before they confirm.
    let preview: Awaited<ReturnType<typeof previewProductDeletion>>;
    try {
      preview = await previewProductDeletion(ids);
    } catch (e) {
      setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
      return;
    }

    const deleteCount = preview.willDelete.length;
    const archiveCount = preview.willArchive.length;

    let title: string;
    let message: string;
    let confirmLabel: string;

    if (archiveCount === 0) {
      // Pure permanent delete path — never-sold products only.
      title = `Supprimer définitivement ${deleteCount} produit${deleteCount > 1 ? "s" : ""} ?`;
      message = deleteCount === 1
        ? "Ce produit n'a jamais été vendu. Il sera supprimé définitivement (action irréversible)."
        : "Ces produits n'ont jamais été vendus. Ils seront supprimés définitivement (action irréversible).";
      confirmLabel = "Supprimer définitivement";
    } else if (deleteCount === 0) {
      // Pure archive path — every selected product already has orders.
      const refs = preview.willArchive.map((p) => p.reference).join(", ");
      title = `Archiver ${archiveCount} produit${archiveCount > 1 ? "s" : ""} ?`;
      message = archiveCount === 1
        ? `Ce produit (${refs}) a déjà été vendu. Il ne peut pas être supprimé définitivement : il sera archivé pour conserver l'historique des commandes et les factures.`
        : `Ces produits ont déjà été vendus (${refs}). Ils ne peuvent pas être supprimés définitivement : ils seront archivés pour conserver l'historique des commandes et les factures.`;
      confirmLabel = "Archiver";
    } else {
      // Mixed path — some will be deleted, some archived.
      const deleteRefs = preview.willDelete.map((p) => p.reference).join(", ");
      const archiveRefs = preview.willArchive.map((p) => p.reference).join(", ");
      title = `Traiter ${count} produit${count > 1 ? "s" : ""} ?`;
      message =
        `${deleteCount} produit${deleteCount > 1 ? "s" : ""} jamais vendu${deleteCount > 1 ? "s" : ""} sera supprimé${deleteCount > 1 ? "s" : ""} définitivement : ${deleteRefs}.\n\n` +
        `${archiveCount} produit${archiveCount > 1 ? "s" : ""} déjà vendu${archiveCount > 1 ? "s" : ""} sera archivé${archiveCount > 1 ? "s" : ""} (historique conservé) : ${archiveRefs}.`;
      confirmLabel = "Supprimer et archiver";
    }

    const confirmed = await confirm({
      type: "danger",
      title,
      message,
      confirmLabel,
      cancelLabel: "Annuler",
    });
    if (!confirmed) return;

    setBulkMessage(null);
    setDeletingIds(new Set(ids));
    showLoading();
    startTransition(async () => {
      try {
        const result = await bulkDeleteProducts(ids);

        const msgs: string[] = [];
        if (result.deleted > 0) msgs.push(`${result.deleted} produit${result.deleted > 1 ? "s" : ""} supprimé${result.deleted > 1 ? "s" : ""} définitivement`);
        if (result.archived.length > 0) {
          const refs = result.archived.map((p) => p.reference).join(", ");
          msgs.push(`${result.archived.length} archivé${result.archived.length > 1 ? "s" : ""} (commandes existantes) : ${refs}`);
        }
        setBulkMessage({
          type: "success",
          text: msgs.join(" — ") || "Aucun produit traité",
        });
        setSelectedIds(new Set());
      } catch (e) {
        setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
      } finally {
        hideLoading();
        setDeletingIds(new Set());
      }
    });
  }, [selectedIds, startTransition, showLoading, hideLoading, confirm]);

  // ─── Bulk variant actions ──
  const handleBulkVariantUpdate = useCallback(async (data: Record<string, unknown>) => {
    const ids = [...selectedVariantIds];
    setBulkMessage(null);

    const hasIncrement = Object.values(data).some((v) => v && typeof v === "object" && "increment" in (v as Record<string, unknown>));

    showLoading();
    startTransition(async () => {
      try {
        if (hasIncrement) {
          const field = Object.keys(data)[0];
          const incrementVal = (data[field] as { increment: number }).increment;
          let updated = 0;
          for (const variantId of ids) {
            try {
              const product = allProducts.find((p) => p.colors.some((c) => c.id === variantId));
              const variant = product?.colors.find((c) => c.id === variantId);
              if (!variant) continue;

              const currentVal = field === "stock" ? variant.stock : field === "unitPrice" ? variant.unitPrice : variant.weight;
              const newVal = Math.max(0, currentVal + incrementVal);
              await updateVariantQuick(variantId, { [field]: field === "stock" ? Math.round(newVal) : newVal });
              updated++;
            } catch { /* skip */ }
          }
          setBulkMessage({
            type: "success",
            text: `${updated} variante${updated > 1 ? "s" : ""} mise${updated > 1 ? "s" : ""} à jour`,
          });
        } else {
          const result = await bulkUpdateVariants(ids, data as Record<string, number | string | null>);
          setBulkMessage({
            type: "success",
            text: `${result.updated} variante${result.updated > 1 ? "s" : ""} mise${result.updated > 1 ? "s" : ""} à jour`,
          });
        }
        setSelectedVariantIds(new Set());
      } catch (e) {
        setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
      } finally {
        hideLoading();
      }
    });
  }, [selectedVariantIds, allProducts, startTransition, showLoading, hideLoading]);

  if (allProducts.length === 0) {
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-16 text-center">
        <div className="w-16 h-16 bg-bg-tertiary rounded-2xl flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <p className="font-heading font-bold text-text-primary text-base mb-1.5">Aucun produit trouvé</p>
        <p className="text-sm text-text-muted font-body max-w-xs mx-auto">Aucun résultat ne correspond à vos critères de recherche. Essayez de modifier vos filtres.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Barre d'actions en masse (produits) */}
      {someSelected && (
        <div className="flex items-center gap-3 bg-bg-dark text-text-inverse rounded-2xl px-5 py-3.5 animate-fadeIn shadow-lg">
          <span className="text-sm font-body font-semibold tabular-nums">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
          </span>
          <div className="h-4 w-px bg-bg-primary/20" />
          <button
            type="button"
            onClick={() => handleBulkStatus("ONLINE")}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#22C55E] text-white text-xs font-medium rounded-lg hover:bg-[#16A34A] disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Mettre en ligne
          </button>
          <button
            type="button"
            onClick={() => handleBulkStatus("OFFLINE")}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary/10 text-text-inverse text-xs font-medium rounded-lg hover:bg-bg-primary/20 disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
            Mettre hors ligne
          </button>
          <button
            type="button"
            onClick={() => handleBulkStatus("ARCHIVED")}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F59E0B]/80 text-white text-xs font-medium rounded-lg hover:bg-[#D97706] disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            Archiver
          </button>
          <div className="h-4 w-px bg-bg-primary/20" />
          <button
            type="button"
            onClick={async () => {
              const selectedProducts = allProducts
                .filter((p) => selectedIds.has(p.id))
                .map((p) => ({
                  productId: p.id,
                  reference: p.reference,
                  productName: p.name,
                  firstImage: p.firstImage,
                }));
              await refreshBulk(selectedProducts);
            }}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6366F1] text-white text-xs font-medium rounded-lg hover:bg-[#4F46E5] disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
            </svg>
            Rafraîchir
          </button>
          <div className="h-4 w-px bg-bg-primary/20" />
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/80 text-white text-xs font-medium rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            Supprimer
          </button>
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); }}
            className="ml-auto text-xs text-text-inverse/50 hover:text-text-inverse transition-colors font-body"
          >
            Désélectionner
          </button>
        </div>
      )}

      {/* Message résultat bulk */}
      {bulkMessage && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-body ${
          bulkMessage.type === "success"
            ? "bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          <span>{bulkMessage.text}</span>
          <button
            type="button"
            onClick={() => setBulkMessage(null)}
            className="ml-auto text-current opacity-50 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Tableau avec double scrollbar (haut + bas) */}
      <TableWithTopScroll products={allProducts} selectedIds={selectedIds} allSelected={allSelected} toggleSelectAll={toggleSelectAll} toggleSelect={toggleSelect} expandedIds={expandedIds} toggleExpand={toggleExpand} selectedVariantIds={selectedVariantIds} toggleVariant={toggleVariant} toggleAllVariants={toggleAllVariants} newProductIds={newProductIds} deletingIds={deletingIds} />

      {/* Barre flottante d'édition en masse des variantes */}
      {variantCount > 0 && (
        <BulkVariantBar
          count={variantCount}
          onApply={handleBulkVariantUpdate}
          onClear={clearSelectedVariants}
          isPending={isPending}
        />
      )}
    </div>
  );
}
