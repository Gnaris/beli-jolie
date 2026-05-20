"use client";

import { useState } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  checkColorMergeConflicts,
  mergeColors,
  type ColorMergeConflict,
  type AffectedProduct,
} from "@/app/actions/admin/color-merge";
import ColorResyncModal from "./ColorResyncModal";

interface ColorOption {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
}

export interface MergeColorsModalProps {
  open: boolean;
  onClose: () => void;
  colors: ColorOption[];
  pfsEnabled: boolean;
  ankorstoreEnabled: boolean;
  onDone: () => void;
}

type Step = "select" | "verify" | "done";

const CONFLICT_LABEL: Record<ColorMergeConflict["kind"], string> = {
  variant_duplicate: "Le produit a déjà les deux couleurs en variante.",
  pack_line_duplicate: "Le produit a les deux couleurs dans un paquet multi-couleurs.",
  image_duplicate: "Le produit a des images sur les deux couleurs au même emplacement.",
};

function ColorPreview({ color }: { color: ColorOption | undefined }) {
  if (!color) return null;
  const style: React.CSSProperties = color.patternImage
    ? { backgroundImage: `url(${color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { backgroundColor: color.hex ?? "#9CA3AF" };
  return (
    <span
      className="w-6 h-6 rounded-md border border-border shrink-0 inline-block align-middle ml-2"
      style={style}
      aria-hidden
    />
  );
}

export default function MergeColorsModal({
  open,
  onClose,
  colors,
  pfsEnabled,
  ankorstoreEnabled,
  onDone,
}: MergeColorsModalProps) {
  const { confirm } = useConfirm();
  const toast = useToast();
  const [step, setStep] = useState<Step>("select");
  const [keptId, setKeptId] = useState<string>("");
  const [absorbedId, setAbsorbedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [conflicts, setConflicts] = useState<ColorMergeConflict[]>([]);
  const [affectedCount, setAffectedCount] = useState(0);
  const [absorbedName, setAbsorbedName] = useState("");
  const [affectedProducts, setAffectedProducts] = useState<AffectedProduct[]>([]);
  const [resyncOpen, setResyncOpen] = useState(false);

  function reset() {
    setStep("select");
    setKeptId("");
    setAbsorbedId("");
    setConflicts([]);
    setAffectedCount(0);
    setAbsorbedName("");
    setAffectedProducts([]);
    setResyncOpen(false);
  }

  function handleClose() {
    onClose();
    // Léger délai pour que la sortie d'animation se passe sans flash
    setTimeout(reset, 0);
  }

  async function goVerify() {
    if (!keptId || !absorbedId || keptId === absorbedId) return;
    setLoading(true);
    try {
      const res = await checkColorMergeConflicts(keptId, absorbedId);
      setConflicts(res.conflicts);
      setAffectedCount(res.affectedProductCount);
      setAbsorbedName(res.absorbedColorName);
      setStep("verify");
    } catch (err) {
      toast.error("Erreur", err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function runMerge() {
    const ok = await confirm({
      type: "danger",
      title: "Fusionner ces deux couleurs ?",
      message: `La couleur « ${absorbedName} » sera supprimée définitivement. Cette action est irréversible.`,
      confirmLabel: "Fusionner",
    });
    if (!ok) return;
    setLoading(true);
    try {
      const res = await mergeColors(keptId, absorbedId);
      if (!res.success) {
        setConflicts(res.conflicts);
        toast.error("Conflit détecté", "La fusion a été annulée.");
        return;
      }
      toast.success(
        "Couleurs fusionnées",
        `${res.affectedProducts.length} produit${res.affectedProducts.length > 1 ? "s" : ""} mis à jour.`,
      );
      setAffectedProducts(res.affectedProducts);
      if (res.affectedProducts.length === 0 || (!pfsEnabled && !ankorstoreEnabled)) {
        onDone();
        handleClose();
      } else {
        setStep("done");
        setResyncOpen(true);
      }
    } catch (err) {
      toast.error("Erreur", err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const keptColor = colors.find((c) => c.id === keptId);
  const absorbedColor = colors.find((c) => c.id === absorbedId);

  return (
    <>
      {step !== "done" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-bg-primary rounded-2xl shadow-lg max-w-2xl w-full p-6 border border-border">
            <h2 className="font-heading text-lg font-semibold text-text-primary">
              Fusionner deux couleurs
            </h2>

            {step === "select" && (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-text-secondary font-body">
                  Choisissez la couleur à garder et la couleur à supprimer. Toutes les références
                  de la couleur supprimée seront transférées sur la couleur gardée (variantes,
                  paquets, images, couleur principale). La couleur supprimée disparaîtra de la
                  bibliothèque.
                </p>

                <div className="space-y-3">
                  <div className="block text-sm font-body">
                    <span className="block mb-1 text-text-secondary">Couleur à garder</span>
                    <div className="flex items-center">
                      <div className="flex-1">
                        <CustomSelect
                          value={keptId}
                          onChange={setKeptId}
                          options={colors.map((c) => ({ value: c.id, label: c.name }))}
                          placeholder="Sélectionner…"
                          searchable
                        />
                      </div>
                      <ColorPreview color={keptColor} />
                    </div>
                  </div>

                  <div className="block text-sm font-body">
                    <span className="block mb-1 text-text-secondary">Couleur à supprimer</span>
                    <div className="flex items-center">
                      <div className="flex-1">
                        <CustomSelect
                          value={absorbedId}
                          onChange={setAbsorbedId}
                          options={colors
                            .filter((c) => c.id !== keptId)
                            .map((c) => ({ value: c.id, label: c.name }))}
                          placeholder="Sélectionner…"
                          searchable
                        />
                      </div>
                      <ColorPreview color={absorbedColor} />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 text-sm font-body text-text-secondary hover:text-text-primary rounded-lg"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={goVerify}
                    disabled={!keptId || !absorbedId || keptId === absorbedId || loading}
                    className="px-4 py-2 text-sm font-body bg-text-primary text-text-inverse rounded-lg disabled:opacity-50"
                  >
                    {loading ? "Vérification…" : "Vérifier"}
                  </button>
                </div>
              </div>
            )}

            {step === "verify" && (
              <div className="mt-4 space-y-4">
                {conflicts.length > 0 ? (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-body">
                      Cette fusion ne peut pas avoir lieu — corrigez d'abord ces produits.
                    </div>
                    <ul className="space-y-2 max-h-64 overflow-y-auto">
                      {conflicts.map((c, i) => (
                        <li
                          key={`${c.productId}-${i}`}
                          className="text-sm font-body p-2 border border-border rounded-lg"
                        >
                          <a
                            href={`/admin/produits/${c.productId}/modifier`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-text-primary hover:underline"
                          >
                            {c.reference} — {c.productName}
                          </a>
                          <p className="text-xs text-text-muted mt-0.5">{CONFLICT_LABEL[c.kind]}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 font-body">
                    {affectedCount === 0
                      ? `Aucun produit n'utilise « ${absorbedName} ». Elle sera simplement supprimée.`
                      : `${affectedCount} produit${affectedCount > 1 ? "s" : ""} seront mis à jour. La couleur « ${absorbedName} » sera supprimée définitivement (son motif, ses traductions et sa référence PFS seront perdus).`}
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setStep("select")}
                    className="px-4 py-2 text-sm font-body text-text-secondary hover:text-text-primary rounded-lg"
                  >
                    Retour
                  </button>
                  <button
                    type="button"
                    onClick={runMerge}
                    disabled={conflicts.length > 0 || loading}
                    className="px-4 py-2 text-sm font-body bg-red-600 text-white rounded-lg disabled:opacity-50"
                  >
                    {loading ? "Fusion…" : "Fusionner"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {step === "done" && (
        <ColorResyncModal
          open={resyncOpen}
          onClose={() => {
            setResyncOpen(false);
            onDone();
            handleClose();
          }}
          products={affectedProducts}
          title="Couleurs fusionnées"
          subtitle={`${affectedProducts.length} produit${affectedProducts.length > 1 ? "s" : ""} ont changé. Re-pousser sur les marketplaces ?`}
          pfsAvailable={pfsEnabled}
          ankorstoreAvailable={ankorstoreEnabled}
          pfsDefaultChecked={pfsEnabled}
          ankorstoreDefaultChecked={ankorstoreEnabled}
        />
      )}
    </>
  );
}
