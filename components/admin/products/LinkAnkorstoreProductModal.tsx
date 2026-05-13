"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  linkAnkorstoreProductWithMapping,
  previewAnkorstoreProductForLinking,
  type AnkorstoreLinkPreview,
  type AnkorstoreLinkPreviewLocalColor,
} from "@/app/actions/admin/ankorstore";

interface AnkorstoreSearchResult {
  id: string;
  name: string;
  extractedRef: string | null;
  variantCount: number;
  firstImageUrl: string | null;
  score: number;
}

interface LinkAnkorstoreProductModalProps {
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
}

type Phase = "search" | "mapping";

export default function LinkAnkorstoreProductModal({
  productId,
  productName,
  reference,
  onClose,
}: LinkAnkorstoreProductModalProps) {
  const toast = useToast();

  // ── Phase 1 : recherche ────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("search");
  const [query, setQuery] = useState(reference);
  const [results, setResults] = useState<AnkorstoreSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Phase 2 : mapping ──────────────────────────────────────────────
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AnkorstoreLinkPreview | null>(null);
  /** Mapping en cours d'édition : akVariantId → localColorId (ou null). */
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [linking, setLinking] = useState(false);

  // ── Recherche ─────────────────────────────────────────────────────
  const runSearch = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchError("Saisissez au moins 2 caractères.");
      setResults([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setHasSearched(true);
    try {
      const res = await fetch(
        `/api/admin/ankorstore-search?q=${encodeURIComponent(trimmed)}`,
      );
      const body = await res.json();
      if (!res.ok) {
        setSearchError(body.error ?? `HTTP ${res.status}`);
        setResults([]);
      } else {
        setResults(body.results ?? []);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  // ── Sélection d'un produit Ankorstore → phase mapping ─────────────
  const selectAnkorstoreProduct = async (akProductId: string) => {
    setPhase("mapping");
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const res = await previewAnkorstoreProductForLinking(productId, akProductId);
      if (!res.success) {
        setPreviewError(res.error);
        return;
      }
      setPreview(res.data);
      // Pré-remplir le mapping avec les suggestions auto
      const initial: Record<string, string | null> = {};
      for (const v of res.data.variants) {
        initial[v.ankorstoreVariantId] = v.suggestedLocalColorId;
      }
      setMapping(initial);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const backToSearch = () => {
    setPhase("search");
    setPreview(null);
    setMapping({});
    setPreviewError(null);
  };

  // ── Validation finale ─────────────────────────────────────────────
  const allMapped = useMemo(() => {
    if (!preview) return false;
    return preview.variants.every(
      (v) => mapping[v.ankorstoreVariantId] != null,
    );
  }, [preview, mapping]);

  const mappedCount = useMemo(() => {
    if (!preview) return 0;
    return preview.variants.filter(
      (v) => mapping[v.ankorstoreVariantId] != null,
    ).length;
  }, [preview, mapping]);

  // Une couleur locale ne peut être utilisée qu'une seule fois — détection
  // d'un usage en double pour bloquer la validation et avertir l'admin.
  const duplicateColorIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of Object.values(mapping)) {
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return new Set(
      Array.from(counts.entries())
        .filter(([, n]) => n > 1)
        .map(([id]) => id),
    );
  }, [mapping]);

  const hasDuplicate = duplicateColorIds.size > 0;
  const canValidate = allMapped && !hasDuplicate && !linking;

  const handleValidate = async () => {
    if (!preview || !canValidate) return;
    setLinking(true);
    try {
      const fullMapping = preview.variants
        .filter((v) => mapping[v.ankorstoreVariantId] != null)
        .map((v) => ({
          ankorstoreVariantId: v.ankorstoreVariantId,
          localColorId: mapping[v.ankorstoreVariantId] as string,
        }));
      const res = await linkAnkorstoreProductWithMapping(
        productId,
        preview.ankorstoreProduct.id,
        fullMapping,
      );
      if (res.success) {
        toast.success("Produit lié à Ankorstore");
        onClose();
      } else {
        toast.error("Échec", res.error ?? "Erreur inconnue");
      }
    } catch (err) {
      toast.error("Échec", err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-heading font-bold text-lg text-text-primary">
              {phase === "search"
                ? "Lier à un produit Ankorstore"
                : "Vérifier la liaison des variantes"}
            </h3>
            <p className="text-sm text-text-secondary font-body mt-0.5 truncate">
              {productName}{" "}
              <span className="text-text-muted">({reference})</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors shrink-0"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Body : Phase 1 ────────────────────────────────────── */}
        {phase === "search" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-6 py-4 border-b border-border bg-bg-secondary">
              <label className="block text-sm font-semibold font-body text-text-primary mb-2">
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
                  className="flex-1 px-3 py-2 border border-border rounded-md text-sm font-body focus:outline-none focus:border-text-primary focus:ring-2 focus:ring-text-primary/10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void runSearch()}
                  disabled={searching || query.trim().length < 2}
                  className="px-5 py-2 text-sm font-semibold text-white bg-text-primary rounded-md hover:bg-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-body"
                >
                  {searching ? "Recherche…" : "Rechercher"}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {searching && (
                <div className="p-6 text-sm text-text-muted font-body text-center">
                  Recherche en cours…
                </div>
              )}
              {searchError && (
                <div className="p-4 text-sm text-red-600 font-body bg-red-50 border border-red-200 rounded-md">
                  Erreur : {searchError}
                </div>
              )}
              {!searching && !searchError && results.length === 0 && hasSearched && (
                <div className="p-6 text-sm text-text-muted font-body text-center">
                  Aucun résultat pour «&nbsp;{query.trim()}&nbsp;».
                </div>
              )}
              {!searching && !searchError && results.length === 0 && !hasSearched && (
                <div className="p-6 text-sm text-text-muted font-body text-center">
                  Saisissez une référence et cliquez sur «&nbsp;Rechercher&nbsp;».
                </div>
              )}

              {!searching && results.length > 0 && (
                <>
                  {results[0].score < 60 && (
                    <div className="mb-3 px-4 py-3 text-xs font-body text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md">
                      Aucun résultat ne correspond exactement à «&nbsp;{query.trim()}&nbsp;».
                      Les produits ci-dessous contiennent peut-être ce mot dans leur nom — vérifiez bien avant de lier.
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {results.map((r) => {
                      const isExact = r.score >= 90;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => void selectAnkorstoreProduct(r.id)}
                          className={`flex gap-3 p-3 rounded-lg border text-left transition-all hover:shadow-md hover:border-text-primary ${
                            isExact ? "border-[#15803D] bg-[#F0FDF4]" : "border-border bg-white"
                          }`}
                        >
                          <div className="w-20 h-20 rounded bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center">
                            {r.firstImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={r.firstImageUrl}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start gap-2 flex-wrap">
                              <p className="text-sm font-semibold font-body text-text-primary line-clamp-2 break-words flex-1 min-w-0">
                                {r.name}
                              </p>
                              {isExact && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#15803D] text-white shrink-0">
                                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  Exact
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-body text-text-muted mt-1">
                              {r.extractedRef && (
                                <span>Réf. extraite&nbsp;: <span className="font-mono text-text-secondary">{r.extractedRef}</span> · </span>
                              )}
                              {r.variantCount} variante{r.variantCount > 1 ? "s" : ""}
                            </p>
                            <p className="text-[11px] font-body text-text-primary mt-1.5 font-semibold">
                              Choisir ce produit →
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Body : Phase 2 — Mapping ─────────────────────────── */}
        {phase === "mapping" && (
          <div className="flex-1 min-h-0 flex flex-col">
            {previewLoading && (
              <div className="flex-1 flex items-center justify-center p-6">
                <p className="text-sm text-text-muted font-body">Chargement du produit Ankorstore…</p>
              </div>
            )}

            {!previewLoading && previewError && (
              <div className="flex-1 p-6">
                <div className="p-4 text-sm text-red-600 font-body bg-red-50 border border-red-200 rounded-md">
                  Erreur : {previewError}
                </div>
                <button
                  type="button"
                  onClick={backToSearch}
                  className="mt-4 text-sm text-text-secondary hover:text-text-primary underline font-body"
                >
                  ← Retour à la recherche
                </button>
              </div>
            )}

            {!previewLoading && preview && (
              <>
                {/* Bandeau produit Ankorstore choisi */}
                <div className="px-6 py-4 bg-bg-secondary border-b border-border flex items-start gap-4">
                  <div className="w-24 h-24 rounded-lg bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center border border-border">
                    {preview.ankorstoreProduct.mainImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview.ankorstoreProduct.mainImage}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted font-body">
                      Produit Ankorstore sélectionné
                    </p>
                    <h4 className="text-base font-semibold font-body text-text-primary line-clamp-2 break-words mt-0.5">
                      {preview.ankorstoreProduct.name}
                    </h4>
                    <p className="text-xs text-text-muted font-body mt-1">
                      {preview.variants.length} variante{preview.variants.length > 1 ? "s" : ""} ·{" "}
                      <button
                        type="button"
                        onClick={backToSearch}
                        className="underline hover:text-text-primary"
                      >
                        Changer de produit
                      </button>
                    </p>
                  </div>
                </div>

                {/* Bandeau d'instructions + progression */}
                <div className="px-6 py-3 bg-white border-b border-border">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm font-body text-text-secondary">
                      Vérifiez la liaison de chaque variante Ankorstore vers une couleur de votre produit.
                      Le matching automatique a été pré-rempli — modifiez si nécessaire.
                    </p>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold font-body shrink-0 ${
                        allMapped && !hasDuplicate
                          ? "bg-[#DCFCE7] text-[#15803D]"
                          : "bg-[#FEF3C7] text-[#B45309]"
                      }`}
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        {allMapped && !hasDuplicate ? (
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        ) : (
                          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                        )}
                      </svg>
                      {mappedCount}/{preview.variants.length} liées
                    </span>
                  </div>
                  {hasDuplicate && (
                    <p className="mt-2 text-xs font-body text-[#B91C1C]">
                      Une couleur de votre site est utilisée pour plusieurs variantes Ankorstore — chaque couleur ne peut être utilisée qu&apos;une seule fois.
                    </p>
                  )}
                </div>

                {/* Liste des variantes Ankorstore */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {preview.variants.map((v) => {
                    const selected = mapping[v.ankorstoreVariantId];
                    const isDuplicate = selected !== null && selected !== undefined && duplicateColorIds.has(selected);
                    return (
                      <div
                        key={v.ankorstoreVariantId}
                        className={`flex gap-3 p-3 rounded-lg border transition-colors ${
                          selected
                            ? isDuplicate
                              ? "border-[#F87171] bg-[#FEF2F2]"
                              : "border-[#BBF7D0] bg-[#F0FDF4]"
                            : "border-[#FDE68A] bg-[#FFFBEB]"
                        }`}
                      >
                        <div className="w-16 h-16 rounded bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center border border-border">
                          {v.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.imageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold font-body text-text-primary">
                              {v.colorOption ?? "(sans couleur Ankorstore)"}
                            </p>
                            {v.sizeOption && (
                              <span className="text-xs font-body text-text-muted">
                                · taille {v.sizeOption}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-mono text-text-muted truncate mt-0.5">
                            {v.sku ?? "Pas de SKU"} · stock {v.stockQuantity} · {v.wholesalePrice.toFixed(2)}&nbsp;€ HT
                          </p>

                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs font-body text-text-secondary shrink-0">
                              Liée à&nbsp;:
                            </span>
                            <ColorPicker
                              colors={preview.localColors}
                              value={selected ?? null}
                              onChange={(colorId) =>
                                setMapping((prev) => ({
                                  ...prev,
                                  [v.ankorstoreVariantId]: colorId,
                                }))
                              }
                              duplicateColorIds={duplicateColorIds}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border bg-bg-secondary">
          {phase === "mapping" && !previewLoading && preview ? (
            <>
              <button
                type="button"
                onClick={backToSearch}
                disabled={linking}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-white border border-border rounded-md hover:bg-bg-tertiary transition-colors font-body disabled:opacity-50"
              >
                ← Retour
              </button>
              <button
                type="button"
                onClick={() => void handleValidate()}
                disabled={!canValidate}
                title={
                  !allMapped
                    ? "Toutes les variantes Ankorstore doivent être liées à une couleur de votre site avant de valider."
                    : hasDuplicate
                      ? "Une couleur est utilisée plusieurs fois — corrigez le mapping."
                      : "Valider la liaison"
                }
                className="px-5 py-2 text-sm font-semibold text-white bg-[#15803D] rounded-md hover:bg-[#166534] disabled:bg-bg-tertiary disabled:text-text-muted disabled:cursor-not-allowed transition-colors font-body"
              >
                {linking ? "Liaison…" : "Valider la liaison"}
              </button>
            </>
          ) : (
            <>
              <div />
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-white border border-border rounded-md hover:bg-bg-tertiary transition-colors font-body"
              >
                Fermer
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ColorPicker — sélecteur visuel de couleur locale
// ─────────────────────────────────────────────

interface ColorPickerProps {
  colors: AnkorstoreLinkPreviewLocalColor[];
  value: string | null;
  onChange: (colorId: string | null) => void;
  duplicateColorIds: Set<string>;
}

function ColorPicker({ colors, value, onChange, duplicateColorIds }: ColorPickerProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {colors.map((c) => {
        const isSelected = value === c.colorId;
        const isDuplicateHere = isSelected && duplicateColorIds.has(c.colorId);
        return (
          <button
            key={c.colorId}
            type="button"
            onClick={() => onChange(isSelected ? null : c.colorId)}
            className={`group inline-flex items-center gap-1 px-1.5 py-1 rounded border text-[11px] font-body transition-all ${
              isSelected
                ? isDuplicateHere
                  ? "border-[#DC2626] bg-white text-[#DC2626] font-semibold"
                  : "border-[#15803D] bg-white text-[#15803D] font-semibold"
                : "border-border bg-white text-text-secondary hover:border-text-primary"
            }`}
            title={c.name}
          >
            <span
              className="w-4 h-4 rounded-full border border-border shrink-0"
              style={
                c.patternImage
                  ? {
                      backgroundImage: `url(${c.patternImage})`,
                      backgroundSize: "cover",
                    }
                  : { backgroundColor: c.hex ?? "#9CA3AF" }
              }
              aria-hidden="true"
            />
            <span className="max-w-[8rem] truncate">{c.name}</span>
            {isSelected && (
              <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
