"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useTransition,
  type ReactNode,
} from "react";
import { addToCart, removeFromCart, updateCartItem } from "@/app/actions/client/cart";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface CartContextValue {
  /** Nombre total d'articles (pour le badge Navbar) */
  count: number;
  setCount: (n: number) => void;
  incrementCount: (by?: number) => void;
  decrementCount: (by?: number) => void;

  isPending: boolean;

  handleAddToCart: (saleOptionId: string, qty?: number) => Promise<void>;
  handleRemove: (cartItemId: string, qty?: number) => Promise<void>;
  handleUpdateQty: (cartItemId: string, qty: number) => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function CartProvider({
  children,
  initialCount = 0,
}: {
  children: ReactNode;
  initialCount?: number;
}) {
  const [count, setCount]       = useState(initialCount);
  const [isPending, startTransition] = useTransition();

  const incrementCount = useCallback((by = 1) => setCount((c) => c + by), []);
  const decrementCount = useCallback(
    (by = 1) => setCount((c) => Math.max(0, c - by)),
    []
  );

  const handleAddToCart = useCallback(
    async (saleOptionId: string, qty = 1) => {
      startTransition(async () => {
        await addToCart(saleOptionId, qty);
        incrementCount(qty);
      });
    },
    [incrementCount]
  );

  const handleRemove = useCallback(
    async (cartItemId: string, qty = 1) => {
      startTransition(async () => {
        await removeFromCart(cartItemId);
        decrementCount(qty);
      });
    },
    [decrementCount]
  );

  const handleUpdateQty = useCallback(
    async (cartItemId: string, newQty: number, oldQty = 1) => {
      startTransition(async () => {
        await updateCartItem(cartItemId, newQty);
        setCount((c) => Math.max(0, c - oldQty + Math.max(0, newQty)));
      });
    },
    []
  );

  return (
    <CartContext.Provider
      value={{
        count,
        setCount,
        incrementCount,
        decrementCount,
        isPending,
        handleAddToCart,
        handleRemove,
        handleUpdateQty,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
