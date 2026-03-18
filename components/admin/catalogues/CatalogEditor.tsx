"use client";

import { useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  updateCatalog,
  addProductToCatalog,
  removeProductFromCatalog,
  updateCatalogProductDisplay,
} from "@/app/actions/admin/catalogs";

// ─── Types bruts Prisma (tels que retournés par la page) ──────────────────────

interface RawColorVariant {
  colorId: string;
  isPrimary: boolean;
  unitPrice: number;
  color: { id: string; name: string; hex: string | null };
}

interface RawImage {
  path: string;
  colorId: string;
}

interface ProductSnap {
  id: string;
  name: string;
  reference: string;
  colorImages: RawImage[];
  colors: RawColorVariant[];
}

interface CatalogProductRow {
  productId: string;
  position: number;
  selectedColorId: string | null;
  selectedImagePath: string | null;
  product: ProductSnap;
}

interface CatalogData {
  id: string;
  title: string;
  token: string;
  primaryColor: string;
  coverImagePath: string | null;
  status: "DRAFT" | "PUBLISHED";
  products: CatalogProductRow[];
}

interface Props {
  catalog: CatalogData;
  allProducts: ProductSnap[];
}

// ─── Type couleur dédupliquée ─────────────────────────────────────────────────

interface UniqueColor {
  colorId: string;       // Color.id
  name: string;
  hex: string | null;
  unitPrice: number;
  isPrimary: boolean;
  images: RawImage[];    // Toutes les images de cette couleur
}

// ─── Palette de couleurs suggérées ────────────────────────────────────────────
const PRESET_COLORS = [
  "#1A1A1A", "#374151", "#6B7280",
  "#DC2626", "#EA580C", "#CA8A04",
  "#16A34A", "#0891B2", "#2563EB",
  "#7C3AED", "#DB2777", "#BE185D",
  "#9D174D", "#92400E", "#065F46",
];

// ─── Helper : déduplique les couleurs d'un produit par colorId ────────────────
// Un produit peut avoir UNIT + PACK pour la même couleur → on garde une entrée
// par couleur, en préférant la row isPrimary ou unitPrice de la variante UNIT.
function deduplicateColors(raw: RawColorVariant[], images: RawImage[]): UniqueColor[] {
  const map = new Map<string, UniqueColor>();
  for (const r of raw) {
    const existing = map.get(r.colorId);
    if (!existing) {
      map.set(r.colorId, {
        colorId: r.colorId,
        name: r.color.name,
        hex: r.color.hex,
        unitPrice: r.unitPrice,
        isPrimary: r.isPrimary,
        images: images.filter((img) => img.colorId === r.colorId),
      });
    } else {
      // Si cette row est primaire, propager
      if (r.isPrimary) existing.isPrimary = true;
    }
  }
  return Array.from(map.values());
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function CatalogEditor({ catalog, allProducts }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const coverInputRef = useRef<HTMLInputElement>(null);

  // ── État local ──────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(catalog.title);
  const [color, setColor] = useState(catalog.primaryColor);
  const [coverImagePath, setCoverImagePath] = useState<string | null>(catalog.coverImagePath ?? null);
  const [coverTab, setCoverTab] = useState<"color" | "photo">(catalog.coverImagePath ? "photo" : "color");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">(catalog.status);
  const [selectedProducts, setSelectedProducts] = useState<CatalogProductRow[]>(catalog.products);
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState(false);
  const [copyDone, setCopyDone] = useState(false);

  // IDs déjà dans le catalogue
  const selectedIds = useMemo(() => new Set(selectedProducts.map((p) => p.productId)), [selectedProducts]);

  // Produits filtrés pour la recherche
  const filteredProducts = useMemo(() => {
    const q = search.toLowerCase();
    return allProducts.filter(
      (p) =>
        !selectedIds.has(p.id) &&
        (p.name.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q))
    );
  }, [allProducts, search, selectedIds]);

  // ─── Upload photo de fond ──────────────────────────────────────────────────
  const handleCoverUpload = async (file: File) => {
    setUploadingCover(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/admin/catalogs/cover", { method: "POST", body: fd });
      const data = await res.json();
      if (data.path) setCoverImagePath(data.path);
    } finally {
      setUploadingCover(false);
    }
  };

  // ─── Sauvegarder les réglages ──────────────────────────────────────────────
  const handleSave = () => {
    startTransition(async () => {
      await updateCatalog(catalog.id, {
        title,
        primaryColor: color,
        coverImagePath: coverTab === "photo" ? coverImagePath : null,
        status,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  // ─── Ajouter un produit ───────────────────────────────────────────────────
  const handleAdd = (product: ProductSnap) => {
    startTransition(async () => {
      await addProductToCatalog(catalog.id, product.id);
      setSelectedProducts((prev) => [
        ...prev,
        { productId: product.id, position: prev.length, selectedColorId: null, selectedImagePath: null, product },
      ]);
    });
  };

  // ─── Retirer un produit ───────────────────────────────────────────────────
  const handleRemove = (productId: string) => {
    startTransition(async () => {
      await removeProductFromCatalog(catalog.id, productId);
      setSelectedProducts((prev) => prev.filter((p) => p.productId !== productId));
    });
  };

  // ─── Changer la couleur d'un produit (reset image) ────────────────────────
  const handleColorChange = (productId: string, colorId: string | null) => {
    startTransition(async () => {
      // Changer la couleur réinitialise l'image sélectionnée
      await updateCatalogProductDisplay(catalog.id, productId, colorId, null);
      setSelectedProducts((prev) =>
        prev.map((p) =>
          p.productId === productId
            ? { ...p, selectedColorId: colorId, selectedImagePath: null }
            : p
        )
      );
    });
  };

  // ─── Changer l'image spécifique d'un produit ──────────────────────────────
  const handleImageChange = (productId: string, imagePath: string | null, currentColorId: string | null) => {
    startTransition(async () => {
      await updateCatalogProductDisplay(catalog.id, productId, currentColorId, imagePath);
      setSelectedProducts((prev) =>
        prev.map((p) =>
          p.productId === productId ? { ...p, selectedImagePath: imagePath } : p
        )
      );
    });
  };

  // ─── Copier le lien ───────────────────────────────────────────────────────
  const handleCopyLink = async () => {
    const url = `${window.location.origin}/catalogue/${catalog.token}`;
    await navigator.clipboard.writeText(url);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      {/* ── Colonne gauche : réglages ─────────────────────────────────────── */}
      <div className="xl:col-span-1 space-y-5">

        {/* Bloc infos */}
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-5">
          <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm">
            Informations
          </h2>

          {/* Titre */}
          <div>
            <label className="field-label">Titre</label>
            <input
              type="text"
              className="field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Statut */}
          <div>
            <label className="field-label">Statut</label>
            <div className="flex gap-3">
              {(["DRAFT", "PUBLISHED"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`flex-1 py-2 rounded-lg text-sm font-[family-name:var(--font-roboto)] border transition-colors ${
                    status === s
                      ? "border-[#1A1A1A] bg-[#1A1A1A] text-white"
                      : "border-[#E5E5E5] bg-white text-[#6B7280] hover:border-[#9CA3AF]"
                  }`}
                >
                  {s === "DRAFT" ? "Brouillon" : "Publié"}
                </button>
              ))}
            </div>
          </div>

          {/* Lien */}
          <div>
            <label className="field-label">Lien partageable</label>
            <div className="flex items-center gap-2">
              <p className="flex-1 font-mono text-xs text-[#6B7280] bg-[#F7F7F8] border border-[#E5E5E5] rounded-lg px-3 py-2 truncate">
                /catalogue/{catalog.token}
              </p>
              <button
                onClick={handleCopyLink}
                title="Copier le lien"
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-[#E5E5E5] hover:bg-[#F7F7F8] transition-colors text-[#6B7280] hover:text-[#1A1A1A]"
              >
                {copyDone ? (
                  <svg className="w-4 h-4 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  </svg>
                )}
              </button>
              <a
                href={`/catalogue/${catalog.token}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Visualiser"
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-[#E5E5E5] hover:bg-[#F7F7F8] transition-colors text-[#6B7280] hover:text-[#1A1A1A]"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Bloc fond du catalogue : Couleur ou Photo */}
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-4">
          <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm">
            Fond du catalogue
          </h2>

          {/* Onglets Couleur / Photo */}
          <div className="flex gap-2 p-1 bg-[#F7F7F8] rounded-xl">
            <button
              type="button"
              onClick={() => setCoverTab("color")}
              className={`flex-1 py-1.5 text-xs font-[family-name:var(--font-roboto)] rounded-lg transition-colors ${
                coverTab === "color"
                  ? "bg-white shadow-sm text-[#1A1A1A] font-medium"
                  : "text-[#6B7280] hover:text-[#1A1A1A]"
              }`}
            >
              Couleur
            </button>
            <button
              type="button"
              onClick={() => setCoverTab("photo")}
              className={`flex-1 py-1.5 text-xs font-[family-name:var(--font-roboto)] rounded-lg transition-colors ${
                coverTab === "photo"
                  ? "bg-white shadow-sm text-[#1A1A1A] font-medium"
                  : "text-[#6B7280] hover:text-[#1A1A1A]"
              }`}
            >
              Photo
            </button>
          </div>

          {coverTab === "color" ? (
            <>
              <p className="text-xs text-[#6B7280] font-[family-name:var(--font-roboto)]">
                Couleur utilisée pour l&apos;en-tête et les accents du catalogue.
              </p>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${
                      color === c ? "ring-2 ring-offset-2 ring-[#1A1A1A] scale-110" : ""
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl border border-[#E5E5E5] shrink-0" style={{ backgroundColor: color }} />
                <input
                  type="text"
                  className="field-input font-mono text-sm"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#1A1A1A"
                  maxLength={7}
                />
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-[#E5E5E5] p-0.5"
                  title="Choisir une couleur"
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[#6B7280] font-[family-name:var(--font-roboto)]">
                La photo sera utilisée comme fond de l&apos;en-tête du catalogue partagé.
              </p>
              {coverImagePath ? (
                <div className="relative rounded-xl overflow-hidden border border-[#E5E5E5]">
                  <img src={coverImagePath} alt="Photo de fond" className="w-full h-28 object-cover" />
                  <button
                    type="button"
                    onClick={() => setCoverImagePath(null)}
                    className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg bg-white/90 hover:bg-white border border-[#E5E5E5] text-[#EF4444] transition-colors"
                    title="Supprimer la photo"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={uploadingCover}
                  className="w-full border-2 border-dashed border-[#E5E5E5] rounded-xl py-8 flex flex-col items-center gap-2 hover:border-[#9CA3AF] hover:bg-[#F7F7F8] transition-colors disabled:opacity-50"
                >
                  {uploadingCover ? (
                    <span className="text-sm text-[#6B7280] font-[family-name:var(--font-roboto)]">Téléchargement…</span>
                  ) : (
                    <>
                      <svg className="w-8 h-8 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      <span className="text-sm text-[#6B7280] font-[family-name:var(--font-roboto)]">Cliquer pour choisir une photo</span>
                      <span className="text-xs text-[#9CA3AF]">JPG, PNG, WEBP · max 5 Mo</span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCoverUpload(file);
                  e.target.value = "";
                }}
              />
              {coverImagePath && (
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={uploadingCover}
                  className="w-full text-xs text-[#6B7280] hover:text-[#1A1A1A] py-1.5 transition-colors disabled:opacity-50"
                >
                  Changer la photo
                </button>
              )}
            </>
          )}
        </div>

        {/* Boutons d'action */}
        <div className="flex gap-3">
          <button onClick={() => router.push("/admin/catalogues")} className="btn-secondary flex-1">
            ← Retour
          </button>
          <button onClick={handleSave} disabled={isPending} className="btn-primary flex-1 disabled:opacity-50">
            {saved ? "✓ Enregistré" : isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>

      {/* ── Colonne droite : sélection produits ──────────────────────────── */}
      <div className="xl:col-span-2 space-y-5">

        {/* Produits sélectionnés */}
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm">
              Produits sélectionnés
            </h2>
            <span className="text-xs px-2 py-1 rounded-full bg-[#F3F4F6] text-[#6B7280]">
              {selectedProducts.length} produit{selectedProducts.length !== 1 ? "s" : ""}
            </span>
          </div>

          {selectedProducts.length === 0 ? (
            <div className="py-10 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-xl bg-[#F7F7F8] flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
              </div>
              <p className="text-sm text-[#6B7280] font-[family-name:var(--font-roboto)]">
                Aucun produit. Recherchez des produits ci-dessous pour les ajouter.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedProducts.map((row) => {
                // Couleurs dédupliquées (une par Color.id)
                const uniqueColors = deduplicateColors(row.product.colors, row.product.colorImages);
                const hasMultipleColors = uniqueColors.length > 1;

                // Couleur active : selectedColorId → primaire → première
                const activeColor = row.selectedColorId
                  ? uniqueColors.find((c) => c.colorId === row.selectedColorId)
                  : (uniqueColors.find((c) => c.isPrimary) ?? uniqueColors[0]);

                // Images de la couleur active
                const activeImages = activeColor?.images ?? row.product.colorImages;
                const hasMultipleImages = activeImages.length > 1;

                // Image à afficher dans la miniature
                const displayImage =
                  row.selectedImagePath ??
                  activeImages[0]?.path ??
                  null;

                return (
                  <div
                    key={row.productId}
                    className="p-3 rounded-xl border border-[#F3F4F6] hover:border-[#E5E5E5] transition-colors group"
                  >
                    {/* Ligne principale */}
                    <div className="flex items-start gap-3">
                      {/* Miniature */}
                      <div className="w-14 h-14 rounded-lg bg-[#F7F7F8] overflow-hidden shrink-0">
                        {displayImage ? (
                          <img src={displayImage} alt={row.product.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-5 h-5 text-[#C4C4C4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                            </svg>
                          </div>
                        )}
                      </div>

                      {/* Infos */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-[family-name:var(--font-poppins)] font-medium text-[#1A1A1A] truncate">
                          {row.product.name}
                        </p>
                        <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                          Réf. {row.product.reference}
                          {activeColor ? ` · ${activeColor.unitPrice.toFixed(2)} €` : ""}
                          {activeColor && (
                            <span className="ml-1 font-medium text-[#6B7280]">— {activeColor.name}</span>
                          )}
                        </p>
                      </div>

                      {/* Retirer */}
                      <button
                        onClick={() => handleRemove(row.productId)}
                        disabled={isPending}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[#9CA3AF] hover:text-[#EF4444] hover:bg-[#FEF2F2] transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100 shrink-0"
                        title="Retirer du catalogue"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* ── Sélecteur couleur (si plusieurs couleurs) ────────── */}
                    {hasMultipleColors && (
                      <div className="mt-2.5 pt-2.5 border-t border-[#F3F4F6]">
                        <p className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] mb-1.5">
                          Couleur dans ce catalogue :
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Bouton "défaut" (étoile) */}
                          <button
                            type="button"
                            onClick={() => handleColorChange(row.productId, null)}
                            disabled={isPending}
                            title="Couleur par défaut (primaire)"
                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-bold transition-all ${
                              row.selectedColorId === null
                                ? "border-[#1A1A1A] bg-[#F7F7F8] text-[#1A1A1A] scale-110"
                                : "border-[#E5E5E5] bg-[#F7F7F8] text-[#9CA3AF] hover:border-[#9CA3AF]"
                            }`}
                          >
                            ★
                          </button>
                          {/* Cercles dédupliqués */}
                          {uniqueColors.map((cv) => (
                            <button
                              key={cv.colorId}
                              type="button"
                              onClick={() => handleColorChange(row.productId, cv.colorId)}
                              disabled={isPending}
                              title={cv.name}
                              className={`w-6 h-6 rounded-full border-2 transition-all ${
                                row.selectedColorId === cv.colorId
                                  ? "border-[#1A1A1A] scale-110"
                                  : "border-[#E5E5E5] hover:border-[#9CA3AF]"
                              }`}
                              style={{
                                backgroundColor: cv.hex ?? "#E5E5E5",
                                boxShadow:
                                  cv.hex?.toLowerCase() === "#ffffff"
                                    ? "inset 0 0 0 1px #E5E5E5"
                                    : undefined,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Sélecteur image (si la couleur active a plusieurs images) ── */}
                    {hasMultipleImages && (
                      <div className="mt-2.5 pt-2.5 border-t border-[#F3F4F6]">
                        <p className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] mb-1.5">
                          Image à afficher :
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {activeImages.map((img, idx) => {
                            const isSelected =
                              row.selectedImagePath === img.path ||
                              (row.selectedImagePath === null && idx === 0);
                            return (
                              <button
                                key={img.path}
                                type="button"
                                onClick={() =>
                                  handleImageChange(
                                    row.productId,
                                    idx === 0 ? null : img.path,
                                    row.selectedColorId
                                  )
                                }
                                disabled={isPending}
                                title={`Image ${idx + 1}`}
                                className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                                  isSelected
                                    ? "border-[#1A1A1A] scale-105"
                                    : "border-[#E5E5E5] hover:border-[#9CA3AF]"
                                }`}
                              >
                                <img
                                  src={img.path}
                                  alt={`Image ${idx + 1}`}
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recherche de produits à ajouter */}
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm mb-4">
            Ajouter des produits
          </h2>

          {/* Barre de recherche — padding inline pour éviter la collision avec l'icône */}
          <div className="relative mb-4">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] z-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              className="field-input"
              style={{ paddingLeft: "2.25rem" }}
              placeholder="Rechercher un produit…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {filteredProducts.length === 0 ? (
            <p className="text-center text-sm text-[#9CA3AF] py-6 font-[family-name:var(--font-roboto)]">
              {search ? "Aucun produit trouvé." : "Tous les produits sont déjà dans le catalogue."}
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {filteredProducts.map((product) => {
                const uniqueColors = deduplicateColors(product.colors, product.colorImages);
                const defaultVariant = uniqueColors.find((c) => c.isPrimary) ?? uniqueColors[0];
                const image = product.colorImages[0]?.path;
                return (
                  <div
                    key={product.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-[#F3F4F6] hover:border-[#E5E5E5] transition-colors group cursor-pointer"
                    onClick={() => handleAdd(product)}
                  >
                    <div className="w-12 h-12 rounded-lg bg-[#F7F7F8] overflow-hidden shrink-0">
                      {image ? (
                        <img src={image} alt={product.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-5 h-5 text-[#C4C4C4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-[family-name:var(--font-poppins)] font-medium text-[#1A1A1A] truncate">
                        {product.name}
                      </p>
                      <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                        Réf. {product.reference}
                        {defaultVariant ? ` · ${defaultVariant.unitPrice.toFixed(2)} €` : ""}
                        {uniqueColors.length > 1 && (
                          <span className="ml-1 text-[#9CA3AF]">· {uniqueColors.length} couleurs</span>
                        )}
                      </p>
                    </div>
                    <div className="w-7 h-7 flex items-center justify-center rounded-lg text-[#9CA3AF] group-hover:text-[#22C55E] group-hover:bg-[#F0FDF4] transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
