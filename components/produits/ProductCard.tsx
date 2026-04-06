"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import FavoriteToggle from "@/components/client/FavoriteToggle";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { useTranslations } from "next-intl";
import { addToCart } from "@/app/actions/client/cart";

interface VariantData {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizes: { name: string; quantity: number }[];
  unitPrice: number;
  stock: number;
  discountType?: "PERCENT" | "AMOUNT" | null;
  discountValue?: number | null;
}

interface ColorData {
  groupKey: string;
  colorId: string;
  hex: string | null;
  patternImage?: string | null;
  name: string;
  subColors?: { name: string; hex: string; patternImage?: string | null }[];
  firstImage: string | null;
  unitPrice: number;
  isPrimary: boolean;
  totalStock: number;
  variants: VariantData[];
}

export interface ClientDiscountInfo {
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
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
  clientDiscount?: ClientDiscountInfo | null;
  filteredColorIds?: string[];
}

function computeVariantPrice(v: VariantData): number {
  const base = Number(v.unitPrice);
  if (!v.discountType || !v.discountValue) return base;
  const dv = Number(v.discountValue);
  if (v.discountType === "PERCENT") return Math.max(0, base * (1 - dv / 100));
  return Math.max(0, base - dv);
}

function applyClientDiscount(price: number, discount: ClientDiscountInfo | null | undefined): number {
  if (!discount) return price;
  if (discount.discountType === "PERCENT") return Math.max(0, price * (1 - discount.discountValue / 100));
  return Math.max(0, price - discount.discountValue);
}

export default function ProductCard({
  id, name, reference, category, subCategory, colors, tags = [], isFavorite = false, isBestSeller = false, isNew = false, clientDiscount, filteredColorIds = [],
}: ProductCardProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const { tp, tc } = useProductTranslation();
  const t = useTranslations("product");
  const [isPending, startTransition] = useTransition();

  // If color filters are active, auto-select the first matching color
  const primaryColor = colors.find((c) => c.isPrimary) ?? colors[0];
  const filteredMatch = filteredColorIds.length > 0
    ? colors.find((c) => filteredColorIds.includes(c.colorId))
    : null;
  const initialColor = filteredMatch ?? primaryColor ?? colors[0];
  const [selectedColor, setSelectedColor] = useState<ColorData>(initialColor);
  const [quantity, setQuantity] = useState(1);
  const [addedMsg, setAddedMsg] = useState("");
  const [addError, setAddError] = useState("");
  const [showSparkles, setShowSparkles] = useState(false);

  // Re-sync selected color when filtered color IDs change
  const filteredKey = filteredColorIds.join(",");
  const prevFilteredKey = useRef(filteredKey);
  if (prevFilteredKey.current !== filteredKey) {
    prevFilteredKey.current = filteredKey;
    if (filteredColorIds.length > 0) {
      const match = colors.find((c) => filteredColorIds.includes(c.colorId));
      if (match) setSelectedColor(match);
    }
  }

  useEffect(() => {
    if (addedMsg) {
      setShowSparkles(true);
      const t = setTimeout(() => setShowSparkles(false), 800);
      return () => clearTimeout(t);
    }
  }, [addedMsg]);

  const displayed = selectedColor ?? primaryColor;
  const image = displayed?.firstImage;

  // Compute prices with product discount
  const basePrice = displayed?.unitPrice ?? Math.min(...colors.map((c) => c.unitPrice));
  const minVariantPrice = displayed?.variants?.length
    ? Math.min(...displayed.variants.map((v) => computeVariantPrice(v)))
    : basePrice;
  const hasProductDiscount = minVariantPrice < basePrice;

  // Apply client discount on top
  const priceAfterProductDiscount = minVariantPrice;
  const finalPrice = applyClientDiscount(priceAfterProductDiscount, clientDiscount);
  const hasClientDiscount = !!clientDiscount && finalPrice < priceAfterProductDiscount;

  // Display logic
  const showStrikethrough = hasProductDiscount || hasClientDiscount;
  const strikethroughPrice = hasClientDiscount ? priceAfterProductDiscount : basePrice;
  const displayedFinalPrice = hasClientDiscount ? finalPrice : priceAfterProductDiscount;

  // Check if any variant in this product has a discount
  const anyVariantHasDiscount = colors.some((c) =>
    c.variants.some((v) => v.discountType && v.discountValue && v.discountValue > 0)
  );

  // Detect pack options for selected color
  const unitOptions = displayed?.variants.filter((v) => v.saleType === "UNIT") ?? [];
  const packOptions = (displayed?.variants.filter((v) => v.saleType === "PACK") ?? [])
    .sort((a, b) => (b.packQuantity ?? 0) - (a.packQuantity ?? 0));

  // Sizes info from the first UNIT variant (descriptive, not selectable)
  const firstUnitVariant = unitOptions[0];
  const sizesInfo = firstUnitVariant?.sizes?.length ? firstUnitVariant.sizes : [];

  // Stock check: is selected color entirely out of stock?
  const selectedColorOutOfStock = (displayed?.totalStock ?? 0) <= 0;
  // All colors out of stock?
  const allOutOfStock = colors.every((c) => (c.totalStock ?? 0) <= 0);

  function handleColorSelect(c: ColorData) {
    setSelectedColor(c);
    setAddedMsg("");
    setAddError("");
  }

  async function handleAddToCart() {
    if (!session) {
      router.push("/connexion?callbackUrl=/produits");
      return;
    }

    if (selectedColorOutOfStock) {
      setAddError(t("outOfStock"));
      return;
    }

    const qty = Math.max(1, quantity);
    const opts = displayed?.variants ?? [];

    const unitOpt = opts.find((v) => v.saleType === "UNIT");
    const sortedPacks = (opts.filter((v) => v.saleType === "PACK"))
      .sort((a, b) => (b.packQuantity ?? 0) - (a.packQuantity ?? 0));

    setAddedMsg("");
    setAddError("");

    startTransition(async () => {
      try {
        if (sortedPacks.length > 0) {
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
              const smallestPack = sortedPacks[sortedPacks.length - 1];
              await addToCart(smallestPack.id, 1);
            }
          }
        } else if (unitOpt) {
          await addToCart(unitOpt.id, qty);
        } else {
          setAddError(t("errorNoOption"));
          return;
        }
        setAddedMsg(t("added"));
        setTimeout(() => setAddedMsg(""), 2500);
      } catch {
        setAddError(t("errorAddToCart"));
      }
    });
  }

  // Count badges on the left to position ref badge
  const badgeCount = (allOutOfStock ? 1 : 0) + (isBestSeller ? 1 : 0) + (isNew ? 1 : 0) + (anyVariantHasDiscount ? 1 : 0);

  return (
    <article className="group card card-hover overflow-hidden flex flex-col animate-zoom-fade p-2.5">
      {/* Image */}
      <Link href={`/produits/${id}`} className="block">
        <div className="bg-bg-secondary relative overflow-hidden aspect-[5/6] sm:aspect-[4/5] md:aspect-[3/4] rounded-[14px] border border-border-light">
          {image ? (
            <Image
              src={image}
              alt={tp(name)}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-12 h-12 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </div>
          )}

          {/* Badges — max 2 priority badges + ref */}
          <div className="absolute top-2 left-2 z-10 flex flex-col gap-1.5">
            {(() => {
              const badges: { label: string; bg: string }[] = [];
              if (allOutOfStock) badges.push({ label: t("outOfStock"), bg: "bg-text-secondary" });
              if (anyVariantHasDiscount) badges.push({ label: t("promo"), bg: "bg-error" });
              if (isBestSeller) badges.push({ label: t("badgeBestSeller"), bg: "bg-warning" });
              if (isNew) badges.push({ label: t("badgeNew"), bg: "bg-info" });
              return badges.slice(0, 2).map((b) => (
                <span key={b.label} className={`${b.bg} text-text-inverse text-[11px] font-bold font-heading px-3 py-1 rounded-full shadow-sm uppercase tracking-wide backdrop-blur-sm`}>
                  {b.label}
                </span>
              ));
            })()}
            <span className="bg-bg-primary/80 backdrop-blur-sm text-text-muted text-[9px] font-mono px-1.5 py-0.5 rounded-full border border-border w-fit">
              {reference}
            </span>
          </div>

          {/* Favori + coloris count */}
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            {colors.length > 1 && (
              <span className="bg-bg-primary text-text-muted text-[9px] font-body px-1.5 py-0.5 rounded-full border border-border">
                {t("colorCount", { count: colors.length })}
              </span>
            )}
            <FavoriteToggle productId={id} isFavorite={isFavorite} />
          </div>

          {/* Shimmer overlay on hover */}
          <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true">
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)",
                animation: "shimmer 1.5s ease-in-out",
              }}
            />
          </div>
        </div>
      </Link>

      {/* Infos + Add to cart */}
      <div className="px-1.5 pt-3 pb-1.5 flex flex-col gap-3 flex-1">
        {/* Color picker + nom */}
        <div className="space-y-2">
          {colors.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {colors.map((c) => {
                const fullName = c.subColors?.length ? [c.name, ...c.subColors.map(sc => sc.name)].join("/") : c.name;
                const mainHex = c.hex ?? "#9CA3AF";
                let swatchStyle: React.CSSProperties;
                if (c.patternImage) {
                  swatchStyle = { backgroundImage: `url(${c.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" };
                } else if (c.subColors && c.subColors.length > 0) {
                  const allHexes = [mainHex, ...c.subColors.map(sc => sc.hex)];
                  const seg = 360 / allHexes.length;
                  const stops = allHexes.map((hex, i) => `${hex} ${i * seg}deg ${(i + 1) * seg}deg`).join(", ");
                  swatchStyle = { background: `conic-gradient(${stops})` };
                } else {
                  swatchStyle = { backgroundColor: mainHex };
                }
                return (
                  <button
                    key={c.groupKey}
                    type="button"
                    aria-label={tp(fullName)}
                    aria-pressed={selectedColor?.groupKey === c.groupKey}
                    title={tp(fullName)}
                    onClick={() => handleColorSelect(c)}
                    className={`w-8 h-8 rounded-full border-2 transition-all duration-200 swatch-pulse ${
                      selectedColor?.groupKey === c.groupKey
                        ? "border-text-primary scale-110"
                        : filteredColorIds.includes(c.colorId)
                          ? "border-text-primary/50 ring-1 ring-black/10"
                          : "border-border hover:border-border-dark hover:scale-110"
                    }`}
                    style={swatchStyle}
                  />
                );
              })}
            </div>
          )}

          <Link href={`/produits/${id}`} className="block">
            <p className="font-body font-semibold text-sm text-text-primary line-clamp-2 leading-snug hover:text-text-secondary transition-colors">
              {tp(name)}
            </p>
          </Link>

          <p className="text-xs text-text-muted font-body">
            {tc(category)}{subCategory && <> · {tc(subCategory)}</>}
          </p>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.slice(0, 3).map((tag) => (
                <Link
                  key={tag.id}
                  href={`/produits?tag=${tag.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-muted border border-border-light font-body hover:bg-bg-tertiary transition-colors"
                >
                  {tp(tag.name)}
                </Link>
              ))}
              {tags.length > 3 && (
                <span className="text-[11px] px-1 py-0.5 text-text-muted font-body">
                  +{tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Prix + pack */}
        <div>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            {showStrikethrough && (
              <span className="font-body text-xs text-text-muted line-through">
                {strikethroughPrice.toFixed(2)} &euro;
              </span>
            )}
            {hasClientDiscount && clientDiscount?.discountType === "PERCENT" && (
              <span className="text-[11px] font-body text-error font-medium">
                -{clientDiscount.discountValue}%
              </span>
            )}
            <span className={`font-heading font-semibold text-lg ${showStrikethrough ? "text-error" : "text-bg-dark"}`}>
              {displayedFinalPrice.toFixed(2)} &euro;
            </span>
            <span className="text-xs text-text-muted font-body">{t("htUnit")}</span>
          </div>
          {packOptions.length > 0 && (
            <p className="text-[11px] text-text-secondary font-body mt-0.5">
              Pack {packOptions.map((p) => `\u00d7${p.packQuantity}`).join(", ")}
            </p>
          )}
        </div>

        {/* Add to cart */}
        <div className="mt-auto space-y-2">
          {sizesInfo.length > 0 && (
            <p className="text-xs text-text-muted font-body">
              {t("sizes")}: {sizesInfo.map((s) => `${s.name}\u00d7${s.quantity}`).join(", ")}
            </p>
          )}

          <div className="flex items-center gap-2">
            {/* Selected color indicator */}
            {displayed && (() => {
              const mainHex = displayed.hex ?? "#9CA3AF";
              let swatchStyle: React.CSSProperties;
              if (displayed.patternImage) {
                swatchStyle = { backgroundImage: `url(${displayed.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" };
              } else if (displayed.subColors && displayed.subColors.length > 0) {
                const allHexes = [mainHex, ...displayed.subColors.map(sc => sc.hex)];
                const seg = 360 / allHexes.length;
                const stops = allHexes.map((hex, i) => `${hex} ${i * seg}deg ${(i + 1) * seg}deg`).join(", ");
                swatchStyle = { background: `conic-gradient(${stops})` };
              } else {
                swatchStyle = { backgroundColor: mainHex };
              }
              return (
                <div
                  className="w-7 h-7 rounded-full border-2 border-text-primary shrink-0"
                  style={swatchStyle}
                  title={tp(displayed.name)}
                />
              );
            })()}
            <div className="flex items-center border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                aria-label={t("decrease") ?? "Diminuer"}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-9 h-10 flex items-center justify-center text-text-muted hover:bg-bg-secondary transition-colors text-lg font-light"
              >&minus;</button>
              <input
                type="number"
                min={1}
                value={quantity}
                aria-label={t("quantity") ?? "Quantité"}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-10 h-10 text-center text-sm font-body text-text-primary border-0 focus:outline-none bg-transparent"
              />
              <button
                type="button"
                aria-label={t("increase") ?? "Augmenter"}
                onClick={() => setQuantity((q) => q + 1)}
                className="w-9 h-10 flex items-center justify-center text-text-muted hover:bg-bg-secondary transition-colors text-lg font-light"
              >+</button>
            </div>

            <div className="relative flex-1">
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={isPending || selectedColorOutOfStock}
                className={`w-full flex items-center justify-center gap-1.5 text-text-inverse text-xs font-body font-medium py-3 px-3 rounded-lg transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
                  addedMsg ? "bg-accent-dark" : "bg-bg-dark hover:bg-primary-hover"
                }`}
              >
                {isPending ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : selectedColorOutOfStock ? (
                  <span className="text-xs">{t("outOfStock")}</span>
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
                    {t("add")}
                  </>
                )}
              </button>

              {showSparkles && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg" aria-hidden="true">
                  {[...Array(6)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute animate-sparkle-pop"
                      style={{
                        left: `${15 + i * 14}%`,
                        top: `${20 + (i % 2) * 50}%`,
                        animationDelay: `${i * 0.08}s`,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#22C55E">
                        <polygon points="12,2 14.5,9 22,9 16,14 18.5,21 12,17 5.5,21 8,14 2,9 9.5,9" />
                      </svg>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {addError && (
            <p className="text-[11px] text-error font-body">{addError}</p>
          )}

          {packOptions.length > 0 && (
            <p className="text-[11px] text-text-muted font-body">
              {t("packAutoDistribution")}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
