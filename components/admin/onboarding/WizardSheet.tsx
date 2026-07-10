"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { OnboardingStep } from "@/lib/onboarding";

export type SheetStep = {
  id: Exclude<OnboardingStep, "done">;
  title: string;
  subtitle: string;
  index: number;
  state: "done" | "active" | "future";
};

export default function WizardSheet({
  open,
  onClose,
  steps,
}: {
  open: boolean;
  onClose: () => void;
  steps: SheetStep[];
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className={`bj-sheet-overlay${open ? " open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`bj-sheet${open ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Parcours de configuration"
      >
        <div className="bj-sheet-handle" />
        <p className="bj-sheet-title">Votre parcours</p>
        <ol className="bj-sheet-list">
          {steps.map((s) => (
            <li key={s.id} className={`bj-sheet-row bj-${s.state}`}>
              <span className={`bj-sheet-num bj-num-${s.state}`}>
                {s.state === "done" ? "✓" : s.index + 1}
              </span>
              <div className="bj-sheet-text">
                <p>{s.title}</p>
                <p>
                  {s.state === "done"
                    ? "Terminée"
                    : s.state === "active"
                    ? "▸ En cours"
                    : "À venir"}
                </p>
              </div>
              {s.state !== "active" && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="bj-sheet-lock">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              )}
            </li>
          ))}
        </ol>
        <p className="bj-sheet-note">
          <strong>💾 Auto-sauvegarde</strong> — Vos réponses sont enregistrées à chaque étape.
        </p>
        <button type="button" className="bj-sheet-close" onClick={onClose}>Fermer</button>
      </div>
      <style jsx>{`
        .bj-sheet-overlay {
          position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.4);
          opacity: 0; pointer-events: none; transition: opacity .3s;
        }
        .bj-sheet-overlay.open { opacity: 1; pointer-events: auto; }
        .bj-sheet {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 61;
          background: white; border-radius: 24px 24px 0 0;
          padding: 20px; padding-bottom: max(20px, env(safe-area-inset-bottom));
          box-shadow: 0 -10px 40px rgba(0,0,0,.15);
          transform: translateY(100%); transition: transform .3s cubic-bezier(.16,1,.3,1);
          max-height: 82vh; overflow-y: auto;
        }
        .bj-sheet.open { transform: translateY(0); }
        .bj-sheet-handle {
          width: 40px; height: 4px; background: #d1d5db;
          border-radius: 999px; margin: 0 auto 16px;
        }
        .bj-sheet-title {
          font-family: var(--font-heading, 'Fraunces', serif);
          font-weight: 700; font-size: 20px; margin: 0 0 16px; color: #111827;
        }
        .bj-sheet-list {
          list-style: none; padding: 0; margin: 0; position: relative;
        }
        .bj-sheet-list::before {
          content: ''; position: absolute; left: 21px; top: 16px; bottom: 16px;
          width: 1px; background: linear-gradient(to bottom, #10b981, #a78bfa, #e5e7eb);
        }
        .bj-sheet-row {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 10px; border-radius: 12px; position: relative;
        }
        .bj-active { background: linear-gradient(135deg, rgba(139,92,246,.12), rgba(236,72,153,.05)); }
        .bj-sheet-num {
          width: 26px; height: 26px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; flex-shrink: 0; z-index: 1;
        }
        .bj-num-done { background: #10b981; color: white; }
        .bj-num-active { background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; }
        .bj-num-future { background: #f3f4f6; color: #9ca3af; }
        .bj-sheet-text { flex: 1; min-width: 0; }
        .bj-sheet-text p:first-child {
          font-size: 14px; font-weight: 600; color: #111827; line-height: 1.2;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0;
        }
        .bj-sheet-text p:last-child {
          font-size: 11px; color: #9ca3af; margin: 3px 0 0; line-height: 1.2;
        }
        .bj-active .bj-sheet-text p:last-child { color: #7c3aed; font-weight: 600; }
        .bj-sheet-lock { color: #9ca3af; flex-shrink: 0; }
        .bj-done { opacity: .7; }
        .bj-future { opacity: .55; }
        .bj-sheet-note {
          margin: 16px 4px 0; padding: 10px 12px;
          border-radius: 12px;
          background: linear-gradient(135deg, #f5f3ff, #fdf2f8);
          border: 1px solid #ede9fe;
          font-size: 11px; color: #6d28d9; line-height: 1.4;
        }
        .bj-sheet-note strong { color: #5b21b6; }
        .bj-sheet-close {
          margin-top: 14px; width: 100%; padding: 12px;
          background: #f3f4f6; border: 0; border-radius: 12px;
          font-size: 14px; font-weight: 600; color: #374151; cursor: pointer;
        }
        .bj-sheet-close:hover { background: #e5e7eb; }
      `}</style>
    </>,
    document.body,
  );
}
