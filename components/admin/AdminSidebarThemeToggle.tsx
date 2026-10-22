"use client";

import { useState, useTransition } from "react";
import { setAdminTheme } from "@/app/actions/admin/admin-theme";
import { applyAdminThemeWithTransition } from "@/lib/admin-theme-transition";
import type { AdminTheme } from "@/lib/admin-theme";

interface Props {
  initialTheme: AdminTheme;
}

export default function AdminSidebarThemeToggle({ initialTheme }: Props) {
  const [theme, setTheme] = useState<AdminTheme>(initialTheme);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: AdminTheme) {
    if (next === theme || isPending) return;
    const previous = theme;
    setTheme(next);
    applyAdminThemeWithTransition(next);
    startTransition(async () => {
      const res = await setAdminTheme(next);
      if (!res.success) {
        setTheme(previous);
        applyAdminThemeWithTransition(previous);
      }
    });
  }

  const isLight = theme === "light";
  const isDark = theme === "dark";

  return (
    <div
      role="group"
      aria-label="Mode clair / sombre"
      data-no-theme-transition
      className="bg-white border border-zinc-200/80 rounded-2xl shadow-sm py-2 px-2 flex flex-col gap-1 shrink-0"
    >
      <button
        type="button"
        onClick={() => handleChange("light")}
        disabled={isPending}
        title="Mode clair"
        aria-pressed={isLight}
        className={`relative flex items-center justify-center p-2 rounded-xl transition-all duration-300 ease-out ${
          isLight
            ? "bg-amber-50 text-amber-600 scale-100"
            : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 scale-90"
        }`}
      >
        {isLight && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-amber-500" />
        )}
        <svg
          className={`w-5 h-5 transition-transform duration-500 ease-out ${isLight ? "rotate-0" : "-rotate-45 opacity-80"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6}
            d="M12 3v1.5m0 15V21m8.485-8.485H19.5m-15 0H3.015M18.364 5.636l-1.06 1.06m-10.607 10.607l-1.061 1.061m12.728 0l-1.06-1.061M6.697 6.697L5.636 5.636M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => handleChange("dark")}
        disabled={isPending}
        title="Mode sombre"
        aria-pressed={isDark}
        className={`relative flex items-center justify-center p-2 rounded-xl transition-all duration-300 ease-out ${
          isDark
            ? "scale-100"
            : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 scale-90"
        }`}
        style={isDark ? { background: "#18181B", color: "#FCD34D" } : undefined}
      >
        {isDark && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-amber-300" />
        )}
        <svg
          className={`w-5 h-5 transition-transform duration-500 ease-out ${isDark ? "rotate-0" : "rotate-45 opacity-80"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6}
            d="M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      </button>
    </div>
  );
}
