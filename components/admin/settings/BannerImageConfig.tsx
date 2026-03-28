"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { updateBannerImage } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface BannerImageConfigProps {
  currentImage: string | null;
}

export default function BannerImageConfig({ currentImage }: BannerImageConfigProps) {
  const [image, setImage] = useState<string | null>(currentImage);
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
      const res = await fetch("/api/admin/banner/image", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Erreur", message: data.error || "Erreur upload" });
        return;
      }
      setImage(data.path);
      // Auto-save
      setSaving(true);
      const result = await updateBannerImage(data.path);
      if (result.success) {
        toast({ type: "success", title: "Succès", message: "Bannière mise à jour." });
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
      const result = await updateBannerImage(null);
      if (result.success) {
        setImage(null);
        toast({ type: "success", title: "Succès", message: "Bannière supprimée." });
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

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-start">
      {/* Preview */}
      <div
        className={`relative w-full sm:w-64 aspect-[2.4/1] rounded-lg overflow-hidden border border-border bg-bg-secondary flex-shrink-0 ${image ? "cursor-pointer group" : ""}`}
        onClick={() => image && !uploading && !saving && setLightbox(true)}
        title={image ? "Cliquer pour agrandir" : undefined}
      >
        {image ? (
          <>
            <Image
              src={image}
              alt="Bannière d'accueil"
              fill
              className="object-cover"
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
            <p className="text-text-inverse/40 text-xs font-body">
              Aucune image
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
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-bg-dark text-text-inverse hover:bg-primary-hover transition-colors disabled:opacity-50 font-body"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            {image ? "Changer" : "Ajouter"}
          </button>

          {image && (
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
        <p className="text-xs text-text-secondary font-body">
          1920×800px, JPG/PNG/WEBP, max 10 Mo.
        </p>
      </div>

      {/* Lightbox */}
      {lightbox && image && createPortal(
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
          <div className="relative w-full max-w-5xl aspect-[2.4/1] rounded-xl overflow-hidden shadow-2xl">
            <Image
              src={image}
              alt="Bannière d'accueil — aperçu"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
