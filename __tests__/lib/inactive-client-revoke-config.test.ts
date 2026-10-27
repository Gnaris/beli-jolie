import { describe, it, expect } from "vitest";
import {
  parseWarningDays,
  parseGraceDays,
  parseProbationDays,
  isRevocationActive,
  computeInactivityReferenceAt,
  computeRevokePhase,
  hasOrderedDuringProbation,
  daysBetween,
  INACTIVE_REVOKE_MAX_WARNING_DAYS,
  INACTIVE_REVOKE_MAX_GRACE_DAYS,
  INACTIVE_REVOKE_MAX_PROBATION_DAYS,
} from "@/lib/inactive-client-revoke-config";

describe("parse*Days", () => {
  it("renvoie null pour valeur vide / null / undefined", () => {
    expect(parseWarningDays(null)).toBeNull();
    expect(parseGraceDays(undefined)).toBeNull();
    expect(parseProbationDays("")).toBeNull();
  });

  it("renvoie null pour une valeur non entière", () => {
    expect(parseWarningDays("30.5")).toBeNull();
    expect(parseGraceDays("abc")).toBeNull();
    expect(parseProbationDays("NaN")).toBeNull();
  });

  it("renvoie null hors bornes", () => {
    expect(parseWarningDays("0")).toBeNull();
    expect(parseWarningDays(String(INACTIVE_REVOKE_MAX_WARNING_DAYS + 1))).toBeNull();
    expect(parseGraceDays("0")).toBeNull();
    expect(parseGraceDays(String(INACTIVE_REVOKE_MAX_GRACE_DAYS + 1))).toBeNull();
    expect(parseProbationDays("0")).toBeNull();
    expect(parseProbationDays(String(INACTIVE_REVOKE_MAX_PROBATION_DAYS + 1))).toBeNull();
  });

  it("accepte les valeurs valides", () => {
    expect(parseWarningDays("365")).toBe(365);
    expect(parseGraceDays("15")).toBe(15);
    expect(parseProbationDays("30")).toBe(30);
  });
});

describe("isRevocationActive", () => {
  it("exige enabled + warningDays + graceDays (probation optionnelle)", () => {
    expect(
      isRevocationActive({
        enabled: true,
        warningDays: 365,
        graceDays: 15,
        probationDays: 30,
      }),
    ).toBe(true);
    expect(
      isRevocationActive({
        enabled: true,
        warningDays: 365,
        graceDays: 15,
        probationDays: null,
      }),
    ).toBe(true);
    expect(
      isRevocationActive({
        enabled: false,
        warningDays: 365,
        graceDays: 15,
        probationDays: 30,
      }),
    ).toBe(false);
    expect(
      isRevocationActive({
        enabled: true,
        warningDays: null,
        graceDays: 15,
        probationDays: 30,
      }),
    ).toBe(false);
  });
});

describe("computeInactivityReferenceAt", () => {
  it("retourne lastOrderAt si présent", () => {
    const createdAt = new Date("2024-01-01");
    const lastOrderAt = new Date("2026-06-15");
    expect(computeInactivityReferenceAt({ lastOrderAt, createdAt })).toEqual(
      lastOrderAt,
    );
  });

  it("retombe sur createdAt si pas de commande", () => {
    const createdAt = new Date("2024-01-01");
    expect(
      computeInactivityReferenceAt({ lastOrderAt: null, createdAt }),
    ).toEqual(createdAt);
  });
});

describe("computeRevokePhase — cycle normal", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const base = { now, warningDays: 365, graceDays: 15, probationDays: 30 };

  it("ACTIVE si inactivité < warningDays", () => {
    const referenceAt = new Date(now.getTime() - 100 * 86400_000);
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        inactivityWarningAt: null,
        probationUntil: null,
      }),
    ).toBe("ACTIVE");
  });

  it("WARNING_DUE à la limite exacte des warningDays", () => {
    const referenceAt = new Date(now.getTime() - 365 * 86400_000);
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        inactivityWarningAt: null,
        probationUntil: null,
      }),
    ).toBe("WARNING_DUE");
  });

  it("GRACE après avertissement, dans la fenêtre", () => {
    const referenceAt = new Date(now.getTime() - 400 * 86400_000);
    const inactivityWarningAt = new Date(now.getTime() - 5 * 86400_000);
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        inactivityWarningAt,
        probationUntil: null,
      }),
    ).toBe("GRACE");
  });

  it("REVOKE_DUE après avertissement + graceDays dépassés", () => {
    const referenceAt = new Date(now.getTime() - 400 * 86400_000);
    const inactivityWarningAt = new Date(now.getTime() - 20 * 86400_000);
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        inactivityWarningAt,
        probationUntil: null,
      }),
    ).toBe("REVOKE_DUE");
  });

  it("WIPE : nouvelle commande post-avertissement → ACTIVE si inactivité repartie à 0", () => {
    const referenceAt = new Date(now.getTime() - 2 * 86400_000);
    const inactivityWarningAt = new Date(now.getTime() - 10 * 86400_000);
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        inactivityWarningAt,
        probationUntil: null,
      }),
    ).toBe("ACTIVE");
  });

  it("WIPE : nouvelle commande post-avertissement → WARNING_DUE si à nouveau inactif", () => {
    const referenceAt = new Date(now.getTime() - 400 * 86400_000);
    const inactivityWarningAt = new Date(now.getTime() - 730 * 86400_000);
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        inactivityWarningAt,
        probationUntil: null,
      }),
    ).toBe("WARNING_DUE");
  });
});

describe("computeRevokePhase — branche probation", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const probationDays = 30;
  const base = {
    now,
    warningDays: 365,
    graceDays: 15,
    probationDays,
    inactivityWarningAt: null,
  };

  it("PROBATION_ACTIVE si probationUntil dans le futur et pas de commande récente", () => {
    const probationUntil = new Date(now.getTime() + 10 * 86400_000); // 10 j restants
    const referenceAt = new Date(now.getTime() - 500 * 86400_000); // commande ancienne
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        probationUntil,
      }),
    ).toBe("PROBATION_ACTIVE");
  });

  it("PROBATION_EXPIRED si probationUntil dépassée sans commande", () => {
    const probationUntil = new Date(now.getTime() - 1 * 86400_000); // expirée hier
    const referenceAt = new Date(now.getTime() - 500 * 86400_000);
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        probationUntil,
      }),
    ).toBe("PROBATION_EXPIRED");
  });

  it("ACTIVE si une commande a eu lieu pendant la probation", () => {
    // Probation posée il y a 10 j, se termine dans 20 j
    const probationUntil = new Date(now.getTime() + 20 * 86400_000);
    // Commande il y a 2 j (post-pose)
    const referenceAt = new Date(now.getTime() - 2 * 86400_000);
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        probationUntil,
      }),
    ).toBe("ACTIVE");
  });

  it("PROBATION_ACTIVE si lastOrderAt est antérieur à la pose de la probation", () => {
    // Probation posée il y a 5 j (dure 30 j, donc se termine dans 25 j)
    const probationUntil = new Date(now.getTime() + 25 * 86400_000);
    // Commande il y a 400 j (très ancienne, pré-désactivation)
    const referenceAt = new Date(now.getTime() - 400 * 86400_000);
    expect(
      computeRevokePhase({
        ...base,
        referenceAt,
        probationUntil,
      }),
    ).toBe("PROBATION_ACTIVE");
  });
});

describe("hasOrderedDuringProbation", () => {
  const now = new Date("2026-10-27T12:00:00Z");

  it("true si referenceAt postérieure à la date estimée de pose", () => {
    const probationUntil = new Date(now.getTime() + 20 * 86400_000);
    const referenceAt = new Date(now.getTime() - 2 * 86400_000);
    expect(
      hasOrderedDuringProbation({
        referenceAt,
        probationUntil,
        probationDays: 30,
      }),
    ).toBe(true);
  });

  it("false si referenceAt antérieure à la pose", () => {
    const probationUntil = new Date(now.getTime() + 25 * 86400_000);
    const referenceAt = new Date(now.getTime() - 400 * 86400_000);
    expect(
      hasOrderedDuringProbation({
        referenceAt,
        probationUntil,
        probationDays: 30,
      }),
    ).toBe(false);
  });
});

describe("daysBetween", () => {
  it("renvoie 0 si past dans le futur", () => {
    const now = new Date("2026-10-27");
    const future = new Date("2026-10-28");
    expect(daysBetween(now, future)).toBe(0);
  });

  it("floor le nombre de jours", () => {
    const now = new Date("2026-10-27T23:59:59Z");
    const past = new Date("2026-10-27T00:00:00Z");
    expect(daysBetween(now, past)).toBe(0);
  });

  it("compte exactement 1 jour à 24h", () => {
    const now = new Date("2026-10-28T00:00:00Z");
    const past = new Date("2026-10-27T00:00:00Z");
    expect(daysBetween(now, past)).toBe(1);
  });

  it("gère les grands écarts", () => {
    const now = new Date("2026-10-27T00:00:00Z");
    const past = new Date("2025-10-27T00:00:00Z");
    expect(daysBetween(now, past)).toBe(365);
  });
});

describe("canSeePrices avec DEACTIVATED", () => {
  it("DEACTIVATED ne voit pas les prix (couvert par la règle status === APPROVED)", async () => {
    const { canSeePricesFromUser } = await import("@/lib/price-visibility");
    expect(canSeePricesFromUser({ role: "CLIENT", status: "DEACTIVATED" })).toBe(
      false,
    );
    expect(canSeePricesFromUser({ role: "CLIENT", status: "APPROVED" })).toBe(
      true,
    );
    expect(canSeePricesFromUser({ role: "CLIENT", status: "PENDING" })).toBe(
      false,
    );
    expect(canSeePricesFromUser({ role: "CLIENT", status: "REJECTED" })).toBe(
      false,
    );
  });
});
