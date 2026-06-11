"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  previewEfashionMatchByReference,
  linkEfashionProductManually,
  deleteEfashionProductLine,
  createLocalVariantFromEfashionLine,
  type EfashionLinkPreview,
  type EfashionLinkCandidate,
  type EfashionLinkLocalColor,
} from "@/app/actions/admin/efashion";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";
import { getImageSrc } from "@/lib/image-utils";
import { LinkModalShell } from "./link-modal/LinkModalShell";
import {
  Callout,
  ColorSwatch,
  EmptyState,
  LoadingState,
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

export default function LinkEfashionProductModal({
  productId,
  productName,
  reference,
  onClose,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [refInput, setRefInput] = useState(() => reference.split(/[-_]/)[0] ?? reference);
  const [preview, setPreview] = useState<EfashionLinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [pendingOrphanAction, setPendingOrphanAction] = useState<number | null>(null);

  // mapping[localColorId] = efashionProductId
  const [mapping, setMapping] = useState<Record<string, number>>({});

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await previewEfashionMatchByReference(productId, refInput);
      if (res.success) {
        setPreview(res.data);
        const initial: Record<string, number> = { ...res.data.existingLinks };
        const usedEfIds = new Set(Object.values(initial));
        for (const cand of res.data.candidates) {
          if (
            cand.suggestedLocalColorId &&
            !(cand.suggestedLocalColorId in initial) &&
            !usedEfIds.has(cand.efashionProductId)
          ) {
            initial[cand.suggestedLocalColorId] = cand.efashionProductId;
            usedEfIds.add(cand.efashionProductId);
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

  function setColorMapping(localColorId: string, efashionProductIdOrEmpty: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (!efashionProductIdOrEmpty) {
        delete next[localColorId];
        return next;
      }
      const efId = parseInt(efashionProductIdOrEmpty, 10);
      if (Number.isNaN(efId)) {
        delete next[localColorId];
        return next;
      }
      for (const [k, v] of Object.entries(next)) {
        if (v === efId && k !== localColorId) delete next[k];
      }
      next[localColorId] = efId;
      return next;
    });
  }

  function handleSave() {
    if (!preview) return;
    const links = Object.entries(mapping).map(([localColorId, efashionProductId]) => {
      const cand = preview.candidates.find((c) => c.efashionProductId === efashionProductId);
      return {
        localColorId,
        efashionProductId,
        efashionColorId: cand?.efashionColorId,
      };
    });
    if (links.length === 0 && preview.localColors.length === 0) {
      toast.error("Aucune couleur liée", "Sélectionnez au moins une ligne eFashion.");
      return;
    }
    startSaving(async () => {
      const res = await linkEfashionProductManually(productId, preview.referenceBase, links);
      if (res.success) {
        if (res.syncWarning) {
          toast.warning(
            "Produit lié — mais la synchro stock/prix a échoué",
            res.syncWarning + " Relancez « Resync » depuis la fiche.",
          );
        } else {
          const created = res.autoCreatedOnEfashion ?? 0;
          const linkedCount = res.linked ?? 0;
          const detail =
            created > 0
              ? `${linkedCount} couleur(s) reliée(s) + ${created} créée(s) chez eFashion. Stock et prix poussés.`
              : `${linkedCount} couleur(s) reliée(s). Stock et prix poussés.`;
          toast.success("Produit lié à eFashion", detail);
        }
        onClose();
        router.refresh();
      } else {
        toast.error("Échec de la liaison", res.error ?? "Erreur inconnue.");
      }
    });
  }

  async function handleDeleteEfashionLine(cand: EfashionLinkCandidate) {
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette ligne chez eFashion ?",
      message:
        `La ligne « ${cand.reference} — ${cand.efashionColorName} » sera supprimée ` +
        "DÉFINITIVEMENT chez eFashion. Cette action est irréversible.",
      confirmLabel: "Supprimer chez eFashion",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;
    setPendingOrphanAction(cand.efashionProductId);
    const res = await deleteEfashionProductLine(cand.efashionProductId);
    setPendingOrphanAction(null);
    if (res.success) {
      toast.success(
        "Ligne supprimée chez eFashion",
        `« ${cand.efashionColorName} » a été retirée.`,
      );
      load();
    } else {
      toast.error("Échec de la suppression", res.error ?? "Erreur inconnue.");
    }
  }

  async function handleCreateLocalVariant(cand: EfashionLinkCandidate) {
    setPendingOrphanAction(cand.efashionProductId);
    const res = await createLocalVariantFromEfashionLine(productId, cand.efashionProductId);
    setPendingOrphanAction(null);
    if (res.success) {
      toast.success(
        "Variante créée chez vous",
        res.createdColor
          ? `Couleur ajoutée (à compléter dans /admin/couleurs).`
          : `« ${cand.efashionColorName} » liée automatiquement.`,
      );
      load();
    } else {
      toast.error("Échec de la création locale", res.error ?? "Erreur inconnue.");
    }
  }

  const unusedCandidates = useMemo(() => {
    if (!preview) return [];
    const used = new Set(Object.values(mapping));
    return preview.candidates.filter((c) => !used.has(c.efashionProductId));
  }, [preview, mapping]);

  const orphanLocalColors = useMemo(() => {
    if (!preview) return [];
    return preview.localColors.filter((c) => !(c.id in mapping));
  }, [preview, mapping]);

  const orphanEfLines = unusedCandidates;

  const hasMissingAttributes = (preview?.missingAttributes.length ?? 0) > 0;
  const canSaveLink =
    preview !== null &&
    preview.localColors.length > 0 &&
    orphanEfLines.length === 0 &&
    !hasMissingAttributes;

  const mappedCount = Object.keys(mapping).length;
  const totalLocal = preview?.localColors.length ?? 0;

  const footerStatus = (() => {
    if (!preview) return "—";
    if (hasMissingAttributes) return `${preview.missingAttributes.length} attribut(s) eFashion à régler`;
    if (orphanEfLines.length > 0) return `${orphanEfLines.length} ligne(s) eFashion à régler avant de lier`;
    if (orphanLocalColors.length > 0)
      return `${mappedCount} liée(s) + ${orphanLocalColors.length} à créer chez eFashion`;
    return `${mappedCount}/${totalLocal} couleur(s) prête(s) à lier`;
  })();

  const footerStatusTone = (() => {
    if (!preview) return "text-text-muted";
    if (hasMissingAttributes || orphanEfLines.length > 0) return "text-rose-700";
    if (orphanLocalColors.length > 0) return "text-sky-700";
    return "text-emerald-700";
  })();

  // ── Search bar ────────────────────────────────────────────────────
  const searchBar = (
    <SearchField
      label="Référence eFashion à rechercher"
      value={refInput}
      onChange={setRefInput}
      onSubmit={load}
      placeholder="ex : A2415"
      loading={isLoading}
      disabled={isSaving}
      helper={
        <>
          Tapez la référence de base (sans suffixe couleur). On affichera toutes les
          lignes-couleurs eFashion correspondantes, à associer à vos couleurs.
        </>
      }
    />
  );

  // ── Footer ────────────────────────────────────────────────────────
  const footer = (
    <>
      <p className={`font-body text-xs font-medium ${footerStatusTone}`}>{footerStatus}</p>
      <div className="flex gap-2">
        <ModalButton onClick={onClose} disabled={isSaving}>
          Annuler
        </ModalButton>
        <ModalButton
          variant="primary"
          onClick={handleSave}
          disabled={isSaving || !canSaveLink}
          title={
            canSaveLink
              ? undefined
              : hasMissingAttributes
                ? "Réglez d'abord les attributs eFashion (catégorie, pays, saison, matières, couleurs)."
                : "Réglez d'abord les lignes eFashion sans équivalent chez vous (créez-les chez nous ou supprimez chez eux)."
          }
        >
          {isSaving
            ? "Liaison + synchro…"
            : preview && orphanLocalColors.length > 0
              ? `Lier ${mappedCount} + créer ${orphanLocalColors.length}`
              : `Lier ${mappedCount > 0 ? mappedCount : totalLocal} variante${(mappedCount > 0 ? mappedCount : totalLocal) > 1 ? "s" : ""}`}
        </ModalButton>
      </div>
    </>
  );

  return (
    <LinkModalShell
      marketplace="efashion"
      productName={productName}
      reference={reference}
      alreadyLinked={preview?.alreadyLinked ?? false}
      onClose={onClose}
      closeDisabled={isSaving}
      searchBar={searchBar}
      footer={footer}
    >
      {isLoading && <LoadingState>Recherche en cours…</LoadingState>}

      {error && !isLoading && (
        <Callout tone="danger" icon={ModalIcons.Block} title="Erreur de recherche">
          {error}
        </Callout>
      )}

      {preview && preview.candidates.length === 0 && !isLoading && (
        <EmptyState
          title={<>Aucune ligne trouvée chez eFashion pour « {preview.referenceBase} »</>}
          description="Vérifiez la référence ou créez d'abord le produit côté eFashion."
        />
      )}

      {preview && preview.candidates.length > 0 && (
        <div className="space-y-4">
          <RecapBanner preview={preview} mappedCount={mappedCount} />

          {preview.missingAttributes.length > 0 && (
            <MissingAttributesSection items={preview.missingAttributes} />
          )}

          {preview.packOnlyColors.length > 0 && (
            <PackOnlySection colors={preview.packOnlyColors} />
          )}

          {preview.localColors.length === 0 && (
            <Callout
              tone="danger"
              icon={ModalIcons.Warning}
              title="Aucune variante à l'unité chez vous"
            >
              eFashion ne synchronise que les variantes vendues à l&apos;unité. Ajoutez-en au moins
              une pour pouvoir lier ce produit.
            </Callout>
          )}

          {preview.localColors.length > 0 && (
            <div className="space-y-2.5">
              {preview.localColors.map((local) => {
                const selectedEfId = mapping[local.id];
                const selectedCand =
                  selectedEfId !== undefined
                    ? preview.candidates.find((c) => c.efashionProductId === selectedEfId) ?? null
                    : null;
                return (
                  <PairRow
                    key={local.id}
                    local={local}
                    selectedCandidate={selectedCand}
                    candidates={preview.candidates}
                    mapping={mapping}
                    onChange={(efId) =>
                      setColorMapping(local.id, efId === null ? "" : String(efId))
                    }
                    disabled={isSaving}
                  />
                );
              })}
            </div>
          )}

          {orphanLocalColors.length > 0 && <BjOrphansSection colors={orphanLocalColors} />}

          {orphanEfLines.length > 0 && preview.localColors.length > 0 && (
            <EfashionOrphansSection
              candidates={orphanEfLines}
              localColors={preview.localColors}
              onAssign={(localColorId, efId) => setColorMapping(localColorId, String(efId))}
              onCreateLocal={handleCreateLocalVariant}
              onDeleteEfashion={handleDeleteEfashionLine}
              pendingId={pendingOrphanAction}
              disabled={isSaving}
            />
          )}

          {preview.localColors.length > 0 && <SyncRecap preview={preview} mapping={mapping} />}
        </div>
      )}
    </LinkModalShell>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SOUS-COMPOSANTS
// ────────────────────────────────────────────────────────────────────────────

function RecapBanner({
  preview,
  mappedCount,
}: {
  preview: EfashionLinkPreview;
  mappedCount: number;
}) {
  const totalLocal = preview.localColors.length;
  const totalCandidates = preview.candidates.length;
  const toCreateCount = Math.max(totalLocal - mappedCount, 0);
  return (
    <div className="rounded-xl bg-bg-primary border border-border-light px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-violet-100 text-violet-700">
          {ModalIcons.Sparkles}
        </span>
        <p className="font-body text-sm text-text-primary">
          <span className="font-semibold">{mappedCount}</span>
          <span className="text-text-muted"> / </span>
          <span className="font-semibold">{totalLocal}</span> couleur(s) BJ liée(s)
          {toCreateCount > 0 && (
            <span className="text-sky-700 ml-1">
              · <strong>{toCreateCount}</strong> à créer chez eFashion
            </span>
          )}
        </p>
      </div>
      <p className="font-body text-xs text-text-secondary">
        <strong>{totalCandidates}</strong> ligne(s) eFashion trouvée(s) pour{" "}
        <span className="font-mono text-[11px] bg-bg-secondary px-1.5 py-0.5 rounded">
          {preview.referenceBase}
        </span>
      </p>
    </div>
  );
}

function PackOnlySection({
  colors,
}: {
  colors: { id: string; name: string; hex: string | null; patternImage: string | null }[];
}) {
  return (
    <Callout
      tone="warning"
      icon={ModalIcons.Warning}
      title={`${colors.length} couleur(s) en paquet — ignorée(s) par eFashion`}
    >
      <p className="mb-2">
        eFashion ne gère que les variantes vendues à l&apos;unité. Ces couleurs ne seront
        pas synchronisées.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 bg-bg-primary border border-amber-200 rounded-full px-2.5 py-1"
          >
            <ColorSwatch hex={c.hex} patternImage={c.patternImage} size={12} />
            <span className="font-body text-[11px] text-amber-900 font-medium">{c.name}</span>
          </span>
        ))}
      </div>
    </Callout>
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
  local: EfashionLinkLocalColor;
  selectedCandidate: EfashionLinkCandidate | null;
  candidates: EfashionLinkCandidate[];
  mapping: Record<string, number>;
  onChange: (efId: number | null) => void;
  disabled: boolean;
}) {
  const options = useMemo(() => {
    const opts = candidates.map((c) => {
      const usedByOther = Object.entries(mapping).some(
        ([k, v]) => k !== local.id && v === c.efashionProductId,
      );
      return {
        value: String(c.efashionProductId),
        label: `${c.reference} — ${c.efashionColorName}${usedByOther ? " · déjà lié" : ""}`,
        disabled: usedByOther,
      };
    });
    return [{ value: "", label: "— Ne pas lier —" }, ...opts];
  }, [candidates, mapping, local.id]);

  return (
    <div
      className={`rounded-xl border bg-bg-primary overflow-hidden transition-colors ${
        selectedCandidate ? "border-emerald-200" : "border-border-light"
      }`}
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr]">
        {/* Gauche : couleur BJ */}
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
              Votre couleur
            </p>
            <div className="flex items-center gap-2 mb-1.5">
              <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={14} />
              <p className="font-body text-sm font-semibold text-text-primary truncate">
                {local.name}
              </p>
            </div>
            <div className="text-xs font-body text-text-secondary space-y-0.5">
              <p>
                Prix unité :{" "}
                <span className="font-semibold text-text-primary">{formatPrice(local.unitPrice)}</span>
              </p>
              <p>
                Stock :{" "}
                <span
                  className={`font-semibold ${
                    (local.unitStock ?? 0) > 0 ? "text-text-primary" : "text-rose-600"
                  }`}
                >
                  {local.unitStock ?? 0}
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

        {/* Droite : ligne eFashion */}
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
                    alt={selectedCandidate.efashionColorName}
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
                <p className="font-body text-[10px] text-text-muted uppercase tracking-wider mb-1">
                  Ligne eFashion
                </p>
                <p className="font-body text-sm font-semibold text-text-primary truncate mb-0.5">
                  {selectedCandidate.reference}
                </p>
                <p className="font-body text-xs text-text-secondary mb-1.5 truncate">
                  {selectedCandidate.efashionColorName}
                </p>
                <div className="flex flex-wrap gap-1 mb-2">
                  <span
                    className={`badge ${selectedCandidate.visible ? "badge-success" : "badge-warning"}`}
                  >
                    {selectedCandidate.visible ? "En ligne" : "Hors ligne"}
                  </span>
                  {selectedCandidate.supprimer && (
                    <span className="badge badge-error">Supprimée</span>
                  )}
                  <span className="badge badge-neutral">
                    {selectedCandidate.nbPhotos} photo{selectedCandidate.nbPhotos > 1 ? "s" : ""}
                  </span>
                  {selectedCandidate.stockValue !== null && (
                    <span className="badge badge-info">Stock {selectedCandidate.stockValue}</span>
                  )}
                </div>
                <CustomSelect
                  value={String(selectedCandidate.efashionProductId)}
                  onChange={(v) => onChange(v ? parseInt(v, 10) : null)}
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
                  onChange={(v) => onChange(v ? parseInt(v, 10) : null)}
                  options={options}
                  placeholder="Choisir une ligne eFashion…"
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

function MissingAttributesSection({ items }: { items: string[] }) {
  return (
    <Callout
      tone="danger"
      icon={ModalIcons.Block}
      title={`Liaison impossible — ${items.length} attribut(s) eFashion à régler`}
    >
      <p className="mb-2">
        Avant de pouvoir lier ou pousser ce produit vers eFashion, toutes ces correspondances
        doivent être renseignées (bibliothèque ou fiche produit selon les cas).
      </p>
      <ul className="space-y-1 pl-1">
        {items.map((label, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-rose-600 mt-0.5">•</span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </Callout>
  );
}

function BjOrphansSection({ colors }: { colors: EfashionLinkLocalColor[] }) {
  return (
    <Callout
      tone="info"
      icon={ModalIcons.Sparkles}
      title={`${colors.length} variante(s) chez vous à créer chez eFashion`}
    >
      <p className="mb-2">
        Ces couleurs n&apos;existent pas encore chez eFashion. À la liaison, elles seront créées
        automatiquement (avec leurs photos) et rattachées au même groupe que les couleurs déjà
        reliées.
      </p>
      <div className="space-y-1.5">
        {colors.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 bg-bg-primary border border-sky-200 rounded-lg px-3 py-2"
          >
            <ColorSwatch hex={c.hex} patternImage={c.patternImage} size={16} />
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-medium text-text-primary truncate">{c.name}</p>
              <p className="font-body text-[11px] text-text-muted">
                Prix unité {formatPrice(c.unitPrice)} · Stock {c.unitStock ?? 0}
              </p>
            </div>
            <span className="badge badge-info">Sera créée</span>
          </div>
        ))}
      </div>
    </Callout>
  );
}

function EfashionOrphansSection({
  candidates,
  localColors,
  onAssign,
  onCreateLocal,
  onDeleteEfashion,
  pendingId,
  disabled,
}: {
  candidates: EfashionLinkCandidate[];
  localColors: EfashionLinkLocalColor[];
  onAssign: (localColorId: string, efId: number) => void;
  onCreateLocal: (cand: EfashionLinkCandidate) => void;
  onDeleteEfashion: (cand: EfashionLinkCandidate) => void;
  pendingId: number | null;
  disabled: boolean;
}) {
  return (
    <Callout
      tone="warning"
      icon={ModalIcons.Warning}
      title={`${candidates.length} ligne(s) eFashion sans correspondance chez vous`}
    >
      <p className="mb-2">
        Pour chaque ligne, choisissez : assignez à une variante existante, créez-la chez vous,
        ou supprimez-la chez eFashion.
      </p>
      <div className="space-y-1.5">
        {candidates.map((c) => {
          const isPending = pendingId === c.efashionProductId;
          return (
            <div
              key={c.efashionProductId}
              className="flex flex-wrap items-center gap-3 bg-bg-primary border border-amber-200 rounded-lg px-3 py-2"
            >
              <div className="shrink-0 w-12 h-12 rounded-md overflow-hidden bg-bg-secondary border border-border-light flex items-center justify-center">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.imageUrl}
                    alt={c.efashionColorName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span className="text-text-muted">{ModalIcons.Image}</span>
                )}
              </div>
              <div className="flex-1 min-w-[140px]">
                <p className="font-body text-sm font-semibold text-text-primary">
                  {c.efashionColorName}
                </p>
                <p className="font-mono text-[11px] text-text-muted truncate">{c.reference}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  <span className={`badge ${c.visible ? "badge-success" : "badge-warning"}`}>
                    {c.visible ? "En ligne" : "Hors ligne"}
                  </span>
                  <span className="badge badge-neutral">
                    {c.nbPhotos} photo{c.nbPhotos > 1 ? "s" : ""}
                  </span>
                  {c.stockValue !== null && (
                    <span className="badge badge-info">Stock {c.stockValue}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {localColors.length > 0 && (
                  <div className="min-w-[150px]">
                    <CustomSelect
                      value=""
                      onChange={(v) => {
                        if (v) onAssign(v, c.efashionProductId);
                      }}
                      options={[
                        { value: "", label: "→ Assigner à…" },
                        ...localColors.map((lc) => ({
                          value: lc.id,
                          label: lc.name,
                        })),
                      ]}
                      size="sm"
                      disabled={disabled || isPending}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onCreateLocal(c)}
                  disabled={disabled || isPending}
                  className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-body font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {isPending ? "Création…" : "Créer chez nous"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteEfashion(c)}
                  disabled={disabled || isPending}
                  className="h-8 px-3 rounded-lg bg-bg-primary border border-rose-300 text-rose-700 text-[11px] font-body font-semibold hover:bg-rose-50 transition-colors disabled:opacity-50"
                >
                  {isPending ? "…" : "Supprimer chez eFashion"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Callout>
  );
}

function SyncRecap({
  preview,
  mapping,
}: {
  preview: EfashionLinkPreview;
  mapping: Record<string, number>;
}) {
  if (preview.localColors.length === 0) return null;
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3">
      <p className="font-body text-[11px] font-semibold text-sky-900 uppercase tracking-wider mb-2">
        À la liaison, eFashion recevra :
      </p>
      <ul className="space-y-1">
        {preview.localColors.map((local) => {
          const efId = mapping[local.id];
          const cand = efId !== undefined
            ? preview.candidates.find((c) => c.efashionProductId === efId)
            : null;
          return (
            <li key={local.id} className="flex items-center gap-2">
              <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={12} />
              <span className="font-body text-xs text-sky-900">
                <strong>{local.name}</strong>
                {cand ? (
                  <>
                    {" → "}
                    {cand.reference} · prix {formatPrice(local.unitPrice)} · stock {local.unitStock ?? 0}
                  </>
                ) : (
                  <span className="font-medium">
                    {" → "}création automatique (prix {formatPrice(local.unitPrice)} · stock{" "}
                    {local.unitStock ?? 0})
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
