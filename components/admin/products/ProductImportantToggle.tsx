"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { toggleProductImportant } from "@/app/actions/admin/products";

interface Props {
  productId: string;
  initialImportant: boolean;
  /** Variante visuelle. "button" = pilule avec libellé (fiche). "icon" = étoile seule (liste). */
  variant?: "button" | "icon";
}

export function ProductImportantToggle({ productId, initialImportant, variant = "button" }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [important, setImportant] = useState(initialImportant);
  const [isPending, startTransition] = useTransition();
  const [optimisticPending, setOptimisticPending] = useState(false);
  const pending = isPending || optimisticPending;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pending) return;
    const next = !important;
    setOptimisticPending(true);
    setImportant(next);
    startTransition(async () => {
      const res = await toggleProductImportant(productId, next);
      setOptimisticPending(false);
      if (!res.success) {
        setImportant(!next);
        toast.error("Impossible", res.error ?? "Action refusée.");
        return;
      }
      toast.success(next ? "Ajouté aux Importants" : "Retiré des Importants");
      router.refresh();
    });
  };

  const title = important
    ? "Retirer des Importants"
    : "Marquer comme Important";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title={title}
        aria-label={title}
        aria-pressed={important}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
          important
            ? "text-amber-500 hover:bg-amber-50"
            : "text-text-muted hover:bg-bg-secondary hover:text-amber-500"
        } disabled:opacity-50 disabled:cursor-wait`}
      >
        <StarIcon filled={important} className="w-4 h-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={title}
      aria-pressed={important}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-body text-[12px] font-semibold transition-all whitespace-nowrap shadow-sm disabled:opacity-50 disabled:cursor-wait ${
        important
          ? "bg-gradient-to-br from-amber-100 to-amber-200 border-amber-400 text-amber-800"
          : "bg-bg-primary border-border text-text-secondary hover:border-border-dark"
      }`}
    >
      <StarIcon filled={important} className="w-3.5 h-3.5" />
      Important
    </button>
  );
}

function StarIcon({ filled, className }: { filled: boolean; className?: string }) {
  if (filled) {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.956a1 1 0 00.95.69h4.161c.969 0 1.371 1.24.588 1.81l-3.366 2.446a1 1 0 00-.363 1.118l1.286 3.956c.3.922-.755 1.688-1.54 1.118l-3.366-2.446a1 1 0 00-1.176 0l-3.366 2.446c-.784.57-1.838-.196-1.539-1.118l1.286-3.956a1 1 0 00-.363-1.118L2.98 9.383c-.783-.57-.38-1.81.588-1.81h4.161a1 1 0 00.951-.69l1.286-3.956z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
      />
    </svg>
  );
}
