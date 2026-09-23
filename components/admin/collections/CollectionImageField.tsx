"use client";

import { useRef, useState } from "react";

type Kind = "card" | "banner";

interface Props {
  kind: Kind;
  value: string | null;
  onChange: (path: string | null) => void;
  slug?: string;
  disabled?: boolean;
  onError?: (message: string) => void;
}

/**
 * Uploader d'image de collection. Deux modes :
 *   - `card`   : miniature affichée sur /collections (ratio 16/9, 1200×675).
 *   - `banner` : bannière hero de /collections/[slug] (ratio 3/1, 2400×800).
 * L'aperçu utilise le ratio cible pour que la cliente voie tout de suite si
 * son fichier va bien passer sans être coupé.
 */
export default function CollectionImageField({
  kind,
  value,
  onChange,
  slug,
  disabled,
  onError,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const isBanner = kind === "banner";
  const title = isBanner ? "Bannière de la page collection" : "Image de la carte";
  const hint = isBanner
    ? "Grand bandeau en haut de la page. Recommandé : 2400 × 800 px (format panoramique 3/1)."
    : "Vignette affichée dans la grille des collections. Recommandé : 1200 × 675 px (format 16/9).";
  const aspectClass = isBanner ? "aspect-[3/1]" : "aspect-[16/9]";

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const fd = new FormData();
    fd.append("image", file);
    fd.append("kind", kind);
    if (slug?.trim()) fd.append("slug", slug.trim());

    try {
      const res = await fetch("/api/admin/collections/images", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        onError?.(data.error ?? "Erreur upload.");
      } else {
        onChange(data.path);
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Erreur upload.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="field-label font-body">{title}</label>
        <p className="text-xs text-text-muted font-body mt-1">{hint}</p>
      </div>

      {value ? (
        <div className={`relative w-full ${aspectClass} rounded-xl overflow-hidden border border-border bg-bg-secondary`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Aperçu" className="w-full h-full object-cover" />
          <div className="absolute top-2 right-2 flex gap-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || disabled}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-primary/90 hover:bg-bg-primary border border-border text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
              title="Changer l'image"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={uploading || disabled}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-primary/90 hover:bg-bg-primary border border-border text-error transition-colors disabled:opacity-50"
              title="Supprimer l'image"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || disabled}
          className={`w-full ${aspectClass} border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 text-text-muted hover:border-border-dark hover:text-text-secondary transition-colors disabled:opacity-50`}
        >
          {uploading ? (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm font-body">Téléchargement…</span>
            </div>
          ) : (
            <>
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="text-sm font-body">Cliquer pour ajouter</span>
              <span className="text-xs">JPG, PNG, WEBP — max 10 Mo</span>
            </>
          )}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
