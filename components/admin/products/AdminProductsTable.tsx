"use client";

import React, { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import {
  bulkUpdateProductStatus,
  bulkDeleteProducts,
  updateVariantQuick,
  bulkUpdateVariants,
  refreshProduct,
} from "@/app/actions/admin/products";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";

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
  color: { name: string; hex: string | null; patternImage?: string | null };
  subColors?: { color: { name: string; hex: string | null; patternImage?: string | null } }[];
}

interface ProductTranslation {
  locale: string;
}

interface AdminProduct {
  id: string;
  reference: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED";
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
              const subs = variant.subColors?.filter(sc => sc.color.hex || sc.color.patternImage) ?? [];
              const fullName = subs.length > 0
                ? [variant.color.name, ...subs.map(sc => sc.color.name)].join("/")
                : variant.color.name;
              let swatchStyle: React.CSSProperties;
              if (variant.color.patternImage) {
                swatchStyle = { backgroundImage: `url(${variant.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" };
              } else if (subs.length > 0) {
                const allHexes = [mainHex, ...subs.map(sc => sc.color.hex ?? "#9CA3AF")];
                const seg = 360 / allHexes.length;
                const stops = allHexes.map((hex, i) => `${hex} ${i * seg}deg ${(i + 1) * seg}deg`).join(", ");
                swatchStyle = { background: `conic-gradient(${stops})` };
              } else {
                swatchStyle = { backgroundColor: mainHex };
              }
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
                  <span className="text-xs font-medium font-[family-name:var(--font-roboto)] text-text-primary">
                    {fullName}
                  </span>
                </>
              );
            })()}
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
        <td className="px-3 py-2.5 text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-primary">
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
        <td className="px-3 py-2.5 text-xs font-[family-name:var(--font-roboto)] text-text-secondary">
          {variant.weight} kg
        </td>
        <td className="px-3 py-2.5 text-xs font-[family-name:var(--font-roboto)]">
          {variant.discountType && variant.discountValue
            ? (
              <span style={{ color: '#15803D', fontWeight: 500, background: '#F0FDF4', padding: '2px 8px', borderRadius: '4px', border: '1px solid #BBF7D0' }}>
                {variant.discountType === "PERCENT" ? `-${variant.discountValue}%` : `-${variant.discountValue}€`}
              </span>
            )
            : <span className="text-text-muted">—</span>
          }
        </td>
        <td className="px-3 py-2.5 text-right">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium font-[family-name:var(--font-roboto)] transition-all px-2.5 py-1 bg-bg-primary text-text-secondary border border-border-dark rounded-md shadow-sm hover:border-text-primary hover:text-text-primary"
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
  // Use variant-input CSS class for dark mode support
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
            <span className="text-xs font-medium font-[family-name:var(--font-roboto)] text-text-primary">
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
            <input type="text" value={size} onChange={(e) => setSize(e.target.value)} placeholder="Taille" className={`${inputClass} !w-16`} />
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
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <CustomSelect
              value={discountType}
              onChange={(v) => setDiscountType(v)}
              options={[
                { value: "", label: "—" },
                { value: "PERCENT", label: "%" },
                { value: "AMOUNT", label: "€" },
              ]}
              size="sm"
              className="w-[74px]"
            />
            {discountType && (
              <input type="number" step="0.01" min={0} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} className={`${inputClass} !w-14`} />
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex items-center gap-1.5 justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`inline-flex items-center gap-1 font-[family-name:var(--font-roboto)] transition-colors px-3 py-1.5 text-[11px] font-semibold bg-bg-dark text-text-inverse rounded-md border-none ${saving ? "cursor-wait opacity-60" : "cursor-pointer"}`}
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
              className="font-[family-name:var(--font-roboto)] transition-colors px-2.5 py-1.5 text-[11px] text-text-secondary bg-transparent border-none rounded-md cursor-pointer hover:bg-bg-primary hover:text-text-primary"
            >
              Annuler
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr className="bg-[#FEF2F2]">
          <td colSpan={8} className="px-5 py-2 text-xs font-[family-name:var(--font-roboto)] text-error">
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
  const { confirm } = useConfirm();

  const uniqueColors = [...new Map(product.colors.map((c) => [c.colorId, c])).values()];
  const minPrice = product.colors.length > 0
    ? Math.min(...product.colors.map((c) => c.unitPrice))
    : NaN;

  // Stock status
  const isFullyOutOfStock = product.colors.length > 0 && product.colors.every((c) => c.stock === 0);
  const hasPartialOutOfStock = !isFullyOutOfStock && product.colors.some((c) => c.stock === 0);

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
          <div className="flex items-center gap-1.5 flex-wrap">
            {uniqueColors.slice(0, 6).map((c) => {
              const mainHex = c.color.hex ?? "#9CA3AF";
              const subs = c.subColors?.filter(sc => sc.color.hex) ?? [];
              const fullName = subs.length > 0
                ? [c.color.name, ...subs.map(sc => sc.color.name)].join("/")
                : c.color.name;
              let swatchStyle: React.CSSProperties;
              if (c.color.patternImage) {
                swatchStyle = { backgroundImage: `url(${c.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" };
              } else if (subs.length > 0) {
                const allHexes = [mainHex, ...subs.map(sc => sc.color.hex ?? "#9CA3AF")];
                const seg = 360 / allHexes.length;
                const stops = allHexes.map((hex, i) => `${hex} ${i * seg}deg ${(i + 1) * seg}deg`).join(", ");
                swatchStyle = { background: `conic-gradient(${stops})` };
              } else {
                swatchStyle = { backgroundColor: mainHex };
              }
              const isOos = c.stock === 0;
              return (
                <span
                  key={c.colorId}
                  title={`${fullName}${isOos ? " — Rupture" : ""}`}
                  className="inline-block w-5 h-5 rounded-full relative shrink-0"
                  style={swatchStyle}
                >
                  {isOos && (
                    <span className="absolute inset-[-2px] rounded-full border-[2.5px] border-[#EF4444] pointer-events-none" />
                  )}
                </span>
              );
            })}
            {uniqueColors.length > 6 && (
              <span className="text-[10px] text-text-muted font-semibold">+{uniqueColors.length - 6}</span>
            )}
          </div>
        </td>

        {/* Statut */}
        <td className="px-3 py-3 hidden sm:table-cell cursor-pointer" onClick={onExpandToggle}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              product.status === "ONLINE"
                ? "bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
                : product.status === "ARCHIVED"
                ? "bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]"
                : "bg-[#F7F7F8] text-[#6B6B6B] border border-[#E5E5E5]"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                product.status === "ONLINE" ? "bg-[#22C55E]" : product.status === "ARCHIVED" ? "bg-[#F59E0B]" : "bg-[#9CA3AF]"
              }`} />
              {product.status === "ONLINE" ? "En ligne" : product.status === "ARCHIVED" ? "Archivé" : "Hors ligne"}
            </span>
            {isFullyOutOfStock && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]"
                title="Toutes les variantes sont en rupture de stock"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                Rupture
              </span>
            )}
            {hasPartialOutOfStock && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]"
                title="Certaines variantes sont en rupture de stock"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
                Rupture variantes
              </span>
            )}
          </div>
        </td>

        {/* Actions */}
        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-end">
            <Link
              href={`/produits/${product.id}`}
              target="_blank"
              className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
              title="Voir côté client"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
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
              onClick={async () => {
                const ok = await confirm({
                  type: "warning",
                  title: "Rafraîchir ce produit ?",
                  message: "Le produit sera remis en \"Nouveauté\" avec la date du jour.",
                  confirmLabel: "Rafraîchir",
                });
                if (!ok) return;
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
              title="Rafraîchir (remettre en Nouveauté)"
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
            <div className="drawer-variant-container" style={{ position: 'relative' }}>
              {/* En-tête du tiroir */}
              <div
                className="flex items-center justify-between drawer-variant-header"
                style={{ padding: '12px 20px' }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-[3px] h-4 rounded-sm bg-bg-dark" />
                    <span className="font-[family-name:var(--font-poppins)] text-[11px] font-bold text-text-primary uppercase tracking-wider"
                    >
                      {product.colors.length} variante{product.colors.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  {product.colors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onToggleAllVariants(variantIds, !allVariantsSelected)}
                      className={`inline-flex items-center gap-1.5 font-[family-name:var(--font-roboto)] transition-all px-2.5 py-1 text-[10px] font-semibold rounded-md border cursor-pointer ${
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
                  className="inline-flex items-center gap-1.5 font-[family-name:var(--font-roboto)] transition-colors text-[11px] text-text-secondary hover:text-text-primary no-underline"
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
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)] text-[10px] font-bold text-text-muted uppercase tracking-wider">Couleur</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)] text-[10px] font-bold text-text-muted uppercase tracking-wider">Type</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)] text-[10px] font-bold text-text-muted uppercase tracking-wider">Prix HT</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)] text-[10px] font-bold text-text-muted uppercase tracking-wider">Stock</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)] text-[10px] font-bold text-text-muted uppercase tracking-wider">Poids</th>
                    <th className="px-3 py-2 text-left font-[family-name:var(--font-roboto)] text-[10px] font-bold text-text-muted uppercase tracking-wider">Remise</th>
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
  { value: "discount", label: "Remise", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z" },
  { value: "discountClear", label: "Supprimer remise", icon: "M6 18L18 6M6 6l12 12" },
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
  const [discountType, setDiscountType] = useState<"PERCENT" | "AMOUNT">("PERCENT");
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);

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

      {/* Field selector — custom dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setFieldMenuOpen(!fieldMenuOpen)}
          className="font-[family-name:var(--font-roboto)]"
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
                    className="font-[family-name:var(--font-roboto)]"
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
  const handleBulkStatus = useCallback(async (status: "ONLINE" | "OFFLINE" | "ARCHIVED") => {
    const ids = [...selectedIds];
    setBulkMessage(null);
    startTransition(async () => {
      try {
        const result = await bulkUpdateProductStatus(ids, status);
        const msgs: string[] = [];
        if (result.success.length > 0) {
          const label = status === "ONLINE" ? "mis en ligne" : status === "ARCHIVED" ? "archivé(s)" : "mis hors ligne";
          msgs.push(`${result.success.length} produit${result.success.length > 1 ? "s" : ""} ${label}`);
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
        const msgs: string[] = [];
        if (result.deleted > 0) {
          msgs.push(`${result.deleted} produit${result.deleted > 1 ? "s" : ""} supprimé${result.deleted > 1 ? "s" : ""}`);
        }
        if (result.protected.length > 0) {
          const refs = result.protected.map((p) => p.reference).join(", ");
          msgs.push(`${result.protected.length} protégé(s) (commandes existantes) : ${refs} — utilisez l'archivage`);
        }
        setBulkMessage({
          type: result.protected.length > 0 ? "error" : "success",
          text: msgs.join(" — "),
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
          <button
            type="button"
            onClick={() => handleBulkStatus("ARCHIVED")}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F59E0B]/80 text-white text-xs font-medium rounded-lg hover:bg-[#D97706] disabled:opacity-50 transition-colors font-[family-name:var(--font-roboto)]"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            Archiver
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
