"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { removeFromCart, updateCartItem } from "@/app/actions/client/cart";

// ─────────────────────────────────────────────
// Types (miroir du retour de getCart())
// ─────────────────────────────────────────────

interface SaleOptionData {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  productColor: {
    unitPrice: number;
    weight: number;
    stock: number;
    color: { name: string; hex: string | null };
    images: { path: string }[];
    product: {
      id: string;
      name: string;
      reference: string;
      category: { name: string };
    };
  };
}

interface CartItemData {
  id: string;
  quantity: number;
  saleOption: SaleOptionData;
}

interface CartData {
  id: string;
  items: CartItemData[];
}

interface Props {
  cart: CartData | null;
}

// ─────────────────────────────────────────────
// Calcul prix
// ─────────────────────────────────────────────

function computeUnitPrice(opt: SaleOptionData): number {
  const { unitPrice } = opt.productColor;
  const base = opt.saleType === "UNIT" ? unitPrice : unitPrice * (opt.packQuantity ?? 1);
  if (!opt.discountType || !opt.discountValue) return base;
  if (opt.discountType === "PERCENT") return Math.max(0, base * (1 - opt.discountValue / 100));
  return Math.max(0, base - opt.discountValue);
}

// ─────────────────────────────────────────────
// Composant ligne
// ─────────────────────────────────────────────

function CartRow({
  item,
  onRemove,
  onQtyChange,
  isPending,
}: {
  item: CartItemData;
  onRemove: (id: string) => void;
  onQtyChange: (id: string, qty: number) => void;
  isPending: boolean;
}) {
  const opt = item.saleOption;
  const product = opt.productColor.product;
  const image = opt.productColor.images[0]?.path ?? null;
  const unitPrice = computeUnitPrice(opt);
  const lineTotal = unitPrice * item.quantity;
  const packUnits = opt.saleType === "PACK" ? (opt.packQuantity ?? 1) * item.quantity : item.quantity;

  return (
    <div className="flex gap-4 py-5 border-b border-[#F5F5F5] last:border-0">
      {/* Image */}
      <Link href={`/produits/${product.id}`} className="shrink-0">
        <div className="w-20 h-20 rounded-xl overflow-hidden bg-[#F5F5F5] border border-[#E5E5E5]">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-7 h-7 text-[#555555] opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
            </div>
          )}
        </div>
      </Link>

      {/* Infos */}
      <div className="flex-1 min-w-0 space-y-1">
        <Link href={`/produits/${product.id}`}
          className="text-sm font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] hover:text-[#1A1A1A] transition-colors line-clamp-2">
          {product.name}
        </Link>
        <p className="text-xs font-mono text-[#999999]">{product.reference}</p>
        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className="text-xs bg-[#F5F5F5] text-[#555555] px-2 py-0.5 rounded-full border border-[#E5E5E5]"
            style={{ borderLeftColor: opt.productColor.color.hex ?? undefined }}>
            {opt.productColor.color.name}
          </span>
          {opt.saleType === "PACK" && (
            <span className="text-xs bg-[#F5F5F5] text-[#333333] px-2 py-0.5 rounded-full border border-[#E5E5E5]">
              Paquet × {opt.packQuantity}
            </span>
          )}
          {opt.size && (
            <span className="text-xs bg-[#F5F5F5] text-[#333333] px-2 py-0.5 rounded-full border border-[#E5E5E5]">
              Taille {opt.size}
            </span>
          )}
        </div>
        {opt.saleType === "PACK" && (
          <p className="text-xs text-[#999999] font-[family-name:var(--font-roboto)]">
            {packUnits} unités au total
          </p>
        )}
      </div>

      {/* Prix + quantité */}
      <div className="flex flex-col items-end gap-2 shrink-0">
        <p className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm">
          {lineTotal.toFixed(2)} €
        </p>
        <p className="text-xs text-[#999999] font-[family-name:var(--font-roboto)]">
          {unitPrice.toFixed(2)} € / {opt.saleType === "UNIT" ? "unité" : "paquet"}
        </p>

        {/* Quantité */}
        <div className="flex items-center border border-[#E5E5E5] rounded-lg overflow-hidden">
          <button
            type="button"
            disabled={isPending}
            onClick={() => onQtyChange(item.id, item.quantity - 1)}
            className="w-7 h-7 flex items-center justify-center text-[#555555] hover:bg-[#F5F5F5] transition-colors text-sm disabled:opacity-40"
          >−</button>
          <span className="w-8 h-7 flex items-center justify-center text-xs font-medium text-[#1A1A1A] border-x border-[#E5E5E5]">
            {item.quantity}
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => onQtyChange(item.id, item.quantity + 1)}
            className="w-7 h-7 flex items-center justify-center text-[#555555] hover:bg-[#F5F5F5] transition-colors text-sm disabled:opacity-40"
          >+</button>
        </div>

        {/* Supprimer */}
        <button
          type="button"
          disabled={isPending}
          onClick={() => onRemove(item.id)}
          className="text-xs text-[#999999] hover:text-[#1A1A1A] transition-colors flex items-center gap-1 disabled:opacity-40"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          Retirer
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────

export default function CartPageClient({ cart }: Props) {
  const router      = useRouter();
  const [isPending, startTransition] = useTransition();

  // Grouper par catégorie
  const grouped: Record<string, CartItemData[]> = {};
  (cart?.items ?? []).forEach((item) => {
    const cat = item.saleOption.productColor.product.category.name;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  const allItems    = cart?.items ?? [];
  const subtotal    = allItems.reduce((s, item) => s + computeUnitPrice(item.saleOption) * item.quantity, 0);
  const totalUnits  = allItems.reduce((s, item) => {
    const units = item.saleOption.saleType === "PACK"
      ? (item.saleOption.packQuantity ?? 1) * item.quantity
      : item.quantity;
    return s + units;
  }, 0);

  function handleRemove(cartItemId: string) {
    startTransition(async () => {
      await removeFromCart(cartItemId);
      router.refresh();
    });
  }

  function handleQtyChange(cartItemId: string, qty: number) {
    if (qty < 1) {
      handleRemove(cartItemId);
      return;
    }
    startTransition(async () => {
      await updateCartItem(cartItemId, qty);
      router.refresh();
    });
  }

  // ── Panier vide ─────────────────────────────
  if (allItems.length === 0) {
    return (
      <div className="container-site py-14">
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-[#1A1A1A] mb-10">
          Mon panier
        </h1>
        <div className="max-w-md mx-auto text-center bg-white border border-[#E5E5E5] rounded-2xl p-12 shadow-card">
          <svg className="w-14 h-14 text-[#555555] mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
          </svg>
          <p className="font-[family-name:var(--font-poppins)] text-lg font-semibold text-[#1A1A1A] mb-2">
            Votre panier est vide
          </p>
          <p className="text-sm font-[family-name:var(--font-roboto)] text-[#555555] mb-7">
            Parcourez notre catalogue et ajoutez vos produits.
          </p>
          <Link href="/produits" className="btn-primary justify-center">
            Voir le catalogue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container-site py-10 md:py-14">
      {/* En-tête */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div>
          <p className="text-xs font-[family-name:var(--font-roboto)] font-medium tracking-[0.2em] uppercase text-[#1A1A1A] mb-1">
            Commande
          </p>
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-[#1A1A1A]">
            Mon panier
          </h1>
        </div>
        <p className="text-sm font-[family-name:var(--font-roboto)] text-[#555555]">
          {allItems.length} référence{allItems.length > 1 ? "s" : ""} · {totalUnits} unité{totalUnits > 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* ── Liste articles ─────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-card">
              {/* En-tête catégorie */}
              <div className="px-5 py-3 border-b border-[#E5E5E5] bg-[#F5F5F5]">
                <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] uppercase tracking-wide">
                  {category}
                </h2>
              </div>
              <div className="px-5">
                {items.map((item) => (
                  <CartRow
                    key={item.id}
                    item={item}
                    onRemove={handleRemove}
                    onQtyChange={handleQtyChange}
                    isPending={isPending}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Récapitulatif ───────────────────────── */}
        <div className="space-y-4">
          <div className="bg-white border border-[#E5E5E5] rounded-2xl p-5 shadow-card space-y-4 sticky top-24">
            <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A]">
              Récapitulatif
            </h3>

            <div className="space-y-2 text-sm font-[family-name:var(--font-roboto)]">
              <div className="flex justify-between text-[#555555]">
                <span>Sous-total HT</span>
                <span className="font-medium text-[#1A1A1A]">{subtotal.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between text-[#999999]">
                <span>TVA</span>
                <span className="italic text-xs">calculée à l&apos;étape suivante</span>
              </div>
              <div className="flex justify-between text-[#999999]">
                <span>Livraison</span>
                <span className="italic text-xs">calculée à l&apos;étape suivante</span>
              </div>
            </div>

            <div className="border-t border-[#E5E5E5] pt-3 flex justify-between items-center">
              <span className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#1A1A1A]">
                Total HT estimé
              </span>
              <span className="font-[family-name:var(--font-poppins)] font-semibold text-lg text-[#1A1A1A]">
                {subtotal.toFixed(2)} €
              </span>
            </div>

            <Link href="/panier/commande" className="btn-primary w-full justify-center">
              Passer la commande
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>

            <Link href="/produits"
              className="text-xs font-[family-name:var(--font-roboto)] text-[#555555] hover:text-[#333333] transition-colors flex items-center justify-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Continuer mes achats
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
