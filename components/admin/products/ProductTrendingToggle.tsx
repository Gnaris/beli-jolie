"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { toggleTrending } from "@/app/actions/admin/products";

interface Props {
  productId: string;
  initialTrending: boolean;
  /** Variante visuelle. "button" = pilule avec libellé. "icon" = flamme seule (liste). */
  variant?: "button" | "icon";
}

export function ProductTrendingToggle({ productId, initialTrending, variant = "icon" }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [trending, setTrending] = useState(initialTrending);
  const [isPending, startTransition] = useTransition();
  const [optimisticPending, setOptimisticPending] = useState(false);
  const pending = isPending || optimisticPending;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pending) return;
    const next = !trending;
    setOptimisticPending(true);
    setTrending(next);
    startTransition(async () => {
      const res = await toggleTrending(productId, next);
      setOptimisticPending(false);
      if (!res.success) {
        setTrending(!next);
        toast.error("Impossible", res.error ?? "Action refusée.");
        return;
      }
      toast.success(next ? "Ajouté aux Tendances" : "Retiré des Tendances");
      router.refresh();
    });
  };

  const title = trending
    ? "Retirer des Tendances"
    : "Marquer comme Tendance du moment";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title={title}
        aria-label={title}
        aria-pressed={trending}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
          trending
            ? "text-rose-500 hover:bg-rose-50"
            : "text-text-muted hover:bg-bg-secondary hover:text-rose-500"
        } disabled:opacity-50 disabled:cursor-wait`}
      >
        <FlameIcon filled={trending} className="w-4 h-4" />
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
      aria-pressed={trending}
      className={`inline-flex items-center justify-center gap-1.5 w-full md:w-auto px-2 md:px-3 py-2 md:py-1.5 rounded-md border font-body text-[12px] font-semibold transition-all whitespace-nowrap shadow-sm disabled:opacity-50 disabled:cursor-wait ${
        trending
          ? "bg-rose-100 border-rose-300 text-rose-900"
          : "bg-bg-primary border-border text-text-secondary hover:bg-bg-secondary hover:border-border-dark hover:text-text-primary"
      }`}
    >
      <FlameIcon filled={trending} className="w-4 h-4 md:w-3.5 md:h-3.5" />
      <span className="hidden md:inline">Tendance</span>
    </button>
  );
}

function FlameIcon({ filled, className }: { filled: boolean; className?: string }) {
  if (filled) {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A3 3 0 0112.12 15.12z" clipRule="evenodd" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z"
      />
    </svg>
  );
}
