"use client";
import { ProductFormHeaderProvider, ProductFormHeaderState, useProductFormHeader } from "./ProductFormHeaderContext";

function StatusToggle({ mode }: { mode: "create" | "edit" }) {
  const { productStatus, isIncomplete, statusToggle } = useProductFormHeader();
  const isOnline = productStatus === "ONLINE";
  const hasErrors = isIncomplete;

  const handleToggle = () => {
    if (!statusToggle) return;
    if (isOnline) {
      // Going offline — no validation needed
      statusToggle.setProductStatus("OFFLINE");
      statusToggle.setOnlineErrors([]);
      statusToggle.setError("");
    } else {
      // Going online — validate
      const errors = statusToggle.getCompletenessErrors();
      if (errors.length > 0) {
        statusToggle.setOnlineErrors(errors);
        statusToggle.setError("Ce produit ne peut pas être mis en ligne. Corrigez les erreurs ci-dessus.");
        return;
      }
      if (statusToggle.isOutOfStock()) {
        statusToggle.setOnlineErrors(["Toutes les variantes sont en rupture de stock"]);
        statusToggle.setError("Ce produit ne peut pas être mis en ligne car aucune variante n'a de stock.");
        return;
      }
      statusToggle.setOnlineErrors([]);
      statusToggle.setError("");
      statusToggle.setProductStatus("ONLINE");
    }
  };

  // Disabled when trying to go online but form is incomplete (only in create mode label differs)
  const disabled = !statusToggle || (!isOnline && hasErrors && !statusToggle);

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="flex items-center gap-3 group"
      title={isOnline
        ? (mode === "edit" ? "Passer hors ligne" : "Mettre hors ligne")
        : (mode === "edit" ? "Passer en ligne" : "Mettre en ligne")
      }
    >
      {/* Toggle track */}
      <div className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
        isOnline ? "bg-[#22C55E]" : "bg-[#D1D5DB]"
      }`}>
        {/* Toggle knob */}
        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${
          isOnline ? "translate-x-5" : "translate-x-0"
        }`} />
      </div>
      {/* Label */}
      <span className={`text-sm font-semibold font-body whitespace-nowrap ${
        isOnline ? "text-[#15803D]" : "text-text-secondary"
      }`}>
        {mode === "create"
          ? (isOnline ? "Mettre en ligne" : "Hors ligne")
          : (isOnline ? "En ligne" : "Hors ligne")
        }
      </span>
    </button>
  );
}

function HeaderBadges() {
  const { productStatus, isIncomplete, stockState } = useProductFormHeader();

  return (
    <>
      {productStatus !== "ONLINE" && isIncomplete && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-body bg-[#F3E8FF] text-[#7C3AED] border border-[#DDD6FE]">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
          </svg>
          Brouillon
        </span>
      )}
      {stockState === "all_out" && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-body bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
          Rupture de stock
        </span>
      )}
      {stockState === "partial_out" && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-body bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#EA580C]" />
          Rupture de variant
        </span>
      )}
    </>
  );
}

export { StatusToggle };

export function ProductEditWrapper({
  staticHeader,
  initial,
  children,
}: {
  staticHeader: React.ReactNode;
  initial: ProductFormHeaderState;
  children: React.ReactNode;
}) {
  return (
    <ProductFormHeaderProvider initial={initial}>
      <div className="max-w-[1600px] mx-auto space-y-8">
        <div className="z-20 bg-bg-secondary border-b border-border -mx-6 px-6 pt-3 pb-4">
          {staticHeader}
          <div className="flex items-center justify-between gap-3 flex-wrap mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-3">
              <h2 className="font-heading text-lg font-bold text-text-primary">
                Informations du produit
              </h2>
              <div className="flex items-center gap-2">
                <HeaderBadges />
              </div>
            </div>
            <StatusToggle mode="edit" />
          </div>
        </div>
        {children}
      </div>
    </ProductFormHeaderProvider>
  );
}
