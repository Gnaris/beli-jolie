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
        <ImportantIcon filled={important} className="w-4 h-4" />
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
      aria-pressed={important}
      className={`inline-flex items-center justify-center gap-1.5 w-full md:w-auto px-2 md:px-3 py-2 md:py-1.5 rounded-md border font-body text-[12px] font-semibold transition-all whitespace-nowrap shadow-sm disabled:opacity-50 disabled:cursor-wait ${
        important
          ? "bg-amber-100 border-amber-300 text-amber-900"
          : "bg-bg-primary border-border text-text-secondary hover:bg-bg-secondary hover:border-border-dark hover:text-text-primary"
      }`}
    >
      <ImportantIcon filled={important} className="w-4 h-4 md:w-3.5 md:h-3.5" />
      <span className="hidden md:inline">Important</span>
    </button>
  );
}

function ImportantIcon({ filled, className }: { filled: boolean; className?: string }) {
  if (filled) {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-12a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0V6zM10 14a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
