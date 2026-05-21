"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewEfashionMatchByReference,
  linkEfashionProductManually,
  type EfashionLinkPreview,
} from "@/app/actions/admin/efashion";
import { useToast } from "@/components/ui/Toast";

interface Props {
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
}

export default function LinkEfashionProductModal({
  productId,
  productName,
  reference,
  onClose,
}: Props) {
  const router = useRouter();
  const toast = useToast();

  const [refInput, setRefInput] = useState(() => reference.split(/[-_]/)[0] ?? reference);
  const [preview, setPreview] = useState<EfashionLinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isSaving, startSaving] = useTransition();

  /**
   * mapping[localColorId] = efashionProductId
   * (clé par couleur locale plutôt que par eFashion, ça empêche d'attribuer
   * 2 fois la même couleur locale et c'est plus naturel pour l'utilisatrice)
   */
  const [mapping, setMapping] = useState<Record<string, number>>({});

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await previewEfashionMatchByReference(productId, refInput);
      if (res.success) {
        setPreview(res.data);
        // Pré-remplit le mapping avec les suggestions auto
        const initial: Record<string, number> = {};
        for (const cand of res.data.candidates) {
          if (cand.suggestedLocalColorId && !(cand.suggestedLocalColorId in initial)) {
            initial[cand.suggestedLocalColorId] = cand.efashionProductId;
          }
        }
        setMapping(initial);
      } else {
        setError(res.error);
        setPreview(null);
      }
    });
  }

  // Auto-load au montage avec la référence proposée
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      toast.error("Aucune couleur liée", "Sélectionnez au moins un produit-couleur eFashion.");
      return;
    }
    startSaving(async () => {
      const res = await linkEfashionProductManually(productId, preview.referenceBase, links);
      if (res.success) {
        toast.success(
          "Produit lié à eFashion",
          `${res.linked} couleur(s) reliée(s) à la référence « ${preview.referenceBase} ».`,
        );
        onClose();
        router.refresh();
      } else {
        toast.error("Échec de la liaison", res.error ?? "Erreur inconnue.");
      }
    });
  }

  // Vue produits eFashion regroupés par id_produit pour le dropdown
  function setColorMapping(localColorId: string, efashionProductIdStr: string) {
    setMapping((prev) => {
      const next = { ...prev };
      const efId = parseInt(efashionProductIdStr, 10);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-none shadow-lg max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-heading font-bold text-text-primary">Lier à un produit eFashion Paris</h2>
            <p className="text-sm text-text-secondary font-body">
              {productName} ({reference})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 border-b border-border bg-bg-secondary/40">
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
              className="h-10 px-4 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {isLoading ? "Recherche…" : "Rechercher"}
            </button>
          </div>
          <p className="mt-2 font-body text-[11px] text-text-muted">
            Tapez la « référence de base » côté eFashion (ex : A2415). On affichera toutes les
            lignes-couleurs qui correspondent, et vous mapperez chaque couleur du produit
            BJ à la bonne ligne eFashion.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && (
            <p className="font-body text-sm text-text-muted">Chargement…</p>
          )}
          {error && (
            <div className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626] font-body">
              {error}
            </div>
          )}
          {preview && preview.candidates.length === 0 && (
            <p className="font-body text-sm text-text-muted">
              Aucune ligne trouvée sur eFashion pour la référence « {preview.referenceBase} ».
              Essayez une autre référence ou créez d&apos;abord le produit chez eFashion.
            </p>
          )}
          {preview && preview.candidates.length > 0 && (
            <div className="space-y-4">
              <p className="font-body text-sm text-text-secondary">
                <strong>{preview.candidates.length}</strong> ligne(s) eFashion trouvée(s) pour
                la référence « <strong>{preview.referenceBase}</strong> ». Associez chaque couleur
                BJ à sa ligne eFashion correspondante :
              </p>

              <div className="space-y-2">
                {preview.localColors.map((color) => {
                  const selectedEfId = mapping[color.id];
                  return (
                    <div
                      key={color.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-bg-primary"
                    >
                      <div className="flex-1">
                        <p className="font-body text-sm font-medium text-text-primary">
                          {color.name}
                        </p>
                        <p className="font-body text-[11px] text-text-muted">
                          Couleur BJ
                        </p>
                      </div>
                      <div className="flex-1">
                        <select
                          value={selectedEfId ?? ""}
                          onChange={(e) => setColorMapping(color.id, e.target.value)}
                          disabled={isSaving}
                          className="w-full h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                        >
                          <option value="">— Ne pas lier —</option>
                          {preview.candidates.map((cand) => {
                            const usedByOther = Object.entries(mapping).some(
                              ([k, v]) => k !== color.id && v === cand.efashionProductId,
                            );
                            return (
                              <option
                                key={cand.efashionProductId}
                                value={cand.efashionProductId}
                                disabled={usedByOther}
                              >
                                {cand.reference} — {cand.efashionColorName}
                                {usedByOther ? " (déjà liée)" : ""}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>

              {preview.candidates.some((c) => !preview.localColors.some((lc) => lc.id === c.suggestedLocalColorId)) && (
                <p className="font-body text-[11px] text-text-muted">
                  💡 Certaines lignes eFashion n&apos;ont pas pu être suggérées automatiquement
                  (nom de couleur non trouvé côté BJ). Vous pouvez les ignorer ou créer la
                  couleur correspondante dans la bibliothèque puis revenir ici.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-bg-secondary/30 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-secondary hover:bg-bg-secondary transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !preview || Object.keys(mapping).length === 0}
            className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {isSaving ? "Liaison…" : `Lier (${Object.keys(mapping).length} couleur(s))`}
          </button>
        </div>
      </div>
    </div>
  );
}
