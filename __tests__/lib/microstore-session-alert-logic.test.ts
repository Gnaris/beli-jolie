import { describe, it, expect } from "vitest";
import {
  getMicrostoreAlertLevel,
  formatMicrostoreRemaining,
  microstoreDismissKey,
  MICROSTORE_ALERT_THRESHOLDS_MS,
} from "@/lib/microstore-session-alert-logic";

const NOW = Date.parse("2026-08-13T12:00:00Z");

describe("getMicrostoreAlertLevel", () => {
  it("retourne 'ok' quand aucune session n'a jamais été connectée", () => {
    expect(getMicrostoreAlertLevel("boss", null, NOW)).toBe("ok");
    expect(getMicrostoreAlertLevel("pictureStation", null, NOW)).toBe("ok");
  });

  it("retourne 'ok' quand l'ISO est invalide (garde-fou)", () => {
    expect(getMicrostoreAlertLevel("boss", "pas une date", NOW)).toBe("ok");
  });

  describe("BOSS — seuil 1 h", () => {
    it("'ok' à 1 h 10 min de l'expiration", () => {
      const iso = new Date(NOW + 70 * 60 * 1000).toISOString();
      expect(getMicrostoreAlertLevel("boss", iso, NOW)).toBe("ok");
    });

    it("'soon' pile au seuil (1 h)", () => {
      const iso = new Date(NOW + MICROSTORE_ALERT_THRESHOLDS_MS.boss).toISOString();
      expect(getMicrostoreAlertLevel("boss", iso, NOW)).toBe("soon");
    });

    it("'soon' à 5 min de l'expiration", () => {
      const iso = new Date(NOW + 5 * 60 * 1000).toISOString();
      expect(getMicrostoreAlertLevel("boss", iso, NOW)).toBe("soon");
    });

    it("'expired' pile à l'expiration", () => {
      const iso = new Date(NOW).toISOString();
      expect(getMicrostoreAlertLevel("boss", iso, NOW)).toBe("expired");
    });

    it("'expired' 10 min après", () => {
      const iso = new Date(NOW - 10 * 60 * 1000).toISOString();
      expect(getMicrostoreAlertLevel("boss", iso, NOW)).toBe("expired");
    });
  });

  describe("Station de transfert — seuil 30 min", () => {
    it("'ok' à 45 min de l'expiration (30 min n'est pas encore atteint)", () => {
      const iso = new Date(NOW + 45 * 60 * 1000).toISOString();
      expect(getMicrostoreAlertLevel("pictureStation", iso, NOW)).toBe("ok");
    });

    it("'soon' à 30 min pile", () => {
      const iso = new Date(NOW + MICROSTORE_ALERT_THRESHOLDS_MS.pictureStation).toISOString();
      expect(getMicrostoreAlertLevel("pictureStation", iso, NOW)).toBe("soon");
    });

    it("'soon' à 10 min", () => {
      const iso = new Date(NOW + 10 * 60 * 1000).toISOString();
      expect(getMicrostoreAlertLevel("pictureStation", iso, NOW)).toBe("soon");
    });

    it("'expired' 1 min après", () => {
      const iso = new Date(NOW - 60 * 1000).toISOString();
      expect(getMicrostoreAlertLevel("pictureStation", iso, NOW)).toBe("expired");
    });
  });

  it("les deux seuils sont bien distincts (BOSS 1h > Station 30min)", () => {
    // À 45 min : BOSS déjà en alerte, Station encore OK.
    const iso = new Date(NOW + 45 * 60 * 1000).toISOString();
    expect(getMicrostoreAlertLevel("boss", iso, NOW)).toBe("soon");
    expect(getMicrostoreAlertLevel("pictureStation", iso, NOW)).toBe("ok");
  });
});

describe("formatMicrostoreRemaining", () => {
  it("formate en minutes sous 1 h", () => {
    expect(formatMicrostoreRemaining(1 * 60_000)).toBe("1 min");
    expect(formatMicrostoreRemaining(45 * 60_000)).toBe("45 min");
    expect(formatMicrostoreRemaining(59 * 60_000)).toBe("59 min");
  });

  it("affiche 'X h' quand pile un multiple d'heures", () => {
    expect(formatMicrostoreRemaining(60 * 60_000)).toBe("1 h");
    expect(formatMicrostoreRemaining(2 * 60 * 60_000)).toBe("2 h");
  });

  it("affiche 'X h Y min' sinon", () => {
    expect(formatMicrostoreRemaining(90 * 60_000)).toBe("1 h 30 min");
    expect(formatMicrostoreRemaining(125 * 60_000)).toBe("2 h 5 min");
  });

  it("retourne '0 min' pour valeurs <= 0 (ne doit pas cracher)", () => {
    expect(formatMicrostoreRemaining(0)).toBe("0 min");
    expect(formatMicrostoreRemaining(-1234)).toBe("0 min");
  });

  it("arrondit vers le bas (on ne parle pas en secondes)", () => {
    expect(formatMicrostoreRemaining(59 * 1000)).toBe("0 min");
    expect(formatMicrostoreRemaining(61 * 1000)).toBe("1 min");
  });
});

describe("microstoreDismissKey", () => {
  it("intègre le type + la date d'expiration exacte", () => {
    const iso = "2026-08-13T13:00:00.000Z";
    expect(microstoreDismissKey("boss", iso)).toBe(
      `microstore-alert-dismissed:boss:${iso}`,
    );
    expect(microstoreDismissKey("pictureStation", iso)).toBe(
      `microstore-alert-dismissed:pictureStation:${iso}`,
    );
  });

  it("change dès que expiresAt change → la barre réapparaît sur la prochaine session", () => {
    const iso1 = "2026-08-13T13:00:00.000Z";
    const iso2 = "2026-08-14T13:00:00.000Z";
    expect(microstoreDismissKey("boss", iso1)).not.toBe(
      microstoreDismissKey("boss", iso2),
    );
  });
});
