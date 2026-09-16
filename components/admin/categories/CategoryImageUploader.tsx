"use client";

import { useEffect, useRef, useState } from "react";
import SmartImage from "@/components/ui/SmartImage";
import { updateCategoryImage } from "@/app/actions/admin/categories";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Props {
  categoryId: string;
  categoryName: string;
  initialImage: string | null;
  onChange: (nextImage: string | null) => void;
}

/**
 * Uploader image de catégorie. UI : preview ronde + bouton « Choisir » +
 * bouton « Retirer » (si image présente). Format 1:1 conseillé, PNG
 * transparent ou JPG fond blanc, 800×800 min, 10 Mo max.
 */
export default function CategoryImageUploader({
  categoryId,
  categoryName,
  initialImage,
  onChange,
}: Props) {
  const [image, setImage] = useState<string | null>(initialImage);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { confirm } = useConfirm();

  // Le parent (CategoriesMasterDetail) réutilise ce composant en changeant
  // simplement les props quand la cliente passe d'une catégorie à l'autre —
  // useState(initialImage) ne relit pas la prop, donc sans ce sync l'aperçu
  // reste figé sur l'image de la catégorie précédente jusqu'au refresh.
  useEffect(() => {
    setImage(initialImage);
    setError("");
  }, [initialImage, categoryId]);

  const monogram = categoryName.trim().charAt(0).toUpperCase() || "•";

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("id", categoryId);
      const res = await fetch("/api/admin/categories/images", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Erreur upload.");
      }
      await updateCategoryImage(categoryId, data.path);
      setImage(data.path);
      onChange(data.path);
      toast.success("Image enregistrée");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur upload.";
      setError(msg);
      toast.error("Upload impossible", msg);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    const ok = await confirm({
      type: "danger",
      title: "Retirer l'image ?",
      message: `La catégorie « ${categoryName} » affichera à nouveau la lettre « ${monogram} » sur fond noir.`,
      confirmLabel: "Retirer",
    });
    if (!ok) return;
    setUploading(true);
    setError("");
    try {
      await updateCategoryImage(categoryId, null);
      setImage(null);
      onChange(null);
      toast.success("Image retirée");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur suppression.";
      setError(msg);
      toast.error("Suppression impossible", msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      {/* Preview ronde */}
      <div className="shrink-0">
        {image ? (
          <div className="w-20 h-20 rounded-full bg-white border border-border grid place-items-center overflow-hidden shadow-[var(--shadow-sm)]">
            <SmartImage
              src={image}
              alt={categoryName}
              width={160}
              height={160}
              className="w-[78%] h-[78%] object-contain"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="w-20 h-20 rounded-full bg-slate-900 text-white grid place-items-center">
            <span className="text-2xl font-heading font-semibold leading-none">{monogram}</span>
          </div>
        )}
      </div>

      {/* Actions + hint */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink text-[12.5px] font-semibold transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                  <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Envoi…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                {image ? "Remplacer" : "Choisir une image"}
              </>
            )}
          </button>
          {image && !uploading && (
            <button
              type="button"
              onClick={handleRemove}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] text-[12.5px] font-semibold transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Retirer
            </button>
          )}
        </div>
        <p className="text-[11px] text-text-muted leading-relaxed">
          Format carré (1:1), PNG transparent ou JPG fond blanc, 800×800 px minimum, 10 Mo max.
          <br />Sans image, la lettre « <span className="font-semibold">{monogram}</span> » s'affichera dans un cercle noir.
        </p>
        {error && (
          <p className="text-[11.5px] text-[#DC2626] font-medium">{error}</p>
        )}
      </div>

      {/* Input file caché */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFile}
        className="sr-only"
      />
    </div>
  );
}
