"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  linkAnkorstoreProductWithMapping,
  previewAnkorstoreProductForLinking,
  type AnkorstoreLinkPreview,
  type AnkorstoreLinkPreviewLocalColor,
} from "@/app/actions/admin/ankorstore";
import { LinkModalShell } from "./link-modal/LinkModalShell";
import {
  Callout,
  ColorSwatch,
  EmptyState,
  LoadingState,
  MappingProgress,
  ModalButton,
  ModalIcons,
  SearchField,
} from "./link-modal/LinkModalPrimitives";

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

  // ── État phase mapping ────────────────────────────────────────────
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

    const url = "/api/admin/ankorstore-catalog";
    const method = refresh ? "POST" : "GET";

    void (async () => {
      try {
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
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
                handleSseEvent(JSON.parse(payload));
              } catch {
                // ignore
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
      if (ref === q || ext === q || ref.includes(q) || name.includes(q)) n++;
    }
    return n;
  }, [entries, query]);

  // ── Phase mapping ────────────────────────────────────────────────
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
    return preview.variants.every((v) => mapping[v.ankorstoreVariantId] != null);
  }, [preview, mapping]);

  const mappedCount = useMemo(() => {
    if (!preview) return 0;
    return preview.variants.filter((v) => mapping[v.ankorstoreVariantId] != null).length;
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

  // ── Search bar (phase ready uniquement) ───────────────────────────
  const searchBar =
    phase === "ready" ? (
      <SearchField
        label={`Filtrer dans votre catalogue Ankorstore (${entries.length} produit${entries.length > 1 ? "s" : ""})`}
        value={query}
        onChange={setQuery}
        placeholder="Tapez une référence, un nom…"
        rightSlot={
          <button
            type="button"
            onClick={() => loadCatalog(true)}
            title="Recharger le catalogue depuis Ankorstore"
            aria-label="Recharger le catalogue Ankorstore"
            className="h-10 w-10 rounded-lg border border-border bg-bg-primary text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors flex items-center justify-center shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        }
        helper={
          loadedAt ? (
            fromCache ? (
              <>Catalogue mis en cache · dernier chargement : {formatLoadedAt(loadedAt)}</>
            ) : (
              <>Catalogue chargé à l&apos;instant : {formatLoadedAt(loadedAt)}</>
            )
          ) : null
        }
      />
    ) : null;

  // ── Footer ───────────────────────────────────────────────────────
  const footer =
    phase === "mapping" && preview && !previewLoading ? (
      <>
        <p className="font-body text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{mappedCount}</span>/{" "}
          <span className="text-text-secondary">{preview.variants.length}</span> variante(s) liée(s)
          {hasDuplicate && (
            <span className="ml-2 text-rose-700">· Doublon de couleur</span>
          )}
        </p>
        <div className="flex gap-2">
          <ModalButton onClick={backToList} disabled={linking}>
            ← Retour
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={() => void handleValidate()}
            disabled={!canValidate}
            title={
              !allMapped
                ? "Toutes les variantes Ankorstore doivent être liées à une couleur."
                : hasDuplicate
                  ? "Une couleur est utilisée plusieurs fois — corrigez le mapping."
                  : "Valider la liaison"
            }
          >
            {linking ? "Liaison…" : "Valider la liaison"}
          </ModalButton>
        </div>
      </>
    ) : (
      <>
        <div />
        <ModalButton onClick={onClose}>Fermer</ModalButton>
      </>
    );

  return (
    <LinkModalShell
      marketplace="ankorstore"
      productName={productName}
      reference={reference}
      onClose={onClose}
      closeDisabled={linking}
      searchBar={searchBar}
      footer={footer}
    >
      {/* Phase loading */}
      {phase === "loading" && !loadError && (
        <LoadingState>
          {loadProgress
            ? `${loadProgress.loaded} produits chargés (page ${loadProgress.pageIndex + 1}…)`
            : "Chargement de votre catalogue Ankorstore…"}
        </LoadingState>
      )}
      {phase === "loading" && loadError && (
        <div className="space-y-3">
          <Callout tone="danger" icon={ModalIcons.Block} title="Erreur de chargement">
            {loadError}
          </Callout>
          <ModalButton variant="primary" onClick={() => loadCatalog(true)}>
            Réessayer
          </ModalButton>
        </div>
      )}

      {/* Phase ready : grille catalogue */}
      {phase === "ready" && (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <EmptyState
              title={
                query.trim().length === 0
                  ? "Catalogue vide"
                  : <>Aucun produit ne correspond à « {query.trim()} »</>
              }
              description="Modifiez votre recherche ou rechargez le catalogue depuis Ankorstore."
            />
          )}
          {filtered.length > 0 && totalMatches > MAX_DISPLAYED && (
            <Callout
              tone="warning"
              icon={ModalIcons.Info}
              title={`${totalMatches} produits correspondent`}
            >
              Affichage limité aux {MAX_DISPLAYED} premiers — affinez votre recherche pour voir le reste.
            </Callout>
          )}
          {filtered.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((r) => (
                <CatalogCard key={r.id} entry={r} onSelect={() => void selectAnkorstoreProduct(r.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Phase mapping */}
      {phase === "mapping" && previewLoading && (
        <LoadingState>Chargement du produit Ankorstore…</LoadingState>
      )}
      {phase === "mapping" && !previewLoading && previewError && (
        <div className="space-y-3">
          <Callout tone="danger" icon={ModalIcons.Block} title="Erreur de chargement">
            {previewError}
          </Callout>
          <ModalButton onClick={backToList}>← Retour à la liste</ModalButton>
        </div>
      )}
      {phase === "mapping" && !previewLoading && preview && (
        <div className="space-y-4">
          <AnkorstoreProductBanner
            preview={preview}
            mappedCount={mappedCount}
            onChange={backToList}
          />

          {hasDuplicate && (
            <Callout
              tone="danger"
              icon={ModalIcons.Warning}
              title="Une couleur est utilisée plusieurs fois"
            >
              Chaque couleur de votre site ne peut être associée qu&apos;à une seule variante Ankorstore.
            </Callout>
          )}

          <div className="space-y-2.5">
            {preview.variants.map((v) => {
              const selected = mapping[v.ankorstoreVariantId] ?? null;
              const isDuplicate =
                selected !== null && duplicateColorIds.has(selected);
              return (
                <VariantRow
                  key={v.ankorstoreVariantId}
                  variant={v}
                  colors={preview.localColors}
                  selected={selected}
                  isDuplicate={isDuplicate}
                  duplicateColorIds={duplicateColorIds}
                  onChange={(colorId) =>
                    setMapping((prev) => ({
                      ...prev,
                      [v.ankorstoreVariantId]: colorId,
                    }))
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </LinkModalShell>
  );
}

// ─────────────────────────────────────────────
// CatalogCard — un produit du catalogue Ankorstore
// ─────────────────────────────────────────────

function CatalogCard({
  entry,
  onSelect,
}: {
  entry: CatalogEntry;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex gap-3 p-3 rounded-xl border border-border-light bg-bg-primary text-left transition-all hover:border-amber-300 hover:shadow-sm"
    >
      <div className="w-20 h-20 rounded-lg bg-bg-secondary overflow-hidden shrink-0 border border-border-light flex items-center justify-center">
        {entry.firstImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.firstImageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-text-muted">{ModalIcons.Image}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold font-body text-text-primary line-clamp-2 break-words leading-snug">
          {entry.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5">
          {entry.ref && (
            <span className="font-mono text-[11px] bg-bg-secondary text-text-secondary px-1.5 py-0.5 rounded">
              {entry.ref}
            </span>
          )}
          <span className="text-[11px] font-body text-text-muted">
            {entry.variantCount} variante{entry.variantCount > 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-[11px] font-body text-amber-800 mt-2 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
          Choisir ce produit →
        </p>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────
// AnkorstoreProductBanner — bandeau produit sélectionné
// ─────────────────────────────────────────────

function AnkorstoreProductBanner({
  preview,
  mappedCount,
  onChange,
}: {
  preview: AnkorstoreLinkPreview;
  mappedCount: number;
  onChange: () => void;
}) {
  return (
    <div className="rounded-xl bg-bg-primary border border-border-light overflow-hidden">
      <div className="flex gap-4 p-4">
        <div className="shrink-0 w-24 h-24 rounded-lg bg-bg-secondary overflow-hidden border border-border-light flex items-center justify-center">
          {preview.ankorstoreProduct.mainImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.ankorstoreProduct.mainImage}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-text-muted">{ModalIcons.Image}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-body text-[10px] text-text-muted uppercase tracking-wider">
            Produit Ankorstore sélectionné
          </p>
          <p className="font-heading font-bold text-text-primary text-base line-clamp-2 break-words mt-0.5 leading-snug">
            {preview.ankorstoreProduct.name}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <span className="text-[11px] font-body text-text-secondary">
              {preview.variants.length} variante{preview.variants.length > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={onChange}
              className="text-[11px] font-body font-semibold text-amber-800 hover:text-amber-900 underline"
            >
              Changer de produit
            </button>
          </div>
        </div>
        <div className="shrink-0 self-center">
          <MappingProgress
            current={mappedCount}
            total={preview.variants.length}
            done={mappedCount === preview.variants.length && preview.variants.length > 0}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// VariantRow — une variante Ankorstore avec son picker de couleur BJ
// ─────────────────────────────────────────────

function VariantRow({
  variant,
  colors,
  selected,
  isDuplicate,
  duplicateColorIds,
  onChange,
}: {
  variant: AnkorstoreLinkPreview["variants"][number];
  colors: AnkorstoreLinkPreviewLocalColor[];
  selected: string | null;
  isDuplicate: boolean;
  duplicateColorIds: Set<string>;
  onChange: (colorId: string | null) => void;
}) {
  const borderClass = !selected
    ? "border-amber-200 bg-amber-50/40"
    : isDuplicate
      ? "border-rose-200 bg-rose-50/50"
      : "border-emerald-200 bg-emerald-50/40";

  return (
    <div className={`rounded-xl border bg-bg-primary overflow-hidden transition-colors ${borderClass}`}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr]">
        {/* Variante Ankorstore */}
        <div className="p-4 flex gap-3 items-start">
          <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-bg-secondary border border-border-light flex items-center justify-center">
            {variant.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={variant.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-text-muted">{ModalIcons.Image}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-body text-[10px] text-text-muted uppercase tracking-wider mb-1">
              Variante Ankorstore
            </p>
            <p className="font-body text-sm font-semibold text-text-primary truncate">
              {variant.colorOption ?? "(sans couleur)"}
            </p>
            <div className="text-xs font-body text-text-secondary space-y-0.5 mt-1">
              {variant.sizeOption && <p>Taille : {variant.sizeOption}</p>}
              <p className="font-mono text-[11px] text-text-muted truncate">
                {variant.sku ?? "Pas de SKU"}
              </p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                <span className="badge badge-info">Stock {variant.stockQuantity}</span>
                <span className="badge badge-neutral">
                  {variant.wholesalePrice.toFixed(2)} € HT
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Séparateur */}
        <div className="hidden md:flex items-center justify-center px-2 bg-bg-secondary/40">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              selected && !isDuplicate
                ? "bg-emerald-100 text-emerald-700"
                : isDuplicate
                  ? "bg-rose-100 text-rose-700"
                  : "bg-bg-tertiary text-text-muted"
            }`}
          >
            {ModalIcons.Arrow}
          </div>
        </div>

        {/* Picker couleur BJ */}
        <div className="p-4 border-t md:border-t-0 md:border-l border-border-light bg-bg-secondary/30">
          <p className="font-body text-[10px] text-text-muted uppercase tracking-wider mb-2">
            Liée à votre couleur
          </p>
          <ColorPicker
            colors={colors}
            value={selected}
            onChange={onChange}
            duplicateColorIds={duplicateColorIds}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ColorPicker — pastilles cliquables des couleurs BJ
// ─────────────────────────────────────────────

function ColorPicker({
  colors,
  value,
  onChange,
  duplicateColorIds,
}: {
  colors: AnkorstoreLinkPreviewLocalColor[];
  value: string | null;
  onChange: (colorId: string | null) => void;
  duplicateColorIds: Set<string>;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {colors.map((c) => {
        const isSelected = value === c.colorId;
        const isDuplicateHere = isSelected && duplicateColorIds.has(c.colorId);
        const cls = isSelected
          ? isDuplicateHere
            ? "border-rose-500 bg-rose-50 text-rose-800"
            : "border-emerald-500 bg-emerald-50 text-emerald-800"
          : "border-border bg-bg-primary text-text-secondary hover:border-text-secondary hover:bg-bg-secondary";
        return (
          <button
            key={c.colorId}
            type="button"
            onClick={() => onChange(isSelected ? null : c.colorId)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-body font-semibold transition-all ${cls}`}
            title={c.name}
          >
            <ColorSwatch hex={c.hex} patternImage={c.patternImage} size={14} />
            <span className="max-w-[9rem] truncate">{c.name}</span>
            {isSelected && <span className="shrink-0">{ModalIcons.Check}</span>}
          </button>
        );
      })}
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
