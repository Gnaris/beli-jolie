"use client";

import { useEffect, useState, useTransition } from "react";
import { loadPfsBrands } from "@/app/actions/admin/site-config";
import { setProductPfsBrand } from "@/app/actions/admin/pfs-brand";
import { useToast } from "@/components/ui/Toast";

interface Props {
  productId: string;
  productName: string;
  onClose: () => void;
  onSaved?: () => void;
}

export default function SetPfsBrandModal({ productId, productName, onClose, onSaved }: Props) {
  const [brands, setBrands] = useState<{ id: string; name: string; logoUrl: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const toast = useToast();

  useEffect(() => {
    startLoading(async () => {
      const res = await loadPfsBrands();
      if (res.success && res.brands) setBrands(res.brands);
      else setError(res.error ?? "Impossible de charger les marques.");
    });
  }, []);

  function handlePick(brand: { id: string; name: string }) {
    startSaving(async () => {
      const res = await setProductPfsBrand(productId, brand);
      if (res.success) {
        toast.success("Marque enregistrée", `Le produit est désormais marqué « ${brand.name} ».`);
        onSaved?.();
        onClose();
      } else {
        toast.error("Erreur", res.error ?? "Impossible d'enregistrer la marque.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-none shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
        <div>
          <h3 className="font-heading font-bold text-text-primary">
            Marque Paris Fashion Shop
          </h3>
          <p className="text-sm text-text-secondary font-body">{productName}</p>
        </div>
        <p className="text-sm text-text-secondary font-body">
          Sélectionnez la marque PFS sous laquelle ce produit est référencé.
          Cette information n&apos;est pas envoyée à PFS, elle sert uniquement à
          afficher la bonne marque dans l&apos;administration.
        </p>

        {isLoading && (
          <p className="text-sm text-text-muted font-body">Chargement des marques…</p>
        )}
        {error && <p className="text-sm text-error font-body">{error}</p>}
        {brands && brands.length === 0 && (
          <p className="text-sm text-text-muted font-body">Aucune marque disponible sur votre compte PFS.</p>
        )}

        {brands && brands.length > 0 && (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {brands.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={isSaving}
                onClick={() => handlePick({ id: b.id, name: b.name })}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-bg-primary hover:bg-bg-secondary text-left transition-colors disabled:opacity-50"
              >
                <span className="flex-1 font-body text-sm text-text-primary">{b.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
