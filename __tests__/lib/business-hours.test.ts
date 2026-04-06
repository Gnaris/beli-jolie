import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isWithinBusinessHours,
  getNextOpenSlot,
  formatScheduleForDisplay,
  DEFAULT_BUSINESS_HOURS,
} from "@/lib/business-hours";
import type { BusinessHoursSchedule } from "@/lib/business-hours";

const SCHEDULE: BusinessHoursSchedule = {
  timezone: "UTC",
  days: {
    "0": { open: "09:00", close: "18:00", closed: true }, // Sunday
    "1": { open: "09:00", close: "18:00" },               // Monday
    "2": { open: "09:00", close: "18:00" },               // Tuesday
    "3": { open: "09:00", close: "18:00" },               // Wednesday
    "4": { open: "09:00", close: "18:00" },               // Thursday
    "5": { open: "09:00", close: "18:00" },               // Friday
    "6": { open: "09:00", close: "18:00", closed: true }, // Saturday
  },
};

describe("business-hours", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isWithinBusinessHours", () => {
    it("returns true during business hours on a weekday", () => {
      // Wednesday 2026-04-08 at 10:30 UTC
      vi.setSystemTime(new Date("2026-04-08T10:30:00Z"));
      expect(isWithinBusinessHours(SCHEDULE)).toBe(true);
    });

    it("returns false before opening time on a weekday", () => {
      // Wednesday 2026-04-08 at 07:00 UTC
      vi.setSystemTime(new Date("2026-04-08T07:00:00Z"));
      expect(isWithinBusinessHours(SCHEDULE)).toBe(false);
    });

    it("returns false after closing time on a weekday", () => {
      // Wednesday 2026-04-08 at 19:00 UTC
      vi.setSystemTime(new Date("2026-04-08T19:00:00Z"));
      expect(isWithinBusinessHours(SCHEDULE)).toBe(false);
    });

    it("returns false on a closed day (Sunday)", () => {
      // Sunday 2026-04-05 at 12:00 UTC
      vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
      expect(isWithinBusinessHours(SCHEDULE)).toBe(false);
    });

    it("returns false on a closed day (Saturday)", () => {
      // Saturday 2026-04-04 at 12:00 UTC
      vi.setSystemTime(new Date("2026-04-04T12:00:00Z"));
      expect(isWithinBusinessHours(SCHEDULE)).toBe(false);
    });

    it("returns true at exactly opening time", () => {
      // Monday 2026-04-06 at 09:00 UTC
      vi.setSystemTime(new Date("2026-04-06T09:00:00Z"));
      expect(isWithinBusinessHours(SCHEDULE)).toBe(true);
    });

    it("returns false at exactly closing time (exclusive)", () => {
      // Monday 2026-04-06 at 18:00 UTC
      vi.setSystemTime(new Date("2026-04-06T18:00:00Z"));
      expect(isWithinBusinessHours(SCHEDULE)).toBe(false);
    });
  });

  describe("getNextOpenSlot", () => {
    it("returns today if before opening time", () => {
      // Monday 2026-04-06 at 07:00 UTC
      vi.setSystemTime(new Date("2026-04-06T07:00:00Z"));
      const result = getNextOpenSlot(SCHEDULE);
      expect(result).toEqual({ day: "Lundi", time: "09:00" });
    });

    it("returns next weekday when on a closed day", () => {
      // Saturday 2026-04-04 at 12:00 UTC -> next open = Sunday? No, Sunday closed too -> Monday
      vi.setSystemTime(new Date("2026-04-04T12:00:00Z"));
      const result = getNextOpenSlot(SCHEDULE);
      expect(result).toEqual({ day: "Lundi", time: "09:00" });
    });

    it("returns next day when after closing time", () => {
      // Monday 2026-04-06 at 20:00 UTC -> next = Tuesday
      vi.setSystemTime(new Date("2026-04-06T20:00:00Z"));
      const result = getNextOpenSlot(SCHEDULE);
      expect(result).toEqual({ day: "Mardi", time: "09:00" });
    });

    it("returns null when all days are closed", () => {
      const allClosed: BusinessHoursSchedule = {
        timezone: "UTC",
        days: {
          "0": { open: "09:00", close: "18:00", closed: true },
          "1": { open: "09:00", close: "18:00", closed: true },
          "2": { open: "09:00", close: "18:00", closed: true },
          "3": { open: "09:00", close: "18:00", closed: true },
          "4": { open: "09:00", close: "18:00", closed: true },
          "5": { open: "09:00", close: "18:00", closed: true },
          "6": { open: "09:00", close: "18:00", closed: true },
        },
      };
      vi.setSystemTime(new Date("2026-04-06T12:00:00Z"));
      expect(getNextOpenSlot(allClosed)).toBeNull();
    });
  });

  describe("formatScheduleForDisplay", () => {
    it("returns 7 days in Mon-Sun order", () => {
      const rows = formatScheduleForDisplay(SCHEDULE);
      expect(rows).toHaveLength(7);
      expect(rows[0].day).toBe("Lundi");
      expect(rows[6].day).toBe("Dimanche");
    });

    it("shows 'Fermé' for closed days", () => {
      const rows = formatScheduleForDisplay(SCHEDULE);
      expect(rows[5].hours).toBe("Fermé"); // Saturday (index 5 = key "6")
      expect(rows[6].hours).toBe("Fermé"); // Sunday (index 6 = key "0")
    });

    it("shows time range for open days", () => {
      const rows = formatScheduleForDisplay(SCHEDULE);
      expect(rows[0].hours).toBe("09:00 - 18:00"); // Monday
    });
  });

  describe("DEFAULT_BUSINESS_HOURS", () => {
    it("has Europe/Paris timezone", () => {
      expect(DEFAULT_BUSINESS_HOURS.timezone).toBe("Europe/Paris");
    });

    it("has 7 days", () => {
      expect(Object.keys(DEFAULT_BUSINESS_HOURS.days)).toHaveLength(7);
    });

    it("has Saturday and Sunday closed", () => {
      expect(DEFAULT_BUSINESS_HOURS.days["0"].closed).toBe(true);
      expect(DEFAULT_BUSINESS_HOURS.days["6"].closed).toBe(true);
    });

    it("has weekdays open 9-18", () => {
      for (const d of ["1", "2", "3", "4", "5"]) {
        expect(DEFAULT_BUSINESS_HOURS.days[d].open).toBe("09:00");
        expect(DEFAULT_BUSINESS_HOURS.days[d].close).toBe("18:00");
        expect(DEFAULT_BUSINESS_HOURS.days[d].closed).toBeUndefined();
      }
    });
  });
});
