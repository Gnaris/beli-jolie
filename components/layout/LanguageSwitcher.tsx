"use client";

import { useState, useTransition, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { setLocale } from "@/app/actions/client/locale";

type Locale = "fr" | "en" | "ar" | "zh" | "de" | "es" | "it";

function Flag({ code, className = "" }: { code: Locale; className?: string }) {
  const common = { viewBox: "0 0 24 16", className: `rounded-sm shrink-0 ${className}` };
  switch (code) {
    case "fr":
      return (
        <svg {...common}>
          <rect width="8" height="16" fill="#0055A4" />
          <rect x="8" width="8" height="16" fill="#FFFFFF" />
          <rect x="16" width="8" height="16" fill="#EF4135" />
        </svg>
      );
    case "en":
      return (
        <svg {...common}>
          <rect width="24" height="16" fill="#012169" />
          <path d="M0 0l24 16M24 0L0 16" stroke="#FFFFFF" strokeWidth="2.4" />
          <path d="M0 0l24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.2" />
          <path d="M12 0v16M0 8h24" stroke="#FFFFFF" strokeWidth="4" />
          <path d="M12 0v16M0 8h24" stroke="#C8102E" strokeWidth="2" />
        </svg>
      );
    case "ar":
      return (
        <svg {...common}>
          <rect width="24" height="16" fill="#006C35" />
          <text x="12" y="11" textAnchor="middle" fontSize="6" fill="#FFFFFF" fontFamily="serif">☪</text>
        </svg>
      );
    case "zh":
      return (
        <svg {...common}>
          <rect width="24" height="16" fill="#EE1C25" />
          <polygon points="5,3 5.7,4.8 7.6,4.8 6.1,5.9 6.6,7.7 5,6.6 3.4,7.7 3.9,5.9 2.4,4.8 4.3,4.8" fill="#FFDE00" />
          <circle cx="9" cy="2.5" r="0.5" fill="#FFDE00" />
          <circle cx="10.5" cy="4" r="0.5" fill="#FFDE00" />
          <circle cx="10.5" cy="6" r="0.5" fill="#FFDE00" />
          <circle cx="9" cy="7.5" r="0.5" fill="#FFDE00" />
        </svg>
      );
    case "de":
      return (
        <svg {...common}>
          <rect width="24" height="5.33" fill="#000000" />
          <rect y="5.33" width="24" height="5.33" fill="#DD0000" />
          <rect y="10.67" width="24" height="5.33" fill="#FFCE00" />
        </svg>
      );
    case "es":
      return (
        <svg {...common}>
          <rect width="24" height="16" fill="#AA151B" />
          <rect y="4" width="24" height="8" fill="#F1BF00" />
        </svg>
      );
    case "it":
      return (
        <svg {...common}>
          <rect width="8" height="16" fill="#009246" />
          <rect x="8" width="8" height="16" fill="#FFFFFF" />
          <rect x="16" width="8" height="16" fill="#CE2B37" />
        </svg>
      );
  }
}

const LANGUAGES: { code: Locale; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
];

const MENU_WIDTH = 180;
const MENU_GAP = 6;

interface Props {
  currentLocale: string;
}

export default function LanguageSwitcher({ currentLocale }: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === currentLocale) ?? LANGUAGES[0];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    function computePos() {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const menuHeight = LANGUAGES.length * 40 + 8;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < menuHeight + MENU_GAP && rect.top > menuHeight + MENU_GAP;
      const top = openUpward
        ? rect.top - menuHeight - MENU_GAP
        : rect.bottom + MENU_GAP;
      const rawLeft = rect.right - MENU_WIDTH;
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - MENU_WIDTH - 8));
      setMenuPos({ top, left });
    }
    computePos();
    window.addEventListener("resize", computePos);
    window.addEventListener("scroll", computePos, true);
    return () => {
      window.removeEventListener("resize", computePos);
      window.removeEventListener("scroll", computePos, true);
    };
  }, [open]);

  function handleSelect(code: Locale) {
    setOpen(false);
    startTransition(async () => {
      await setLocale(code);
      window.location.reload();
    });
  }

  const menu = open && menuPos && mounted ? createPortal(
    <div
      ref={menuRef}
      className="fixed z-[1000] bg-bg-primary border border-border rounded-xl shadow-lg overflow-hidden py-1 animate-fadeIn"
      style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
      role="listbox"
    >
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          onClick={() => handleSelect(lang.code)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg-secondary transition-colors text-left ${
            lang.code === currentLocale
              ? "bg-bg-secondary font-semibold text-text-primary"
              : "text-text-secondary"
          }`}
          role="option"
          aria-selected={lang.code === currentLocale}
        >
          <Flag code={lang.code} className="w-5 h-[14px] border border-black/10" />
          <span>{lang.label}</span>
          {lang.code === currentLocale && (
            <svg className="w-3.5 h-3.5 text-[#22C55E] ml-auto" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-bg-primary hover:bg-bg-secondary text-sm font-medium text-text-primary transition-colors disabled:opacity-50"
        aria-label="Change language"
        aria-expanded={open}
      >
        {isPending ? (
          <span className="w-4 h-4 border-2 border-border border-t-text-primary rounded-full animate-spin" />
        ) : (
          <Flag code={current.code} className="w-5 h-[14px] border border-black/10" />
        )}
        <span className="text-xs font-semibold text-text-secondary">{current.code.toUpperCase()}</span>
        <svg
          className={`w-3 h-3 text-[#999] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {menu}
    </div>
  );
}
