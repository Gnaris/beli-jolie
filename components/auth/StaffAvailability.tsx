"use client";

import { useState, useEffect } from "react";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import { isWithinBusinessHours, getNextOpenSlot, DEFAULT_BUSINESS_HOURS } from "@/lib/business-hours";

/**
 * Affiche un message dynamique selon les horaires définis dans l'admin.
 * variant="dark" pour le panneau sombre du layout auth.
 */
export default function StaffAvailability({
  variant = "light",
  schedule,
}: {
  variant?: "light" | "dark";
  schedule?: BusinessHoursSchedule;
}) {
  const effectiveSchedule = schedule ?? DEFAULT_BUSINESS_HOURS;
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [nextSlot, setNextSlot] = useState<{ day: string; time: string } | null>(null);

  useEffect(() => {
    function check() {
      setIsOnline(isWithinBusinessHours(effectiveSchedule));
      setNextSlot(getNextOpenSlot(effectiveSchedule));
    }
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [effectiveSchedule]);

  if (isOnline === null) return null;

  const dark = variant === "dark";

  if (isOnline) {
    return (
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
        dark ? "bg-white/5 border-white/10" : "bg-[#22C55E]/5 border-[#22C55E]/15"
      }`}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          dark ? "bg-[#22C55E]/20" : "bg-[#22C55E]/10"
        }`}>
          <div className="w-2.5 h-2.5 bg-[#22C55E] rounded-full animate-pulse" />
        </div>
        <p className={`text-xs font-body leading-relaxed ${
          dark ? "text-white/50" : "text-text-secondary"
        }`}>
          <span className={`font-semibold ${dark ? "text-[#4ADE80]" : "text-[#22C55E]"}`}>Staff en ligne</span> — Notre équipe est disponible et valide les inscriptions en quelques secondes.
        </p>
      </div>
    );
  }

  const nextOpeningText = nextSlot
    ? `Votre inscription sera vérifiée dès ${nextSlot.day} ${nextSlot.time}.`
    : "Votre inscription sera vérifiée à la prochaine ouverture.";

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
      dark ? "bg-white/5 border-white/10" : "bg-[#F59E0B]/5 border-[#F59E0B]/15"
    }`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
        dark ? "bg-[#F59E0B]/20" : "bg-[#F59E0B]/10"
      }`}>
        <svg className="w-4 h-4 text-[#F59E0B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      </div>
      <p className={`text-xs font-body leading-relaxed ${
        dark ? "text-white/50" : "text-text-secondary"
      }`}>
        <span className={`font-semibold ${dark ? "text-[#FBBF24]" : "text-[#F59E0B]"}`}>Hors horaires</span> — Notre équipe n&apos;est plus en service actuellement. {nextOpeningText}
      </p>
    </div>
  );
}
