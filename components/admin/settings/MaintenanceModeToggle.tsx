"use client";

import { useState, useTransition } from "react";
import { setMaintenanceMode } from "@/app/actions/admin/site-config";

interface Props {
  currentValue: boolean;
}

export default function MaintenanceModeToggle({ currentValue }: Props) {
  const [enabled, setEnabled] = useState(currentValue);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);

  function requestToggle(value: boolean) {
    setPendingValue(value);
    setConfirmOpen(true);
  }

  function confirm() {
    if (pendingValue === null) return;
    setConfirmOpen(false);
    const newValue = pendingValue;
    startTransition(async () => {
      const result = await setMaintenanceMode(newValue);
      if (result.success) {
        setEnabled(newValue);
        setMessage({
          type: "success",
          text: newValue
            ? "Le site est maintenant en maintenance. Les clients ne peuvent plus y accéder."
            : "Le site est de nouveau accessible aux clients.",
        });
      } else {
        setMessage({ type: "error", text: result.error ?? "Une erreur est survenue." });
      }
      setTimeout(() => setMessage(null), 5000);
    });
  }

  return (
    <>
      {/* Toggle row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-[family-name:var(--font-roboto)] text-sm text-[#1A1A1A] font-medium">
            {enabled ? "Maintenance activée" : "Site en ligne"}
          </p>
          <p className="font-[family-name:var(--font-roboto)] text-xs text-[#6B6B6B] mt-0.5">
            {enabled
              ? "Seul l'administrateur peut accéder au site."
              : "Le site est accessible à tous les clients."}
          </p>
        </div>

        {/* Toggle button */}
        <button
          type="button"
          disabled={isPending}
          onClick={() => requestToggle(!enabled)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1A1A1A] disabled:opacity-50 ${
            enabled ? "bg-[#EF4444]" : "bg-[#D1D1D1]"
          }`}
          aria-checked={enabled}
          role="switch"
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Status indicator */}
      <div className="mt-4 flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${enabled ? "bg-[#EF4444] animate-pulse" : "bg-[#22C55E]"}`}
        />
        <span className="font-[family-name:var(--font-roboto)] text-sm text-[#6B6B6B]">
          {enabled ? "Maintenance active" : "Opérationnel"}
        </span>
      </div>

      {/* Feedback message */}
      {message && (
        <div
          className={`mt-4 rounded-lg px-4 py-3 text-sm font-[family-name:var(--font-roboto)] ${
            message.type === "success"
              ? "bg-[#DCFCE7] text-[#15803D]"
              : "bg-[#FEE2E2] text-[#B91C1C]"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Confirm dialog */}
      {confirmOpen && pendingValue !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setConfirmOpen(false)}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 animate-fadeIn">
            {/* Icon */}
            <div
              className={`mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center ${
                pendingValue ? "bg-[#FEE2E2]" : "bg-[#DCFCE7]"
              }`}
            >
              {pendingValue ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-6 h-6 text-[#EF4444]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-6 h-6 text-[#22C55E]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              )}
            </div>

            <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] text-center mb-2">
              {pendingValue ? "Activer la maintenance ?" : "Désactiver la maintenance ?"}
            </h3>
            <p className="font-[family-name:var(--font-roboto)] text-sm text-[#6B6B6B] text-center mb-6 leading-relaxed">
              {pendingValue
                ? "Le site deviendra immédiatement inaccessible aux clients. Seul l'administrateur pourra continuer à le parcourir."
                : "Le site redeviendra accessible à tous les clients connectés."}
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-[#E5E5E5] text-sm font-medium text-[#6B6B6B] hover:bg-[#F7F7F8] transition-colors font-[family-name:var(--font-roboto)]"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirm}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors font-[family-name:var(--font-roboto)] ${
                  pendingValue
                    ? "bg-[#EF4444] hover:bg-[#DC2626]"
                    : "bg-[#1A1A1A] hover:bg-[#333333]"
                }`}
              >
                {pendingValue ? "Activer" : "Désactiver"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
