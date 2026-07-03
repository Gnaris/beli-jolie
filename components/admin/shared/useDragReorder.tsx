"use client";

import { useCallback, useState } from "react";

/**
 * Hook drag & drop pour les listes admin (Tailles, Couleurs, Saisons, …).
 *
 * Renvoie des `bind*` à appliquer sur chaque ligne, et calcule à la fois
 * l'ID en cours de drag et l'ID cible avec la position (« above » / « below »)
 * pour dessiner le repère visuel.
 *
 * L'appelant fournit :
 * - `orderedIds` : tableau des IDs dans l'ordre courant (source de vérité UI).
 * - `isLocked(id)` : callback pour bloquer certains items (verrouillés,
 *   orphelins PFS…). Un item verrouillé n'est ni draggable, ni droppable.
 * - `onReorder(newOrder)` : callback qui reçoit le nouvel ordre à persister.
 */
export type DragBinding = {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

export type UseDragReorderOptions = {
  orderedIds: string[];
  isLocked?: (id: string) => boolean;
  /**
   * Optionnel : bloque un couple drag/cible spécifique (par ex. pour
   * empêcher les orphelins PFS de sortir de leur groupe).
   */
  canDropOn?: (dragId: string, targetId: string) => boolean;
  onReorder: (newOrder: string[]) => void;
};

export type UseDragReorderResult = {
  dragId: string | null;
  overId: string | null;
  overPos: "above" | "below" | null;
  bind: (id: string) => DragBinding;
};

export function useDragReorder({
  orderedIds,
  isLocked,
  canDropOn,
  onReorder,
}: UseDragReorderOptions): UseDragReorderResult {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overPos, setOverPos] = useState<"above" | "below" | null>(null);

  const reset = useCallback(() => {
    setDragId(null);
    setOverId(null);
    setOverPos(null);
  }, []);

  const bind = useCallback(
    (id: string): DragBinding => {
      const locked = isLocked ? isLocked(id) : false;
      return {
        draggable: !locked,
        onDragStart: (e) => {
          if (locked) { e.preventDefault(); return; }
          setDragId(id);
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", id); } catch { /* Firefox exige un setData */ }
        },
        onDragEnd: () => reset(),
        onDragOver: (e) => {
          if (!dragId || dragId === id || locked) return;
          if (canDropOn && !canDropOn(dragId, id)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const above = e.clientY < rect.top + rect.height / 2;
          setOverId(id);
          setOverPos(above ? "above" : "below");
        },
        onDragLeave: (e) => {
          // Ne reset que si on quitte réellement l'élément (pas un enfant)
          const related = e.relatedTarget as Node | null;
          if (related && (e.currentTarget as HTMLElement).contains(related)) return;
          if (overId === id) {
            setOverId(null);
            setOverPos(null);
          }
        },
        onDrop: (e) => {
          e.preventDefault();
          if (!dragId || dragId === id || locked) { reset(); return; }
          if (canDropOn && !canDropOn(dragId, id)) { reset(); return; }
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const above = e.clientY < rect.top + rect.height / 2;
          const from = orderedIds.indexOf(dragId);
          const target = orderedIds.indexOf(id);
          if (from < 0 || target < 0) { reset(); return; }
          const next = [...orderedIds];
          const [moved] = next.splice(from, 1);
          if (!moved) { reset(); return; }
          let to = next.indexOf(id);
          if (!above) to += 1;
          next.splice(to, 0, moved);
          reset();
          onReorder(next);
        },
      };
    },
    [dragId, overId, orderedIds, isLocked, canDropOn, onReorder, reset],
  );

  return { dragId, overId, overPos, bind };
}

/**
 * Composant de poignée « ⋮⋮ » à afficher à gauche de chaque ligne.
 * Curseur `grab` → `grabbing` géré au CSS.
 */
export function DragHandle({
  disabled = false,
  ariaLabel = "Glisser pour réorganiser",
  className = "",
}: {
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      title={disabled ? "Verrouillé — non déplaçable" : "Glisser pour réorganiser"}
      className={`inline-flex items-center justify-center w-6 h-8 rounded-md shrink-0 ${disabled ? "opacity-30 cursor-not-allowed" : "text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"} ${className}`}
      aria-label={ariaLabel}
    >
      <svg className="w-3.5 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="9" cy="6" r="1.2" />
        <circle cx="9" cy="12" r="1.2" />
        <circle cx="9" cy="18" r="1.2" />
        <circle cx="15" cy="6" r="1.2" />
        <circle cx="15" cy="12" r="1.2" />
        <circle cx="15" cy="18" r="1.2" />
      </svg>
    </span>
  );
}

/**
 * Utilitaire : classes CSS à ajouter à la ligne pour dessiner le repère de
 * dépôt (barre foncée en haut ou en bas selon la position).
 */
export function dropIndicatorClass(
  overId: string | null,
  overPos: "above" | "below" | null,
  rowId: string,
): string {
  if (overId !== rowId || !overPos) return "";
  return overPos === "above"
    ? "before:content-[''] before:absolute before:left-2 before:right-2 before:-top-0.5 before:h-[3px] before:rounded before:bg-slate-900 before:shadow-[0_0_0_2px_rgba(255,255,255,.9)] before:pointer-events-none"
    : "after:content-[''] after:absolute after:left-2 after:right-2 after:-bottom-0.5 after:h-[3px] after:rounded after:bg-slate-900 after:shadow-[0_0_0_2px_rgba(255,255,255,.9)] after:pointer-events-none";
}
