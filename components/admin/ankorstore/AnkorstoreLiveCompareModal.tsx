"use client";

import { useState, useEffect, useTransition, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/Toast";
import { applyAnkorstoreSelectivePublish } from "@/app/actions/admin/ankorstore";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface BjVariant {
  sku: string;
  colorLabel: string;
  wholesalePrice: number;
  stock: number;
  saleType: string;
}

interface AnkorsVariant {
  sku: string | null;
  wholesalePrice: number | null;
  stock: number | null;
}

interface FormattedProduct {
  name: string;
  description: string;
  wholesalePrice: number | null;
  weight: number | null;
  height: number | null;
  width: number | null;
  length: number | null;
  madeInCountry: string | null;
  variants: (BjVariant | AnkorsVariant)[];
}

interface DiffField {
  field: string;
  bjValue: unknown;
  ankorsValue: unknown;
}

interface InitialData {
  existing: FormattedProduct;
  ankorstore: FormattedProduct;
  differences: DiffField[];
  hasDifferences: boolean;
  countryName: string | null;
}

interface AnkorstoreLiveCompareModalProps {
  productId: string;
  initialData: InitialData | null;
  open: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatPrice(v: unknown): string {
  if (v == null) return "-";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return `${n.toFixed(2)} \u20AC`;
}

function formatWeight(grams: unknown): string {
  if (grams == null) return "-";
  const g = Number(grams);
  if (isNaN(g)) return String(grams);
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g} g`;
}

function formatDimension(mm: unknown): string {
  if (mm == null) return "-";
  return `${mm} mm`;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Nom",
  description: "Description",
  wholesalePrice: "Prix de gros",
  weight: "Poids",
  height: "Hauteur",
  width: "Largeur",
  length: "Longueur",
  madeInCountry: "Pays de fabrication",
};

function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  if (field.startsWith("variant_price_")) return `Prix - ${field.replace("variant_price_", "")}`;
  if (field.startsWith("variant_stock_")) return `Stock - ${field.replace("variant_stock_", "")}`;
  if (field.startsWith("variant_missing_")) return `Variante manquante - ${field.replace("variant_missing_", "")}`;
  if (field.startsWith("variant_extra_")) return `Variante en trop - ${field.replace("variant_extra_", "")}`;
  return field;
}

function formatValue(field: string, value: unknown): string {
  if (value == null) return "-";
  if (field === "wholesalePrice" || field.startsWith("variant_price_")) return formatPrice(value);
  if (field === "weight") return formatWeight(value);
  if (field === "height" || field === "width" || field === "length") return formatDimension(value);
  if (field.startsWith("variant_stock_")) return String(value);
  if (field.startsWith("variant_missing_") || field.startsWith("variant_extra_")) {
    if (typeof value === "object" && value !== null) {
      const v = value as Record<string, unknown>;
      const parts: string[] = [];
      if (v.sku) parts.push(`SKU: ${v.sku}`);
      if (v.colorLabel) parts.push(`Couleur: ${v.colorLabel}`);
      if (v.wholesalePrice != null) parts.push(`Prix: ${formatPrice(v.wholesalePrice)}`);
      if (v.stock != null) parts.push(`Stock: ${v.stock}`);
      return parts.join(", ");
    }
  }
  return String(value);
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function CompareRow({
  label,
  bjValue,
  ankorsValue,
  hasDiff,
  checked,
  onToggle,
  isDescription,
}: {
  label: string;
  bjValue: string;
  ankorsValue: string;
  hasDiff: boolean;
  checked: boolean;
  onToggle: () => void;
  isDescription?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="pt-0.5 shrink-0">
        {hasDiff && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wide">{label}</p>
        <div className="grid grid-cols-2 gap-3">
          <div
            className={`p-3 rounded-lg ${
              hasDiff
                ? "bg-blue-50 border border-blue-200"
                : "bg-emerald-50 border border-emerald-200"
            }`}
          >
            <p className="text-xs text-text-muted mb-1">Boutique</p>
            {isDescription ? (
              <p className="text-sm whitespace-pre-wrap max-h-32 overflow-y-auto">{bjValue}</p>
            ) : (
              <p className="text-sm font-medium">{bjValue}</p>
            )}
          </div>
          <div
            className={`p-3 rounded-lg ${
              hasDiff
                ? "bg-amber-50 border border-amber-200"
                : "bg-emerald-50 border border-emerald-200"
            }`}
          >
            <p className="text-xs text-text-muted mb-1">Ankorstore</p>
            {isDescription ? (
              <p className="text-sm whitespace-pre-wrap max-h-32 overflow-y-auto">{ankorsValue}</p>
            ) : (
              <p className="text-sm font-medium">{ankorsValue}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide border-b border-border pb-2 mb-3">
      {children}
    </h3>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function AnkorstoreLiveCompareModal({
  productId,
  initialData,
  open,
  onClose,
}: AnkorstoreLiveCompareModalProps) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [checkedFields, setCheckedFields] = useState<Set<string>>(new Set());

  // Initialize checked fields from differences
  useEffect(() => {
    if (initialData?.differences) {
      setCheckedFields(new Set(initialData.differences.map((d) => d.field)));
    }
  }, [initialData]);

  // ESC key handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const toggleField = useCallback((field: string) => {
    setCheckedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!initialData) return;
    const allFields = initialData.differences.map((d) => d.field);
    setCheckedFields((prev) => {
      if (prev.size === allFields.length) return new Set();
      return new Set(allFields);
    });
  }, [initialData]);

  // Group differences by category
  const grouped = useMemo(() => {
    if (!initialData) return null;
    const { differences } = initialData;

    const general = differences.filter((d) => d.field === "name" || d.field === "description");
    const pricing = differences.filter((d) => d.field === "wholesalePrice");
    const specs = differences.filter((d) =>
      ["weight", "height", "width", "length", "madeInCountry"].includes(d.field)
    );
    const variants = differences.filter((d) => d.field.startsWith("variant_"));

    return { general, pricing, specs, variants };
  }, [initialData]);

  const handlePublish = useCallback(() => {
    if (!initialData || checkedFields.size === 0) return;

    const allFields = initialData.differences.map((d) => d.field);
    const selectedKeys =
      checkedFields.size === allFields.length
        ? ["all"]
        : Array.from(checkedFields);

    startTransition(async () => {
      try {
        const result = await applyAnkorstoreSelectivePublish(productId, selectedKeys);
        if (result.success) {
          toast.success("Modifications publiees sur Ankorstore");
          onClose();
        } else {
          toast.error(result.error ?? "Erreur lors de la publication");
        }
      } catch {
        toast.error("Erreur inattendue lors de la publication");
      }
    });
  }, [initialData, checkedFields, productId, toast, onClose]);

  if (!open) return null;

  const allChecked =
    initialData != null && checkedFields.size === initialData.differences.length;

  const content = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-primary rounded-2xl shadow-lg max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-heading text-lg font-semibold text-text-primary">
              Comparaison Ankorstore
            </h2>
            {initialData && (
              <p className="text-sm text-text-muted mt-0.5">
                {initialData.differences.length} difference{initialData.differences.length !== 1 ? "s" : ""} detectee{initialData.differences.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {initialData && initialData.differences.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                {allChecked ? "Tout deselectionner" : "Tout selectionner"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition-colors p-1"
              aria-label="Fermer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!initialData ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-text-muted">Chargement...</p>
            </div>
          ) : !initialData.hasDifferences ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <p className="text-text-primary font-medium">Tout est synchronise</p>
              <p className="text-sm text-text-muted">Aucune difference detectee entre la boutique et Ankorstore.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* General info */}
              {grouped!.general.length > 0 && (
                <section>
                  <SectionTitle>Informations generales</SectionTitle>
                  <div className="space-y-1">
                    {grouped!.general.map((d) => (
                      <CompareRow
                        key={d.field}
                        label={fieldLabel(d.field)}
                        bjValue={formatValue(d.field, d.bjValue)}
                        ankorsValue={formatValue(d.field, d.ankorsValue)}
                        hasDiff
                        checked={checkedFields.has(d.field)}
                        onToggle={() => toggleField(d.field)}
                        isDescription={d.field === "description"}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Pricing */}
              {grouped!.pricing.length > 0 && (
                <section>
                  <SectionTitle>Tarification</SectionTitle>
                  <div className="space-y-1">
                    {grouped!.pricing.map((d) => (
                      <CompareRow
                        key={d.field}
                        label={fieldLabel(d.field)}
                        bjValue={formatValue(d.field, d.bjValue)}
                        ankorsValue={formatValue(d.field, d.ankorsValue)}
                        hasDiff
                        checked={checkedFields.has(d.field)}
                        onToggle={() => toggleField(d.field)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Specs */}
              {grouped!.specs.length > 0 && (
                <section>
                  <SectionTitle>Specifications</SectionTitle>
                  <div className="space-y-1">
                    {grouped!.specs.map((d) => {
                      let bjDisplay = formatValue(d.field, d.bjValue);
                      let ankorsDisplay = formatValue(d.field, d.ankorsValue);
                      if (d.field === "madeInCountry" && initialData.countryName) {
                        bjDisplay = `${d.bjValue} (${initialData.countryName})`;
                      }
                      if (d.field === "madeInCountry" && d.ankorsValue) {
                        ankorsDisplay = String(d.ankorsValue);
                      }
                      return (
                        <CompareRow
                          key={d.field}
                          label={fieldLabel(d.field)}
                          bjValue={bjDisplay}
                          ankorsValue={ankorsDisplay}
                          hasDiff
                          checked={checkedFields.has(d.field)}
                          onToggle={() => toggleField(d.field)}
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Variants */}
              {grouped!.variants.length > 0 && (
                <section>
                  <SectionTitle>Variantes</SectionTitle>
                  <div className="space-y-1">
                    {grouped!.variants.map((d) => {
                      const isMissing = d.field.startsWith("variant_missing_");
                      const isExtra = d.field.startsWith("variant_extra_");

                      if (isMissing || isExtra) {
                        const present = isMissing ? d.bjValue : d.ankorsValue;
                        return (
                          <div key={d.field} className="flex items-start gap-3 py-3">
                            <div className="pt-0.5 shrink-0">
                              <input
                                type="checkbox"
                                checked={checkedFields.has(d.field)}
                                onChange={() => toggleField(d.field)}
                                className="h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wide">
                                {fieldLabel(d.field)}
                              </p>
                              <div className="grid grid-cols-2 gap-3">
                                <div
                                  className={`p-3 rounded-lg ${
                                    isMissing
                                      ? "bg-blue-50 border border-blue-200"
                                      : "bg-red-50 border border-red-200"
                                  }`}
                                >
                                  <p className="text-xs text-text-muted mb-1">Boutique</p>
                                  <p className="text-sm font-medium">
                                    {isMissing ? formatValue(d.field, present) : "Absente"}
                                  </p>
                                </div>
                                <div
                                  className={`p-3 rounded-lg ${
                                    isExtra
                                      ? "bg-amber-50 border border-amber-200"
                                      : "bg-red-50 border border-red-200"
                                  }`}
                                >
                                  <p className="text-xs text-text-muted mb-1">Ankorstore</p>
                                  <p className="text-sm font-medium">
                                    {isExtra ? formatValue(d.field, present) : "Absente"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <CompareRow
                          key={d.field}
                          label={fieldLabel(d.field)}
                          bjValue={formatValue(d.field, d.bjValue)}
                          ankorsValue={formatValue(d.field, d.ankorsValue)}
                          hasDiff
                          checked={checkedFields.has(d.field)}
                          onToggle={() => toggleField(d.field)}
                        />
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {initialData && initialData.hasDifferences && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 bg-bg-primary rounded-b-2xl">
            <p className="text-sm text-text-muted">
              {checkedFields.size} champ{checkedFields.size !== 1 ? "s" : ""} selectionne{checkedFields.size !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={isPending || checkedFields.size === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending
                  ? "Publication..."
                  : `Publier ${checkedFields.size} champ${checkedFields.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
