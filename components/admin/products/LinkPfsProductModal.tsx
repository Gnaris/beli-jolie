"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  previewPfsMatchByReference,
  linkPfsProductManually,
  type PfsLinkPreview,
  type PfsLinkCandidate,
  type PfsLinkLocalColor,
} from "@/app/actions/admin/pfs";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";
import { getImageSrc } from "@/lib/image-utils";

interface Props {
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
}

const FALLBACK_THUMB = "/placeholder.webp";

function formatPrice(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(value);
}

export default function LinkPfsProductModal({
  productId,
  productName,
  reference,
  onClose,
}: Props) {
  const router = useRouter();
  const toast = useToast();

  const [refInput, setRefInput] = useState(reference);
  const [preview, setPreview] = useState<PfsLinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isSaving, startSaving] = useTransition();

  /**
   * mapping[productColorId] = pfsVariantId
   * Clé par ProductColor BJ : empêche d'attribuer 2 fois la même variante PFS.
   */
  const [mapping, setMapping] = useState<Record<string, string>>({});

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await previewPfsMatchByReference(productId, refInput);
      if (res.success) {
        setPreview(res.data);
        // Pré-remplit : liens existants en BDD d'abord, puis suggestions auto par nom.
        const initial: Record<string, string> = { ...res.data.existingLinks };
        const usedPfsVids = new Set(Object.values(initial));
        for (const cand of res.data.candidates) {
          if (
            cand.suggestedLocalColorId &&
            !(cand.suggestedLocalColorId in initial) &&
            !usedPfsVids.has(cand.pfsVariantId)
          ) {
            initial[cand.suggestedLocalColorId] = cand.pfsVariantId;
            usedPfsVids.add(cand.pfsVariantId);
          }
        }
        setMapping(initial);
      } else {
        setError(res.error);
        setPreview(null);
      }
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setColorMapping(productColorId: string, pfsVariantIdOrEmpty: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (!pfsVariantIdOrEmpty) {
        delete next[productColorId];
        return next;
      }
      // Si cette variante PFS est déjà mappée à une autre couleur, on délie l'autre
      for (const [k, v] of Object.entries(next)) {
        if (v === pfsVariantIdOrEmpty && k !== productColorId) delete next[k];
      }
      next[productColorId] = pfsVariantIdOrEmpty;
      return next;
    });
  }

  function handleSave() {
    if (!preview || !preview.pfsProductId) return;
    const links = Object.entries(mapping).map(([productColorId, pfsVariantId]) => {
      const cand = preview.candidates.find((c) => c.pfsVariantId === pfsVariantId);
      return {
        productColorId,
        pfsVariantId,
        pfsColorRef: cand?.pfsColorRef,
      };
    });
    if (links.length === 0) {
      toast.error("Aucune couleur liée", "Sélectionnez au moins une variante PFS.");
      return;
    }
    startSaving(async () => {
      const res = await linkPfsProductManually(
        productId,
        preview.pfsProductId!,
        {
          id: preview.pfsBrandId ?? null,
          name: preview.pfsBrandName ?? null,
        },
        links,
      );
      if (res.success) {
        if (res.syncWarning) {
          toast.warning(
            "Produit lié — mais la synchro stock/prix a échoué",
            res.syncWarning + " Relancez « Resync » depuis la fiche.",
          );
        } else {
          toast.success(
            "Produit lié à Paris Fashion Shop",
            `${res.linked ?? 0} variante(s) reliée(s). Stock et prix poussés.`,
          );
        }
        onClose();
        router.refresh();
      } else {
        toast.error("Échec de la liaison", res.error ?? "Erreur inconnue.");
      }
    });
  }

  const orphanLocalColors = useMemo(() => {
    if (!preview) return [];
    return preview.localColors.filter((c) => !(c.productColorId in mapping));
  }, [preview, mapping]);

  const orphanCandidates = useMemo(() => {
    if (!preview) return [];
    const used = new Set(Object.values(mapping));
    return preview.candidates.filter((c) => !used.has(c.pfsVariantId));
  }, [preview, mapping]);

  const mappedCount = Object.keys(mapping).length;
  const canSaveLink =
    preview !== null &&
    preview.pfsProductId !== null &&
    mappedCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-bg-primary rounded-2xl shadow-lg max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col border border-border">
        {/* ─── HEADER ─── */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border bg-bg-secondary/30">
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}
              >
                Paris Fashion Shop
              </span>
              <span className="font-body text-[11px] text-text-muted uppercase tracking-wider">
                Liaison produit
              </span>
            </div>
            <h2 className="font-heading font-bold text-text-primary text-lg truncate">
              {productName}
            </h2>
            <p className="font-body text-xs text-text-secondary truncate">
              Référence BJ : <span className="font-medium">{reference}</span>
              {preview?.alreadyLinked && (
                <span className="ml-2 inline-flex items-center gap-1 text-[#15803D] font-medium">
                  · ✅ Déjà lié à PFS
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ─── BARRE DE RECHERCHE ─── */}
        <div className="px-6 py-4 border-b border-border">
          <label className="block font-body text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Référence PFS à rechercher
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={refInput}
              onChange={(e) => setRefInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") load();
              }}
              placeholder="ex: A2415"
              className="flex-1 h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              disabled={isLoading || isSaving}
            />
            <button
              type="button"
              onClick={load}
              disabled={isLoading || isSaving || !refInput.trim()}
              className="h-10 px-5 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {isLoading ? "Recherche…" : "Rechercher"}
            </button>
          </div>
          <p className="mt-2 font-body text-[11px] text-text-muted">
            Tapez la référence exacte côté PFS. On affichera toutes les variantes
            (couleurs × tailles) trouvées, et vous choisirez laquelle relier à
            chaque couleur de votre produit.
          </p>
        </div>

        {/* ─── CORPS ─── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-bg-secondary/20">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="font-body text-sm text-text-muted">Recherche en cours…</div>
            </div>
          )}

          {error && !isLoading && (
            <div className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626] font-body">
              {error}
            </div>
          )}

          {preview && !preview.pfsProductId && !isLoading && (
            <div className="rounded-xl border border-dashed border-border bg-bg-primary px-6 py-10 text-center">
              <div className="text-4xl mb-3">🔍</div>
              <p className="font-body text-sm text-text-secondary mb-1">
                Aucun produit PFS trouvé pour la référence
                {" "}<strong>« {preview.pfsReference} »</strong>.
              </p>
              <p className="font-body text-xs text-text-muted">
                Vérifiez la référence ou créez d&apos;abord le produit côté PFS.
              </p>
            </div>
          )}

          {preview && preview.pfsProductId && (
            <div className="space-y-5">
              {/* Bandeau produit PFS trouvé */}
              <PfsProductBanner preview={preview} mappedCount={mappedCount} />

              {/* Aucune variante PFS */}
              {preview.candidates.length === 0 && (
                <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-sm text-[#991B1B] font-body">
                  Le produit PFS existe mais n&apos;a aucune variante — créez-en
                  d&apos;abord côté PFS avant de pouvoir lier.
                </div>
              )}

              {/* Aucune couleur BJ */}
              {preview.localColors.length === 0 && (
                <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-sm text-[#991B1B] font-body">
                  Ce produit n&apos;a aucune variante côté BJ. Ajoutez au moins
                  une couleur avant de lier.
                </div>
              )}

              {/* Cartes 2 colonnes */}
              {preview.localColors.length > 0 && preview.candidates.length > 0 && (
                <div className="space-y-3">
                  {preview.localColors.map((local) => {
                    const selectedPfsId = mapping[local.productColorId];
                    const selectedCand =
                      selectedPfsId
                        ? preview.candidates.find(
                            (c) => c.pfsVariantId === selectedPfsId,
                          ) ?? null
                        : null;
                    return (
                      <PairRow
                        key={local.productColorId}
                        local={local}
                        selectedCandidate={selectedCand}
                        candidates={preview.candidates}
                        mapping={mapping}
                        onChange={(pfsVid) =>
                          setColorMapping(local.productColorId, pfsVid ?? "")
                        }
                        disabled={isSaving}
                      />
                    );
                  })}
                </div>
              )}

              {/* Orphelins BJ */}
              {orphanLocalColors.length > 0 && (
                <BjOrphansSection colors={orphanLocalColors} />
              )}

              {/* Orphelins PFS */}
              {orphanCandidates.length > 0 && preview.localColors.length > 0 && (
                <PfsOrphansSection candidates={orphanCandidates} />
              )}

              {/* Récap final */}
              {preview.localColors.length > 0 && preview.candidates.length > 0 && (
                <SyncRecap preview={preview} mapping={mapping} />
              )}
            </div>
          )}
        </div>

        {/* ─── FOOTER ─── */}
        <div className="px-6 py-4 border-t border-border bg-bg-primary flex items-center justify-between gap-3">
          <p className="font-body text-xs text-text-muted">
            {!preview || !preview.pfsProductId
              ? "—"
              : `✅ ${mappedCount} variante(s) prête(s) à lier${
                  orphanLocalColors.length > 0
                    ? ` · ⚠️ ${orphanLocalColors.length} non liée(s)`
                    : ""
                }`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="h-10 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-secondary hover:bg-bg-secondary transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !canSaveLink}
              className="h-10 px-5 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving
                ? "Liaison + synchro…"
                : `Lier ${mappedCount} variante${mappedCount > 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SOUS-COMPOSANTS
// ────────────────────────────────────────────────────────────────────────────

function PfsProductBanner({
  preview,
  mappedCount,
}: {
  preview: PfsLinkPreview;
  mappedCount: number;
}) {
  return (
    <div className="rounded-xl bg-bg-primary border border-border overflow-hidden">
      <div className="flex gap-4 p-4">
        <div className="shrink-0 w-24 h-24 rounded-lg bg-bg-secondary overflow-hidden border border-border relative">
          {preview.pfsProductImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.pfsProductImage}
              alt={preview.pfsProductName ?? ""}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = FALLBACK_THUMB;
              }}
            />
          ) : (
            <div className="flex items-center justify-center w-full h-full text-text-muted">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-body text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Produit PFS trouvé
          </p>
          <p className="font-heading font-bold text-text-primary text-base truncate mt-0.5">
            {preview.pfsProductName ?? preview.pfsReference}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="font-mono text-[11px] bg-bg-secondary px-1.5 py-0.5 rounded">
              {preview.pfsReference}
            </span>
            {preview.pfsBrandName && (
              <span className="inline-flex items-center gap-1 text-[11px] font-body text-text-secondary">
                · Marque <strong className="text-text-primary">{preview.pfsBrandName}</strong>
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-body text-text-secondary">
              · {preview.candidates.length} variante{preview.candidates.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="shrink-0 self-center">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold font-body ${
              mappedCount > 0
                ? "bg-[#DCFCE7] text-[#15803D]"
                : "bg-[#FEF3C7] text-[#B45309]"
            }`}
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              {mappedCount > 0 ? (
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              ) : (
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              )}
            </svg>
            {mappedCount}/{preview.localColors.length} liée{mappedCount > 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function PairRow({
  local,
  selectedCandidate,
  candidates,
  mapping,
  onChange,
  disabled,
}: {
  local: PfsLinkLocalColor;
  selectedCandidate: PfsLinkCandidate | null;
  candidates: PfsLinkCandidate[];
  mapping: Record<string, string>;
  onChange: (pfsVid: string | null) => void;
  disabled: boolean;
}) {
  const options = useMemo(() => {
    const opts = candidates.map((c) => {
      const usedByOther = Object.entries(mapping).some(
        ([k, v]) => k !== local.productColorId && v === c.pfsVariantId,
      );
      const label = `${c.pfsColorName} · ${c.sizeLabel} · ${c.type}${
        usedByOther ? " · déjà lié" : ""
      }`;
      return {
        value: c.pfsVariantId,
        label,
        disabled: usedByOther,
      };
    });
    return [{ value: "", label: "— Ne pas lier —" }, ...opts];
  }, [candidates, mapping, local.productColorId]);

  return (
    <div className="rounded-xl border border-border bg-bg-primary overflow-hidden shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr]">
        {/* COLONNE GAUCHE : variante BJ */}
        <div className="p-4 flex gap-3 items-start">
          <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-bg-secondary border border-border relative">
            {local.productImage ? (
              <Image
                src={getImageSrc(local.productImage, "thumb")}
                alt={local.name}
                fill
                sizes="80px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={40} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={14} />
              <p className="font-body text-sm font-semibold text-text-primary truncate">
                {local.name}
              </p>
              <span
                className={`badge ${local.saleType === "PACK" ? "badge-info" : "badge-neutral"}`}
              >
                {local.saleType}
              </span>
            </div>
            <p className="font-body text-[11px] text-text-muted uppercase tracking-wider mb-1.5">
              Votre variante
            </p>
            <div className="space-y-0.5">
              <p className="font-body text-xs text-text-secondary">
                Prix :{" "}
                <span className="font-semibold text-text-primary">
                  {formatPrice(local.unitPrice)}
                </span>
              </p>
              <p className="font-body text-xs text-text-secondary">
                Stock :{" "}
                <span
                  className={`font-semibold ${
                    local.stock > 0 ? "text-text-primary" : "text-[#DC2626]"
                  }`}
                >
                  {local.stock}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* SÉPARATEUR */}
        <div className="hidden md:flex items-center justify-center px-2 bg-bg-secondary/40">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              selectedCandidate
                ? "bg-[#DCFCE7] text-[#15803D]"
                : "bg-bg-secondary text-text-muted"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </div>

        {/* COLONNE DROITE : variante PFS */}
        <div
          className={`p-4 border-t md:border-t-0 md:border-l border-border ${
            selectedCandidate ? "bg-[#F0FDF4]/40" : "bg-bg-secondary/30"
          }`}
        >
          {selectedCandidate ? (
            <div className="flex gap-3 items-start">
              <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-bg-secondary border border-border relative">
                {selectedCandidate.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedCandidate.imageUrl}
                    alt={selectedCandidate.pfsColorName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_THUMB;
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center w-full h-full">
                    <ColorSwatch
                      hex={selectedCandidate.pfsColorHex}
                      patternImage={selectedCandidate.pfsColorImage}
                      size={40}
                    />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <ColorSwatch
                    hex={selectedCandidate.pfsColorHex}
                    patternImage={selectedCandidate.pfsColorImage}
                    size={14}
                  />
                  <p className="font-body text-sm font-semibold text-text-primary truncate">
                    {selectedCandidate.pfsColorName}
                  </p>
                </div>
                <p className="font-body text-[11px] text-text-muted mb-1.5">
                  {selectedCandidate.sizeLabel} · {selectedCandidate.type}
                </p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedCandidate.isActive ? (
                    <span className="badge badge-success">Active</span>
                  ) : (
                    <span className="badge badge-warning">Inactive</span>
                  )}
                  <span className="badge badge-info">
                    Stock {selectedCandidate.stockQty}
                  </span>
                  <span className="badge badge-neutral">
                    {formatPrice(selectedCandidate.priceUnit)} HT
                  </span>
                </div>
                <CustomSelect
                  value={selectedCandidate.pfsVariantId}
                  onChange={(v) => onChange(v || null)}
                  options={options}
                  size="sm"
                  disabled={disabled}
                  searchable
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-[88px] gap-2">
              <p className="font-body text-xs text-text-muted">— Pas encore liée —</p>
              <div className="w-full">
                <CustomSelect
                  value=""
                  onChange={(v) => onChange(v || null)}
                  options={options}
                  placeholder="Choisir une variante PFS…"
                  size="sm"
                  disabled={disabled}
                  searchable
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BjOrphansSection({ colors }: { colors: PfsLinkLocalColor[] }) {
  return (
    <div className="rounded-xl bg-[#FFF7ED] border border-[#FED7AA] px-4 py-3">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-base mt-0.5">⚠️</span>
        <div className="flex-1">
          <p className="font-body text-sm font-semibold text-[#9A3412] mb-0.5">
            {colors.length} variante(s) chez vous sans correspondance PFS
          </p>
          <p className="font-body text-xs text-[#9A3412]/80">
            Ces variantes ne seront pas reliées. Pour les pousser sur PFS,
            utilisez « Resync » après la liaison (ou re-publiez le produit).
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <span
            key={c.productColorId}
            className="inline-flex items-center gap-1.5 bg-bg-primary border border-[#FED7AA] rounded-full px-2.5 py-1"
          >
            <ColorSwatch hex={c.hex} patternImage={c.patternImage} size={14} />
            <span className="font-body text-[11px] text-[#9A3412] font-medium">
              {c.name} · {c.saleType}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PfsOrphansSection({ candidates }: { candidates: PfsLinkCandidate[] }) {
  return (
    <div className="rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] px-4 py-3">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-base mt-0.5">ℹ️</span>
        <div className="flex-1">
          <p className="font-body text-sm font-semibold text-[#1E40AF] mb-0.5">
            {candidates.length} variante(s) PFS sans équivalent chez vous
          </p>
          <p className="font-body text-xs text-[#1E40AF]/80">
            Ces variantes existent sur PFS mais ne sont pas dans votre fiche BJ.
            Elles resteront actives côté PFS — vous pouvez les supprimer
            manuellement depuis l&apos;interface PFS si besoin.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {candidates.map((c) => (
          <span
            key={c.pfsVariantId}
            className="inline-flex items-center gap-1.5 bg-bg-primary border border-[#BFDBFE] rounded-full px-2.5 py-1"
          >
            <ColorSwatch hex={c.pfsColorHex} patternImage={c.pfsColorImage} size={14} />
            <span className="font-body text-[11px] text-[#1E40AF] font-medium">
              {c.pfsColorName} · {c.sizeLabel}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SyncRecap({
  preview,
  mapping,
}: {
  preview: PfsLinkPreview;
  mapping: Record<string, string>;
}) {
  if (preview.localColors.length === 0) return null;
  return (
    <div className="rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] px-4 py-3">
      <p className="font-body text-xs font-semibold text-[#1E40AF] uppercase tracking-wider mb-2">
        À la liaison, on resynchronisera vers PFS :
      </p>
      <ul className="space-y-1">
        {preview.localColors.map((local) => {
          const pfsVid = mapping[local.productColorId];
          const cand =
            pfsVid
              ? preview.candidates.find((c) => c.pfsVariantId === pfsVid)
              : null;
          return (
            <li key={local.productColorId} className="flex items-center gap-2">
              <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={12} />
              <span className="font-body text-xs text-[#1E40AF]">
                <strong>{local.name}</strong>
                {cand ? (
                  <>
                    {" → "}
                    {cand.pfsColorName} · {cand.sizeLabel} · prix{" "}
                    {formatPrice(local.unitPrice)} · stock {local.stock}
                  </>
                ) : (
                  <span className="font-medium opacity-70"> → non liée (ignorée)</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ColorSwatch({
  hex,
  patternImage,
  size,
}: {
  hex: string | null;
  patternImage: string | null;
  size: number;
}) {
  const style: React.CSSProperties = patternImage
    ? {
        width: size,
        height: size,
        backgroundImage: `url(${patternImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {
        width: size,
        height: size,
        backgroundColor: hex ?? "#E5E7EB",
      };
  return (
    <span
      className="inline-block rounded-full border border-border shrink-0"
      style={style}
      aria-hidden
    />
  );
}
