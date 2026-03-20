"use client";

import { useState, useTransition, useCallback } from "react";
import { setAdminTheme } from "@/app/actions/admin/theme";
import { useToast } from "@/components/ui/Toast";

interface Props {
  currentTheme: "light" | "dark";
}

export default function DarkModeToggle({ currentTheme }: Props) {
  const [isDark, setIsDark] = useState(currentTheme === "dark");
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleToggle = useCallback(() => {
    const newTheme = isDark ? "light" : "dark";

    // Immediate visual feedback: toggle the class on the wrapper
    const wrapper = document.getElementById("admin-theme-wrapper");
    if (wrapper) {
      wrapper.classList.add("admin-dark-transition");
      if (newTheme === "dark") {
        wrapper.classList.add("admin-dark");
      } else {
        wrapper.classList.remove("admin-dark");
      }
      // Remove transition class after animation
      setTimeout(() => wrapper.classList.remove("admin-dark-transition"), 300);
    }

    setIsDark(!isDark);

    startTransition(async () => {
      const result = await setAdminTheme(newTheme);
      if (!result.success) {
        // Revert on error
        setIsDark(isDark);
        if (wrapper) {
          if (isDark) wrapper.classList.add("admin-dark");
          else wrapper.classList.remove("admin-dark");
        }
        toast.error("Erreur", result.error ?? "Impossible de changer le thème.");
      }
    });
  }, [isDark, toast]);

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* Sun / Moon icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
          isDark ? "bg-[#1E293B]" : "bg-[#FEF3C7]"
        }`}>
          {isDark ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[#93C5FD]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[#F59E0B]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
            </svg>
          )}
        </div>
        <div>
          <p className="font-[family-name:var(--font-roboto)] text-sm font-medium">
            {isDark ? "Mode nuit activé" : "Mode jour activé"}
          </p>
          <p className="font-[family-name:var(--font-roboto)] text-xs text-[#6B6B6B] mt-0.5">
            {isDark
              ? "L'interface admin utilise un thème sombre."
              : "L'interface admin utilise le thème clair par défaut."}
          </p>
        </div>
      </div>

      {/* Toggle button */}
      <button
        type="button"
        disabled={isPending}
        onClick={handleToggle}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1A1A1A] disabled:opacity-50 ${
          isDark ? "bg-[#3B82F6]" : "bg-[#D1D1D1]"
        }`}
        aria-checked={isDark}
        aria-label="Basculer le mode nuit"
        role="switch"
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
            isDark ? "translate-x-6" : "translate-x-1"
          }`}
        >
          {/* Tiny icon inside the knob */}
          {isDark ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-[#3B82F6] m-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-[#F59E0B] m-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
}
