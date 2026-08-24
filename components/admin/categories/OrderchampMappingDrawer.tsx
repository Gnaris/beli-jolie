"use client";

/**
 * OrderchampMappingDrawer — overlay dédié à la sélection d'une feuille
 * Orderchamp pour une Category ou une SubCategory. Isolé de la modale
 * d'édition catégorie parce que le sélecteur cascade tient trop de place.
 *
 * Sauvegarde immédiate au clic sur une feuille (server action). Toast +
 * router.refresh() en sortie.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import OrderchampCategoryCascadeSelector from "./OrderchampCategoryCascadeSelector";
import {
  updateCategoryOrderchampCategoryPath,
  updateSubCategoryOrderchampCategoryPath,
} from "@/app/actions/admin/categories";
import { useMappingImpact } from "@/components/admin/mapping/MappingImpactContext";
import type { OrderchampCategoryLeaf } from "@/lib/orderchamp-taxonomy-shared";

type CategoryTarget = { kind: "category"; id: string; name: string };
type SubCategoryTarget = {
  kind: "subcategory";
  id: string;
  name: string;
  parentCategoryName: string;
};
export type OrderchampMappingTarget = CategoryTarget | SubCategoryTarget;

type Props = {
  open: boolean;
  onClose: () => void;
  target: OrderchampMappingTarget | null;
  currentPath: string | null;
  leaves: OrderchampCategoryLeaf[];
};

export default function OrderchampMappingDrawer({
  open,
  onClose,
  target,
  currentPath,
  leaves,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const backdrop = useBackdropClose(onClose);
  const { showMappingImpact } = useMappingImpact();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted || !open || !target) return null;

  const isSubCategory = target.kind === "subcategory";

  async function save(path: string | null) {
    if (!target) return;
    try {
      if (target.kind === "category") {
        const res = await updateCategoryOrderchampCategoryPath(target.id, path);
        if (res.impact) showMappingImpact(res.impact);
        toast.success(
          path ? "Catégorie Orderchamp liée" : "Mapping Orderchamp retiré",
        );
      } else {
        await updateSubCategoryOrderchampCategoryPath(target.id, path);
        toast.success(
          path
            ? "Sous-catégorie liée à Orderchamp"
            : "Mapping Orderchamp retiré (retombera sur la catégorie parente)",
        );
      }
      router.refresh();
      // On garde le drawer ouvert : l'utilisateur voit le nouveau statut
      // « Actuellement mappée sur X » sans avoir à rouvrir.
    } catch (err) {
      toast.error(
        "Orderchamp",
        err instanceof Error ? err.message : "Erreur d'enregistrement.",
      );
      throw err;
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="w-full max-w-[680px] bg-bg-primary rounded-[24px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)] flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header aurora orange OC */}
        <div className="relative overflow-hidden border-b border-border shrink-0">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 80% at 10% 0%, rgba(249,115,22,0.14), transparent 60%)," +
                "radial-gradient(50% 70% at 90% 10%, rgba(253,186,116,0.10), transparent 60%)",
            }}
          />
          <div className="relative px-7 pt-6 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <span
                  className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 text-white shadow-sm"
                  style={{ background: "linear-gradient(135deg,#F97316,#FDBA74)" }}
                >
                  <span className="font-heading font-bold text-[14px]">O</span>
                </span>
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-orange-50 border border-orange-100 text-orange-700 text-[10.5px] font-bold uppercase tracking-[0.14em]">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                    Mapping Orderchamp
                  </span>
                  <h3 className="font-heading text-[18px] font-bold text-text-primary leading-tight mt-2 truncate">
                    {isSubCategory
                      ? `Sous-catégorie « ${target.name} »`
                      : `Catégorie « ${target.name} »`}
                  </h3>
                  <p className="text-[12.5px] text-text-secondary mt-1 leading-relaxed">
                    {isSubCategory
                      ? `Facultatif — si vide, on utilisera le mapping de la catégorie « ${(target as SubCategoryTarget).parentCategoryName} ».`
                      : "Choisissez la catégorie Orderchamp qui correspond le mieux — obligatoire pour publier un produit sur Orderchamp."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-6">
          <OrderchampCategoryCascadeSelector
            leaves={leaves}
            value={currentPath}
            onChange={save}
            canClear
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-7 py-4 border-t border-border shrink-0 bg-bg-primary">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center h-10 px-5 bg-bg-dark hover:bg-black text-text-inverse text-sm font-semibold rounded-lg shadow-sm transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
