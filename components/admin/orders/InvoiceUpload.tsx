"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  orderId: string;
  hasInvoice: boolean;
}

export default function InvoiceUpload({ orderId, hasInvoice }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useTransition();
  const [deleting, setDeleting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("Seuls les fichiers PDF sont acceptes.");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.append("file", file);

    setUploading(async () => {
      const res = await fetch(`/api/admin/commandes/${orderId}/invoice`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erreur lors de l'upload.");
      } else {
        router.refresh();
      }
      // Reset input so same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  async function handleDelete() {
    setError(null);
    setDeleting(async () => {
      const res = await fetch(`/api/admin/commandes/${orderId}/invoice`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erreur lors de la suppression.");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Upload button */}
        <label
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-body font-medium cursor-pointer transition-colors rounded-lg ${
            uploading
              ? "bg-text-muted text-text-inverse cursor-not-allowed"
              : "bg-bg-dark text-text-inverse hover:bg-neutral-800"
          }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          {uploading ? "Upload..." : hasInvoice ? "Remplacer la facture" : "Uploader la facture"}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="sr-only"
            disabled={uploading}
            onChange={handleUpload}
          />
        </label>

        {/* Download button (admin) */}
        {hasInvoice && (
          <>
            <a
              href={`/api/admin/commandes/${orderId}/invoice`}
              target="_blank"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-body font-medium border border-border text-text-secondary hover:border-bg-dark hover:text-text-primary transition-colors rounded-lg"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Voir la facture
            </a>

            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 text-sm font-body font-medium hover:bg-red-50 transition-colors disabled:opacity-50 rounded-lg"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              {deleting ? "Suppression..." : "Supprimer"}
            </button>
          </>
        )}
      </div>

      {/* Status */}
      {hasInvoice && !error && (
        <p className="text-xs text-emerald-600 font-body flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Facture disponible — le client peut la telecharger
        </p>
      )}
      {!hasInvoice && !error && (
        <p className="text-xs text-text-muted font-body">
          Aucune facture uploadee — le client ne peut pas encore telecharger
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 font-body">{error}</p>
      )}
    </div>
  );
}
