"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  previewFaireMatchBySku,
  linkFaireProductManually,
  type FaireLinkPreview,
  type FaireLinkCandidate,
  type FaireLinkLocalColor,
} from "@/app/actions/admin/faire";
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

// Petit composant <img> avec fallback robuste : si l'URL d'origine plante
// (cdn.faire.com bloqué par un bloqueur de pub, mixed-content, etc.), on
// remplace par une icône image inline plutôt qu'un carré vide.
function ImageWithFallback({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div
        className={`flex items-center justify-center w-full h-full text-text-muted ${className ?? ""}`}
      >
        {ModalIcons.Image}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className ?? "w-full h-full object-cover"}
      onError={() => setErrored(true)}
    />
  );
}

function formatPriceEur(cents: number | null): string {
  if (cents === null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatPriceUnit(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(value);
}

export default function LinkFaireProductModal({
  productId,
  productName,
  reference,
  onClose,
}: Props) {
  const router = useRouter();
  const toast = useToast();

  const [skuInput, setSkuInput] = useState("");
  const [preview, setPreview] = useState<FaireLinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isSaving, startSaving] = useTransition();

  // mapping[productColorId] = faireVariantId
  const [mapping, setMapping] = useState<Record<string, string>>({});

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await previewFaireMatchBySku(productId, skuInput);
      if (res.success) {
        setPreview(res.data);
        // Pré-remplit le champ avec ce qu'a interprété le serveur (SKU local
        // par défaut au premier chargement, ou ce que l'admin a tapé ensuite).
        setSkuInput(res.data.faireSkuInput);

        const initial: Record<string, string> = { ...res.data.existingLinks };
        const usedFaireVids = new Set(Object.values(initial));
        for (const cand of res.data.candidates) {
          if (
            cand.suggestedLocalColorId &&
            !(cand.suggestedLocalColorId in initial) &&
            !usedFaireVids.has(cand.faireVariantId)
          ) {
            initial[cand.suggestedLocalColorId] = cand.faireVariantId;
            usedFaireVids.add(cand.faireVariantId);
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

  function setColorMapping(productColorId: string, faireVidOrEmpty: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (!faireVidOrEmpty) {
        delete next[productColorId];
        return next;
      }
      for (const [k, v] of Object.entries(next)) {
        if (v === faireVidOrEmpty && k !== productColorId) delete next[k];
      }
      next[productColorId] = faireVidOrEmpty;
      return next;
    });
  }

  function handleSave() {
    if (!preview || !preview.faireProductId) return;
    const links = Object.entries(mapping).map(([productColorId, faireVariantId]) => ({
      productColorId,
      faireVariantId,
    }));
    if (links.length === 0) {
      toast.error(
        "Aucune couleur liée",
        "Sélectionnez au moins une variante Faire.",
      );
      return;
    }
    startSaving(async () => {
      const res = await linkFaireProductManually(
        productId,
        preview.faireProductId!,
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
            "Produit lié à Faire",
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
    return preview.candidates.filter((c) => !used.has(c.faireVariantId));
  }, [preview, mapping]);

  const mappedCount = Object.keys(mapping).length;
  const totalLocal = preview?.localColors.length ?? 0;
  const canSaveLink =
    preview !== null && preview.faireProductId !== null && mappedCount > 0;

  return (
    <LinkModalShell
      marketplace="faire"
      productName={productName}
      reference={reference}
      alreadyLinked={preview?.alreadyLinked ?? false}
      onClose={onClose}
      closeDisabled={isSaving}
      searchBar={
        <SearchField
          label="Référence du produit à rechercher sur Faire"
          value={skuInput}
          onChange={setSkuInput}
          onSubmit={load}
          placeholder="ex : F137"
          loading={isLoading}
          disabled={isSaving}
          helper={
            <>
              Tapez la référence du produit (ex : <strong>F137</strong>) — on
              cherche automatiquement parmi toutes ses couleurs côté Faire. Si
              votre fiche Faire utilise un SKU personnalisé, vous pouvez coller
              directement le SKU complet.{" "}
              <strong>Seuls les produits en ligne sur Faire</strong> (publiés)
              sont recherchables.
            </>
          }
        />
      }
      footer={
        <>
          <p className="font-body text-xs text-text-muted">
            {!preview || !preview.faireProductId
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
      {isLoading && <LoadingState>Recherche en cours sur Faire…</LoadingState>}

      {error && !isLoading && (
        <Callout tone="danger" icon={ModalIcons.Block} title="Erreur de recherche">
          {error}
        </Callout>
      )}

      {preview && !preview.faireProductId && !isLoading && (
        <EmptyState
          title={<>Aucun produit Faire trouvé pour « {preview.faireSkuInput} »</>}
          description={
            <>
              Vérifiez que ce SKU correspond bien à un produit{" "}
              <strong>publié</strong> sur votre compte Faire. Les brouillons
              (non publiés) ne sont pas retrouvables par SKU — utilisez
              « Publier » à la place.
            </>
          }
        />
      )}

      {preview && preview.faireProductId && (
        <div className="space-y-4">
          <FaireProductBanner
            preview={preview}
            mappedCount={mappedCount}
            totalLocal={totalLocal}
          />

          {preview.otherMatchesCount > 0 && (
            <Callout
              tone="info"
              icon={ModalIcons.Info}
              title={`${preview.otherMatchesCount} autre(s) produit(s) Faire partagent ce SKU`}
            >
              On a sélectionné le produit publié (« en ligne »). Si ce n&apos;est
              pas le bon, précisez le SKU pour resserrer la recherche.
            </Callout>
          )}

          {preview.candidates.length === 0 && (
            <Callout tone="danger" icon={ModalIcons.Warning} title="Aucune variante chez Faire">
              Le produit Faire existe mais n&apos;a aucune variante exploitable
              — vérifiez côté portail Faire avant de pouvoir lier.
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
                const selectedFaireId = mapping[local.productColorId];
                const selectedCand = selectedFaireId
                  ? preview.candidates.find(
                      (c) => c.faireVariantId === selectedFaireId,
                    ) ?? null
                  : null;
                return (
                  <PairRow
                    key={local.productColorId}
                    local={local}
                    selectedCandidate={selectedCand}
                    candidates={preview.candidates}
                    mapping={mapping}
                    onChange={(faireVid) =>
                      setColorMapping(local.productColorId, faireVid ?? "")
                    }
                    disabled={isSaving}
                  />
                );
              })}
            </div>
          )}

          {orphanLocalColors.length > 0 && <BjOrphansSection colors={orphanLocalColors} />}

          {orphanCandidates.length > 0 && preview.localColors.length > 0 && (
            <FaireOrphansSection candidates={orphanCandidates} />
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

function FaireProductBanner({
  preview,
  mappedCount,
  totalLocal,
}: {
  preview: FaireLinkPreview;
  mappedCount: number;
  totalLocal: number;
}) {
  return (
    <div className="rounded-xl bg-bg-primary border border-border-light overflow-hidden">
      <div className="flex gap-4 p-4">
        <div className="shrink-0 w-24 h-24 rounded-lg bg-bg-secondary overflow-hidden border border-border-light">
          <ImageWithFallback
            src={preview.faireProductImage}
            alt={preview.faireProductName ?? ""}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-body text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Produit Faire trouvé
          </p>
          <p className="font-heading font-bold text-text-primary text-base truncate mt-0.5">
            {preview.faireProductName ?? preview.faireSkuInput}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <span className="font-mono text-[11px] bg-bg-secondary text-text-secondary px-1.5 py-0.5 rounded">
              {preview.faireProductId}
            </span>
            {preview.faireLifecycleState && (
              <span
                className={`badge ${
                  preview.faireLifecycleState === "PUBLISHED"
                    ? "badge-success"
                    : preview.faireLifecycleState === "DRAFT"
                      ? "badge-warning"
                      : preview.faireLifecycleState === "UNPUBLISHED"
                        ? "badge-neutral"
                        : "badge-error"
                }`}
              >
                {preview.faireLifecycleState}
              </span>
            )}
            <span className="text-[11px] font-body text-text-secondary">
              {preview.candidates.length} variante
              {preview.candidates.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="shrink-0 self-center">
          <MappingProgress
            current={mappedCount}
            total={totalLocal}
            done={mappedCount === totalLocal && totalLocal > 0}
          />
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
  local: FaireLinkLocalColor;
  selectedCandidate: FaireLinkCandidate | null;
  candidates: FaireLinkCandidate[];
  mapping: Record<string, string>;
  onChange: (faireVid: string | null) => void;
  disabled: boolean;
}) {
  const options = useMemo(() => {
    const opts = candidates.map((c) => {
      const usedByOther = Object.entries(mapping).some(
        ([k, v]) => k !== local.productColorId && v === c.faireVariantId,
      );
      const colorPart = c.colorLabel ?? c.faireVariantName;
      const label = `${colorPart} · ${c.faireSku}${usedByOther ? " · déjà lié" : ""}`;
      return { value: c.faireVariantId, label, disabled: usedByOther };
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
                  {formatPriceUnit(local.unitPrice)}
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

        {/* Droite : variante Faire */}
        <div
          className={`p-4 border-t md:border-t-0 md:border-l border-border-light transition-colors ${
            selectedCandidate ? "bg-emerald-50/40" : "bg-bg-secondary/40"
          }`}
        >
          {selectedCandidate ? (
            <div className="flex gap-3 items-start">
              <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-bg-secondary border border-border-light">
                <ImageWithFallback
                  src={selectedCandidate.imageUrl}
                  alt={selectedCandidate.colorLabel ?? selectedCandidate.faireSku}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body text-[10px] text-text-muted uppercase tracking-wider mb-1">
                  Variante Faire
                </p>
                <p className="font-body text-sm font-semibold text-text-primary truncate mb-0.5">
                  {selectedCandidate.colorLabel ?? selectedCandidate.faireVariantName}
                </p>
                <p className="font-mono text-[10px] text-text-muted mb-1.5 truncate">
                  {selectedCandidate.faireSku}
                </p>
                <div className="flex flex-wrap gap-1 mb-2">
                  <span
                    className={`badge ${
                      selectedCandidate.lifecycleState === "PUBLISHED"
                        ? "badge-success"
                        : selectedCandidate.lifecycleState === "DRAFT"
                          ? "badge-warning"
                          : "badge-neutral"
                    }`}
                  >
                    {selectedCandidate.lifecycleState ?? "?"}
                  </span>
                  <span className="badge badge-info">
                    Stock {selectedCandidate.availableQuantity}
                  </span>
                  <span className="badge badge-neutral">
                    {formatPriceEur(selectedCandidate.wholesalePriceCents)} HT
                  </span>
                </div>
                <CustomSelect
                  value={selectedCandidate.faireVariantId}
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
                  placeholder="Choisir une variante Faire…"
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

function BjOrphansSection({ colors }: { colors: FaireLinkLocalColor[] }) {
  return (
    <Callout
      tone="warning"
      icon={ModalIcons.Warning}
      title={`${colors.length} variante(s) chez vous sans correspondance Faire`}
    >
      <p className="mb-2">
        Ces variantes ne seront pas reliées. Pour les pousser sur Faire, créez
        d&apos;abord la variante côté Faire puis re-ouvrez cette modale, ou
        utilisez « Resync » après la liaison.
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

function FaireOrphansSection({ candidates }: { candidates: FaireLinkCandidate[] }) {
  return (
    <Callout
      tone="info"
      icon={ModalIcons.Info}
      title={`${candidates.length} variante(s) Faire sans équivalent chez vous`}
    >
      <p className="mb-2">
        Ces variantes existent sur Faire mais ne sont pas dans votre fiche BJ.
        Elles resteront actives côté Faire — vous pouvez les supprimer
        manuellement depuis le portail Faire si besoin.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {candidates.map((c) => (
          <span
            key={c.faireVariantId}
            className="inline-flex items-center gap-1.5 bg-bg-primary border border-sky-200 rounded-full px-2.5 py-1"
          >
            <span className="font-body text-[11px] text-sky-900 font-medium">
              {c.colorLabel ?? c.faireVariantName} · {c.faireSku}
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
  preview: FaireLinkPreview;
  mapping: Record<string, string>;
}) {
  if (preview.localColors.length === 0) return null;
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3">
      <p className="font-body text-[11px] font-semibold text-sky-900 uppercase tracking-wider mb-2">
        À la liaison, on resynchronisera vers Faire :
      </p>
      <ul className="space-y-1">
        {preview.localColors.map((local) => {
          const faireVid = mapping[local.productColorId];
          const cand = faireVid
            ? preview.candidates.find((c) => c.faireVariantId === faireVid)
            : null;
          return (
            <li key={local.productColorId} className="flex items-center gap-2">
              <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={12} />
              <span className="font-body text-xs text-sky-900">
                <strong>{local.name}</strong>
                {cand ? (
                  <>
                    {" → "}
                    {cand.colorLabel ?? cand.faireVariantName} · prix{" "}
                    {formatPriceUnit(local.unitPrice)} · stock {local.stock}
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
