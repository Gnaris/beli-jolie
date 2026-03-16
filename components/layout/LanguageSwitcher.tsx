"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { setLocale } from "@/app/actions/client/locale";

const LANGUAGES = [
  { code: "fr", label: "Français",  flag: "🇫🇷" },
  { code: "en", label: "English",   flag: "🇬🇧" },
  { code: "ar", label: "العربية",   flag: "🇸🇦" },
  { code: "zh", label: "中文",       flag: "🇨🇳" },
  { code: "de", label: "Deutsch",   flag: "🇩🇪" },
  { code: "es", label: "Español",   flag: "🇪🇸" },
  { code: "it", label: "Italiano",  flag: "🇮🇹" },
] as const;

type Locale = (typeof LANGUAGES)[number]["code"];

interface Props {
  currentLocale: string;
}

export default function LanguageSwitcher({ currentLocale }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === currentLocale) ?? LANGUAGES[0];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(code: Locale) {
    setOpen(false);
    startTransition(async () => {
      await setLocale(code);
      window.location.reload();
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E5E5E5] bg-white hover:bg-[#F7F7F8] text-sm font-medium text-[#1A1A1A] transition-colors disabled:opacity-50"
        aria-label="Change language"
      >
        {isPending ? (
          <span className="w-4 h-4 border-2 border-[#E5E5E5] border-t-[#1A1A1A] rounded-full animate-spin" />
        ) : (
          <span className="text-base leading-none">{current.flag}</span>
        )}
        <span className="hidden sm:inline text-xs font-semibold text-[#555]">{current.code.toUpperCase()}</span>
        <svg
          className={`w-3 h-3 text-[#999] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-50 bg-white border border-[#E5E5E5] rounded-xl shadow-lg overflow-hidden min-w-[150px] animate-fadeIn">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleSelect(lang.code)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-[#F7F7F8] transition-colors text-left ${
                lang.code === currentLocale
                  ? "bg-[#F7F7F8] font-semibold text-[#1A1A1A]"
                  : "text-[#444]"
              }`}
            >
              <span className="text-base">{lang.flag}</span>
              <span>{lang.label}</span>
              {lang.code === currentLocale && (
                <svg className="w-3.5 h-3.5 text-[#22C55E] ml-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
