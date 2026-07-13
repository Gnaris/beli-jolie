"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface AdminWarning {
  title?: string;
  reasons?: string[];
  hint?: string;
}

interface Props {
  warning?: AdminWarning;
  children: React.ReactNode;
  wrapperClassName?: string;
  as?: "div" | "span";
}

export function AdminWarningTooltip({ warning, children, wrapperClassName, as = "div" }: Props) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  const hasContent = !!(warning && (warning.title || warning.reasons?.length || warning.hint));

  function show() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.top + r.height / 2, left: r.right + 14 });
    setVisible(true);
  }
  function hide() { setVisible(false); }

  const handlers = {
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  };

  const setRef = (el: HTMLElement | null) => { ref.current = el; };

  const portal = mounted && visible && pos && hasContent
    ? createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ top: pos.top, left: pos.left, transform: "translateY(-50%)" }}
        >
          <div className="relative w-[280px] rounded-xl bg-zinc-900 text-white text-[12.5px] leading-relaxed shadow-[0_18px_40px_-8px_rgba(9,9,11,0.55)] px-4 py-3">
            <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-zinc-900 rotate-45" />
            {warning?.title && (
              <p className="font-semibold text-amber-300 text-[11px] uppercase tracking-wider mb-1.5">{warning.title}</p>
            )}
            {warning?.reasons && warning.reasons.length > 0 && (
              <ul className="space-y-0.5 text-zinc-100">
                {warning.reasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            )}
            {warning?.hint && (
              <p className={`text-[11px] text-zinc-400 ${(warning.reasons?.length || warning.title) ? "mt-2 pt-2 border-t border-white/10" : ""}`}>
                {warning.hint}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  if (as === "span") {
    return (
      <>
        <span ref={setRef} className={wrapperClassName} {...handlers}>{children}</span>
        {portal}
      </>
    );
  }
  return (
    <>
      <div ref={setRef} className={wrapperClassName} {...handlers}>{children}</div>
      {portal}
    </>
  );
}
