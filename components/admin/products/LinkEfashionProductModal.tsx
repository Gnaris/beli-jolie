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

  /**
   * mapping[localColorId] = efashionProductId
   * Clé par couleur locale : empêche d'attribuer 2 fois la même couleur BJ.
   */
  const [mapping, setMapping] = useState<Record<string, number>>({});

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await previewEfashionMatchByReference(productId, refInput);
      if (res.success) {
        setPreview(res.data);
        // Pré-remplit le mapping en priorité depuis les liens DÉJÀ sauvés en BDD
        // (pour refléter l'état réel quand l'utilisatrice rouvre la modale après
        // une liaison réussie), puis complète avec les suggestions auto par nom
        // pour les couleurs pas encore liées.
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
      // Si cet efashionProductId est déjà mappé à une autre couleur, on le délie
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
    if (links.length === 0) {
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
          const detail = created > 0
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
      load(); // refresh preview
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
      load(); // refresh preview
    } else {
      toast.error("Échec de la création locale", res.error ?? "Erreur inconnue.");
    }
  }

  // Lignes eFashion non utilisées par le mapping courant
  const unusedCandidates = useMemo(() => {
    if (!preview) return [];
    const used = new Set(Object.values(mapping));
    return preview.candidates.filter((c) => !used.has(c.efashionProductId));
  }, [preview, mapping]);

  // Orphelins BJ : couleurs UNIT du produit non mappées à une ligne eFashion
  const orphanLocalColors = useMemo(() => {
    if (!preview) return [];
    return preview.localColors.filter((c) => !(c.id in mapping));
  }, [preview, mapping]);

  // Orphelins eFashion = `unusedCandidates` (alias plus parlant côté UI)
  const orphanEfLines = unusedCandidates;

  const hasMissingAttributes = (preview?.missingAttributes.length ?? 0) > 0;
  // Validation asymétrique :
  //   - Les couleurs BJ sans correspondance eFashion (orphanLocalColors) SONT
  //     autorisées : elles seront créées automatiquement chez eFashion lors
  //     de la sync post-liaison.
  //   - Les lignes eFashion sans correspondance chez nous (orphanEfLines)
  //     RESTENT bloquantes : l'admin doit d'abord les créer chez nous ou les
  //     supprimer chez eFashion (boutons dans EfashionOrphansSection).
  const canSaveLink =
    preview !== null &&
    preview.localColors.length > 0 &&
    orphanEfLines.length === 0 &&
    !hasMissingAttributes;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-bg-primary rounded-2xl shadow-lg max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col border border-border">
        {/* ─── HEADER ─── */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border bg-bg-secondary/30">
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="badge badge-purple">eFashion Paris</span>
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
                  · ✅ Déjà lié à eFashion
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
            Référence eFashion à rechercher
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
            Tapez la référence de base (sans suffixe couleur). On affichera toutes les
            lignes-couleurs eFashion correspondantes, et vous choisirez la bonne pour chaque
            couleur de votre produit.
          </p>
        </div>

        {/* ─── CORPS ─── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-bg-secondary/20">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="font-body text-sm text-text-muted">Recherche en cours…</div>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626] font-body">
              {error}
            </div>
          )}

          {preview && preview.candidates.length === 0 && !isLoading && (
            <div className="rounded-xl border border-dashed border-border bg-bg-primary px-6 py-10 text-center">
              <div className="text-4xl mb-3">🔍</div>
              <p className="font-body text-sm text-text-secondary mb-1">
                Aucune ligne trouvée chez eFashion pour la référence
                {" "}<strong>« {preview.referenceBase} »</strong>.
              </p>
              <p className="font-body text-xs text-text-muted">
                Vérifiez la référence ou créez d&apos;abord le produit côté eFashion.
              </p>
            </div>
          )}

          {preview && preview.candidates.length > 0 && (
            <div className="space-y-5">
              {/* Récap */}
              <RecapBar preview={preview} mapping={mapping} />

              {/* Attributs eFashion manquants — bloquant */}
              {preview.missingAttributes.length > 0 && (
                <MissingAttributesSection items={preview.missingAttributes} />
              )}

              {/* Variantes PACK ignorées */}
              {preview.packOnlyColors.length > 0 && (
                <PackOnlySection colors={preview.packOnlyColors} />
              )}

              {/* Pas de couleurs liables */}
              {preview.localColors.length === 0 && (
                <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-sm text-[#991B1B] font-body">
                  Ce produit n&apos;a aucune variante <strong>à l&apos;unité</strong>.
                  eFashion ne synchronise que les variantes unitaires — ajoutez-en au moins une
                  pour pouvoir lier ce produit.
                </div>
              )}

              {/* Cartes 2 colonnes */}
              {preview.localColors.length > 0 && (
                <div className="space-y-3">
                  {preview.localColors.map((local) => {
                    const selectedEfId = mapping[local.id];
                    const selectedCand =
                      selectedEfId !== undefined
                        ? preview.candidates.find(
                            (c) => c.efashionProductId === selectedEfId,
                          ) ?? null
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

              {/* Orphelins BJ — vos couleurs sans ligne eFashion */}
              {orphanLocalColors.length > 0 && (
                <BjOrphansSection colors={orphanLocalColors} />
              )}

              {/* Orphelins eFashion — leurs lignes sans variante chez vous */}
              {orphanEfLines.length > 0 && preview.localColors.length > 0 && (
                <EfashionOrphansSection
                  candidates={orphanEfLines}
                  localColors={preview.localColors}
                  onAssign={(localColorId, efId) =>
                    setColorMapping(localColorId, String(efId))
                  }
                  onCreateLocal={handleCreateLocalVariant}
                  onDeleteEfashion={handleDeleteEfashionLine}
                  pendingId={pendingOrphanAction}
                  disabled={isSaving}
                />
              )}

              {/* Récap final */}
              {preview.localColors.length > 0 && (
                <SyncRecap preview={preview} mapping={mapping} />
              )}
            </div>
          )}
        </div>

        {/* ─── FOOTER ─── */}
        <div className="px-6 py-4 border-t border-border bg-bg-primary flex items-center justify-between gap-3">
          <p className="font-body text-xs text-text-muted">
            {!preview
              ? "—"
              : hasMissingAttributes
                ? `⛔ ${preview.missingAttributes.length} attribut(s) eFashion à régler`
                : orphanEfLines.length > 0
                  ? `⛔ ${orphanEfLines.length} ligne(s) eFashion à régler avant de lier`
                  : orphanLocalColors.length > 0
                    ? `✅ ${Object.keys(mapping).length} liée(s) + ✨ ${orphanLocalColors.length} à créer chez eFashion`
                    : `✅ ${Object.keys(mapping).length} couleur(s) prête(s) à lier`}
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
              title={
                canSaveLink
                  ? undefined
                  : hasMissingAttributes
                    ? "Réglez d'abord les attributs eFashion (catégorie, pays, saison, matières, couleurs)."
                    : "Réglez d'abord les lignes eFashion sans équivalent chez vous (créez-les chez nous ou supprimez chez eux)."
              }
              className="h-10 px-5 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving
                ? "Liaison + synchro…"
                : preview && orphanLocalColors.length > 0
                  ? `Lier (${Object.keys(mapping).length}) + créer (${orphanLocalColors.length}) chez eFashion`
                  : `Lier${preview ? ` (${preview.localColors.length} couleur${preview.localColors.length > 1 ? "s" : ""})` : ""}`}
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

function RecapBar({
  preview,
  mapping,
}: {
  preview: EfashionLinkPreview;
  mapping: Record<string, number>;
}) {
  const mappedCount = Object.keys(mapping).length;
  const totalLocal = preview.localColors.length;
  const totalCandidates = preview.candidates.length;
  const toCreateCount = totalLocal - mappedCount;
  return (
    <div className="rounded-xl bg-bg-primary border border-border px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-base">✅</span>
        <span className="font-body text-sm text-text-primary">
          <strong>{mappedCount}</strong> / {totalLocal} couleur(s) BJ liée(s)
          {toCreateCount > 0 && (
            <span className="text-[#1E40AF] ml-1">
              · ✨ <strong>{toCreateCount}</strong> à créer chez eFashion
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-body text-sm text-text-secondary">
          <strong>{totalCandidates}</strong> ligne(s) eFashion trouvée(s)
          pour <span className="font-mono text-xs bg-bg-secondary px-1.5 py-0.5 rounded">
            {preview.referenceBase}
          </span>
        </span>
      </div>
    </div>
  );
}

function PackOnlySection({
  colors,
}: {
  colors: { id: string; name: string; hex: string | null; patternImage: string | null }[];
}) {
  return (
    <div className="rounded-xl bg-[#FEF3C7] border border-[#FDE68A] px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="text-base mt-0.5">⚠️</span>
        <div className="flex-1">
          <p className="font-body text-sm font-semibold text-[#92400E] mb-1">
            {colors.length} couleur(s) en paquet — ignorée(s) par eFashion
          </p>
          <p className="font-body text-xs text-[#92400E]/80 mb-2">
            eFashion ne gère que les variantes vendues à l&apos;unité. Ces couleurs ne seront
            pas synchronisées.
          </p>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 bg-bg-primary border border-[#FDE68A] rounded-full px-2.5 py-1"
              >
                <ColorSwatch hex={c.hex} patternImage={c.patternImage} size={14} />
                <span className="font-body text-[11px] text-[#92400E] font-medium">
                  {c.name}
                </span>
              </span>
            ))}
          </div>
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
    <div className="rounded-xl border border-border bg-bg-primary overflow-hidden shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr]">
        {/* COLONNE GAUCHE : couleur BJ */}
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
            <div className="flex items-center gap-2 mb-1">
              <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={14} />
              <p className="font-body text-sm font-semibold text-text-primary truncate">
                {local.name}
              </p>
            </div>
            <p className="font-body text-[11px] text-text-muted uppercase tracking-wider mb-1.5">
              Votre couleur
            </p>
            <div className="space-y-0.5">
              <p className="font-body text-xs text-text-secondary">
                Prix unité :{" "}
                <span className="font-semibold text-text-primary">
                  {formatPrice(local.unitPrice)}
                </span>
              </p>
              <p className="font-body text-xs text-text-secondary">
                Stock :{" "}
                <span
                  className={`font-semibold ${
                    (local.unitStock ?? 0) > 0 ? "text-text-primary" : "text-[#DC2626]"
                  }`}
                >
                  {local.unitStock ?? 0}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* SÉPARATEUR + FLÈCHE */}
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

        {/* COLONNE DROITE : ligne eFashion */}
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
                    alt={selectedCandidate.efashionColorName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_THUMB;
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center w-full h-full text-text-muted text-[10px] font-body">
                    Pas de photo
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-semibold text-text-primary truncate mb-0.5">
                  {selectedCandidate.reference}
                </p>
                <p className="font-body text-xs text-text-secondary mb-1.5">
                  {selectedCandidate.efashionColorName}
                </p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedCandidate.visible ? (
                    <span className="badge badge-success">En ligne</span>
                  ) : (
                    <span className="badge badge-warning">Hors ligne</span>
                  )}
                  {selectedCandidate.supprimer && (
                    <span className="badge badge-error">Supprimée</span>
                  )}
                  <span className="badge badge-neutral">
                    📷 {selectedCandidate.nbPhotos}
                  </span>
                  {selectedCandidate.stockValue !== null && (
                    <span className="badge badge-info">
                      Stock : {selectedCandidate.stockValue}
                    </span>
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
            <div className="flex flex-col items-center justify-center h-full min-h-[88px] gap-2">
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
    <div className="rounded-xl bg-[#FEF2F2] border-2 border-[#FCA5A5] px-4 py-3">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-lg mt-0.5">⛔</span>
        <div className="flex-1">
          <p className="font-body text-sm font-bold text-[#991B1B] mb-0.5">
            Liaison impossible — {items.length} attribut(s) eFashion à régler
          </p>
          <p className="font-body text-xs text-[#991B1B]/85">
            Avant de pouvoir lier ou pousser ce produit vers eFashion, toutes ces
            correspondances doivent être renseignées (dans la bibliothèque ou la fiche du
            produit selon les cas).
          </p>
        </div>
      </div>
      <ul className="space-y-1.5 pl-1">
        {items.map((label, i) => (
          <li
            key={i}
            className="flex items-start gap-2 font-body text-xs text-[#991B1B]"
          >
            <span className="text-[#DC2626] mt-0.5">•</span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BjOrphansSection({
  colors,
}: {
  colors: EfashionLinkLocalColor[];
}) {
  return (
    <div className="rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] px-4 py-3">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-base mt-0.5">✨</span>
        <div className="flex-1">
          <p className="font-body text-sm font-semibold text-[#1E40AF] mb-0.5">
            {colors.length} variante(s) chez vous à créer chez eFashion
          </p>
          <p className="font-body text-xs text-[#1E40AF]/80">
            Ces couleurs n&apos;existent pas encore chez eFashion. À la liaison,
            elles seront créées automatiquement (avec leurs photos) et rattachées
            au même groupe produit que les couleurs déjà reliées.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {colors.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 bg-bg-primary border border-[#BFDBFE] rounded-lg px-3 py-2"
          >
            <ColorSwatch hex={c.hex} patternImage={c.patternImage} size={18} />
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-medium text-text-primary truncate">
                {c.name}
              </p>
              <p className="font-body text-[11px] text-text-muted">
                Prix unité {formatPrice(c.unitPrice)} · Stock {c.unitStock ?? 0}
              </p>
            </div>
            <span className="badge badge-info">Sera créée chez eFashion</span>
          </div>
        ))}
      </div>
    </div>
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
    <div className="rounded-xl bg-[#FFF7ED] border border-[#FED7AA] px-4 py-3">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-base mt-0.5">⚠️</span>
        <div className="flex-1">
          <p className="font-body text-sm font-semibold text-[#9A3412] mb-0.5">
            {candidates.length} ligne(s) eFashion sans correspondance chez vous
          </p>
          <p className="font-body text-xs text-[#9A3412]/80">
            Pour chaque ligne, choisissez : assignez à une variante existante,
            créez-la chez vous, ou supprimez-la chez eFashion.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {candidates.map((c) => {
          const isPending = pendingId === c.efashionProductId;
          return (
            <div
              key={c.efashionProductId}
              className="flex flex-wrap items-center gap-3 bg-bg-primary border border-[#FED7AA] rounded-lg px-3 py-2"
            >
              <div className="shrink-0 w-12 h-12 rounded-md overflow-hidden bg-bg-secondary border border-border">
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
                ) : null}
              </div>
              <div className="flex-1 min-w-[140px]">
                <p className="font-body text-sm font-semibold text-text-primary">
                  {c.efashionColorName}
                </p>
                <p className="font-body text-[11px] text-text-muted truncate">
                  {c.reference}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.visible ? (
                    <span className="badge badge-success">En ligne</span>
                  ) : (
                    <span className="badge badge-warning">Hors ligne</span>
                  )}
                  <span className="badge badge-neutral">📷 {c.nbPhotos}</span>
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
                  className="h-8 px-3 rounded-lg bg-[#15803D] text-white text-[11px] font-body font-semibold hover:bg-[#166534] transition-colors disabled:opacity-50"
                >
                  {isPending ? "Création…" : "Créer chez nous"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteEfashion(c)}
                  disabled={disabled || isPending}
                  className="h-8 px-3 rounded-lg bg-bg-primary border border-[#DC2626] text-[#DC2626] text-[11px] font-body font-semibold hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
                >
                  {isPending ? "…" : "Supprimer chez eFashion"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SyncRecap({
  preview,
  mapping,
}: {
  preview: EfashionLinkPreview;
  mapping: Record<string, number>;
}) {
  // Affiche le récap dès qu'il y a au moins une couleur locale (liée ou non).
  // Une couleur sans mapping est désormais une « à créer chez eFashion », pas
  // une « ignorée », donc il faut la lister aussi.
  if (preview.localColors.length === 0) return null;
  return (
    <div className="rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] px-4 py-3">
      <p className="font-body text-xs font-semibold text-[#1E40AF] uppercase tracking-wider mb-2">
        À la liaison, eFashion recevra :
      </p>
      <ul className="space-y-1">
        {preview.localColors.map((local) => {
          const efId = mapping[local.id];
          const cand =
            efId !== undefined
              ? preview.candidates.find((c) => c.efashionProductId === efId)
              : null;
          return (
            <li key={local.id} className="flex items-center gap-2">
              <ColorSwatch hex={local.hex} patternImage={local.patternImage} size={12} />
              <span className="font-body text-xs text-[#1E40AF]">
                <strong>{local.name}</strong>
                {cand ? (
                  <>
                    {" → "}
                    {cand.reference} · prix {formatPrice(local.unitPrice)} · stock{" "}
                    {local.unitStock ?? 0}
                  </>
                ) : (
                  <span className="font-medium">
                    {" → "}✨ création automatique chez eFashion (prix{" "}
                    {formatPrice(local.unitPrice)} · stock {local.unitStock ?? 0})
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
