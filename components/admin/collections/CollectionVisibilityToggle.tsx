"use client";

import { useState, useTransition } from "react";
import { setCollectionVisibility } from "@/app/actions/admin/collections";
import { useToast } from "@/components/ui/Toast";

interface Props {
  id: string;
  name: string;
  initialVisible: boolean;
  // "card" = switch dans la liste des collections, "editor" = switch de l'éditeur
  variant?: "card" | "editor";
}

export default function CollectionVisibilityToggle({
  id,
  name,
  initialVisible,
  variant = "card",
}: Props) {
  const [visible, setVisible] = useState(initialVisible);
  const [pending, startTransition] = useTransition();
  const { success, error } = useToast();

  function handleToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !visible;
    const previous = visible;
    setVisible(next);
    startTransition(async () => {
      try {
        await setCollectionVisibility(id, next);
        success(
          next ? "Collection visible" : "Collection masquée",
          next
            ? `« ${name} » apparaît maintenant sur le site.`
            : `« ${name} » n'apparaît plus sur le site.`,
        );
      } catch (err) {
        setVisible(previous);
        const detail = err instanceof Error ? err.message : "Erreur inconnue";
        error("Modification impossible", detail);
      }
    });
  }

  if (variant === "editor") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        aria-pressed={visible}
        title={
          visible
            ? "Cliquer pour masquer la collection du site"
            : "Cliquer pour afficher la collection sur le site"
        }
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium font-body border transition-all disabled:opacity-60 ${
          visible
            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
            : "bg-bg-secondary text-text-muted border-border hover:bg-bg-tertiary"
        }`}
      >
        <span
          className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${
            visible ? "bg-emerald-500" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
              visible ? "translate-x-3.5" : "translate-x-0.5"
            } mt-0.5`}
          />
        </span>
        {visible ? "Visible sur le site" : "Masquée"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      aria-pressed={visible}
      title={
        visible
          ? "Visible sur le site — cliquer pour masquer"
          : "Masquée du site — cliquer pour afficher"
      }
      className={`inline-flex items-center gap-1.5 text-xs font-medium font-body px-2.5 py-1 rounded-full border transition-colors disabled:opacity-60 ${
        visible
          ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
          : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
      }`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          visible ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      {visible ? "Visible" : "Masquée"}
    </button>
  );
}
