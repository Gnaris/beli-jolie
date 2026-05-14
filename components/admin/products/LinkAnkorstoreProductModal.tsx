"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  linkAnkorstoreProductWithMapping,
  previewAnkorstoreProductForLinking,
  type AnkorstoreLinkPreview,
  type AnkorstoreLinkPreviewLocalColor,
} from "@/app/actions/admin/ankorstore";

interface CatalogEntry {
  id: string;
  name: string;
  ref: string | null;
  externalId: string | null;
  firstImageUrl: string | null;
  variantCount: number;
}

interface LinkAnkorstoreProductModalProps {
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
}

type Phase = "loading" | "ready" | "mapping";

const MAX_DISPLAYED = 50;

export default function LinkAnkorstoreProductModal({
  productId,
  productName,
  reference,
  onClose,
}: LinkAnkorstoreProductModalProps) {
  const toast = useToast();

  // ── État global ───────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("loading");
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{
    loaded: number;
    pageIndex: number;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState(reference);
  const abortRef = useRef<AbortController | null>(null);

  // ── État phase 2 (mapping, inchangé) ──────────────────────────────
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AnkorstoreLinkPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [linking, setLinking] = useState(false);

  // ── Chargement du catalogue via SSE ───────────────────────────────
  const loadCatalog = (refresh: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("loading");
    setEntries([]);
    setLoadProgress(null);
    setLoadError(null);

    // Petit helper : on streame du JSON-lines via fetch + ReadableStream
    // (plus simple que EventSource pour gérer le POST refresh + auth cookies).
    const url = "/api/admin/ankorstore-catalog";
    const method = refresh ? "POST" : "GET";

    void (async () => {
      try {
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Lit le flux SSE ligne par ligne, ne traite que celles préfixées "data:".
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (!payload) continue;
              try {
                const evt = JSON.parse(payload);
                handleSseEvent(evt);
              } catch {
                // Ignore les payloads non-JSON.
              }
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const handleSseEvent = (evt: {
    type: string;
    entries?: CatalogEntry[];
    loadedAt?: string | null;
    loaded?: number;
    pageIndex?: number;
    fromCache?: boolean;
    message?: string;
  }) => {
    if (evt.type === "progress") {
      setLoadProgress({
        loaded: evt.loaded ?? 0,
        pageIndex: evt.pageIndex ?? 0,
      });
    } else if (evt.type === "complete") {
      setEntries(evt.entries ?? []);
      setLoadedAt(evt.loadedAt ?? null);
      setFromCache(evt.fromCache === true);
      setPhase("ready");
    } else if (evt.type === "error") {
      setLoadError(evt.message ?? "Erreur inconnue");
    }
  };

  useEffect(() => {
    loadCatalog(false);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Filtrage local ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    if (!q) return entries.slice(0, MAX_DISPLAYED);
    const scored: { e: CatalogEntry; s: number }[] = [];
    for (const e of entries) {
      const ref = normalizeQuery(e.ref ?? "");
      const ext = normalizeQuery(e.externalId ?? "");
      const name = normalizeQuery(e.name);
      let s = 0;
      if (ref === q) s = 100;
      else if (ext === q) s = 90;
      else if (ref.startsWith(q)) s = 70;
      else if (ref.includes(q)) s = 60;
      else if (name.startsWith(q)) s = 50;
      else if (name.includes(q)) s = 30;
      if (s > 0) scored.push({ e, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, MAX_DISPLAYED).map((x) => x.e);
  }, [entries, query]);

  const totalMatches = useMemo(() => {
    const q = normalizeQuery(query);
    if (!q) return entries.length;
    let n = 0;
    for (const e of entries) {
      const ref = normalizeQuery(e.ref ?? "");
      const ext = normalizeQuery(e.externalId ?? "");
      const name = normalizeQuery(e.name);
      if (
        ref === q ||
        ext === q ||
        ref.includes(q) ||
        name.includes(q)
      )
        n++;
    }
    return n;
  }, [entries, query]);

  // ── Phase 2 — Sélection d'un produit ──────────────────────────────
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

  const backToList = () => {
    setPhase("ready");
    setPreview(null);
    setMapping({});
    setPreviewError(null);
  };

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

  // ── Rendu ─────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-heading font-bold text-lg text-text-primary">
              {phase === "mapping"
                ? "Vérifier la liaison des variantes"
                : "Lier à un produit Ankorstore"}
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

        {/* ── Phase loading ─────────────────────────────────────── */}
        {phase === "loading" && (
          <div className="flex-1 min-h-[300px] flex flex-col items-center justify-center p-8 gap-4">
            {!loadError && (
              <>
                <svg
                  className="w-10 h-10 text-text-primary animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <p className="text-sm font-body text-text-primary text-center max-w-md">
                  Chargement de votre catalogue Ankorstore…
                  <br />
                  <span className="text-xs text-text-muted">
                    La 1<sup>re</sup> fois ça prend 30 s à 1 min, ensuite c'est
                    instantané pendant 6 heures.
                  </span>
                </p>
                {loadProgress && (
                  <p className="text-xs font-body text-text-secondary">
                    {loadProgress.loaded} produits chargés (page&nbsp;
                    {loadProgress.pageIndex + 1}…)
                  </p>
                )}
              </>
            )}
            {loadError && (
              <div className="w-full max-w-md">
                <div className="p-4 text-sm text-red-600 font-body bg-red-50 border border-red-200 rounded-md">
                  Erreur de chargement&nbsp;: {loadError}
                </div>
                <button
                  type="button"
                  onClick={() => loadCatalog(true)}
                  className="mt-3 px-4 py-2 text-sm font-semibold text-white bg-text-primary rounded-md hover:bg-text-secondary font-body"
                >
                  Réessayer
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Phase ready : liste filtrable ───────────────────── */}
        {phase === "ready" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-6 py-4 border-b border-border bg-bg-secondary">
              <label className="block text-sm font-semibold font-body text-text-primary mb-2">
                Filtrer dans votre catalogue ({entries.length} produits)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tapez une référence, un nom…"
                  className="flex-1 px-3 py-2 border border-border rounded-md text-sm font-body focus:outline-none focus:border-text-primary focus:ring-2 focus:ring-text-primary/10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => loadCatalog(true)}
                  title="Recharger le catalogue depuis Ankorstore"
                  className="inline-flex items-center justify-center w-10 h-10 text-text-secondary bg-white border border-border rounded-md hover:bg-bg-tertiary hover:text-text-primary transition-colors"
                  aria-label="Recharger le catalogue Ankorstore"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>
              <p className="text-[11px] font-body text-text-muted mt-2">
                {fromCache && loadedAt && (
                  <>Catalogue mis en cache · dernier chargement&nbsp;: {formatLoadedAt(loadedAt)}</>
                )}
                {!fromCache && loadedAt && (
                  <>Catalogue chargé à l'instant&nbsp;: {formatLoadedAt(loadedAt)}</>
                )}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filtered.length === 0 && (
                <div className="p-6 text-sm text-text-muted font-body text-center">
                  {query.trim().length === 0
                    ? "Tapez quelque chose pour filtrer."
                    : `Aucun produit ne correspond à « ${query.trim()} ».`}
                </div>
              )}

              {filtered.length > 0 && (
                <>
                  {totalMatches > MAX_DISPLAYED && (
                    <div className="mb-3 px-4 py-2 text-xs font-body text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md">
                      {totalMatches} produits correspondent — affichage limité aux {MAX_DISPLAYED} premiers. Affinez votre recherche.
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filtered.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => void selectAnkorstoreProduct(r.id)}
                        className="flex gap-3 p-3 rounded-lg border border-border bg-white text-left transition-all hover:shadow-md hover:border-text-primary"
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
                          <p className="text-sm font-semibold font-body text-text-primary line-clamp-2 break-words">
                            {r.name}
                          </p>
                          <p className="text-xs font-body text-text-muted mt-1">
                            {r.ref && (
                              <span>
                                Réf.&nbsp;: <span className="font-mono text-text-secondary">{r.ref}</span> ·{" "}
                              </span>
                            )}
                            {r.variantCount} variante{r.variantCount > 1 ? "s" : ""}
                          </p>
                          <p className="text-[11px] font-body text-text-primary mt-1.5 font-semibold">
                            Choisir ce produit →
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Phase mapping (inchangée) ───────────────────────── */}
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
                  Erreur&nbsp;: {previewError}
                </div>
                <button
                  type="button"
                  onClick={backToList}
                  className="mt-4 text-sm text-text-secondary hover:text-text-primary underline font-body"
                >
                  ← Retour à la liste
                </button>
              </div>
            )}

            {!previewLoading && preview && (
              <>
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
                        onClick={backToList}
                        className="underline hover:text-text-primary"
                      >
                        Changer de produit
                      </button>
                    </p>
                  </div>
                </div>

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
                onClick={backToList}
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
// Helpers
// ─────────────────────────────────────────────

function normalizeQuery(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function formatLoadedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────
// ColorPicker (inchangé)
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
