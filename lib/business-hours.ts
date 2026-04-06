/**
 * Business hours utilities.
 * Schedule stored in SiteConfig as JSON with key "business_hours".
 */

export interface DaySchedule {
  open: string;   // "09:00"
  close: string;  // "18:00"
  closed?: boolean;
}

export interface BusinessHoursSchedule {
  timezone: string;
  days: Record<string, DaySchedule>; // keys "0"-"6" (0=Sunday, matches JS getDay())
}

const DAY_NAMES_FR = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

/** Monday-Friday 9-18, Saturday-Sunday closed, Europe/Paris */
export const DEFAULT_BUSINESS_HOURS: BusinessHoursSchedule = {
  timezone: "Europe/Paris",
  days: {
    "0": { open: "09:00", close: "18:00", closed: true },
    "1": { open: "09:00", close: "18:00" },
    "2": { open: "09:00", close: "18:00" },
    "3": { open: "09:00", close: "18:00" },
    "4": { open: "09:00", close: "18:00" },
    "5": { open: "09:00", close: "18:00" },
    "6": { open: "09:00", close: "18:00", closed: true },
  },
};

/** Get current hours and minutes in the given timezone */
function getNowInTimezone(timezone: string): { dayOfWeek: number; hours: number; minutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  let hours = 0;
  let minutes = 0;
  let weekday = "";

  for (const part of parts) {
    if (part.type === "hour") hours = parseInt(part.value, 10);
    if (part.type === "minute") minutes = parseInt(part.value, 10);
    if (part.type === "weekday") weekday = part.value;
  }

  // Intl hour12:false can return 24 for midnight
  if (hours === 24) hours = 0;

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekday] ?? 0;

  return { dayOfWeek, hours, minutes };
}

/** Parse "HH:MM" to total minutes */
function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Check if currently within business hours */
export function isWithinBusinessHours(schedule: BusinessHoursSchedule): boolean {
  const { dayOfWeek, hours, minutes } = getNowInTimezone(schedule.timezone);
  const day = schedule.days[String(dayOfWeek)];
  if (!day || day.closed) return false;

  const nowMinutes = hours * 60 + minutes;
  return nowMinutes >= parseTime(day.open) && nowMinutes < parseTime(day.close);
}

/** Get next opening slot (day name + time) */
export function getNextOpenSlot(schedule: BusinessHoursSchedule): { day: string; time: string } | null {
  const { dayOfWeek, hours, minutes } = getNowInTimezone(schedule.timezone);
  const nowMinutes = hours * 60 + minutes;

  // Check remaining of today first
  const today = schedule.days[String(dayOfWeek)];
  if (today && !today.closed && nowMinutes < parseTime(today.open)) {
    return { day: DAY_NAMES_FR[dayOfWeek], time: today.open };
  }

  // Check next 7 days
  for (let i = 1; i <= 7; i++) {
    const d = (dayOfWeek + i) % 7;
    const slot = schedule.days[String(d)];
    if (slot && !slot.closed) {
      return { day: DAY_NAMES_FR[d], time: slot.open };
    }
  }

  return null;
}

/** Format schedule for display: array of { day, hours } */
export function formatScheduleForDisplay(schedule: BusinessHoursSchedule): { day: string; hours: string }[] {
  // Display Mon-Sun order (1,2,3,4,5,6,0)
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((d) => {
    const slot = schedule.days[String(d)];
    return {
      day: DAY_NAMES_FR[d],
      hours: !slot || slot.closed ? "Fermé" : `${slot.open} - ${slot.close}`,
    };
  });
}
