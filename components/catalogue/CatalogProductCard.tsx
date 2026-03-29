"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addToCart } from "@/app/actions/client/cart";
import { getImageSrc } from "@/lib/image-utils";
import ColorSwatch from "@/components/ui/ColorSwatch";

interface SubColor {
  color: { name: string; hex: string | null; patternImage?: string | null };
}

interface VariantSize {
  size: { name: string };
  quantity: number;
}

interface ColorVariant {
  id: string;
  colorId: string | null;
  unitPrice: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  color: { id: string; name: string; hex: string | null; patternImage?: string | null } | null;
  subColors: SubColor[];
  variantSizes: VariantSize[];
}

interface ColorImage {
  path: string;
  colorId: string;
  order: number;
}

interface CatalogProductCardProps {
  product: {
    id: string;
    name: string;
    reference: string;
    category: { name: string };
    colors: ColorVariant[];
    colorImages: ColorImage[];
  };
  selectedColorId: string | null;
  selectedImagePath: string | null;
  primaryColor: string;
  isAuthenticated: boolean;
  catalogToken: string;
}

export default function CatalogProductCard({
  product,
  selectedColorId,
  selectedImagePath,
  primaryColor,
  isAuthenticated,
  catalogToken,
}: CatalogProductCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Find initial variant based on catalog selection
  const initialVariant = selectedColorId
    ? product.colors.find((c) => c.color?.id === selectedColorId) ?? product.colors.find((c) => c.isPrimary) ?? product.colors[0]
    : product.colors.find((c) => c.isPrimary) ?? product.colors[0];

  const [activeVariant, setActiveVariant] = useState<ColorVariant | null>(initialVariant ?? null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (!activeVariant) return null;

  // Effective stock
  const effectiveStock = activeVariant.saleType === "PACK" && activeVariant.packQuantity
    ? Math.floor(activeVariant.stock / activeVariant.packQuantity)
    : activeVariant.stock;

  // Image resolution
  const activeColorId = activeVariant.color?.id;
  const image =
    (activeColorId === (selectedColorId ?? initialVariant?.color?.id) ? selectedImagePath : null) ??
    (activeColorId
      ? product.colorImages.find((img) => img.colorId === activeColorId)?.path
      : null) ??
    product.colorImages[0]?.path;

  const price = Number(activeVariant.unitPrice);

  function handleAddToCart() {
    if (!isAuthenticated) {
      router.push(`/connexion?callbackUrl=/catalogue/${catalogToken}`);
      return;
    }

    setError("");
    setSuccess(false);
    startTransition(async () => {
      try {
        await addToCart(activeVariant!.id, quantity);
        setSuccess(true);
        setQuantity(1);
        setTimeout(() => setSuccess(false), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur lors de l'ajout au panier.");
      }
    });
  }

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-[0_1px_6px_rgba(0,0,0,0.07)] hover:shadow-[0_4px_18px_rgba(0,0,0,0.12)] transition-all duration-200">
      {/* Image */}
      <div className="relative aspect-[4/5] bg-[#F5F5F5] overflow-hidden">
        {image ? (
          <img
            src={getImageSrc(image, "medium")}
            alt={product.name}
            className="w-full h-full object-contain p-2"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-[#D1D5DB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
            </svg>
          </div>
        )}
        {/* Bandeau couleur en bas */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: primaryColor }} />
      </div>

      {/* Infos */}
      <div className="p-4">
        <p className="text-[10px] text-[#9CA3AF] uppercase tracking-wider mb-1">
          {product.category.name}
        </p>
        <h2 className="font-semibold text-[#1A1A1A] text-sm leading-snug line-clamp-2 mb-1" style={{ fontFamily: "var(--font-poppins)" }}>
          {product.name}
        </h2>
        <p className="text-xs text-[#9CA3AF] mb-2">
          Réf. {product.reference}
        </p>

        {/* Prix */}
        <p className="font-bold text-base mb-3" style={{ color: primaryColor, fontFamily: "var(--font-poppins)" }}>
          {price.toFixed(2)} €
          <span className="text-xs font-normal text-[#9CA3AF] ml-1">
            HT / {activeVariant.saleType === "PACK" ? "pack" : "unité"}
          </span>
        </p>

        {/* ── Mini-sélecteur ── */}
        <div className="border-t border-[#F0F0F0] pt-3 space-y-2.5">

          {/* Couleurs */}
          {product.colors.length > 1 && (
            <div>
              <p className="text-[10px] text-[#9CA3AF] uppercase tracking-wider mb-1.5">Couleur</p>
              <div className="flex flex-wrap gap-1.5">
                {product.colors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => { setActiveVariant(v); setQuantity(1); setError(""); }}
                    className={`rounded-lg transition-all ${
                      v.id === activeVariant.id
                        ? "ring-2 ring-offset-1"
                        : "hover:ring-1 hover:ring-[#D1D5DB]"
                    }`}
                    style={v.id === activeVariant.id ? { ringColor: primaryColor } as React.CSSProperties : undefined}
                    title={v.color?.name ?? "Pack"}
                  >
                    <ColorSwatch
                      hex={v.color?.hex}
                      patternImage={v.color?.patternImage}
                      subColors={v.subColors.map((sc) => ({
                        hex: sc.color.hex,
                        patternImage: sc.color.patternImage,
                      }))}
                      size={28}
                      border
                      rounded="lg"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tailles (informatif pour UNIT) */}
          {activeVariant.variantSizes.length > 0 && (
            <div>
              <p className="text-[10px] text-[#9CA3AF] uppercase tracking-wider mb-1.5">
                {activeVariant.saleType === "PACK" ? "Contenu" : "Taille"}
              </p>
              <div className="flex flex-wrap gap-1">
                {activeVariant.variantSizes.map((vs) => (
                  <span
                    key={vs.size.name}
                    className="px-2 py-0.5 text-[11px] bg-[#F5F5F5] text-[#6B7280] rounded-md"
                  >
                    {vs.size.name}{vs.quantity > 1 ? ` ×${vs.quantity}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quantité + Ajouter */}
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-[#E5E5E5] rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-7 h-7 flex items-center justify-center text-[#6B7280] hover:bg-[#F5F5F5] transition-colors text-sm"
              >
                −
              </button>
              <span className="w-7 h-7 flex items-center justify-center text-xs font-medium text-[#1A1A1A]">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity(Math.min(effectiveStock, quantity + 1))}
                disabled={quantity >= effectiveStock}
                className="w-7 h-7 flex items-center justify-center text-[#6B7280] hover:bg-[#F5F5F5] transition-colors text-sm disabled:opacity-30"
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={isPending || effectiveStock <= 0}
              className="flex-1 h-7 flex items-center justify-center gap-1.5 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: effectiveStock <= 0 ? "#9CA3AF" : primaryColor }}
            >
              {isPending ? (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : effectiveStock <= 0 ? (
                "Rupture"
              ) : !isAuthenticated ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Se connecter
                </>
              ) : success ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Ajouté !
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                  </svg>
                  Ajouter
                </>
              )}
            </button>
          </div>

          {/* Stock info */}
          {effectiveStock > 0 && effectiveStock <= 5 && (
            <p className="text-[10px] text-[#F59E0B]">
              Plus que {effectiveStock} en stock
            </p>
          )}

          {/* Error / Success messages */}
          {error && (
            <p className="text-[10px] text-[#DC2626] bg-[#FEF2F2] px-2 py-1 rounded">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
