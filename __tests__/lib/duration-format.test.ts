import { describe, it, expect } from "vitest";
import { formatDuration } from "@/lib/duration-format";

describe("formatDuration", () => {
  it("borne les durées négatives à 0s", () => {
    expect(formatDuration(-5_000)).toBe("0s");
    expect(formatDuration(-1)).toBe("0s");
  });

  it("affiche les secondes seules sous la minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(1_000)).toBe("1s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(59_999)).toBe("59s");
  });

  it("affiche minutes + secondes jusqu'à 1h", () => {
    expect(formatDuration(60_000)).toBe("1min");
    expect(formatDuration(63_000)).toBe("1min 3s");
    expect(formatDuration(4 * 60_000 + 23_000)).toBe("4min 23s");
    expect(formatDuration(59 * 60_000 + 59_000)).toBe("59min 59s");
  });

  it("affiche heures + minutes jusqu'à 24h", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h");
    expect(formatDuration(60 * 60_000 + 15 * 60_000)).toBe("1h 15min");
    expect(formatDuration(2 * 60 * 60_000 + 30 * 60_000)).toBe("2h 30min");
    expect(formatDuration(23 * 60 * 60_000 + 59 * 60_000)).toBe("23h 59min");
  });

  it("affiche jours + heures au-delà de 24h", () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe("1j");
    expect(formatDuration(25 * 60 * 60_000)).toBe("1j 1h");
    expect(formatDuration(3 * 24 * 60 * 60_000 + 7 * 60 * 60_000)).toBe("3j 7h");
  });

  it("supprime la sous-unité quand elle est à 0", () => {
    expect(formatDuration(2 * 60_000)).toBe("2min");
    expect(formatDuration(5 * 60 * 60_000)).toBe("5h");
    expect(formatDuration(10 * 24 * 60 * 60_000)).toBe("10j");
  });
});
