"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";

const DURATION = 5000;

export default function SuccessToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    if (shownRef.current) return;
    if (searchParams.get("success") !== "1") return;

    shownRef.current = true;
    setVisible(true);
    setExiting(false);

    // Nettoyer l'URL sans recharger la page
    const url = new URL(window.location.href);
    url.searchParams.delete("success");
    router.replace(url.pathname + url.search, { scroll: false });

    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => setVisible(false), 400);
    }, DURATION);

    return () => clearTimeout(timer);
  }, [searchParams, router]);

  if (!visible) return null;

  return (
    <div
      className={`fixed top-5 right-5 z-50 w-80 transition-all duration-400 ${
        exiting
          ? "opacity-0 translate-x-4"
          : "opacity-100 translate-x-0 animate-[slideIn_0.3s_ease-out]"
      }`}
    >
      <div className="bg-bg-primary border border-[#A7F3D0] rounded-xl shadow-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-full bg-[#DCFCE7] flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-[#16A34A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-heading text-sm font-semibold text-text-primary">
              Commande validee
            </p>
            <p className="text-xs font-body text-text-secondary mt-0.5">
              Votre paiement a ete confirme avec succes.
            </p>
          </div>
          <button
            onClick={() => { setExiting(true); setTimeout(() => setVisible(false), 400); }}
            className="text-text-muted hover:text-text-primary transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Barre de progression */}
        <div className="h-1 bg-[#F0FDF4]">
          <div
            className="h-full bg-[#22C55E] rounded-r-full"
            style={{
              animation: `shrinkBar ${DURATION}ms linear forwards`,
            }}
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(16px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes shrinkBar {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
      `}</style>
    </div>
  );
}
