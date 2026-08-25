"use client";
import { ProductFormHeaderProvider, ProductFormHeaderState, useProductFormHeader } from "./ProductFormHeaderContext";
import { useToast } from "@/components/ui/Toast";

function StatusToggle({ mode }: { mode: "create" | "edit" }) {
  const { productStatus, statusToggle } = useProductFormHeader();
  const toast = useToast();
  const isOnline = productStatus === "ONLINE";

  const goOnline = () => {
    if (isOnline || !statusToggle) return;
    const errors = statusToggle.getCompletenessErrors();
    if (errors.length > 0) {
      const preview = errors.slice(0, 3).join(" · ");
      const suffix = errors.length > 3 ? ` (+${errors.length - 3} autre${errors.length - 3 > 1 ? "s" : ""})` : "";
      toast.error("Produit incomplet", `Impossible de mettre en ligne : ${preview}${suffix}`);
      return;
    }
    if (statusToggle.isOutOfStock()) {
      toast.error("Rupture de stock", "Toutes les variantes sont en rupture — impossible de mettre en ligne.");
      return;
    }
    statusToggle.setOnlineErrors([]);
    statusToggle.setError("");
    statusToggle.setProductStatus("ONLINE");
  };

  const goOffline = () => {
    if (!isOnline || !statusToggle) return;
    statusToggle.setProductStatus("OFFLINE");
    statusToggle.setOnlineErrors([]);
    statusToggle.setError("");
  };

  return (
    <div
      className="inline-flex items-center bg-bg-tertiary rounded-full p-0.5 gap-0.5"
      role="group"
      aria-label="Statut du produit"
    >
      <button
        type="button"
        onClick={goOnline}
        title={mode === "create" ? "Mettre en ligne" : "Passer en ligne"}
        className={`px-3 py-1 rounded-full text-[11.5px] font-semibold font-body transition-all whitespace-nowrap ${
          isOnline
            ? "bg-white text-[#15803D] shadow-sm"
            : "text-text-muted hover:text-text-primary"
        }`}
      >
        En ligne
      </button>
      <button
        type="button"
        onClick={goOffline}
        title="Passer hors ligne"
        className={`px-3 py-1 rounded-full text-[11.5px] font-semibold font-body transition-all whitespace-nowrap ${
          !isOnline
            ? "bg-white text-text-primary shadow-sm"
            : "text-text-muted hover:text-text-primary"
        }`}
      >
        Hors ligne
      </button>
    </div>
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
        </div>
        {children}
      </div>
    </ProductFormHeaderProvider>
  );
}
