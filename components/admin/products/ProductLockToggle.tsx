"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { toggleProductLock } from "@/app/actions/admin/products";

interface Props {
  productId: string;
  initialLocked: boolean;
  /** Variante visuelle. "button" = bouton bordé (fiche). "icon" = icône seule (liste). */
  variant?: "button" | "icon";
}

export function ProductLockToggle({ productId, initialLocked, variant = "button" }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [locked, setLocked] = useState(initialLocked);
  const [isPending, startTransition] = useTransition();
  const [optimisticPending, setOptimisticPending] = useState(false);
  const pending = isPending || optimisticPending;

  const handleClick = () => {
    if (pending) return;
    const next = !locked;
    setOptimisticPending(true);
    setLocked(next);
    startTransition(async () => {
      const res = await toggleProductLock(productId, next);
      setOptimisticPending(false);
      if (!res.success) {
        setLocked(!next);
        toast.error("Impossible", res.error ?? "Action refusée.");
        return;
      }
      toast.success(next ? "Produit verrouillé" : "Produit déverrouillé");
      router.refresh();
    });
  };

  const title = locked
    ? "Produit verrouillé — cliquer pour déverrouiller"
    : "Cliquer pour verrouiller (bloque le rafraîchissement)";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title={title}
        aria-label={title}
        aria-pressed={locked}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
          locked
            ? "text-amber-600 hover:bg-amber-50"
            : "text-text-muted hover:bg-bg-secondary hover:text-text-secondary"
        } disabled:opacity-50 disabled:cursor-wait`}
      >
        <LockIcon locked={locked} className="w-4 h-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={title}
      aria-label={title}
      aria-pressed={locked}
      className={`inline-flex items-center justify-center gap-1.5 w-full md:w-auto px-2 md:px-3 py-2 md:py-1.5 text-[12px] font-medium rounded-md border transition-all font-body shadow-sm disabled:opacity-50 disabled:cursor-wait whitespace-nowrap ${
        locked
          ? "text-amber-700 bg-amber-50 border-amber-200 hover:border-amber-300"
          : "text-text-secondary bg-bg-primary border-border hover:bg-bg-secondary hover:border-border-dark hover:text-text-primary"
      }`}
    >
      <LockIcon locked={locked} className="w-4 h-4 md:w-3.5 md:h-3.5" />
      <span className="hidden md:inline">{locked ? "Verrouillé" : "Verrouiller"}</span>
    </button>
  );
}

function LockIcon({ locked, className }: { locked: boolean; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {locked ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
        />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
        />
      )}
    </svg>
  );
}
