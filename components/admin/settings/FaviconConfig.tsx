"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "@/components/ui/SmartImage";
import { updateFavicon } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface FaviconConfigProps {
  /**
   * Current uploaded favicon paths, or `null` if the site falls back to the
   * auto-generated initial icon.
   */
  currentFavicon: { icon: string; appleIcon: string } | null;
}

export default function FaviconConfig({ currentFavicon }: FaviconConfigProps) {
  const [favicon, setFavicon] = useState<{ icon: string; appleIcon: string } | null>(currentFavicon);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/admin/favicon/image", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Erreur", message: data.error || "Erreur upload" });
        return;
      }
      const next = { icon: data.icon as string, appleIcon: data.appleIcon as string };
      setFavicon(next);
      setSaving(true);
      const result = await updateFavicon(next);
      if (result.success) {
        toast({ type: "success", title: "Succès", message: "Icône mise à jour." });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de l'upload." });
    } finally {
      setUploading(false);
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      const result = await updateFavicon(null);
      if (result.success) {
        setFavicon(null);
        toast({ type: "success", title: "Succès", message: "Icône réinitialisée." });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur." });
    } finally {
      setSaving(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  }

  const previewSrc = favicon?.appleIcon ?? null;

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-start">
      {/* Preview (square, 180px) */}
      <div
        className={`relative w-32 h-32 rounded-lg overflow-hidden border border-border bg-bg-secondary flex-shrink-0 ${previewSrc ? "cursor-pointer group" : ""}`}
        onClick={() => previewSrc && !uploading && !saving && setLightbox(true)}
        title={previewSrc ? "Cliquer pour agrandir" : undefined}
      >
        {previewSrc ? (
          <>
            <Image
              src={previewSrc}
              alt="Icône du site"
              fill
              className="object-contain p-2"
              unoptimized
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <svg className="w-6 h-6 text-text-inverse opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
              </svg>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-dark">
            <p className="text-text-inverse/60 text-xs font-body text-center px-2">
              Icône automatique
            </p>
          </div>
        )}

        {(uploading || saving) && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-bg-dark text-text-inverse hover:bg-primary-hover transition-colors disabled:opacity-50 font-body"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            {favicon ? "Changer" : "Ajouter"}
          </button>

          {favicon && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading || saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[#EF4444]/30 text-[#EF4444] hover:bg-[#EF4444]/5 transition-colors disabled:opacity-50 font-body"
            >
              Supprimer
            </button>
          )}
        </div>
        <p className="text-xs text-text-secondary font-body max-w-xs">
          Image carrée, idéalement <strong>512×512&nbsp;px</strong>. JPG, PNG, WEBP ou SVG. Max 5&nbsp;Mo.
        </p>
        <p className="text-xs text-text-secondary font-body max-w-xs">
          L&apos;onglet du navigateur se met à jour tout de suite (Ctrl+F5 au besoin). Google peut mettre plusieurs semaines à afficher la nouvelle icône dans ses résultats.
        </p>
      </div>

      {/* Lightbox */}
      {lightbox && previewSrc && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 cursor-pointer"
          onClick={() => setLightbox(false)}
        >
          <button
            type="button"
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 text-text-inverse/70 hover:text-text-inverse transition-colors z-10"
            aria-label="Fermer"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="relative w-72 h-72 sm:w-96 sm:h-96 rounded-xl overflow-hidden shadow-2xl bg-bg-secondary">
            <Image
              src={previewSrc}
              alt="Icône du site — aperçu"
              fill
              className="object-contain p-8"
              unoptimized
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
