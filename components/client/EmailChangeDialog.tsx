"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { requestEmailChange } from "@/app/actions/client/change-email";

interface Props {
  open: boolean;
  currentEmail: string;
  onClose: () => void;
}

export default function EmailChangeDialog({ open, currentEmail, onClose }: Props) {
  const t = useTranslations("account");
  const [mounted, setMounted] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const backdrop = useBackdropClose(() => {
    if (!isPending) handleClose();
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPending]);

  function handleClose() {
    setNewEmail("");
    setPassword("");
    setError("");
    setSentTo(null);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("emailInvalid"));
      return;
    }
    if (trimmed === currentEmail.toLowerCase()) {
      setError(t("emailSameAsCurrent"));
      return;
    }
    if (password.length === 0) {
      setError(t("passwordRequired"));
      return;
    }
    startTransition(async () => {
      const res = await requestEmailChange({
        newEmail: trimmed,
        currentPassword: password,
      });
      if (res.success) {
        setSentTo(trimmed);
        setPassword("");
      } else {
        setError(res.error);
      }
    });
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="bg-bg-primary rounded-2xl shadow-2xl w-full max-w-md p-6 animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {sentTo ? (
          <>
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-emerald-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="font-heading text-lg font-semibold text-text-primary text-center">
              {t("emailChangeSentTitle")}
            </h3>
            <p className="text-sm font-body text-text-secondary text-center mt-2">
              {t.rich("emailChangeSentDesc", {
                email: () => (
                  <strong className="text-text-primary">{sentTo}</strong>
                ),
              })}
            </p>
            <p className="text-xs font-body text-text-muted text-center mt-3">
              {t("emailChangeSentValidity")}
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="btn-primary w-full mt-6"
            >
              {t("close")}
            </button>
          </>
        ) : (
          <>
            <h3 className="font-heading text-lg font-semibold text-text-primary">
              {t("emailChangeDialogTitle")}
            </h3>
            <p className="text-sm font-body text-text-secondary mt-1">
              {t("emailChangeDialogSubtitle")}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4 mt-5">
              <div>
                <label
                  htmlFor="current-email"
                  className="text-xs font-body font-medium text-text-muted uppercase tracking-wider block mb-1"
                >
                  {t("currentEmail")}
                </label>
                <div className="text-sm text-text-primary font-body px-3 py-2 bg-bg-secondary rounded-lg border border-border">
                  {currentEmail}
                </div>
              </div>

              <div>
                <label
                  htmlFor="new-email"
                  className="text-xs font-body font-medium text-text-muted uppercase tracking-wider block mb-1"
                >
                  {t("newEmail")}
                </label>
                <input
                  id="new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={isPending}
                  className="w-full text-sm text-text-primary font-body border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-bg-dark transition-colors"
                  placeholder="nouveau@exemple.com"
                />
              </div>

              <div>
                <label
                  htmlFor="current-password"
                  className="text-xs font-body font-medium text-text-muted uppercase tracking-wider block mb-1"
                >
                  {t("currentPassword")}
                </label>
                <input
                  id="current-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={isPending}
                  className="w-full text-sm text-text-primary font-body border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-bg-dark transition-colors"
                  placeholder={t("currentPasswordPlaceholder")}
                />
                <p className="text-[11px] text-text-muted font-body mt-1">
                  {t("currentPasswordHint")}
                </p>
              </div>

              {error && (
                <p className="text-sm text-[#EF4444] font-body">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isPending}
                  className="flex-1 px-4 py-2.5 text-sm font-body font-medium text-text-secondary bg-bg-secondary border border-border rounded-xl hover:bg-bg-tertiary transition-colors disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 px-4 py-2.5 text-sm font-body font-medium text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors disabled:opacity-50"
                >
                  {isPending ? t("saving") : t("sendConfirmation")}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
