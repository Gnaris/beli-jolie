"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { linkAnkorstoreProductManually } from "@/app/actions/admin/ankorstore";

interface AnkorstoreSearchResult {
  id: string;
  name: string;
  extractedRef: string | null;
  variantCount: number;
  firstImageUrl: string | null;
  /** Score de pertinence calculé côté serveur (100 = match exact). */
  score: number;
}

interface LinkAnkorstoreProductModalProps {
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
}

export default function LinkAnkorstoreProductModal({
  productId,
  productName,
  reference,
  onClose,
}: LinkAnkorstoreProductModalProps) {
  const toast = useToast();
  const [query, setQuery] = useState(reference);
  const [results, setResults] = useState<AnkorstoreSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const runSearch = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Saisissez au moins 2 caractères.");
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const res = await fetch(
        `/api/admin/ankorstore-search?q=${encodeURIComponent(trimmed)}`,
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        setResults([]);
      } else {
        setResults(body.results ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async (akProductId: string) => {
    setLinking(akProductId);
    try {
      const res = await linkAnkorstoreProductManually(productId, akProductId);
      if (res.success) {
        const matched = res.matched ?? 0;
        const unmatched = res.unmatched ?? 0;
        if (unmatched > 0) {
          toast.info(
            "Produit lié",
            `${matched} variante${matched > 1 ? "s" : ""} liée${matched > 1 ? "s" : ""}, ${unmatched} sans correspondance.`,
          );
        } else {
          toast.success("Produit lié à Ankorstore");
        }
        onClose();
      } else {
        toast.error("Échec", res.error ?? "Erreur inconnue");
      }
    } catch (err) {
      toast.error("Échec", err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-none shadow-lg p-6 max-w-2xl w-full mx-4 space-y-4 max-h-[80vh] flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-heading font-bold text-text-primary">
              Lier à un produit Ankorstore existant
            </h3>
            <p className="text-sm text-text-secondary font-body mt-0.5">
              {productName} ({reference})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div>
          <label className="block text-sm font-semibold font-body text-text-primary mb-1">
            Rechercher (nom ou référence)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              placeholder="Tapez la référence ou un nom (min 2 caractères)…"
              className="flex-1 px-3 py-2 border border-border rounded-none text-sm font-body focus:outline-none focus:border-text-primary"
              autoFocus
            />
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={loading || query.trim().length < 2}
              className="px-4 py-2 text-sm font-semibold text-white bg-text-primary rounded-none hover:bg-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-body"
            >
              {loading ? "Recherche…" : "Rechercher"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto border border-border rounded-none">
          {loading && (
            <div className="p-4 text-sm text-text-muted font-body text-center">
              Recherche en cours…
            </div>
          )}
          {error && (
            <div className="p-4 text-sm text-red-600 font-body">
              Erreur : {error}
            </div>
          )}
          {!loading && !error && results.length === 0 && hasSearched && (
            <div className="p-4 text-sm text-text-muted font-body text-center">
              Aucun résultat pour « {query.trim()} ».
            </div>
          )}
          {!loading && !error && results.length === 0 && !hasSearched && (
            <div className="p-4 text-sm text-text-muted font-body text-center">
              Saisissez une référence et cliquez sur « Rechercher ».
            </div>
          )}
          {!loading && results.length > 0 && (
            <>
              {results[0].score < 60 && (
                <div className="px-4 py-2 text-xs font-body text-[#92400E] bg-[#FFFBEB] border-b border-[#FDE68A]">
                  Aucun résultat ne correspond exactement à «&nbsp;{query.trim()}&nbsp;».
                  Les produits ci-dessous contiennent peut-être ce mot dans leur nom — vérifiez bien avant de lier.
                </div>
              )}
              <ul className="divide-y divide-border">
                {results.map((r) => {
                  const isExact = r.score >= 90;
                  const isStrong = r.score >= 60;
                  return (
                    <li
                      key={r.id}
                      className={`flex items-center gap-3 px-4 py-3 ${
                        isExact ? "bg-[#F0FDF4]" : ""
                      }`}
                    >
                      <div className="w-12 h-12 rounded bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center">
                        {r.firstImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.firstImageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold font-body text-text-primary truncate">
                            {r.name}
                          </p>
                          {isExact && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#15803D] text-white">
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Correspondance exacte
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-body text-text-muted">
                          {r.extractedRef ? `Réf. extraite : ${r.extractedRef} · ` : ""}
                          {r.variantCount} variante{r.variantCount > 1 ? "s" : ""}
                          {!isStrong && " · correspondance faible"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLink(r.id)}
                        disabled={linking !== null}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#15803D] rounded-none hover:bg-[#166534] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-body"
                      >
                        {linking === r.id ? "Liaison…" : "Lier"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
