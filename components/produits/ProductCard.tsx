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
  tags?: { id: string; name: string }[];
  isFavorite?: boolean;
  isBestSeller?: boolean;
  isNew?: boolean;
}

export default function ProductCard({
  id, name, reference, category, subCategory, colors, tags = [], isFavorite = false, isBestSeller = false, isNew = false,
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
  // All pack options sorted by packQuantity descending (largest first for greedy algorithm)
  const packOptions = (displayed?.saleOptions.filter((o) => o.saleType === "PACK") ?? [])
    .sort((a, b) => (b.packQuantity ?? 0) - (a.packQuantity ?? 0));
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
    const sortedPacks = (opts.filter((o) => o.saleType === "PACK"))
      .sort((a, b) => (b.packQuantity ?? 0) - (a.packQuantity ?? 0));

    setAddedMsg("");
    setAddError("");

    startTransition(async () => {
      try {
        if (sortedPacks.length > 0) {
          // Greedy split: largest pack first, then smaller packs, then units
          let remaining = qty;
          for (const pack of sortedPacks) {
            if (!pack.packQuantity) continue;
            const numPacks = Math.floor(remaining / pack.packQuantity);
            if (numPacks > 0) {
              await addToCart(pack.id, numPacks);
              remaining -= numPacks * pack.packQuantity;
            }
          }
          if (remaining > 0) {
            if (unitOpt) {
              await addToCart(unitOpt.id, remaining);
            } else {
              // No unit option: round up with smallest pack
              const smallestPack = sortedPacks[sortedPacks.length - 1];
              await addToCart(smallestPack.id, 1);
            }
          }
        } else if (unitOpt) {
          await addToCart(unitOpt.id, qty);
        } else {
          setAddError("Option de vente indisponible.");
          return;
        }
        setAddedMsg("Ajoute !");
        setTimeout(() => setAddedMsg(""), 2500);
      } catch {
        setAddError("Erreur, veuillez reessayer.");
      }
    });
  }

  return (
    <article className="group card card-hover overflow-hidden flex flex-col">
      {/* Image */}
      <Link href={`/produits/${id}`} className="block">
        <div className="bg-bg-tertiary relative overflow-hidden">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={name}
              className="w-full h-auto block transition-transform duration-300 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-12 h-12 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </div>
          )}

          {/* Badge Best-Seller */}
          {isBestSeller && (
            <span className="absolute top-2 left-2 z-10 bg-[#F59E0B] text-white text-[11px] font-bold font-[family-name:var(--font-poppins)] px-3 py-1 rounded-full shadow-md uppercase tracking-wide">
              Best-Seller
            </span>
          )}

          {/* Badge Nouveauté */}
          {isNew && (
            <span className={`absolute ${isBestSeller ? "top-10" : "top-2"} left-2 z-10 bg-[#3B82F6] text-white text-[11px] font-bold font-[family-name:var(--font-poppins)] px-3 py-1 rounded-full shadow-md uppercase tracking-wide`}>
              Nouveauté
            </span>
          )}

          {/* Badge reference */}
          <span className={`absolute ${isBestSeller && isNew ? "top-[4.5rem]" : (isBestSeller || isNew) ? "top-10" : "top-2"} left-2 bg-bg-primary text-text-muted text-[9px] font-mono px-1.5 py-0.5 rounded-full border border-border`}>
            {reference}
          </span>

          {/* Favori + coloris count */}
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            {colors.length > 1 && (
              <span className="bg-bg-primary text-text-muted text-[9px] font-[family-name:var(--font-roboto)] px-1.5 py-0.5 rounded-full border border-border">
                {colors.length} coloris
              </span>
            )}
            <FavoriteToggle productId={id} isFavorite={isFavorite} />
          </div>
        </div>
      </Link>

      {/* Infos + Add to cart */}
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
                  className={`w-[18px] h-[18px] rounded-full border-2 transition-all duration-100 ${
                    selectedColor?.id === c.id
                      ? "border-text-primary scale-110"
                      : "border-border hover:border-border-dark"
                  }`}
                  style={{ backgroundColor: c.hex ?? "#9CA3AF" }}
                />
              ))}
            </div>
          )}

          <Link href={`/produits/${id}`} className="block">
            <p className="font-[family-name:var(--font-roboto)] font-semibold text-sm text-text-primary line-clamp-2 leading-snug hover:text-text-secondary transition-colors">
              {name}
            </p>
          </Link>

          <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
            {category}{subCategory && <> · {subCategory}</>}
          </p>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.slice(0, 3).map((tag) => (
                <Link
                  key={tag.id}
                  href={`/produits?tag=${tag.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-muted border border-border-light font-[family-name:var(--font-roboto)] hover:bg-bg-tertiary transition-colors"
                >
                  {tag.name}
                </Link>
              ))}
              {tags.length > 3 && (
                <span className="text-[10px] px-1 py-0.5 text-text-muted font-[family-name:var(--font-roboto)]">
                  +{tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Prix + pack */}
        <div>
          <div className="flex items-baseline gap-1">
            <span className="font-[family-name:var(--font-poppins)] font-semibold text-lg text-text-primary">
              {displayPrice.toFixed(2)} &euro;
            </span>
            <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">/ unite</span>
          </div>
          {packOptions.length > 0 && (
            <p className="text-[11px] text-text-secondary font-[family-name:var(--font-roboto)] mt-0.5">
              Pack {packOptions.map((p) => `\u00d7${p.packQuantity}`).join(", ")}
            </p>
          )}
        </div>

        {/* Add to cart */}
        <div className="mt-auto space-y-2">
          {/* Taille si necessaire */}
          {hasSizes && uniqueSizes.length > 0 && (
            <select
              value={selectedSize}
              onChange={(e) => setSelectedSize(e.target.value)}
              className="field-input w-full text-sm"
            >
              {uniqueSizes.map((s) => (
                <option key={s} value={s}>Taille {s}</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2">
            {/* Quantite */}
            <div className="flex items-center border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-8 h-9 flex items-center justify-center text-text-muted hover:bg-bg-secondary transition-colors text-lg font-light"
              >&minus;</button>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-10 h-9 text-center text-sm font-[family-name:var(--font-roboto)] text-text-primary border-0 focus:outline-none bg-transparent"
              />
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                className="w-8 h-9 flex items-center justify-center text-text-muted hover:bg-bg-secondary transition-colors text-lg font-light"
              >+</button>
            </div>

            {/* Bouton ajouter */}
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={isPending}
              className={`flex-1 flex items-center justify-center gap-1.5 text-text-inverse text-xs font-[family-name:var(--font-roboto)] font-medium py-2.5 px-3 rounded-lg transition-colors duration-200 disabled:opacity-60 ${
                addedMsg ? "bg-accent-dark" : "bg-bg-dark hover:bg-[#333333]"
              }`}
            >
              {isPending ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : addedMsg ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  Ajoute !
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
            <p className="text-[10px] text-error font-[family-name:var(--font-roboto)]">{addError}</p>
          )}

          {packOptions.length > 0 && (
            <p className="text-[10px] text-text-muted font-[family-name:var(--font-roboto)]">
              Saisir en unites — repartition automatique en packs
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
