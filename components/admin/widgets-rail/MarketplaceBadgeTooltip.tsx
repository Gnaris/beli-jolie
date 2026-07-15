"use client";

/**
 * Tooltip portalé (fixed dans document.body) pour les badges marketplaces
 * du tiroir « Synchro marketplaces ».
 *
 * Pourquoi un portail — les badges vivent dans une carte avec `overflow:hidden`
 * dans un drawer lui-même en overflow:auto : un tooltip en `position:absolute`
 * classique se ferait trancher. En le montant dans `document.body` en `fixed`,
 * il flotte librement au-dessus de tout.
 *
 * Comportement — même famille que le tooltip des mini-boutons du FAB
 * (cf. CLAUDE.md § widget flottant) :
 *  - Hoverable : reste ouvert quand la souris passe du badge au tooltip
 *    (délai anti-flicker de 180 ms).
 *  - Auto-recadrage horizontal si près du bord de l'écran.
 *  - Bouton « Copier le message » affiché uniquement quand `copyable` est
 *    fourni (donc seulement pour les erreurs).
 *  - Feedback via useToast().
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/Toast";

export type TooltipTone = "error" | "ok" | "progress" | "neutral";

interface TooltipPayload {
  anchor: HTMLElement;
  tone: TooltipTone;
  title?: string;
  body: string;
  copyable?: string;
}

interface TooltipContextValue {
  show: (payload: TooltipPayload) => void;
  scheduleHide: () => void;
  cancelHide: () => void;
}

const HIDE_DELAY_MS = 180;

/**
 * Hook interne partagé entre les badges et le portail. Comme le drawer est
 * remonté à chaque ouverture, on garde l'état en local dans le composant hôte
 * `<MarketplaceTooltipHost>` — pas besoin de context React.
 */
function useTooltipController(): {
  payload: TooltipPayload | null;
  api: TooltipContextValue;
} {
  const [payload, setPayload] = useState<TooltipPayload | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      setPayload(null);
      hideTimerRef.current = null;
    }, HIDE_DELAY_MS);
  }, [cancelHide]);

  const show = useCallback(
    (next: TooltipPayload) => {
      cancelHide();
      setPayload(next);
    },
    [cancelHide],
  );

  useEffect(() => () => cancelHide(), [cancelHide]);

  return { payload, api: { show, scheduleHide, cancelHide } };
}

// ────────────────────────────────────────────────────────────────
// Host — à monter une seule fois dans le drawer
// ────────────────────────────────────────────────────────────────

export interface TooltipHandle {
  show: (payload: Omit<TooltipPayload, "anchor"> & { anchor: HTMLElement }) => void;
  scheduleHide: () => void;
  cancelHide: () => void;
}

export function MarketplaceTooltipHost({
  handleRef,
}: {
  handleRef: React.MutableRefObject<TooltipHandle | null>;
}) {
  const { payload, api } = useTooltipController();

  useEffect(() => {
    handleRef.current = api;
    return () => {
      handleRef.current = null;
    };
  }, [api, handleRef]);

  if (!payload) return null;

  return createPortal(
    <TooltipView payload={payload} api={api} />,
    document.body,
  );
}

// ────────────────────────────────────────────────────────────────
// Vue du tooltip lui-même
// ────────────────────────────────────────────────────────────────

const TITLE_COLOR: Record<TooltipTone, string> = {
  error: "text-rose-200",
  ok: "text-emerald-200",
  progress: "text-sky-200",
  neutral: "text-slate-200",
};

function TooltipView({
  payload,
  api,
}: {
  payload: TooltipPayload;
  api: TooltipContextValue;
}) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const toast = useToast();

  // Position au-dessus de l'ancre, centré, recadré si près du bord.
  useEffect(() => {
    const anchor = payload.anchor;
    if (!anchor || !tooltipRef.current) return;
    const anchorRect = anchor.getBoundingClientRect();
    const cx = anchorRect.left + anchorRect.width / 2;
    const cy = anchorRect.top - 8;

    // Première pose puis auto-recadrage
    setPos({ left: cx, top: cy });
    requestAnimationFrame(() => {
      const t = tooltipRef.current;
      if (!t) return;
      const rect = t.getBoundingClientRect();
      const margin = 8;
      let dx = 0;
      if (rect.left < margin) dx = margin - rect.left;
      else if (rect.right > window.innerWidth - margin) {
        dx = window.innerWidth - margin - rect.right;
      }
      if (dx !== 0) setPos({ left: cx + dx, top: cy });
    });
  }, [payload]);

  const handleCopy = useCallback(() => {
    if (!payload.copyable) return;
    void navigator.clipboard.writeText(payload.copyable).then(
      () => toast.success("Copié", "Message d'erreur copié dans le presse-papier."),
      () => toast.error("Copie impossible", "Le presse-papier n'est pas disponible."),
    );
  }, [payload.copyable, toast]);

  return (
    <div
      ref={tooltipRef}
      role="tooltip"
      className="fixed z-[99999] max-w-[280px] min-w-[180px] rounded-[10px] bg-slate-900 text-white shadow-[0_12px_32px_-10px_rgba(0,0,0,.5)] px-3 py-2.5 text-[11.5px] leading-snug pointer-events-auto"
      style={{
        left: pos ? `${pos.left}px` : "-9999px",
        top: pos ? `${pos.top}px` : "-9999px",
        transform: "translate(-50%, -100%)",
      }}
      onMouseEnter={api.cancelHide}
      onMouseLeave={api.scheduleHide}
    >
      {payload.title && (
        <div className={`text-[11px] font-bold mb-1 ${TITLE_COLOR[payload.tone]}`}>
          {payload.title}
        </div>
      )}
      <div>{payload.body}</div>
      {payload.copyable && (
        <button
          type="button"
          onClick={handleCopy}
          className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/40 text-rose-100 hover:text-white text-[10.5px] font-semibold transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Copier le message
        </button>
      )}
      {/* Flèche */}
      <span
        aria-hidden
        className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-slate-900"
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Badge — élément de déclenchement du tooltip
// ────────────────────────────────────────────────────────────────

export interface MarketplaceBadgeProps {
  label: string;
  tone: TooltipTone;
  /** Classes utilitaires appliquées au badge (couleur de fond/texte). */
  className: string;
  /** Point coloré à gauche du label. */
  dotClassName: string;
  /** Contenu additionnel (spinner, etc.) après le label. */
  suffix?: React.ReactNode;
  tooltipTitle?: string;
  tooltipBody: string;
  /** Si fourni, un bouton « Copier le message » apparaît dans le tooltip. */
  copyable?: string;
  tooltipHandle: React.MutableRefObject<TooltipHandle | null>;
}

export function MarketplaceBadge({
  label,
  tone,
  className,
  dotClassName,
  suffix,
  tooltipTitle,
  tooltipBody,
  copyable,
  tooltipHandle,
}: MarketplaceBadgeProps) {
  const ref = useRef<HTMLSpanElement | null>(null);

  const handleEnter = () => {
    const anchor = ref.current;
    if (!anchor) return;
    tooltipHandle.current?.show({
      anchor,
      tone,
      title: tooltipTitle,
      body: tooltipBody,
      copyable,
    });
  };
  const handleLeave = () => {
    tooltipHandle.current?.scheduleHide();
  };

  return (
    <span
      ref={ref}
      tabIndex={0}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      className={`inline-flex items-center gap-1 pl-1.5 pr-2 py-[3px] rounded-full text-[10.5px] font-bold tracking-wide leading-none cursor-default focus:outline-none focus:ring-2 focus:ring-sky-300 ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClassName}`} />
      {label}
      {suffix}
    </span>
  );
}
