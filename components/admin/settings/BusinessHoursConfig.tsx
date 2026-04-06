"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { updateBusinessHours } from "@/app/actions/admin/site-config";
import type { BusinessHoursSchedule, DaySchedule } from "@/lib/business-hours";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/business-hours";

const DAY_LABELS = [
  { key: "1", label: "Lundi" },
  { key: "2", label: "Mardi" },
  { key: "3", label: "Mercredi" },
  { key: "4", label: "Jeudi" },
  { key: "5", label: "Vendredi" },
  { key: "6", label: "Samedi" },
  { key: "0", label: "Dimanche" },
];

const TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Brussels",
  "Europe/Zurich",
  "Africa/Casablanca",
  "Africa/Algiers",
  "Africa/Tunis",
];

interface Props {
  initialSchedule: BusinessHoursSchedule | null;
}

export default function BusinessHoursConfig({ initialSchedule }: Props) {
  const schedule = initialSchedule || DEFAULT_BUSINESS_HOURS;
  const [timezone, setTimezone] = useState(schedule.timezone);
  const [days, setDays] = useState<Record<string, DaySchedule>>({ ...schedule.days });
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function updateDay(key: string, field: keyof DaySchedule, value: string | boolean) {
    setDays((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  }

  function handleSave() {
    const payload: BusinessHoursSchedule = { timezone, days };
    startTransition(async () => {
      const result = await updateBusinessHours(payload);
      if (result.success) {
        toast.success("Horaires mis à jour");
      } else {
        toast.error(result.error || "Erreur");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Timezone */}
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">
          Fuseau horaire
        </h3>
        <p className="text-sm text-text-secondary font-body mb-4">
          Le fuseau horaire de référence pour les horaires d&apos;ouverture.
        </p>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border border-border rounded-lg text-sm font-body bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary/20"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz.replace("_", " ")}</option>
          ))}
        </select>
      </div>

      {/* Days */}
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">
          Jours et horaires
        </h3>
        <p className="text-sm text-text-secondary font-body mb-4">
          Configurez les heures d&apos;ouverture pour chaque jour de la semaine.
        </p>

        <div className="space-y-3">
          {DAY_LABELS.map(({ key, label }) => {
            const day = days[key] || { open: "09:00", close: "18:00", closed: true };
            const isOpen = !day.closed;

            return (
              <div
                key={key}
                className="flex items-center gap-4 py-3 px-4 rounded-xl border border-border bg-bg-secondary/30"
              >
                {/* Day name */}
                <span className="w-24 text-sm font-medium text-text-primary font-body">
                  {label}
                </span>

                {/* Toggle */}
                <button
                  type="button"
                  onClick={() => updateDay(key, "closed", isOpen)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    isOpen ? "bg-green-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                      isOpen ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>

                {/* Status */}
                <span className={`text-xs font-body w-14 ${isOpen ? "text-green-600" : "text-text-muted"}`}>
                  {isOpen ? "Ouvert" : "Fermé"}
                </span>

                {/* Time inputs */}
                {isOpen ? (
                  <div className="flex items-center gap-2 ml-auto">
                    <input
                      type="time"
                      value={day.open}
                      onChange={(e) => updateDay(key, "open", e.target.value)}
                      className="px-2 py-1.5 border border-border rounded-lg text-sm font-body bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary/20"
                    />
                    <span className="text-text-muted text-sm">—</span>
                    <input
                      type="time"
                      value={day.close}
                      onChange={(e) => updateDay(key, "close", e.target.value)}
                      className="px-2 py-1.5 border border-border rounded-lg text-sm font-body bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary/20"
                    />
                  </div>
                ) : (
                  <div className="ml-auto text-sm text-text-muted font-body italic">
                    Fermé toute la journée
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="px-6 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
        >
          {isPending ? "Enregistrement..." : "Enregistrer les horaires"}
        </button>
      </div>
    </div>
  );
}
