"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { useBackdropClose } from "@/hooks/useBackdropClose";

interface CartItem {
  id: string;
  quantity: number;
  product: { id: string; reference: string; name: string };
  variant: {
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    unitPrice: number;
    discountType: string | null;
    discountValue: number | null;
    stock: number;
    sizes: { name: string; quantity: number }[];
  };
  color: { name: string; hex: string | null };
  image: string | null;
  lineTotal: number;
}

interface CartData {
  items: CartItem[];
  total: number;
  itemCount: number;
}

interface Props {
  userId: string;
  userName: string;
  onClose: () => void;
}

export default function CartModal({ userId, userName, onClose }: Props) {
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCart = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/cart`);
      if (res.ok) {
        const data = await res.json();
        setCart(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchCart();
  }, [fetchCart]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const backdrop = useBackdropClose(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
      role="dialog"
      aria-modal="true"
      aria-label={`Panier de ${userName}`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-bg-primary rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="font-heading font-semibold text-text-primary text-base">
              Panier de {userName}
            </h3>
            {cart && !loading && (
              <p className="text-xs text-text-muted font-body mt-0.5">
                {cart.itemCount} article{cart.itemCount !== 1 ? "s" : ""} — {cart.total.toFixed(2)} € HT
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-border border-t-[#1A1A1A] rounded-full animate-spin" />
            </div>
          ) : !cart || cart.items.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-12 h-12 text-text-muted mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              <p className="text-sm text-text-muted font-body">
                Panier vide
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.items.map((item) => {
                const hasDiscount = item.variant.discountType && item.variant.discountValue;
                return (
                  <div
                    key={item.id}
                    className="flex gap-3 p-3 rounded-xl bg-bg-secondary"
                  >
                    {/* Image */}
                    <div className="w-14 h-14 rounded-lg bg-bg-primary border border-border overflow-hidden flex-shrink-0">
                      {item.image ? (
                        <Image
                          src={item.image}
                          alt={item.product.name}
                          width={56}
                          height={56}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-heading font-semibold text-text-primary truncate">
                        {item.product.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        <span className="text-[11px] font-mono text-text-muted">
                          {item.product.reference}
                        </span>
                        <span className="text-[11px] text-text-muted">·</span>
                        <span className="flex items-center gap-1 text-[11px] text-text-muted">
                          {item.color.hex && (
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-border inline-block"
                              style={{ backgroundColor: item.color.hex }}
                            />
                          )}
                          {item.color.name}
                        </span>
                        <span className="text-[11px] text-text-muted">·</span>
                        <span className="text-[11px] text-text-muted">
                          {item.variant.saleType === "PACK"
                            ? `Pack ×${item.variant.packQuantity}`
                            : "Unité"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs font-body text-text-secondary">
                          Qté : <span className="font-semibold text-text-primary">{item.quantity}</span>
                        </span>
                        <div className="text-right">
                          {hasDiscount && (
                            <span className="text-[10px] text-text-muted line-through mr-1.5">
                              {(Number(item.variant.unitPrice) * item.quantity).toFixed(2)} €
                            </span>
                          )}
                          <span className="text-sm font-heading font-semibold text-text-primary">
                            {Number(item.lineTotal).toFixed(2)} €
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer total */}
        {cart && cart.items.length > 0 && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-between">
            <span className="text-sm font-body text-text-secondary">
              Total HT
            </span>
            <span className="text-lg font-heading font-bold text-text-primary">
              {cart.total.toFixed(2)} €
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
