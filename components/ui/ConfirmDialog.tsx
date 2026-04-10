"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ConfirmType = "danger" | "warning" | "info";

interface ConfirmCheckbox {
  id?: string;
  label: string;
  defaultChecked: boolean;
  onChange?: (checked: boolean) => void;
}

interface ConfirmSecondaryAction {
  label: string;
  style?: "danger" | "neutral";
}

interface ConfirmOptions {
  type?: ConfirmType;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Single checkbox (backward compat) */
  checkbox?: ConfirmCheckbox;
  /** Multiple checkboxes — takes priority over `checkbox` if both provided */
  checkboxes?: ConfirmCheckbox[];
  /** Section label above checkboxes (default: none for single, "Options" for multiple) */
  checkboxesLabel?: string;
  secondaryAction?: ConfirmSecondaryAction;
}

export type ConfirmResult = boolean | "secondary";

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<ConfirmResult>;
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
  iconBg: string;
  iconColor: string;
  icon: React.ReactNode;
  btnClass: string;
}> = {
  danger: {
    iconBg: "bg-red-50",
    iconColor: "#EF4444",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="#EF4444" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    ),
    btnClass: "bg-red-500 hover:bg-red-600 text-white focus:ring-red-500/30",
  },
  warning: {
    iconBg: "bg-amber-50",
    iconColor: "#F59E0B",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="#F59E0B" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z" />
      </svg>
    ),
    btnClass: "bg-amber-500 hover:bg-amber-600 text-white focus:ring-amber-500/30",
  },
  info: {
    iconBg: "bg-bg-tertiary",
    iconColor: "#4B5563",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="#4B5563" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
      </svg>
    ),
    btnClass: "bg-text-primary hover:bg-black text-white focus:ring-text-primary/30",
  },
};

// ─────────────────────────────────────────────
// Checkbox component
// ─────────────────────────────────────────────

function CheckboxItem({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group select-none">
      <span className="relative flex items-center justify-center shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={`
            w-[18px] h-[18px] rounded-[5px] border-2 transition-all duration-150
            ${checked
              ? "border-text-primary bg-text-primary"
              : "border-border-dark bg-bg-primary hover:border-text-muted"
            }
          `}
        />
        <svg
          className={`absolute w-3 h-3 text-white pointer-events-none transition-all duration-150 ${
            checked ? "opacity-100 scale-100" : "opacity-0 scale-75"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
      <span className="text-[13px] font-body text-text-secondary leading-snug">
        {label}
      </span>
    </label>
  );
}

// ─────────────────────────────────────────────
// Modal component
// ─────────────────────────────────────────────

function ConfirmModal({
  opts,
  onResult,
}: {
  opts: ConfirmOptions;
  onResult: (result: ConfirmResult) => void;
}) {
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);

  // Merge checkboxes: `checkboxes` takes priority, fallback to single `checkbox`
  const allCheckboxes = opts.checkboxes ?? (opts.checkbox ? [opts.checkbox] : []);
  const [checkedStates, setCheckedStates] = useState<boolean[]>(
    allCheckboxes.map((cb) => cb.defaultChecked)
  );

  useEffect(() => { setMounted(true); }, []);
  const c = CONFIG[opts.type ?? "danger"];

  function resolve(result: ConfirmResult) {
    setClosing(true);
    setTimeout(() => onResult(result), 200);
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

  function handleCheckboxChange(idx: number, checked: boolean) {
    setCheckedStates((prev) => {
      const next = [...prev];
      next[idx] = checked;
      return next;
    });
    allCheckboxes[idx]?.onChange?.(checked);
  }

  const modal = (
    <div
      ref={backdropRef}
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === backdropRef.current; }}
      onMouseUp={(e) => { if (e.target === backdropRef.current && mouseDownOnBackdrop.current) resolve(false); mouseDownOnBackdrop.current = false; }}
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-all duration-200 ${
        closing ? "bg-black/0 backdrop-blur-0" : "bg-black/30 backdrop-blur-[3px]"
      }`}
      style={{ animation: closing ? undefined : "confirmFadeIn 0.2s ease-out" }}
    >
      <div
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className={`bg-bg-primary rounded-2xl shadow-xl border border-border w-full max-w-md overflow-hidden transition-all duration-200 ${
          closing ? "opacity-0 scale-95 translate-y-2" : "opacity-100 scale-100 translate-y-0"
        }`}
        style={{ animation: closing ? undefined : "confirmSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-3.5">
            {/* Icon */}
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.iconBg}`}>
              {c.icon}
            </div>
            {/* Text */}
            <div className="flex-1 min-w-0 pt-0.5">
              <h3 id="confirm-title" className="font-heading text-[15px] font-semibold text-text-primary leading-tight">
                {opts.title}
              </h3>
              <p id="confirm-message" className="text-sm font-body text-text-secondary mt-1.5 leading-relaxed">
                {opts.message}
              </p>
            </div>
          </div>
        </div>

        {/* Checkboxes */}
        {allCheckboxes.length > 0 && (
          <div className="mx-6 mb-4 px-4 py-3 rounded-xl bg-bg-secondary border border-border space-y-2.5">
            {(opts.checkboxesLabel || allCheckboxes.length > 1) && (
              <p className="text-[11px] uppercase tracking-wider font-medium text-text-muted mb-1">
                {opts.checkboxesLabel ?? "Options"}
              </p>
            )}
            {allCheckboxes.map((cb, idx) => (
              <CheckboxItem
                key={cb.id ?? idx}
                label={cb.label}
                checked={checkedStates[idx]}
                onChange={(v) => handleCheckboxChange(idx, v)}
              />
            ))}
          </div>
        )}

        {/* Separator */}
        <div className="h-px bg-border mx-6" />

        {/* Actions */}
        <div className="px-6 py-4 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => resolve(false)}
            className="px-4 py-2 text-[13px] font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-lg hover:bg-bg-secondary hover:text-text-primary transition-all duration-150 active:scale-[0.98]"
          >
            {opts.cancelLabel ?? "Annuler"}
          </button>
          {opts.secondaryAction && (
            <button
              type="button"
              onClick={() => resolve("secondary")}
              className={`px-4 py-2 text-[13px] font-medium font-body rounded-lg border transition-all duration-150 active:scale-[0.98] ${
                opts.secondaryAction.style === "danger"
                  ? "text-red-600 border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300"
                  : "text-text-secondary border-border bg-bg-secondary hover:bg-[#E5E5E5] hover:text-text-primary"
              }`}
            >
              {opts.secondaryAction.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => resolve(true)}
            autoFocus
            className={`px-5 py-2 text-[13px] font-semibold font-body rounded-lg transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-1 ${c.btnClass}`}
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
  const [current, setCurrent] = useState<{ opts: ConfirmOptions; resolve: (v: ConfirmResult) => void } | null>(null);

  const confirmFn = useCallback((opts: ConfirmOptions): Promise<ConfirmResult> => {
    return new Promise<ConfirmResult>((resolve) => {
      setCurrent({ opts, resolve });
    });
  }, []);

  function handleResult(result: ConfirmResult) {
    current?.resolve(result);
    setCurrent(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm: confirmFn }}>
      {children}
      {current && <ConfirmModal opts={current.opts} onResult={handleResult} />}

      <style jsx global>{`
        @keyframes confirmFadeIn {
          from { background-color: rgba(0,0,0,0); }
          to   { background-color: rgba(0,0,0,0.3); }
        }
        @keyframes confirmSlideUp {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </ConfirmContext.Provider>
  );
}
