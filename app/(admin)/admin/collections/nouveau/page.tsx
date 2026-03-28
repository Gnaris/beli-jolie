"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createCollection } from "@/app/actions/admin/collections";

export default function NewCollectionPage() {
  const router        = useRouter();
  const [name, setName]     = useState("");
  const [image, setImage]   = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const fileRef               = useRef<HTMLInputElement>(null);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    const fd = new FormData();
    fd.append("image", file);

    const res  = await fetch("/api/admin/collections/images", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Erreur upload.");
    } else {
      setImage(data.path);
      setPreview(data.path);
    }
    setUploading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.append("name",  name);
    if (image) fd.append("image", image);

    const result = await createCollection(fd);
    setSaving(false);

    if (result.error) {
      setError(result.error);
    } else {
      router.push(`/admin/collections/${result.id}/modifier`);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/collections"
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label="Retour"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <h1 className="page-title">
            Nouvelle collection
          </h1>
          <p className="page-subtitle font-body">
            Créez une collection et ajoutez-y des produits après.
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {error && (
          <div className="bg-[#FEE2E2] border border-[#FECACA] text-error text-sm px-4 py-2.5 rounded-xl">
            {error}
          </div>
        )}

        {/* Nom */}
        <div>
          <label className="field-label font-body">
            Nom de la collection <span className="text-error">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex: Été 2026, Romantique, Minimaliste…"
            required
            className="field-input"
          />
        </div>

        {/* Image */}
        <div>
          <label className="field-label font-body">
            Image de la collection
          </label>

          {preview ? (
            <div className="relative w-48 h-48 rounded-xl overflow-hidden border border-border">
              <img src={preview} alt="Aperçu" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => { setImage(null); setPreview(null); }}
                className="absolute top-2 right-2 bg-bg-primary/90 text-text-primary rounded-full p-1 hover:bg-bg-primary transition-colors shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full h-40 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 text-text-muted hover:border-border-dark hover:text-text-secondary transition-colors"
            >
              {uploading ? (
                <span className="text-sm font-body">Téléchargement…</span>
              ) : (
                <>
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                  <span className="text-sm font-body">Cliquer pour ajouter une image</span>
                  <span className="text-xs">JPG, PNG, WEBP — max 5 Mo</span>
                </>
              )}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleImageChange}
          />
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || uploading}
            className="btn-primary"
          >
            {saving ? "Création…" : "Créer la collection"}
          </button>
          <Link href="/admin/collections" className="btn-secondary">
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
