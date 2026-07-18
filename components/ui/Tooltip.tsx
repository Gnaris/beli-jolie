"use client";

/**
 * <Tooltip> — infobulle customisée ardoise avec délai d'apparition.
 *
 * Différences avec l'attribut HTML `title=` natif :
 *  - Style contrôlé (fond noir, texte blanc, ombre douce, coins arrondis).
 *  - Délai d'apparition configurable (défaut 400 ms) — laisse le temps de
 *    lire au survol volontaire sans polluer les mouvements de souris rapides.
 *  - Portalé dans document.body, donc jamais rogné par overflow: hidden.
 *  - Positionnement auto (top par défaut), bascule en bas si pas de place.
 *
 * Usage :
 *   <Tooltip content="Marketplace désactivée">
 *     <span className="mp-badge mp-disabled">…</span>
 *   </Tooltip>
 */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Props {
  content: ReactNode;
  children: ReactNode;
  /** Délai avant apparition, en ms. Défaut 400 ms. */
  delayMs?: number;
  /** Position préférée. Défaut "top". Bascule auto si pas de place. */
  placement?: "top" | "bottom";
  /** Désactive complètement le tooltip (utile pour disable conditionnel). */
  disabled?: boolean;
}

interface Position {
  x: number;
  y: number;
  placement: "top" | "bottom";
}

const OFFSET = 8;

export function Tooltip({
  content,
  children,
  delayMs = 400,
  placement = "top",
  disabled = false,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const [mounted, setMounted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useEffect(() => {
    setMounted(true);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const computePosition = useCallback((): Position | null => {
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const tipRect = tip?.getBoundingClientRect();
    const tipW = tipRect?.width ?? 180;
    const tipH = tipRect?.height ?? 32;

    let effective: "top" | "bottom" = placement;
    if (placement === "top" && rect.top - tipH - OFFSET < 8) {
      effective = "bottom";
    } else if (placement === "bottom" && rect.bottom + tipH + OFFSET > window.innerHeight - 8) {
      effective = "top";
    }

    const centerX = rect.left + rect.width / 2;
    const x = Math.max(
      8 + tipW / 2,
      Math.min(window.innerWidth - 8 - tipW / 2, centerX),
    );
    const y = effective === "top" ? rect.top - OFFSET : rect.bottom + OFFSET;

    return { x, y, placement: effective };
  }, [placement]);

  const show = useCallback(() => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setPos(computePosition());
      setVisible(true);
      // Re-mesure après le rendu pour bien centrer si la largeur naturelle
      // du tooltip diffère de l'estimation par défaut.
      requestAnimationFrame(() => setPos(computePosition()));
    }, delayMs);
  }, [computePosition, delayMs, disabled]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  // Wrap l'enfant pour attacher les listeners + un ref combiné.
  if (!isValidElement(children)) {
    // Cas de secours : envelopper dans un <span>.
    return (
      <>
        <span
          ref={(el) => {
            anchorRef.current = el;
          }}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          aria-describedby={visible ? id : undefined}
          style={{ display: "inline-flex" }}
        >
          {children}
        </span>
        {mounted && visible && pos && renderTip(pos, content, id, tipRef)}
      </>
    );
  }

  const child = children as ReactElement<Record<string, unknown>>;
  const cloned = cloneElement(child, {
    ref: (el: HTMLElement | null) => {
      anchorRef.current = el;
      const originalRef = (child as unknown as { ref?: unknown }).ref;
      if (typeof originalRef === "function") {
        (originalRef as (v: HTMLElement | null) => void)(el);
      } else if (originalRef && typeof originalRef === "object") {
        (originalRef as { current: HTMLElement | null }).current = el;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      show();
      const orig = (child.props as { onMouseEnter?: (e: React.MouseEvent) => void }).onMouseEnter;
      orig?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hide();
      const orig = (child.props as { onMouseLeave?: (e: React.MouseEvent) => void }).onMouseLeave;
      orig?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      show();
      const orig = (child.props as { onFocus?: (e: React.FocusEvent) => void }).onFocus;
      orig?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      hide();
      const orig = (child.props as { onBlur?: (e: React.FocusEvent) => void }).onBlur;
      orig?.(e);
    },
    "aria-describedby": visible ? id : undefined,
  });

  return (
    <>
      {cloned}
      {mounted && visible && pos && renderTip(pos, content, id, tipRef)}
    </>
  );
}

function renderTip(
  pos: Position,
  content: ReactNode,
  id: string,
  ref: React.MutableRefObject<HTMLDivElement | null>,
) {
  const transform =
    pos.placement === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  return createPortal(
    <div
      id={id}
      role="tooltip"
      ref={ref}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        transform,
        zIndex: 10000,
        pointerEvents: "none",
        animation: "tooltip-fade-in 120ms ease-out",
      }}
      className="px-2.5 py-1.5 rounded-lg bg-bg-dark text-text-inverse text-[11px] font-semibold shadow-pop max-w-[220px] leading-tight"
    >
      {content}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          [pos.placement === "top" ? "bottom" : "top"]: -4,
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          ...(pos.placement === "top"
            ? { borderTop: "5px solid var(--color-bg-dark)" }
            : { borderBottom: "5px solid var(--color-bg-dark)" }),
        }}
      />
      <style>{`
        @keyframes tooltip-fade-in {
          from { opacity: 0; transform: ${transform} translateY(${pos.placement === "top" ? "2px" : "-2px"}); }
          to   { opacity: 1; transform: ${transform} translateY(0); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
