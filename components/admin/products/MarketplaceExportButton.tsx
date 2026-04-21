"use client";

import { useState } from "react";
import JSZip from "jszip";
import { useToast } from "@/components/ui/Toast";

interface Props {
  productIds: string[];
  disabled?: boolean;
}

interface ExportWarning {
  marketplace: string;
  reference: string;
  message: string;
}

export default function MarketplaceExportButton({ productIds, disabled }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [pfs, setPfs] = useState(true);
  const [ankor, setAnkor] = useState(true);
  const [loading, setLoading] = useState(false);
  const [blockedWarnings, setBlockedWarnings] = useState<ExportWarning[] | null>(null);
  const toast = useToast();

  async function handleExport() {
    if (!pfs && !ankor) {
      toast.error("Sélectionner au moins un marketplace");
      return;
    }
    setBlockedWarnings(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/marketplace-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, includePfs: pfs, includeAnkorstore: ankor }),
      });

      // Warning-blocked export — show the list, no download.
      if (res.status === 422) {
        const payload = (await res.json().catch(() => ({}))) as {
          warnings?: ExportWarning[];
          error?: string;
        };
        const list = Array.isArray(payload.warnings) ? payload.warnings : [];
        setBlockedWarnings(list);
        toast.error(
          "Export bloqué",
          `${list.length} avertissement${list.length > 1 ? "s" : ""} à corriger avant export`,
        );
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erreur" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const warningCount = Number(res.headers.get("X-Export-Warnings") ?? 0);
      const productCount = Number(res.headers.get("X-Export-Products") ?? 0);
      const arrayBuffer = await res.arrayBuffer();

      // Unpack server-side bundle and trigger one download per inner file so
      // the admin doesn't have to extract a ZIP. The browser shows a
      // "Download multiple files?" prompt on the first run — expected.
      const zip = await JSZip.loadAsync(arrayBuffer);
      const entries = Object.values(zip.files).filter((f) => !f.dir);

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const blob = await entry.async("blob");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        // Strip "excel/" prefix so files land directly in Downloads.
        a.download = entry.name.replace(/^excel\//, "");
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Give the browser a moment between clicks — Chrome otherwise
        // collapses rapid successive downloads into a single file prompt.
        if (i < entries.length - 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }

      void warningCount;
      toast.success(`Export généré (${productCount} produit${productCount > 1 ? "s" : ""})`);
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
    <>
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

      {blockedWarnings && blockedWarnings.length > 0 && (
        <WarningsPanel
          warnings={blockedWarnings}
          onClose={() => setBlockedWarnings(null)}
        />
      )}
    </>
  );
}

function WarningsPanel({
  warnings,
  onClose,
}: {
  warnings: ExportWarning[];
  onClose: () => void;
}) {
  // Group by marketplace for readability.
  const grouped = warnings.reduce<Record<string, ExportWarning[]>>((acc, w) => {
    (acc[w.marketplace] ??= []).push(w);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-bg-primary border border-border rounded-2xl shadow-card-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <svg className="w-5 h-5 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-semibold font-body text-text-primary">
              Export bloqué — {warnings.length} avertissement{warnings.length > 1 ? "s" : ""} à corriger
            </h3>
            <p className="text-[11px] text-text-muted font-body mt-0.5">
              Corrigez chaque point ci-dessous puis relancez l&apos;export.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {Object.entries(grouped).map(([marketplace, items]) => (
            <div key={marketplace}>
              <p className="text-[11px] uppercase tracking-wide font-semibold text-text-muted font-body mb-2">
                {marketplace} ({items.length})
              </p>
              <ul className="space-y-1.5">
                {items.map((w, i) => (
                  <li
                    key={`${w.marketplace}-${w.reference}-${i}`}
                    className="text-xs font-body text-text-primary bg-bg-secondary border border-border rounded-lg px-3 py-2"
                  >
                    <span className="font-mono font-semibold">{w.reference}</span>
                    <span className="text-text-secondary"> — {w.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#8B5CF6] text-white text-xs font-medium rounded-lg hover:bg-[#7C3AED] transition-colors font-body"
          >
            Compris
          </button>
        </div>
      </div>
    </div>
  );
}
