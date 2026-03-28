"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useBackdropClose } from "@/hooks/useBackdropClose";

export default function LogoutButton() {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const backdrop = useBackdropClose(() => setOpen(false));

  useEffect(() => { setMounted(true); }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-body font-medium text-text-secondary hover:text-text-primary bg-bg-primary border border-border rounded-lg hover:border-bg-dark transition-all"
        aria-label={t("logout")}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
        </svg>
        {t("logout")}
      </button>

      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={backdrop.onMouseDown}
          onMouseUp={backdrop.onMouseUp}
        >
          <div
            className="bg-bg-primary rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon */}
            <div className="w-12 h-12 mx-auto rounded-full bg-[#FEF3C7] flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-[#F59E0B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </div>

            {/* Title */}
            <h3 className="font-heading text-lg font-semibold text-text-primary text-center">
              {t("logoutConfirmTitle")}
            </h3>

            {/* Message */}
            <p className="text-sm font-body text-text-secondary text-center mt-2">
              {t("logoutConfirmMessage")}
            </p>

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm font-body font-medium text-text-secondary bg-bg-secondary border border-border rounded-xl hover:bg-bg-tertiary transition-colors"
              >
                {t("logoutConfirmCancel")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try { await fetch("/api/heartbeat/disconnect", { method: "POST" }); } catch {}
                  signOut({ callbackUrl: "/connexion" });
                }}
                className="flex-1 px-4 py-2.5 text-sm font-body font-medium text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors"
              >
                {t("logoutConfirmYes")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
