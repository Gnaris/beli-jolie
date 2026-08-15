import { describe, it, expect } from "vitest";
import { formatDurationLive } from "@/components/admin/widgets-rail/MarketplacesDrawer";

describe("formatDurationLive", () => {
  it("affiche les millisecondes en dessous d'une seconde", () => {
    expect(formatDurationLive(0)).toBe("0 ms");
    expect(formatDurationLive(250)).toBe("250 ms");
    expect(formatDurationLive(999)).toBe("999 ms");
  });

  it("affiche les secondes avec 1 décimale entre 1s et 1min", () => {
    expect(formatDurationLive(1000)).toBe("1.0 s");
    expect(formatDurationLive(1234)).toBe("1.2 s");
    expect(formatDurationLive(59_900)).toBe("59.9 s");
  });

  it("passe au format minutes + secondes zéro-paddées à 1 min", () => {
    expect(formatDurationLive(60_000)).toBe("1 min 00 s");
    expect(formatDurationLive(65_500)).toBe("1 min 05 s");
    expect(formatDurationLive(150_000)).toBe("2 min 30 s");
  });

  it("passe au format heures + minutes zéro-paddées à 1 h", () => {
    expect(formatDurationLive(3_600_000)).toBe("1 h 00 min");
    expect(formatDurationLive(3_900_000)).toBe("1 h 05 min");
    expect(formatDurationLive(7_800_000)).toBe("2 h 10 min");
  });
});
