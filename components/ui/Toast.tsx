"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, 0 = no auto-dismiss
}

interface ToastContextValue {
  toast: (opts: Omit<ToastItem, "id">) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

// ─────────────────────────────────────────────
// Config per type
// ─────────────────────────────────────────────

const CONFIG: Record<ToastType, {
  dotColor: string; borderColor: string; bgBar: string; barColor: string;
  iconBg: string; iconColor: string; icon: string;
}> = {
  success: {
    dotColor: "#22C55E", borderColor: "#A7F3D0", bgBar: "#F0FDF4", barColor: "#22C55E",
    iconBg: "#DCFCE7", iconColor: "#16A34A",
    icon: "M5 13l4 4L19 7",
  },
  error: {
    dotColor: "#EF4444", borderColor: "#FECACA", bgBar: "#FEF2F2", barColor: "#EF4444",
    iconBg: "#FEE2E2", iconColor: "#DC2626",
    icon: "M6 18L18 6M6 6l12 12",
  },
  warning: {
    dotColor: "#F59E0B", borderColor: "#FDE68A", bgBar: "#FFFBEB", barColor: "#F59E0B",
    iconBg: "#FEF3C7", iconColor: "#D97706",
    icon: "M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z",
  },
  info: {
    dotColor: "#3B82F6", borderColor: "#BFDBFE", bgBar: "#EFF6FF", barColor: "#3B82F6",
    iconBg: "#DBEAFE", iconColor: "#2563EB",
    icon: "M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z",
  },
};

const DEFAULT_DURATION = 4500;

// ─────────────────────────────────────────────
// Single toast card
// ─────────────────────────────────────────────

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const c = CONFIG[item.type];
  const dur = item.duration ?? DEFAULT_DURATION;

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(item.id), 320);
  }, [item.id, onDismiss]);

  useEffect(() => {
    if (dur <= 0) return;
    const t = setTimeout(dismiss, dur);
    return () => clearTimeout(t);
  }, [dur, dismiss]);

  return (
    <div
      className={`w-80 transition-all duration-300 ease-out pointer-events-auto ${
        exiting ? "opacity-0 translate-x-6 scale-95" : "opacity-100 translate-x-0 scale-100"
      }`}
      style={{ animation: exiting ? undefined : "toastSlideIn 0.35s cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div
        className="bg-bg-primary rounded-2xl shadow-lg border border-border overflow-hidden"
        style={{ borderLeft: `3px solid ${c.borderColor}` }}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          {/* Icon with blinking dot */}
          <div className="relative shrink-0 mt-0.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: c.iconBg }}
            >
              <svg className="w-4 h-4" fill="none" stroke={c.iconColor} viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d={c.icon} />
              </svg>
            </div>
            {/* Blinking dot */}
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
              style={{
                backgroundColor: c.dotColor,
                animation: "toastDotPulse 1.5s ease-in-out infinite",
              }}
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="font-heading text-sm font-semibold text-text-primary leading-tight">
              {item.title}
            </p>
            {item.message && (
              <p className="text-xs font-body text-text-secondary mt-0.5 leading-relaxed">
                {item.message}
              </p>
            )}
          </div>

          {/* Close */}
          <button
            onClick={dismiss}
            className="text-[#D1D5DB] hover:text-text-primary transition-colors shrink-0 mt-0.5 p-0.5 rounded-md hover:bg-bg-secondary"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        {dur > 0 && (
          <div className="h-[3px]" style={{ backgroundColor: c.bgBar }}>
            <div
              className="h-full rounded-r-full"
              style={{
                backgroundColor: c.barColor,
                animation: `toastShrink ${dur}ms linear forwards`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const counterRef = useRef(0);

  useEffect(() => { setMounted(true); }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((opts: Omit<ToastItem, "id">) => {
    const id = `toast_${++counterRef.current}_${Date.now()}`;
    setToasts((prev) => [...prev.slice(-4), { ...opts, id }]); // max 5 visible
  }, []);

  const ctx: ToastContextValue = {
    toast: addToast,
    success: (title, message) => addToast({ type: "success", title, message }),
    error: (title, message) => addToast({ type: "error", title, message }),
    warning: (title, message) => addToast({ type: "warning", title, message }),
    info: (title, message) => addToast({ type: "info", title, message }),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {mounted && createPortal(
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2.5 pointer-events-none">
          {toasts.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={remove} />
          ))}
        </div>,
        document.body
      )}

      {/* Keyframes injected once */}
      <style jsx global>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(20px) scale(0.95); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes toastShrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
        @keyframes toastDotPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.75); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
