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

  // mapping[productColorId] = pfsVariantId — clé par couleur BJ
  const [mapping, setMapping] = useState<Record<string, string>>({});

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await previewPfsMatchByReference(productId, refInput);
      if (res.success) {
        setPreview(res.data);
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
        { id: preview.pfsBrandId ?? null, name: preview.pfsBrandName ?? null },
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
  const totalLocal = preview?.localColors.length ?? 0;
  const canSaveLink =
    preview !== null && preview.pfsProductId !== null && mappedCount > 0;

  return (
    <LinkModalShell
      marketplace="pfs"
      productName={productName}
      reference={reference}
      alreadyLinked={preview?.alreadyLinked ?? false}
      onClose={onClose}
      closeDisabled={isSaving}
      searchBar={
        <SearchField
          label="Référence PFS à rechercher"
          value={refInput}
          onChange={setRefInput}
          onSubmit={load}
          placeholder="ex : A2415"
          loading={isLoading}
          disabled={isSaving}
          helper={
            <>
              Tapez la référence exacte côté PFS. On affichera toutes les variantes
              (couleurs × tailles) trouvées, à associer à vos couleurs.
            </>
          }
        />
      }
      footer={
        <>
          <p className="font-body text-xs text-text-muted">
            {!preview || !preview.pfsProductId
              ? "—"
              : (
                <>
                  <span className="font-semibold text-text-secondary">{mappedCount}</span>
                  {" "}/{" "}<span className="text-text-secondary">{totalLocal}</span> variante(s) prête(s)
                  {orphanLocalColors.length > 0 && (
                    <span className="ml-2 text-amber-700">
                      · {orphanLocalColors.length} non liée(s)
                    </span>
                  )}
                </>
              )}
          </p>
          <div className="flex gap-2">
            <ModalButton onClick={onClose} disabled={isSaving}>
              Annuler
            </ModalButton>
            <ModalButton variant="primary" onClick={handleSave} disabled={isSaving || !canSaveLink}>
              {isSaving
                ? "Liaison + synchro…"
                : `Lier ${mappedCount} variante${mappedCount > 1 ? "s" : ""}`}
            </ModalButton>
          </div>
        </>
      }
    >
      {isLoading && <LoadingState>Recherche en cours…</LoadingState>}

      {error && !isLoading && (
        <Callout tone="danger" icon={ModalIcons.Block} title="Erreur de recherche">
          {error}
        </Callout>
      )}

      {preview && !preview.pfsProductId && !isLoading && (
        <EmptyState
          title={<>Aucun produit PFS trouvé pour « {preview.pfsReference} »</>}
          description="Vérifiez la référence ou créez d'abord le produit côté PFS."
        />
      )}

      {preview && preview.pfsProductId && (
        <div className="space-y-4">
          <PfsProductBanner preview={preview} mappedCount={mappedCount} totalLocal={totalLocal} />

          {preview.candidates.length === 0 && (
            <Callout tone="danger" icon={ModalIcons.Warning} title="Aucune variante chez PFS">
              Le produit PFS existe mais n&apos;a aucune variante — créez-en d&apos;abord côté
              PFS avant de pouvoir lier.
            </Callout>
          )}

          {preview.localColors.length === 0 && (
            <Callout tone="danger" icon={ModalIcons.Warning} title="Aucune couleur chez vous">
              Ce produit n&apos;a aucune variante côté BJ. Ajoutez au moins une couleur avant
              de lier.
            </Callout>
          )}

          {preview.localColors.length > 0 && preview.candidates.length > 0 && (
            <div className="space-y-2.5">
              {preview.localColors.map((local) => {
                const selectedPfsId = mapping[local.productColorId];
                const selectedCand = selectedPfsId
                  ? preview.candidates.find((c) => c.pfsVariantId === selectedPfsId) ?? null
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

          {orphanLocalColors.length > 0 && <BjOrphansSection colors={orphanLocalColors} />}

          {orphanCandidates.length > 0 && preview.localColors.length > 0 && (
            <PfsOrphansSection candidates={orphanCandidates} />
          )}

          {preview.localColors.length > 0 && preview.candidates.length > 0 && (
            <SyncRecap preview={preview} mapping={mapping} />
          )}
        </div>
      )}
    </LinkModalShell>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SOUS-COMPOSANTS
// ────────────────────────────────────────────────────────────────────────────

function PfsProductBanner({
  preview,
  mappedCount,
  totalLocal,
}: {
  preview: PfsLinkPreview;
  mappedCount: number;
  totalLocal: number;
}) {
  return (
    <div className="rounded-xl bg-bg-primary border border-border-light overflow-hidden">
      <div className="flex gap-4 p-4">
        <div className="shrink-0 w-24 h-24 rounded-lg bg-bg-secondary overflow-hidden border border-border-light">
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
              {ModalIcons.Image}
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <span className="font-mono text-[11px] bg-bg-secondary text-text-secondary px-1.5 py-0.5 rounded">
              {preview.pfsReference}
            </span>
            {preview.pfsBrandName && (
              <span className="text-[11px] font-body text-text-secondary">
                Marque{" "}
                <strong className="text-text-primary font-semibold">
                  {preview.pfsBrandName}
                </strong>
              </span>
            )}
            <span className="text-[11px] font-body text-text-secondary">
              {preview.candidates.length} variante
              {preview.candidates.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="shrink-0 self-center">
          <MappingProgress current={mappedCount} total={totalLocal} done={mappedCount === totalLocal && totalLocal > 0} />
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
      return { value: c.pfsVariantId, label, disabled: usedByOther };
    });
    return [{ value: "", label: "— Ne pas lier —" }, ...opts];
  }, [candidates, mapping, local.productColorId]);

  return (
    <div
      className={`rounded-xl border bg-bg-primary overflow-hidden transition-colors ${
        selectedCandidate ? "border-emerald-200" : "border-border-light"
      }`}
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr]">
        {/* Gauche : variante BJ */}
        <div className="p-4 flex gap-3 items-start">
          <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-bg-secondary border border-border-light relative">
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
            <p className="font-body text-[10px] text-text-muted uppercase tracking-wider mb-1">
              Votre variante
            </p>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={14} />
              <p className="font-body text-sm font-semibold text-text-primary truncate">
                {local.name}
              </p>
              <span className={`badge ${local.saleType === "PACK" ? "badge-info" : "badge-neutral"}`}>
                {local.saleType}
              </span>
            </div>
            <div className="text-xs font-body text-text-secondary space-y-0.5">
              <p>
                Prix :{" "}
                <span className="font-semibold text-text-primary">
                  {formatPrice(local.unitPrice)}
                </span>
              </p>
              <p>
                Stock :{" "}
                <span
                  className={`font-semibold ${
                    local.stock > 0 ? "text-text-primary" : "text-rose-600"
                  }`}
                >
                  {local.stock}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Séparateur */}
        <div className="hidden md:flex items-center justify-center px-2 bg-bg-secondary/40">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              selectedCandidate
                ? "bg-emerald-100 text-emerald-700"
                : "bg-bg-tertiary text-text-muted"
            }`}
          >
            {ModalIcons.Arrow}
          </div>
        </div>

        {/* Droite : variante PFS */}
        <div
          className={`p-4 border-t md:border-t-0 md:border-l border-border-light transition-colors ${
            selectedCandidate ? "bg-emerald-50/40" : "bg-bg-secondary/40"
          }`}
        >
          {selectedCandidate ? (
            <div className="flex gap-3 items-start">
              <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-bg-secondary border border-border-light">
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
                <p className="font-body text-[10px] text-text-muted uppercase tracking-wider mb-1">
                  Variante PFS
                </p>
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
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
                  <span className={`badge ${selectedCandidate.isActive ? "badge-success" : "badge-warning"}`}>
                    {selectedCandidate.isActive ? "Active" : "Inactive"}
                  </span>
                  <span className="badge badge-info">Stock {selectedCandidate.stockQty}</span>
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
            <div className="flex flex-col items-center justify-center h-full min-h-[96px] gap-2 py-2">
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
    <Callout
      tone="warning"
      icon={ModalIcons.Warning}
      title={`${colors.length} variante(s) chez vous sans correspondance PFS`}
    >
      <p className="mb-2">
        Ces variantes ne seront pas reliées. Pour les pousser sur PFS, utilisez « Resync »
        après la liaison (ou re-publiez le produit).
      </p>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c) => (
          <span
            key={c.productColorId}
            className="inline-flex items-center gap-1.5 bg-bg-primary border border-amber-200 rounded-full px-2.5 py-1"
          >
            <ColorSwatch hex={c.hex} patternImage={c.patternImage} size={12} />
            <span className="font-body text-[11px] text-amber-900 font-medium">
              {c.name} · {c.saleType}
            </span>
          </span>
        ))}
      </div>
    </Callout>
  );
}

function PfsOrphansSection({ candidates }: { candidates: PfsLinkCandidate[] }) {
  return (
    <Callout
      tone="info"
      icon={ModalIcons.Info}
      title={`${candidates.length} variante(s) PFS sans équivalent chez vous`}
    >
      <p className="mb-2">
        Ces variantes existent sur PFS mais ne sont pas dans votre fiche BJ. Elles resteront
        actives côté PFS — vous pouvez les supprimer manuellement depuis l&apos;interface PFS
        si besoin.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {candidates.map((c) => (
          <span
            key={c.pfsVariantId}
            className="inline-flex items-center gap-1.5 bg-bg-primary border border-sky-200 rounded-full px-2.5 py-1"
          >
            <ColorSwatch hex={c.pfsColorHex} patternImage={c.pfsColorImage} size={12} />
            <span className="font-body text-[11px] text-sky-900 font-medium">
              {c.pfsColorName} · {c.sizeLabel}
            </span>
          </span>
        ))}
      </div>
    </Callout>
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
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3">
      <p className="font-body text-[11px] font-semibold text-sky-900 uppercase tracking-wider mb-2">
        À la liaison, on resynchronisera vers PFS :
      </p>
      <ul className="space-y-1">
        {preview.localColors.map((local) => {
          const pfsVid = mapping[local.productColorId];
          const cand = pfsVid
            ? preview.candidates.find((c) => c.pfsVariantId === pfsVid)
            : null;
          return (
            <li key={local.productColorId} className="flex items-center gap-2">
              <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={12} />
              <span className="font-body text-xs text-sky-900">
                <strong>{local.name}</strong>
                {cand ? (
                  <>
                    {" → "}
                    {cand.pfsColorName} · {cand.sizeLabel} · prix {formatPrice(local.unitPrice)} ·
                    stock {local.stock}
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
