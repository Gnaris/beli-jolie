"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

interface Props {
  productIds: string[];
  disabled?: boolean;
}

export default function MarketplaceExportButton({ productIds, disabled }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [pfs, setPfs] = useState(true);
  const [ankor, setAnkor] = useState(true);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function handleExport() {
    if (!pfs && !ankor) {
      toast.error("Sélectionner au moins un marketplace");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/marketplace-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, includePfs: pfs, includeAnkorstore: ankor }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erreur" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const warningCount = Number(res.headers.get("X-Export-Warnings") ?? 0);
      const productCount = Number(res.headers.get("X-Export-Products") ?? 0);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "export-marketplace.zip";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (warningCount > 0) {
        toast.warning(
          `Export généré (${productCount} produit${productCount > 1 ? "s" : ""})`,
          `${warningCount} avertissement${warningCount > 1 ? "s" : ""} — voir AVERTISSEMENTS.txt`
        );
      } else {
        toast.success(`Export généré (${productCount} produit${productCount > 1 ? "s" : ""})`);
      }
      setExpanded(false);
    } catch (err) {
      toast.error("Erreur export", err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#8B5CF6]/80 text-white text-xs font-medium rounded-lg hover:bg-[#7C3AED] disabled:opacity-50 transition-colors font-body"
        title="Générer un ZIP Excel + images pour upload manuel"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Exporter Marketplaces
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-primary/10 rounded-lg">
      <label className="flex items-center gap-1.5 text-xs text-text-inverse font-body cursor-pointer">
        <input
          type="checkbox"
          checked={pfs}
          onChange={(e) => setPfs(e.target.checked)}
          className="checkbox-custom checkbox-sm"
        />
        PFS
      </label>
      <label className="flex items-center gap-1.5 text-xs text-text-inverse font-body cursor-pointer">
        <input
          type="checkbox"
          checked={ankor}
          onChange={(e) => setAnkor(e.target.checked)}
          className="checkbox-custom checkbox-sm"
        />
        Ankorstore
      </label>
      <button
        type="button"
        onClick={handleExport}
        disabled={loading}
        className="px-3 py-1 bg-[#8B5CF6] text-white text-xs font-medium rounded-lg hover:bg-[#7C3AED] disabled:opacity-50 transition-colors font-body"
      >
        {loading ? "Génération…" : "Télécharger"}
      </button>
      <button
        type="button"
        onClick={() => setExpanded(false)}
        disabled={loading}
        className="px-2 py-1 text-text-inverse/60 hover:text-text-inverse text-xs font-body"
      >
        Annuler
      </button>
    </div>
  );
}
