"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ShippingSection from "@/components/admin/orders/ShippingSection";

interface Props {
  orderId: string;
  hasInvoice: boolean;
  hasCreditNote: boolean;
  carrierName: string | null;
  carrierId: string | null;
  eeTrackingId: string | null;
  eeLabelUrl: string | null;
  isOutsideEu: boolean;
}

export default function OrderQuickActions({
  orderId,
  hasInvoice,
  hasCreditNote,
  carrierName,
  carrierId,
  eeTrackingId,
  eeLabelUrl,
  isOutsideEu,
}: Props) {
  const [showShip, setShowShip] = useState(false);

  const hasLabel = !!eeLabelUrl || !!eeTrackingId;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {/* Bon de commande — avec prix */}
        <a
          href={`/api/admin/commandes/${orderId}/pdf`}
          target="_blank"
          className="inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-slate-800"
        >
          <DocIcon /> Bon avec prix
        </a>

        {/* Bon de commande — sans prix */}
        <a
          href={`/api/admin/commandes/${orderId}/pdf?noPrices=1`}
          target="_blank"
          className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-800 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-slate-50"
        >
          <DocIcon /> Bon sans prix
        </a>

        {/* Upload / Voir Facture */}
        <FileButton
          label="Facture"
          hasFile={hasInvoice}
          orderId={orderId}
          endpoint={`/api/admin/commandes/${orderId}/invoice`}
        />

        {/* Upload / Voir Avoir */}
        <FileButton
          label="Avoir"
          hasFile={hasCreditNote}
          orderId={orderId}
          endpoint={`/api/admin/commandes/${orderId}/credit-note`}
        />

        {/* Bordereau d'expédition */}
        {hasLabel && eeLabelUrl ? (
          <a
            href={`/api/admin/commandes/${orderId}/label`}
            target="_blank"
            className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-800 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-slate-50"
          >
            <PackageIcon /> Télécharger le bordereau
          </a>
        ) : (
          <button
            onClick={() => setShowShip((v) => !v)}
            className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border ${
              showShip
                ? "bg-sky-50 border-sky-200 text-sky-800"
                : "bg-white border-slate-200 text-slate-800 hover:bg-slate-50"
            }`}
          >
            <PackageIcon /> {showShip ? "Fermer" : hasLabel ? "Gérer le bordereau" : "Créer le bordereau"}
          </button>
        )}

        {/* Si un bordereau existe, permettre aussi de le modifier */}
        {hasLabel && eeLabelUrl && (
          <button
            onClick={() => setShowShip((v) => !v)}
            className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            title="Modifier / effacer le suivi"
          >
            ⚙️
          </button>
        )}
      </div>

      {/* Panneau ShippingSection (déployé sur clic Bordereau) */}
      {showShip && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Bordereau d'expédition
            </p>
            <button onClick={() => setShowShip(false)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">
              ✕
            </button>
          </div>
          <ShippingSection
            orderId={orderId}
            initialCarrierName={carrierName ?? ""}
            initialTrackingId={eeTrackingId}
            initialLabelUrl={eeLabelUrl}
            isOutsideEu={isOutsideEu}
            carrierId={carrierId}
          />
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Bouton upload/download compact (Facture, Avoir…)                    */
/* ================================================================== */

function FileButton({
  label,
  hasFile,
  orderId,
  endpoint,
}: {
  label: string;
  hasFile: boolean;
  orderId: string;
  endpoint: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [deleting, startDelete] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const toast = useToast();
  const { confirm } = useConfirm();

  void orderId;

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error(`${label} : seuls les fichiers PDF sont acceptés.`);
      return;
    }
    const fd = new FormData();
    fd.append("file", file);

    showLoading();
    startUpload(async () => {
      try {
        const res = await fetch(endpoint, { method: "POST", body: fd });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          toast.error(d.error ?? `Erreur upload ${label}`);
        } else {
          toast.success(`${label} enregistré${label.endsWith("e") ? "e" : ""}.`);
          router.refresh();
        }
        if (inputRef.current) inputRef.current.value = "";
      } finally {
        hideLoading();
      }
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Supprimer ${label.toLowerCase()}`,
      message: `Cette action retire le PDF de la commande. Continuer ?`,
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
      type: "danger",
    });
    if (!ok) return;
    showLoading();
    startDelete(async () => {
      try {
        const res = await fetch(endpoint, { method: "DELETE" });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          toast.error(d.error ?? "Erreur");
        } else {
          toast.success(`${label} supprimé${label.endsWith("e") ? "e" : ""}.`);
          router.refresh();
        }
      } finally {
        hideLoading();
      }
    });
  }

  // Pas de fichier → bouton d'upload
  if (!hasFile) {
    return (
      <label
        className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border cursor-pointer ${
          uploading
            ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
            : "bg-white border-slate-200 text-slate-800 hover:bg-slate-50"
        }`}
      >
        <UploadIcon /> {uploading ? "Envoi…" : `Uploader ${label}`}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={uploading}
          onChange={handleUpload}
        />
      </label>
    );
  }

  // Fichier présent → bouton "Voir" + bouton "…" pour Remplacer/Supprimer
  return (
    <div className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden">
      <a
        href={endpoint}
        target="_blank"
        className="inline-flex items-center gap-2 pl-4 pr-3 py-2.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
      >
        <CheckIcon /> {label}
      </a>
      <label
        className="inline-flex items-center px-2 py-2.5 text-emerald-700 border-l border-emerald-200 hover:bg-emerald-100 cursor-pointer"
        title="Remplacer"
      >
        <RefreshIcon />
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={uploading}
          onChange={handleUpload}
        />
      </label>
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Supprimer"
        className="inline-flex items-center px-2 py-2.5 text-rose-600 border-l border-emerald-200 hover:bg-rose-50 disabled:opacity-40"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/* ================================================================== */
/*  Icônes                                                              */
/* ================================================================== */

function DocIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5m0 0L7.5 12m4.5-4.5v13.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25l-9-4.5-9 4.5m18 0l-9 4.5m9-4.5v9l-9 4.5M3 8.25l9 4.5m-9-4.5v9l9 4.5m0-13.5v13.5" />
    </svg>
  );
}
