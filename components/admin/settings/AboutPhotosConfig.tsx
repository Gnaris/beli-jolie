"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "@/components/ui/SmartImage";
import { updateAboutPhoto } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface AboutPhotosConfigProps {
  initialPhotos: (string | null)[];
}

export default function AboutPhotosConfig({ initialPhotos }: AboutPhotosConfigProps) {
  const [photos, setPhotos] = useState<(string | null)[]>(() => {
    const arr = [...initialPhotos];
    while (arr.length < 6) arr.push(null);
    return arr.slice(0, 6);
  });
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { toast } = useToast();

  async function handleUpload(slot: number, file: File) {
    setBusySlot(slot);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("slot", String(slot));
      const res = await fetch("/api/admin/about-photo/image", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Erreur", message: data.error || "Erreur upload" });
        return;
      }
      const path = data.path as string;
      const result = await updateAboutPhoto(slot, path);
      if (result.success) {
        setPhotos((prev) => prev.map((p, i) => (i === slot - 1 ? path : p)));
        toast({ type: "success", title: "Photo enregistrée", message: `Emplacement ${slot} mis à jour.` });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de l'upload." });
    } finally {
      setBusySlot(null);
    }
  }

  async function handleRemove(slot: number) {
    setBusySlot(slot);
    try {
      const result = await updateAboutPhoto(slot, null);
      if (result.success) {
        setPhotos((prev) => prev.map((p, i) => (i === slot - 1 ? null : p)));
        toast({ type: "success", title: "Photo retirée", message: `Emplacement ${slot} libéré.` });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur." });
    } finally {
      setBusySlot(null);
    }
  }

  function handleFileChange(slot: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(slot, file);
    e.target.value = "";
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted font-body">
        6 emplacements photos affichés en grille sur <code className="font-mono text-[11px]">/a-propos</code>.
        Format vertical recommandé (portrait 4:5). JPG/PNG/WEBP, max 10 Mo par photo.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {photos.map((photo, i) => {
          const slot = i + 1;
          const busy = busySlot === slot;
          return (
            <div key={slot} className="flex flex-col gap-2">
              <div
                className={`relative aspect-[4/5] rounded-xl overflow-hidden border border-border bg-bg-secondary ${photo ? "cursor-pointer group" : ""}`}
                onClick={() => photo && !busy && setLightbox(photo)}
                title={photo ? "Cliquer pour agrandir" : undefined}
              >
                {photo ? (
                  <>
                    <Image
                      src={photo}
                      alt={`Photo ${slot} de la page À propos`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-text-muted">
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                    </svg>
                    <span className="text-[10px] uppercase tracking-[0.2em] font-body">Emplacement {slot}</span>
                  </div>
                )}
                {busy && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>

              <input
                ref={(el) => { fileRefs.current[i] = el; }}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => handleFileChange(slot, e)}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRefs.current[i]?.click()}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-bg-dark text-text-inverse hover:bg-primary-hover transition-colors disabled:opacity-50 font-body"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                  </svg>
                  {photo ? "Changer" : "Ajouter"}
                </button>
                {photo && (
                  <button
                    type="button"
                    onClick={() => handleRemove(slot)}
                    disabled={busy}
                    className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium rounded-lg border border-[#EF4444]/30 text-[#EF4444] hover:bg-[#EF4444]/5 transition-colors disabled:opacity-50 font-body"
                    aria-label={`Supprimer la photo ${slot}`}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {lightbox && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 cursor-pointer"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-text-inverse/70 hover:text-text-inverse transition-colors z-10"
            aria-label="Fermer"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="relative w-full max-w-3xl aspect-[4/5] rounded-xl overflow-hidden shadow-2xl">
            <Image
              src={lightbox}
              alt="Photo — aperçu"
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
