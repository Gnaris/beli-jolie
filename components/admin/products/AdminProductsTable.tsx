"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import {
  bulkUpdateProductStatus,
  bulkDeleteProducts,
  updateVariantQuick,
  bulkUpdateVariants,
  refreshProduct,
} from "@/app/actions/admin/products";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ColorVariant {
  id: string;
  colorId: string;
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  color: { name: string; hex: string | null };
}

interface ProductTranslation {
  locale: string;
}

interface AdminProduct {
  id: string;
  reference: string;
  name: string;
  status: "ONLINE" | "OFFLINE";
  categoryName: string;
  subCategoryName: string | null;
  createdAt: string;
  firstImage: string | null;
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
  const [size, setSize] = useState(variant.size ?? "");
  const [discountType, setDiscountType] = useState(variant.discountType ?? "");
  const [discountValue, setDiscountValue] = useState(String(variant.discountValue ?? ""));
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
        size: size.trim() || null,
        discountType: discountType === "PERCENT" || discountType === "AMOUNT" ? discountType : null,
        discountValue: discountValue ? parseFloat(discountValue) : null,
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
      <tr className={`transition-colors ${checked ? "bg-[#EEF2FF]" : "hover:bg-white/80"}`}
        style={{ borderTop: '1px solid #E8E8EA' }}
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
            <span
              className="w-5 h-5 rounded-full shrink-0"
              style={{
                backgroundColor: variant.color.hex ?? "#9CA3AF",
                border: '2px solid #fff',
                boxShadow: '0 0 0 1px #D1D1D1, 0 1px 2px rgba(0,0,0,0.08)',
              }}
            />
            <span className="text-xs font-medium font-[family-name:var(--font-roboto)] text-[#1A1A1A]">
              {variant.color.name}
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs font-[family-name:var(--font-roboto)]">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold"
            style={variant.saleType === "UNIT"
              ? { background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }
              : { background: '#F5F3FF', color: '#6D28D9', border: '1px solid #DDD6FE' }
            }
          >
            {variant.saleType === "UNIT" ? "Unité" : `Pack ×${variant.packQuantity}`}
          </span>
          {variant.size && (
            <span className="ml-1.5 text-[10px]"
              style={{ color: '#6B6B6B', background: '#F0F0F0', padding: '2px 6px', borderRadius: '4px' }}
            >
              {variant.size}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs font-[family-name:var(--font-roboto)] font-semibold" style={{ color: '#1A1A1A' }}>
          {variant.unitPrice.toFixed(2)} €
        </td>
        <td className="px-3 py-2.5 text-xs font-[family-name:var(--font-roboto)]">
          <span className="inline-flex items-center gap-1"
            style={{
              color: variant.stock === 0 ? '#EF4444' : variant.stock <= 5 ? '#F59E0B' : '#1A1A1A',
              fontWeight: variant.stock <= 5 ? 600 : 400,
            }}
          >
            {variant.stock === 0 && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444', display: 'inline-block' }} className="animate-pulse" />
            )}
            {variant.stock}
          </span>
        </td>
        <td className="px-3 py-2.5 text-xs font-[family-name:var(--font-roboto)]" style={{ color: '#6B6B6B' }}>
          {variant.weight} kg
        </td>
        <td className="px-3 py-2.5 text-xs font-[family-name:var(--font-roboto)]">
          {variant.discountType && variant.discountValue
            ? (
              <span style={{ color: '#15803D', fontWeight: 500, background: '#F0FDF4', padding: '2px 8px', borderRadius: '4px', border: '1px solid #BBF7D0' }}>
                {variant.discountType === "PERCENT" ? `-${variant.discountValue}%` : `-${variant.discountValue}€`}
              </span>
            )
            : <span style={{ color: '#9CA3AF' }}>—</span>
          }
        </td>
        <td className="px-3 py-2.5 text-right">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium font-[family-name:var(--font-roboto)] transition-all"
            style={{
              padding: '4px 10px',
              background: '#fff',
              color: '#6B6B6B',
              border: '1px solid #D1D1D1',
              borderRadius: '6px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1A1A1A'; e.currentTarget.style.color = '#1A1A1A'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#D1D1D1'; e.currentTarget.style.color = '#6B6B6B'; }}
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
  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    border: '1.5px solid #D1D1D1',
    borderRadius: '8px',
    fontSize: '12px',
    fontFamily: 'var(--font-roboto), sans-serif',
    color: '#1A1A1A',
    background: '#fff',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };
  const selectClass = [
    "px-3 py-2 pr-8 min-h-[36px]",
    "text-xs font-[family-name:var(--font-roboto)] text-[#1A1A1A]",
    "bg-white border-[1.5px] border-[#D1D1D1] rounded-lg",
    "appearance-none cursor-pointer",
    "outline-none transition-all duration-150",
    "hover:border-[#1A1A1A] hover:shadow-[0_0_0_1px_rgba(26,26,26,0.08)]",
    "focus:border-[#1A1A1A] focus:shadow-[0_0_0_3px_rgba(26,26,26,0.08)]",
  ].join(" ");
  const selectArrowBg: React.CSSProperties = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%231A1A1A' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    backgroundSize: '10px 10px',
  };

  return (
    <>
      <tr style={{ borderTop: '1.5px solid #FDE68A', background: '#FFFBEB' }}>
        <td className="pl-5 pr-2 py-2.5 w-10">
          <input type="checkbox" checked={checked} onChange={onCheck} className="checkbox-custom checkbox-sm" />
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full shrink-0"
              style={{ backgroundColor: variant.color.hex ?? "#9CA3AF", border: '2px solid #fff', boxShadow: '0 0 0 1px #D1D1D1' }}
            />
            <span className="text-xs font-medium font-[family-name:var(--font-roboto)]" style={{ color: '#1A1A1A' }}>
              {variant.color.name}
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <select
              value={saleType}
              onChange={(e) => setSaleType(e.target.value as "UNIT" | "PACK")}
              className={selectClass}
              style={{ ...selectArrowBg, width: 90 }}
            >
              <option value="UNIT">Unité</option>
              <option value="PACK">Pack</option>
            </select>
            {saleType === "PACK" && (
              <input type="number" min={2} value={packQuantity} onChange={(e) => setPackQuantity(e.target.value)} placeholder="Qté" style={{ ...inputStyle, width: 56 }} />
            )}
            <input type="text" value={size} onChange={(e) => setSize(e.target.value)} placeholder="Taille" style={{ ...inputStyle, width: 64 }} />
          </div>
        </td>
        <td className="px-3 py-2.5">
          <input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} style={{ ...inputStyle, width: 80 }} />
        </td>
        <td className="px-3 py-2.5">
          <input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} style={{ ...inputStyle, width: 64 }} />
        </td>
        <td className="px-3 py-2.5">
          <input type="number" step="0.01" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} style={{ ...inputStyle, width: 64 }} />
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value)}
              className={selectClass}
              style={{ ...selectArrowBg, width: 74 }}
            >
              <option value="">—</option>
              <option value="PERCENT">%</option>
              <option value="AMOUNT">€</option>
            </select>
            {discountType && (
              <input type="number" step="0.01" min={0} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} style={{ ...inputStyle, width: 56 }} />
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex items-center gap-1.5 justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1 font-[family-name:var(--font-roboto)] transition-colors"
              style={{
                padding: '5px 12px',
                fontSize: '11px',
                fontWeight: 600,
                background: '#1A1A1A',
                color: '#fff',
                borderRadius: '6px',
                border: 'none',
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
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
              className="font-[family-name:var(--font-roboto)] transition-colors"
              style={{
                padding: '5px 10px',
                fontSize: '11px',
                color: '#6B6B6B',
                background: 'transparent',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#1A1A1A'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6B6B6B'; }}
            >
              Annuler
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr style={{ background: '#FEF2F2' }}>
          <td colSpan={8} className="px-5 py-2 text-xs font-[family-name:var(--font-roboto)]" style={{ color: '#EF4444' }}>
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
}: {
  product: AdminProduct;
  selected: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpandToggle: () => void;
  selectedVariantIds: Set<string>;
  onToggleVariant: (id: string) => void;
  onToggleAllVariants: (ids: string[], select: boolean) => void;
}) {
  const [refreshing, startRefresh] = useTransition();

  const uniqueColors = [...new Map(product.colors.map((c) => [c.colorId, c])).values()];
  const minPrice = product.colors.length > 0
    ? Math.min(...product.colors.map((c) => c.unitPrice))
    : NaN;

  // All variants out of stock?
  const isOutOfStock = product.colors.length > 0 && product.colors.every((c) => c.stock === 0);

  const allNonFrLocales = ["en", "ar", "zh", "de", "es", "it"];
  const existingLocales = new Set(product.translations.map((t) => t.locale));
  const missingLocales = allNonFrLocales.filter((l) => !existingLocales.has(l));
  const hasMissingTranslations = missingLocales.length > 0;

  const variantIds = product.colors.map((c) => c.id);
  const allVariantsSelected = variantIds.length > 0 && variantIds.every((id) => selectedVariantIds.has(id));

  return (
    <>
      <tr
        className={`table-row transition-colors ${selected ? "bg-blue-50/40" : ""} ${expanded ? "border-b-0" : ""}`}
      >
        {/* Checkbox */}
        <td className="px-3 py-3 w-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="checkbox-custom"
          />
        </td>

        {/* Photo — clickable for expand */}
        <td className="px-3 py-3 cursor-pointer" onClick={onExpandToggle}>
          {product.firstImage ? (
            <img
              src={product.firstImage}
              alt={product.name}
              className="w-10 h-10 object-cover rounded-lg border border-border"
            />
          ) : (
            <div className="w-10 h-10 bg-bg-tertiary rounded-lg flex items-center justify-center border border-border">
              <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm0 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 9V7.5a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121 7.5v9a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 21z" />
              </svg>
            </div>
          )}
        </td>

        {/* Référence */}
        <td className="px-3 py-3 cursor-pointer" onClick={onExpandToggle}>
          <span className="font-mono text-xs bg-bg-tertiary px-2 py-0.5 rounded text-text-secondary">
            {product.reference}
          </span>
        </td>

        {/* Nom + prix */}
        <td className="px-3 py-3 cursor-pointer" onClick={onExpandToggle}>
          <div className="flex items-center gap-2">
            <p className="font-medium text-text-primary text-sm">{product.name}</p>
            {hasMissingTranslations && (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold shrink-0" title={`Traductions manquantes: ${missingLocales.join(", ")}`}>
                ⓘ
              </span>
            )}
          </div>
          {!isNaN(minPrice) && (
            <p className="text-xs text-text-muted">à partir de {minPrice.toFixed(2)} €</p>
          )}
        </td>

        {/* Catégorie */}
        <td className="px-3 py-3 hidden md:table-cell cursor-pointer" onClick={onExpandToggle}>
          <span className="text-xs text-text-secondary">{product.categoryName}</span>
          {product.subCategoryName && (
            <span className="text-xs text-text-muted"> / {product.subCategoryName}</span>
          )}
        </td>

        {/* Couleurs */}
        <td className="px-3 py-3 hidden lg:table-cell cursor-pointer" onClick={onExpandToggle}>
          <div className="flex items-center gap-1 flex-wrap">
            {uniqueColors.slice(0, 6).map((c) => (
              <span
                key={c.colorId}
                title={`${c.color.name}${c.stock === 0 ? " — Rupture" : ""}`}
                className={`inline-block w-4 h-4 rounded-full border-2 ${c.stock === 0 ? "border-error opacity-50" : "border-border"}`}
                style={{ backgroundColor: c.color.hex ?? "#9CA3AF" }}
              />
            ))}
            {uniqueColors.length > 6 && (
              <span className="text-[10px] text-text-muted">+{uniqueColors.length - 6}</span>
            )}
          </div>
        </td>

        {/* Statut */}
        <td className="px-3 py-3 hidden sm:table-cell cursor-pointer" onClick={onExpandToggle}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              product.status === "ONLINE"
                ? "bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
                : "bg-[#F7F7F8] text-[#6B6B6B] border border-[#E5E5E5]"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${product.status === "ONLINE" ? "bg-[#22C55E]" : "bg-[#9CA3AF]"}`} />
              {product.status === "ONLINE" ? "En ligne" : "Hors ligne"}
            </span>
            {isOutOfStock && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]"
                title="Toutes les variantes sont en rupture de stock"
              >
                Rupture
              </span>
            )}
          </div>
        </td>

        {/* Actions */}
        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-end">
            <button
              type="button"
              onClick={onExpandToggle}
              className={`p-1.5 transition-colors rounded ${expanded ? "text-text-primary bg-bg-tertiary" : "text-text-muted hover:text-text-primary"}`}
              title={expanded ? "Réduire" : "Voir les variantes"}
            >
              <svg className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                startRefresh(async () => {
                  try {
                    await refreshProduct(product.id);
                  } catch {
                    // silently ignore
                  }
                });
              }}
              disabled={refreshing}
              className={`p-1.5 text-text-muted hover:text-text-primary transition-colors ${refreshing ? "opacity-50 cursor-wait" : ""}`}
              title="Rafraichir (remettre en Nouveaute)"
            >
              <svg className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
              </svg>
            </button>
            <Link
              href={`/admin/produits/${product.id}/modifier`}
              className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
              title="Modifier"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </Link>
          </div>
        </td>
      </tr>

      {/* ── Tiroir variantes ── */}
      {expanded && (
        <tr>
          <td colSpan={8} className="p-0">
            <div
              style={{
                background: 'linear-gradient(180deg, #EEEEF0 0%, #F5F5F6 100%)',
                borderLeft: '4px solid #1A1A1A',
                borderTop: '2px solid #D1D1D1',
                borderBottom: '2px solid #D1D1D1',
                boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.06), inset 0 -1px 4px rgba(0,0,0,0.03)',
                position: 'relative',
              }}
            >
              {/* En-tête du tiroir */}
              <div
                className="flex items-center justify-between"
                style={{
                  padding: '12px 20px',
                  borderBottom: '1px solid #DDDDE0',
                  background: 'rgba(255,255,255,0.5)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div style={{ width: 3, height: 16, borderRadius: 2, background: '#1A1A1A' }} />
                    <span className="font-[family-name:var(--font-poppins)]"
                      style={{ fontSize: '11px', fontWeight: 700, color: '#1A1A1A', textTransform: 'uppercase', letterSpacing: '0.08em' }}
                    >
                      {product.colors.length} variante{product.colors.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  {product.colors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onToggleAllVariants(variantIds, !allVariantsSelected)}
                      className="inline-flex items-center gap-1.5 font-[family-name:var(--font-roboto)] transition-all"
                      style={{
                        padding: '4px 10px',
                        fontSize: '10px',
                        fontWeight: 600,
                        borderRadius: '6px',
                        border: allVariantsSelected ? '1px solid #1A1A1A' : '1px solid #D1D1D1',
                        background: allVariantsSelected ? '#1A1A1A' : '#fff',
                        color: allVariantsSelected ? '#fff' : '#6B6B6B',
                        cursor: 'pointer',
                      }}
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
                  className="inline-flex items-center gap-1.5 font-[family-name:var(--font-roboto)] transition-colors"
                  style={{ fontSize: '11px', color: '#6B6B6B', textDecoration: 'none' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#1A1A1A'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#6B6B6B'; }}
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
                  <tr style={{ borderBottom: '1px solid #DDDDE0' }}>
                    <th style={{ width: 40, padding: '8px 8px 8px 20px' }}></th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)]" style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Couleur</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)]" style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Type</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)]" style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Prix HT</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)]" style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Stock</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)]" style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Poids</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)]" style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Remise</th>
                    <th className="px-3 py-2 text-right" style={{ fontSize: '10px' }}></th>
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
  const [discountType, setDiscountType] = useState<"PERCENT" | "AMOUNT">("PERCENT");

  const handleApply = () => {
    const numVal = parseFloat(value);
    if (isNaN(numVal) && field !== "discountClear") return;

    if (field === "stock") {
      onApply(mode === "set" ? { stock: Math.max(0, Math.round(numVal)) } : { stock: { increment: Math.round(numVal) } });
    } else if (field === "price") {
      if (mode === "set") onApply({ unitPrice: Math.max(0, numVal) });
      else onApply({ unitPrice: { increment: numVal } });
    } else if (field === "weight") {
      onApply({ weight: Math.max(0, numVal) });
    } else if (field === "discount") {
      onApply({ discountType, discountValue: Math.max(0, numVal) });
    } else if (field === "discountClear") {
      onApply({ discountType: null, discountValue: null });
    }
  };

  const barSelectClass = [
    "px-3 py-2 pr-9 min-h-[36px]",
    "text-xs font-medium font-[family-name:var(--font-roboto)] text-white",
    "bg-white/[0.12] border border-white/20 rounded-lg",
    "appearance-none cursor-pointer",
    "outline-none transition-all duration-150",
    "hover:bg-white/[0.18] hover:border-white/30",
    "focus:bg-white/[0.18] focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(255,255,255,0.1)]",
  ].join(" ");
  const barSelectArrowBg: React.CSSProperties = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='white' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    backgroundSize: '10px 10px',
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
        <span className="font-[family-name:var(--font-poppins)]"
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
        <span className="font-[family-name:var(--font-roboto)]" style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
          variante{count > 1 ? "s" : ""}
        </span>
      </div>

      <div style={{ height: 24, width: 1, background: 'rgba(255,255,255,0.15)' }} />

      {/* Field selector */}
      <select
        value={field}
        onChange={(e) => { setField(e.target.value); setValue(""); }}
        className={barSelectClass}
        style={barSelectArrowBg}
      >
        <option value="stock" className="text-[#1A1A1A] bg-white">Stock</option>
        <option value="price" className="text-[#1A1A1A] bg-white">Prix HT</option>
        <option value="weight" className="text-[#1A1A1A] bg-white">Poids</option>
        <option value="discount" className="text-[#1A1A1A] bg-white">Remise</option>
        <option value="discountClear" className="text-[#1A1A1A] bg-white">Supprimer remise</option>
      </select>

      {/* Mode (set / add) — only for stock & price */}
      {(field === "stock" || field === "price") && (
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
          <button
            type="button"
            onClick={() => setMode("set")}
            className="font-[family-name:var(--font-roboto)]"
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
            className="font-[family-name:var(--font-roboto)]"
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

      {/* Discount type selector */}
      {field === "discount" && (
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
          <button
            type="button"
            onClick={() => setDiscountType("PERCENT")}
            className="font-[family-name:var(--font-roboto)]"
            style={{
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: discountType === "PERCENT" ? '#fff' : 'transparent',
              color: discountType === "PERCENT" ? '#1A1A1A' : 'rgba(255,255,255,0.5)',
              transition: 'all 0.15s',
            }}
          >
            %
          </button>
          <button
            type="button"
            onClick={() => setDiscountType("AMOUNT")}
            className="font-[family-name:var(--font-roboto)]"
            style={{
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: discountType === "AMOUNT" ? '#fff' : 'transparent',
              color: discountType === "AMOUNT" ? '#1A1A1A' : 'rgba(255,255,255,0.5)',
              transition: 'all 0.15s',
            }}
          >
            €
          </button>
        </div>
      )}

      {/* Value input */}
      {field !== "discountClear" && (
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
        disabled={isPending || (field !== "discountClear" && !value)}
        className="flex items-center gap-1.5 font-[family-name:var(--font-roboto)]"
        style={{
          padding: '7px 16px',
          fontSize: 12,
          fontWeight: 700,
          background: '#fff',
          color: '#1A1A1A',
          border: 'none',
          borderRadius: 8,
          cursor: isPending || (field !== "discountClear" && !value) ? 'not-allowed' : 'pointer',
          opacity: isPending || (field !== "discountClear" && !value) ? 0.4 : 1,
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
        className="font-[family-name:var(--font-roboto)]"
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

// ─── Main Table ────────────────────────────────────────────────────────────────

export default function AdminProductsTable({ products, totalCount: _totalCount }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const allPageIds = products.map((p) => p.id);
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
  const handleBulkStatus = useCallback(async (status: "ONLINE" | "OFFLINE") => {
    const ids = [...selectedIds];
    setBulkMessage(null);
    startTransition(async () => {
      try {
        const result = await bulkUpdateProductStatus(ids, status);
        const msgs: string[] = [];
        if (result.success.length > 0) {
          msgs.push(`${result.success.length} produit${result.success.length > 1 ? "s" : ""} mis ${status === "ONLINE" ? "en ligne" : "hors ligne"}`);
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
      }
    });
  }, [selectedIds, startTransition]);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    setBulkMessage(null);
    startTransition(async () => {
      try {
        const result = await bulkDeleteProducts(ids);
        setBulkMessage({
          type: "success",
          text: `${result.deleted} produit${result.deleted > 1 ? "s" : ""} supprimé${result.deleted > 1 ? "s" : ""}`,
        });
        setSelectedIds(new Set());
        setConfirmDelete(false);
      } catch (e) {
        setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
        setConfirmDelete(false);
      }
    });
  }, [selectedIds, startTransition]);

  // ─── Bulk variant actions ──
  const handleBulkVariantUpdate = useCallback(async (data: Record<string, unknown>) => {
    const ids = [...selectedVariantIds];
    setBulkMessage(null);

    const hasIncrement = Object.values(data).some((v) => v && typeof v === "object" && "increment" in (v as Record<string, unknown>));

    startTransition(async () => {
      try {
        if (hasIncrement) {
          const field = Object.keys(data)[0];
          const incrementVal = (data[field] as { increment: number }).increment;
          let updated = 0;
          for (const variantId of ids) {
            try {
              const product = products.find((p) => p.colors.some((c) => c.id === variantId));
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
      }
    });
  }, [selectedVariantIds, products, startTransition]);

  if (products.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="w-12 h-12 bg-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <p className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary mb-1">Aucun produit</p>
        <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)]">Aucun résultat pour ces critères.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Barre d'actions en masse (produits) */}
      {someSelected && (
        <div className="flex items-center gap-3 bg-[#1A1A1A] text-white rounded-xl px-4 py-3 animate-fadeIn">
          <span className="text-sm font-[family-name:var(--font-roboto)] font-medium">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
          </span>
          <div className="h-4 w-px bg-white/20" />
          <button
            type="button"
            onClick={() => handleBulkStatus("ONLINE")}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#22C55E] text-white text-xs font-medium rounded-lg hover:bg-[#16A34A] disabled:opacity-50 transition-colors font-[family-name:var(--font-roboto)]"
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
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 text-white text-xs font-medium rounded-lg hover:bg-white/20 disabled:opacity-50 transition-colors font-[family-name:var(--font-roboto)]"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
            Mettre hors ligne
          </button>
          <div className="h-4 w-px bg-white/20" />
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/80 text-white text-xs font-medium rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors font-[family-name:var(--font-roboto)]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Supprimer
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-300 font-[family-name:var(--font-roboto)]">Confirmer ?</span>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={isPending}
                className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-[family-name:var(--font-roboto)]"
              >
                Oui, supprimer {selectedIds.size}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 bg-white/10 text-white text-xs rounded-lg hover:bg-white/20 transition-colors font-[family-name:var(--font-roboto)]"
              >
                Annuler
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); setConfirmDelete(false); }}
            className="ml-auto text-xs text-white/50 hover:text-white transition-colors font-[family-name:var(--font-roboto)]"
          >
            Désélectionner
          </button>
        </div>
      )}

      {/* Message résultat bulk */}
      {bulkMessage && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-[family-name:var(--font-roboto)] ${
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

      {/* Tableau */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm font-[family-name:var(--font-roboto)]">
          <thead>
            <tr className="table-header">
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="checkbox-custom"
                  title="Tout sélectionner"
                />
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Photo</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Réf.</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Nom</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider hidden md:table-cell">Catégorie</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider hidden lg:table-cell">Couleurs</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider hidden sm:table-cell">Statut</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider w-24"></th>
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
              />
            ))}
          </tbody>
        </table>
      </div>

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
