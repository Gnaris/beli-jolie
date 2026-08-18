"use client";

import { useState, useCallback } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

/**
 * Bouton « Exporter stock faible » — ouvre une modale de confirmation puis
 * télécharge un PDF listant les produits dont au moins une variante a un
 * stock nul ou < 10 (une page par produit).
 */
export default function LowStockPdfButton() {
  const { confirm } = useConfirm();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    const ok = await confirm({
      type: "info",
      title: "Exporter les produits en stock faible",
      message:
        "Générer un PDF listant tous les produits dont au moins une couleur est en rupture (0) ou presque en rupture (moins de 10). Une page par produit avec photos et couleurs concernées.",
      confirmLabel: "Télécharger le PDF",
      cancelLabel:  "Annuler",
    });
    if (ok !== true) return;

    setLoading(true);
    try {
      const res = await fetch("/api/admin/products/low-stock-pdf", { method: "GET" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `stock-faible-${stamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("PDF téléchargé");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue.";
      toast.error("Échec de la génération du PDF", msg);
    } finally {
      setLoading(false);
    }
  }, [confirm, toast]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-body font-medium transition-all w-full md:w-auto shadow-sm ${
        loading
          ? "bg-bg-tertiary text-text-muted cursor-wait"
          : "bg-rose-600 text-white hover:bg-rose-700"
      }`}
      title="Exporter en PDF les produits dont une couleur est en rupture ou presque en rupture"
    >
      {loading ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M4 6h16M6 6l1.5 14a2 2 0 002 2h5a2 2 0 002-2L18 6" />
        </svg>
      )}
      <span className="hidden sm:inline">
        {loading ? "Génération…" : "Stock faible"}
      </span>
      <span className="sm:hidden">
        {loading ? "…" : "Stock"}
      </span>
    </button>
  );
}
