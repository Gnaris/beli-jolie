"use client";

import { useState, useTransition } from "react";
import {
  runAnkorstoreAutoMatch,
  confirmAnkorstoreMatch,
} from "@/app/actions/admin/ankorstore";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { MatchReport, MatchResult } from "@/lib/ankorstore-match";

type StatusFilter = "all" | "matched" | "ambiguous" | "unmatched";

export default function AnkorstoreMatchingClient() {
  const [report, setReport] = useState<MatchReport | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [isMatching, startMatching] = useTransition();
  const [linking, setLinking] = useState<string | null>(null);
  const toast = useToast();
  const { confirm } = useConfirm();

  function handleAutoMatch() {
    startMatching(async () => {
      try {
        const r = await runAnkorstoreAutoMatch();
        setReport(r);
        setHidden(new Set());
        toast.success(
          "Matching terminé",
          `${r.matched} match${r.matched > 1 ? "s" : ""} sur ${r.total} produit${r.total > 1 ? "s" : ""} Ankorstore`,
        );
      } catch (err) {
        toast.error("Échec du matching automatique", err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function handleLink(result: MatchResult) {
    if (result.bjProductIds.length !== 1) return;
    const localProductId = result.bjProductIds[0];
    setLinking(result.ankorstoreProduct.id);
    try {
      const variantMatches = result.variantMatches
        .filter((vm) => vm.bjColorId !== null)
        .map((vm) => ({
          localColorId: vm.bjColorId as string,
          ankorstoreVariantId: vm.ankorstoreVariant.id,
        }));
      const res = await confirmAnkorstoreMatch(
        localProductId,
        result.ankorstoreProduct.id,
        variantMatches,
      );
      if (res.success) {
        setHidden((prev) => new Set(prev).add(result.ankorstoreProduct.id));
        toast.success(`« ${result.ankorstoreProduct.name} » lié`);
      } else {
        toast.error("Échec", res.error ?? "Erreur inconnue");
      }
    } catch (err) {
      toast.error("Échec", err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(null);
    }
  }

  async function handleLinkAll() {
    if (!report) return;
    const candidates = report.results.filter(
      (r) => r.status === "matched" && !hidden.has(r.ankorstoreProduct.id),
    );
    if (candidates.length === 0) return;

    const ok = await confirm({
      type: "warning",
      title: "Tout lier ?",
      message: `${candidates.length} produit${candidates.length > 1 ? "s seront liés" : " sera lié"} à Ankorstore. Vous ne pourrez pas annuler en masse.`,
      confirmLabel: "Tout lier",
    });
    if (!ok) return;

    for (const r of candidates) {
      await handleLink(r);
    }
  }

  const visibleResults = (report?.results ?? []).filter(
    (r) => !hidden.has(r.ankorstoreProduct.id) && (filter === "all" || r.status === filter),
  );
  const matchedVisibleCount = report
    ? report.results.filter(
        (r) => r.status === "matched" && !hidden.has(r.ankorstoreProduct.id),
      ).length
    : 0;

  return (
    <div className="max-w-[1400px] mx-auto p-6 space-y-6">
      <div>
        <h1 className="page-title">Ankorstore — matching automatique</h1>
        <p className="text-sm text-text-muted font-body mt-1">
          Lance la recherche pour comparer les produits Ankorstore à votre catalogue local et lier
          ceux qui correspondent par référence.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleAutoMatch}
          disabled={isMatching}
          className="px-4 py-2 text-sm font-semibold text-white bg-text-primary rounded-none hover:bg-text-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-body"
        >
          {isMatching ? "Recherche en cours…" : "Lancer la recherche automatique"}
        </button>
        {report && matchedVisibleCount > 0 && (
          <button
            type="button"
            onClick={handleLinkAll}
            disabled={linking !== null}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#15803D] rounded-none hover:bg-[#166534] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-body"
          >
            Tout lier ({matchedVisibleCount})
          </button>
        )}
      </div>

      {report && (
        <div className="flex items-center gap-2 text-sm font-body">
          <span className="text-text-muted">Filtre :</span>
          {([
            ["all", `Tous (${report.results.length - hidden.size})`],
            ["matched", `Liables (${report.matched})`],
            ["ambiguous", `Ambigus (${report.ambiguous})`],
            ["unmatched", `Non trouvés (${report.unmatched})`],
          ] as [StatusFilter, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-1 rounded-none border transition-colors ${
                filter === key
                  ? "bg-text-primary text-white border-text-primary"
                  : "bg-bg-primary text-text-secondary border-border hover:bg-bg-tertiary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {!report && (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center text-text-muted font-body shadow-sm">
          Cliquez sur « Lancer la recherche automatique » pour comparer les produits Ankorstore à
          votre catalogue.
        </div>
      )}

      {report && visibleResults.length === 0 && (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center text-text-muted font-body shadow-sm">
          Aucun résultat à afficher avec le filtre actuel.
        </div>
      )}

      {report && visibleResults.length > 0 && (
        <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-bg-secondary border-b border-border">
              <tr className="text-left text-[12px] font-semibold font-body text-text-secondary uppercase tracking-wide">
                <th className="px-4 py-3">Produit Ankorstore</th>
                <th className="px-4 py-3">Réf. extraite</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Produit local</th>
                <th className="px-4 py-3">Variantes</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {visibleResults.map((r) => {
                const matchedVariantsCount = r.variantMatches.filter((vm) => vm.bjColorId !== null).length;
                return (
                  <tr key={r.ankorstoreProduct.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {r.ankorstoreProduct.images[0]?.url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.ankorstoreProduct.images[0].url}
                            alt=""
                            className="w-10 h-10 object-cover rounded"
                          />
                        )}
                        <span className="text-sm font-semibold font-body text-text-primary">
                          {r.ankorstoreProduct.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                      {r.extractedRef ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {r.status === "matched" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]">
                          Liable
                        </span>
                      )}
                      {r.status === "ambiguous" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]">
                          Ambigu
                        </span>
                      )}
                      {r.status === "unmatched" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-bg-secondary text-text-muted border border-border">
                          Non trouvé
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-body text-text-primary">
                      {r.bjProductNames.length === 0
                        ? "—"
                        : r.bjProductNames.length === 1
                          ? r.bjProductNames[0]
                          : `${r.bjProductNames.length} candidats`}
                    </td>
                    <td className="px-4 py-3 text-xs font-body text-text-secondary">
                      {r.status === "matched"
                        ? `${matchedVariantsCount}/${r.variantMatches.length} couleurs liées`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        {r.status === "matched" && (
                          <button
                            type="button"
                            onClick={() => handleLink(r)}
                            disabled={linking !== null}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-[#15803D] rounded-none hover:bg-[#166534] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-body"
                          >
                            {linking === r.ankorstoreProduct.id ? "Liaison…" : "Lier"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setHidden((prev) => new Set(prev).add(r.ankorstoreProduct.id))
                          }
                          className="px-3 py-1.5 text-xs font-semibold text-text-secondary bg-bg-secondary rounded-none border border-border hover:bg-bg-tertiary transition-colors font-body"
                        >
                          Masquer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
