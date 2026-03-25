"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ConfirmType = "danger" | "warning" | "info";

interface ConfirmOptions {
  type?: ConfirmType;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

// ─────────────────────────────────────────────
// Config per type
// ─────────────────────────────────────────────

const CONFIG: Record<ConfirmType, {
  iconBg: string; iconColor: string; icon: string;
  btnBg: string; btnHover: string; btnText: string;
}> = {
  danger: {
    iconBg: "#FEE2E2", iconColor: "#DC2626",
    icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
    btnBg: "#EF4444", btnHover: "#DC2626", btnText: "#FFFFFF",
  },
  warning: {
    iconBg: "#FEF3C7", iconColor: "#D97706",
    icon: "M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z",
    btnBg: "#F59E0B", btnHover: "#D97706", btnText: "#FFFFFF",
  },
  info: {
    iconBg: "#DBEAFE", iconColor: "#2563EB",
    icon: "M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z",
    btnBg: "#1A1A1A", btnHover: "#000000", btnText: "#FFFFFF",
  },
};

// ─────────────────────────────────────────────
// Modal component
// ─────────────────────────────────────────────

function ConfirmModal({
  opts,
  onResult,
}: {
  opts: ConfirmOptions;
  onResult: (confirmed: boolean) => void;
}) {
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => { setMounted(true); }, []);
  const c = CONFIG[opts.type ?? "danger"];

  function resolve(confirmed: boolean) {
    setClosing(true);
    setTimeout(() => onResult(confirmed), 200);
  }

  // Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") resolve(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modal = (
    <div
      ref={backdropRef}
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === backdropRef.current; }}
      onMouseUp={(e) => { if (e.target === backdropRef.current && mouseDownOnBackdrop.current) resolve(false); mouseDownOnBackdrop.current = false; }}
      className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-all duration-200 ${
        closing ? "bg-black/0" : "bg-black/40"
      }`}
      style={{ animation: closing ? undefined : "confirmFadeIn 0.2s ease-out" }}
    >
      <div
        className={`bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] w-full max-w-md overflow-hidden transition-all duration-200 ${
          closing ? "opacity-0 scale-95 translate-y-2" : "opacity-100 scale-100 translate-y-0"
        }`}
        style={{ animation: closing ? undefined : "confirmSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}
      >
        {/* Body */}
        <div className="px-6 pt-6 pb-4 flex gap-4">
          {/* Icon */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: c.iconBg }}
          >
            <svg className="w-5 h-5" fill="none" stroke={c.iconColor} viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={c.icon} />
            </svg>
          </div>
          {/* Text */}
          <div className="flex-1 min-w-0">
            <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] leading-tight">
              {opts.title}
            </h3>
            <p className="text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] mt-1.5 leading-relaxed">
              {opts.message}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => resolve(false)}
            className="px-4 py-2.5 text-sm font-medium font-[family-name:var(--font-roboto)] text-[#6B6B6B] bg-white border border-[#E5E5E5] rounded-lg hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-all duration-150 active:scale-[0.98]"
          >
            {opts.cancelLabel ?? "Annuler"}
          </button>
          <button
            type="button"
            onClick={() => resolve(true)}
            autoFocus
            className="px-4 py-2.5 text-sm font-semibold font-[family-name:var(--font-roboto)] rounded-lg transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-2"
            style={{
              backgroundColor: c.btnBg,
              color: c.btnText,
              // @ts-expect-error -- CSS custom property for hover
              "--hover-bg": c.btnHover,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = c.btnHover)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = c.btnBg)}
          >
            {opts.confirmLabel ?? "Confirmer"}
          </button>
        </div>
      </div>
    </div>
  );

  return mounted ? createPortal(modal, document.body) : null;
}

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirmFn = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setCurrent({ opts, resolve });
    });
  }, []);

  function handleResult(confirmed: boolean) {
    current?.resolve(confirmed);
    setCurrent(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm: confirmFn }}>
      {children}
      {current && <ConfirmModal opts={current.opts} onResult={handleResult} />}

      <style jsx global>{`
        @keyframes confirmFadeIn {
          from { background-color: rgba(0,0,0,0); }
          to   { background-color: rgba(0,0,0,0.4); }
        }
        @keyframes confirmSlideUp {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </ConfirmContext.Provider>
  );
}
