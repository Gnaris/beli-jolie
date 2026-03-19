"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

function getAccessCodeSnapshot() {
  return document.cookie.includes("bj_access_code=");
}

function getAccessCodeServerSnapshot() {
  return false;
}

function subscribeAccessCode(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

/**
 * Bandeau en bas de page pour les visiteurs naviguant avec un code d'accès invité.
 * Position absolute (ne cache pas le contenu). Peut être replié/déplié avec animation.
 * Sur les pages auth : le bouton devient "Visiter le site".
 */
export default function GuestBanner() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const hasAccessCode = useSyncExternalStore(subscribeAccessCode, getAccessCodeSnapshot, getAccessCodeServerSnapshot);
  const [collapsed, setCollapsed] = useState(false);

  function handleLogout() {
    document.cookie = "bj_access_code=; max-age=0; path=/";
    router.push("/connexion");
    router.refresh();
  }

  if (session?.user || !hasAccessCode) return null;

  const isAuthPage = pathname === "/connexion" || pathname === "/inscription";

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-500 ease-in-out ${
        collapsed ? "translate-y-[calc(100%-44px)]" : "translate-y-0"
      }`}
    >
      {/* Toggle — solidaire du bandeau, se déplace avec lui */}
      <div className="flex justify-center">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="bg-bg-dark text-text-inverse/70 hover:text-warning px-5 py-2 rounded-t-xl transition-colors duration-300"
          aria-label={collapsed ? "Afficher le bandeau invité" : "Masquer le bandeau invité"}
        >
          <svg
            className={`w-5 h-5 transition-transform duration-500 ease-in-out ${collapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Banner */}
      <div className="bg-bg-dark text-text-inverse px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between gap-4 shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-warning/15 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm sm:text-base font-semibold font-[family-name:var(--font-poppins)] text-warning">
              Mode invit&#233;
            </p>
            <p className="text-xs sm:text-sm text-text-inverse/70 font-[family-name:var(--font-roboto)] hidden sm:block truncate">
              Inscrivez-vous rapidement et sans v&#233;rification pour acc&#233;der compl&#232;tement au site.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={isAuthPage ? "/" : "/inscription"}
            className="text-sm font-[family-name:var(--font-roboto)] font-semibold bg-bg-primary text-text-primary px-5 py-2.5 rounded-xl hover:bg-bg-secondary transition-colors whitespace-nowrap"
          >
            {isAuthPage ? (
              <>
                <span className="hidden sm:inline">Visiter le site</span>
                <span className="sm:hidden">Visiter</span>
              </>
            ) : (
              <>
                S&apos;inscrire <span className="hidden sm:inline">&rarr;</span>
              </>
            )}
          </Link>
          <button
            onClick={handleLogout}
            className="text-sm font-[family-name:var(--font-roboto)] font-medium text-text-inverse/60 hover:text-warning px-3 py-2.5 rounded-xl border border-text-inverse/20 hover:border-warning/50 transition-colors whitespace-nowrap"
            aria-label="Se déconnecter du mode invité"
          >
            <span className="hidden sm:inline">Se déconnecter</span>
            <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
