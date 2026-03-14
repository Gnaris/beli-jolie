"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import FavoriteToggle from "@/components/client/FavoriteToggle";
import { addToCart } from "@/app/actions/client/cart";

interface SaleOptionData {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
}

interface ColorData {
  id: string;
  hex: string | null;
  name: string;
  firstImage: string | null;
  unitPrice: number;
  isPrimary: boolean;
  saleOptions: SaleOptionData[];
}

interface ProductCardProps {
  id: string;
  name: string;
  reference: string;
  category: string;
  subCategory: string | null;
  colors: ColorData[];
  isFavorite?: boolean;
}

export default function ProductCard({
  id, name, reference, category, subCategory, colors, isFavorite = false,
}: ProductCardProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const primaryColor = colors.find((c) => c.isPrimary) ?? colors[0];
  const [selectedColor, setSelectedColor] = useState<ColorData>(primaryColor ?? colors[0]);
  const [quantity, setQuantity] = useState(1);
  const [addedMsg, setAddedMsg] = useState("");
  const [addError, setAddError] = useState("");

  const displayed   = selectedColor ?? primaryColor;
  const image       = displayed?.firstImage;
  const displayPrice = displayed?.unitPrice ?? Math.min(...colors.map((c) => c.unitPrice));

  // Detect sizes for selected color's UNIT options
  const unitOptions = displayed?.saleOptions.filter((o) => o.saleType === "UNIT") ?? [];
  const packOption  = displayed?.saleOptions.find((o) => o.saleType === "PACK") ?? null;
  const hasSizes    = unitOptions.some((o) => o.size);
  const uniqueSizes = [...new Set(unitOptions.filter((o) => o.size).map((o) => o.size!))];

  const [selectedSize, setSelectedSize] = useState<string>(uniqueSizes[0] ?? "");

  function handleColorSelect(c: ColorData) {
    setSelectedColor(c);
    setAddedMsg("");
    setAddError("");
    const newUnitOpts = c.saleOptions.filter((o) => o.saleType === "UNIT");
    const newSizes = [...new Set(newUnitOpts.filter((o) => o.size).map((o) => o.size!))];
    setSelectedSize(newSizes[0] ?? "");
  }

  async function handleAddToCart() {
    if (!session) {
      router.push("/connexion?callbackUrl=/produits");
      return;
    }

    const qty = Math.max(1, quantity);
    const opts = displayed?.saleOptions ?? [];

    // Find UNIT option (matching size if applicable)
    const unitOpt = hasSizes && selectedSize
      ? opts.find((o) => o.saleType === "UNIT" && o.size === selectedSize)
      : opts.find((o) => o.saleType === "UNIT");
    const packOpt = opts.find((o) => o.saleType === "PACK");

    setAddedMsg("");
    setAddError("");

    startTransition(async () => {
      try {
        if (unitOpt && packOpt && packOpt.packQuantity) {
          // Smart split: qty = numPacks × packQty + remainder
          const packQty   = packOpt.packQuantity;
          const numPacks  = Math.floor(qty / packQty);
          const remainder = qty % packQty;
          if (numPacks > 0)  await addToCart(packOpt.id, numPacks);
          if (remainder > 0) await addToCart(unitOpt.id, remainder);
        } else if (unitOpt) {
          await addToCart(unitOpt.id, qty);
        } else if (packOpt) {
          await addToCart(packOpt.id, qty);
        } else {
          setAddError("Option de vente indisponible.");
          return;
        }
        setAddedMsg("Ajouté !");
        setTimeout(() => setAddedMsg(""), 2500);
      } catch {
        setAddError("Erreur, veuillez réessayer.");
      }
    });
  }

  return (
    <article className="group bg-white border border-[#E5E5E5] rounded-xl overflow-hidden transition-shadow duration-200 hover:shadow-[0_6px_24px_rgba(0,0,0,0.09)] flex flex-col">
      {/* ── Image cliquable ── */}
      <Link href={`/produits/${id}`} className="block">
        <div className="aspect-[4/3] bg-[#F5F5F5] relative overflow-hidden">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-12 h-12 text-[#CCCCCC]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </div>
          )}

          {/* Badge référence */}
          <span className="absolute top-2.5 left-2.5 bg-white/90 backdrop-blur-sm text-[#555555] text-[10px] font-mono px-2 py-0.5 rounded border border-[#E5E5E5]">
            {reference}
          </span>

          {/* Favori */}
          <div className="absolute top-2.5 right-2.5 flex flex-col items-end gap-1.5">
            {colors.length > 1 && (
              <span className="bg-white/90 backdrop-blur-sm text-[#555555] text-[10px] font-[family-name:var(--font-roboto)] px-2 py-0.5 rounded border border-[#E5E5E5]">
                {colors.length} coloris
              </span>
            )}
            <FavoriteToggle productId={id} isFavorite={isFavorite} />
          </div>
        </div>
      </Link>

      {/* ── Infos + Add to cart ── */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Color picker + nom */}
        <div className="space-y-2">
          {colors.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {colors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.name}
                  onClick={() => handleColorSelect(c)}
                  className={`w-5 h-5 rounded-full border-2 transition-all duration-100 ${
                    selectedColor?.id === c.id
                      ? "border-[#1A1A1A] scale-110 shadow-sm"
                      : "border-[#E5E5E5] hover:border-[#999999]"
                  }`}
                  style={{ backgroundColor: c.hex ?? "#CCCCCC" }}
                />
              ))}
            </div>
          )}

          <Link href={`/produits/${id}`} className="block group/name">
            <p className="font-[family-name:var(--font-roboto)] font-medium text-sm text-[#1A1A1A] line-clamp-2 leading-snug group-hover/name:text-[#C2516A] transition-colors">
              {name}
            </p>
          </Link>

          <p className="text-xs text-[#999999] font-[family-name:var(--font-roboto)]">
            {category}{subCategory && <> · {subCategory}</>}
          </p>
        </div>

        {/* Prix */}
        <div className="flex items-baseline gap-1">
          <span className="font-[family-name:var(--font-roboto)] font-semibold text-base text-[#1A1A1A]">
            {displayPrice.toFixed(2)} €
          </span>
          <span className="text-[10px] text-[#999999] font-[family-name:var(--font-roboto)]">/ unité</span>
          {packOption && (
            <span className="text-[10px] text-[#7A9E87] font-[family-name:var(--font-roboto)] ml-1">
              Pack ×{packOption.packQuantity}
            </span>
          )}
        </div>

        {/* ── Add to cart ── */}
        <div className="mt-auto space-y-2">
          {/* Taille si nécessaire */}
          {hasSizes && uniqueSizes.length > 0 && (
            <select
              value={selectedSize}
              onChange={(e) => setSelectedSize(e.target.value)}
              className="w-full border border-[#E5E5E5] rounded-md px-3 py-1.5 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] transition-all bg-white"
            >
              {uniqueSizes.map((s) => (
                <option key={s} value={s}>Taille {s}</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2">
            {/* Quantité */}
            <div className="flex items-center border border-[#E5E5E5] rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-8 h-9 flex items-center justify-center text-[#555555] hover:bg-[#F5F5F5] transition-colors text-lg font-light"
              >−</button>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-10 h-9 text-center text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] border-0 focus:outline-none bg-transparent"
              />
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                className="w-8 h-9 flex items-center justify-center text-[#555555] hover:bg-[#F5F5F5] transition-colors text-lg font-light"
              >+</button>
            </div>

            {/* Bouton ajouter */}
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={isPending}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#1C1018] hover:bg-[#C2516A] text-white text-xs font-[family-name:var(--font-roboto)] font-medium py-2.5 px-3 rounded-md transition-colors duration-200 disabled:opacity-60"
            >
              {isPending ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : addedMsg ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  {addedMsg}
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                  </svg>
                  Ajouter
                </>
              )}
            </button>
          </div>

          {addError && (
            <p className="text-[10px] text-red-500 font-[family-name:var(--font-roboto)]">{addError}</p>
          )}

          {packOption && packOption.packQuantity && (
            <p className="text-[10px] text-[#999999] font-[family-name:var(--font-roboto)]">
              Saisir en unités — le paquet de {packOption.packQuantity} est appliqué automatiquement
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
