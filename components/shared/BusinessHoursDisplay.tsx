"use client";

import { useState, useEffect } from "react";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import { isWithinBusinessHours, getNextOpenSlot, formatScheduleForDisplay } from "@/lib/business-hours";

interface Props {
  schedule: BusinessHoursSchedule;
  compact?: boolean;
}

export default function BusinessHoursDisplay({ schedule, compact }: Props) {
  const [isOpen, setIsOpen] = useState(() => isWithinBusinessHours(schedule));
  const [nextSlot, setNextSlot] = useState(() => getNextOpenSlot(schedule));

  // Re-check every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setIsOpen(isWithinBusinessHours(schedule));
      setNextSlot(getNextOpenSlot(schedule));
    }, 60_000);
    return () => clearInterval(interval);
  }, [schedule]);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isOpen ? "bg-green-500" : "bg-red-400"}`} />
        <span className="text-xs font-body text-text-secondary">
          {isOpen ? "En ligne" : "Hors ligne"}
        </span>
        {!isOpen && nextSlot && (
          <span className="text-xs font-body text-text-muted">
            · {nextSlot.day} {nextSlot.time}
          </span>
        )}
      </div>
    );
  }

  const rows = formatScheduleForDisplay(schedule);

  return (
    <div className="space-y-3">
      {/* Status */}
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${isOpen ? "bg-green-500" : "bg-red-400"}`} />
        <span className={`text-sm font-medium font-body ${isOpen ? "text-green-700" : "text-red-600"}`}>
          {isOpen ? "Ouvert" : "Fermé"}
        </span>
        {!isOpen && nextSlot && (
          <span className="text-sm font-body text-text-muted">
            — Prochaine ouverture : {nextSlot.day} à {nextSlot.time}
          </span>
        )}
      </div>

      {/* Schedule table */}
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.day} className="flex items-center justify-between text-sm font-body">
            <span className="text-text-secondary w-24">{row.day}</span>
            <span className={row.hours === "Fermé" ? "text-text-muted italic" : "text-text-primary"}>
              {row.hours}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
