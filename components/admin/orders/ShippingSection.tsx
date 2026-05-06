"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateShipmentLabel,
  setManualShipping,
  clearShipping,
} from "@/app/actions/admin/shipping";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";

interface CarrierOption {
  id: string;
  name: string;
  price: number;
  delay: string;
}

interface Props {
  orderId: string;
  initialCarrierName: string;
  initialTrackingId: string | null;
  initialLabelUrl: string | null;
  /** True si la livraison est hors UE (FR + UE + DOM-TOM exclus). */
  isOutsideEu: boolean;
}

export default function ShippingSection({
  orderId,
  initialCarrierName,
  initialTrackingId,
  initialLabelUrl,
  isOutsideEu,
}: Props) {
  const router = useRouter();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();

  const [trackingId, setTrackingId] = useState<string | null>(initialTrackingId);
  const [labelUrl, setLabelUrl] = useState<string | null>(initialLabelUrl);

  // Saisie manuelle (formulaire)
  const [showManual, setShowManual] = useState(false);
  const [manualCarrier, setManualCarrier] = useState(initialCarrierName);
  const [manualTracking, setManualTracking] = useState("");

  // Choix d'un transporteur de remplacement (quand celui d'origine n'est plus dispo)
  const [pickerCarriers, setPickerCarriers] = useState<CarrierOption[]>([]);
  const [pickerTransactionId, setPickerTransactionId] = useState<string>("");
  const [pickedCarrierId, setPickedCarrierId] = useState<string>("");

  function handleAutoGenerate() {
    showLoading();
    startTransition(async () => {
      try {
        const res = await generateShipmentLabel(orderId);
        if (res.success) {
          setTrackingId(res.trackingId ?? null);
          setLabelUrl(res.labelUrl ?? null);
          toast.success("Bordereau généré", "Numéro de suivi enregistré.");
          router.refresh();
        } else if (res.availableCarriers && res.availableCarriers.length > 0) {
          setPickerCarriers(res.availableCarriers);
          setPickerTransactionId(res.transactionId ?? "");
          setPickedCarrierId("");
          toast.warning("Transporteur indisponible", res.error);
        } else {
          toast.error("Impossible de générer le bordereau", res.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handlePickerConfirm() {
    if (!pickedCarrierId || !pickerTransactionId) return;
    showLoading();
    startTransition(async () => {
      try {
        const res = await generateShipmentLabel(orderId, {
          carrierId: pickedCarrierId,
          transactionId: pickerTransactionId,
        });
        if (res.success) {
          setTrackingId(res.trackingId ?? null);
          setLabelUrl(res.labelUrl ?? null);
          setPickerCarriers([]);
          setPickerTransactionId("");
          setPickedCarrierId("");
          toast.success("Bordereau généré", "Numéro de suivi enregistré.");
          router.refresh();
        } else {
          toast.error("Impossible de générer le bordereau", res.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    showLoading();
    startTransition(async () => {
      try {
        const res = await setManualShipping(orderId, {
          carrierName: manualCarrier,
          trackingId: manualTracking,
        });
        if (res.success) {
          setTrackingId(manualTracking.trim());
          setLabelUrl(null);
          setShowManual(false);
          setManualTracking("");
          toast.success("Suivi enregistré");
          router.refresh();
        } else {
          toast.error("Erreur", res.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  async function handleClear() {
    const ok = await confirm({
      title: "Effacer le suivi",
      message:
        "Confirmer la suppression du numéro de suivi et du bordereau associé ? Cette action détache le bordereau de cette commande mais ne supprime pas un bordereau déjà généré chez Easy-Express.",
      confirmLabel: "Effacer",
      type: "danger",
    });
    if (ok !== true) return;
    showLoading();
    startTransition(async () => {
      try {
        const res = await clearShipping(orderId);
        if (res.success) {
          setTrackingId(null);
          setLabelUrl(null);
          toast.success("Suivi effacé");
          router.refresh();
        } else {
          toast.error("Erreur", res.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  // ─────────────────────────────────────────────
  // Cas 1 — un suivi est déjà enregistré
  // ─────────────────────────────────────────────
  if (trackingId) {
    return (
      <div className="px-5 py-4 space-y-3 text-sm font-body">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
            Numéro de suivi
          </p>
          <p className="font-mono text-text-primary bg-bg-tertiary px-2 py-1 rounded inline-block mt-1">
            {trackingId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {labelUrl && (
            <a
              href={`/api/admin/commandes/${orderId}/label`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-xs inline-flex items-center gap-1.5"
            >
              Télécharger le bordereau
            </a>
          )}
          <button
            type="button"
            onClick={handleClear}
            disabled={pending}
            className="btn-ghost text-xs"
          >
            Effacer / recommencer
          </button>
        </div>
        {!labelUrl && (
          <p className="text-xs text-text-muted">
            Suivi saisi manuellement — pas de bordereau PDF associé.
          </p>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // Cas 2 — il faut choisir un transporteur de remplacement
  // ─────────────────────────────────────────────
  if (pickerCarriers.length > 0) {
    return (
      <div className="px-5 py-4 space-y-3 text-sm font-body">
        <p className="text-text-secondary">
          Le transporteur initial n&apos;est plus disponible. Choisissez-en un autre :
        </p>
        <CustomSelect
          value={pickedCarrierId}
          onChange={setPickedCarrierId}
          options={[
            { value: "", label: "— Sélectionner —" },
            ...pickerCarriers.map((c) => ({
              value: c.id,
              label: `${c.name} — ${c.price.toFixed(2)} € (${c.delay})`,
            })),
          ]}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePickerConfirm}
            disabled={pending || !pickedCarrierId}
            className="btn-primary text-sm"
          >
            Générer le bordereau
          </button>
          <button
            type="button"
            onClick={() => {
              setPickerCarriers([]);
              setPickerTransactionId("");
              setPickedCarrierId("");
            }}
            className="btn-ghost text-sm"
            disabled={pending}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // Cas 3 — pas encore de bordereau, on propose les 2 options
  // ─────────────────────────────────────────────
  return (
    <div className="px-5 py-4 space-y-4 text-sm font-body">
      {isOutsideEu && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-text-primary">
          Livraison <strong>hors UE</strong> : générez le bordereau directement depuis le portail
          Easy-Express (la déclaration douanière doit être remplie là-bas), puis recopiez le
          numéro de suivi ci-dessous.
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
          Transporteur choisi par le client
        </p>
        <p className="text-text-primary">{initialCarrierName}</p>
      </div>

      {!isOutsideEu && (
        <button
          type="button"
          onClick={handleAutoGenerate}
          disabled={pending}
          className="btn-primary text-sm w-full"
        >
          Générer le bordereau Easy-Express
        </button>
      )}

      <div className={isOutsideEu ? "" : "border-t border-border pt-4"}>
        {!showManual && !isOutsideEu ? (
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="btn-ghost text-xs"
            disabled={pending}
          >
            Saisir un suivi à la main
          </button>
        ) : !showManual && isOutsideEu ? (
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="btn-primary text-sm w-full"
            disabled={pending}
          >
            Saisir le suivi
          </button>
        ) : (
          <form onSubmit={handleManualSubmit} className="space-y-3">
            <div>
              <label
                htmlFor="manual-carrier"
                className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1"
              >
                Transporteur
              </label>
              <input
                id="manual-carrier"
                type="text"
                value={manualCarrier}
                onChange={(e) => setManualCarrier(e.target.value)}
                placeholder="ex: FedEx International"
                className="field-input w-full"
                required
              />
            </div>
            <div>
              <label
                htmlFor="manual-tracking"
                className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1"
              >
                Numéro de suivi
              </label>
              <input
                id="manual-tracking"
                type="text"
                value={manualTracking}
                onChange={(e) => setManualTracking(e.target.value)}
                placeholder="ex: 1Z999AA10123456784"
                className="field-input w-full"
                required
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className="btn-primary text-sm">
                Enregistrer
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowManual(false);
                  setManualTracking("");
                }}
                className="btn-ghost text-sm"
                disabled={pending}
              >
                Annuler
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
