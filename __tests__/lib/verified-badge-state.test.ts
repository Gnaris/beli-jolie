import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { getVerifiedBadgeState } from "@/lib/verified-badge-state";

function makeSession(role: "CLIENT" | "ADMIN", status: "PENDING" | "APPROVED" | "REJECTED"): Session {
  return {
    user: {
      id: "u1",
      email: "u@test.com",
      name: "Test",
      role,
      status,
      company: "ACME",
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session;
}

describe("getVerifiedBadgeState", () => {
  it("cache le badge pour un visiteur non connecté", () => {
    expect(getVerifiedBadgeState(null)).toEqual({ show: false });
    expect(getVerifiedBadgeState(undefined)).toEqual({ show: false });
  });

  it("cache le badge pour un admin (pas de statut de validation à montrer)", () => {
    expect(getVerifiedBadgeState(makeSession("ADMIN", "APPROVED"))).toEqual({ show: false });
  });

  it("affiche 'Vérifié' pour un client APPROVED", () => {
    expect(getVerifiedBadgeState(makeSession("CLIENT", "APPROVED"))).toEqual({
      show: true,
      variant: "verified",
    });
  });

  it("affiche 'Non vérifié' pour un client PENDING", () => {
    expect(getVerifiedBadgeState(makeSession("CLIENT", "PENDING"))).toEqual({
      show: true,
      variant: "pending",
    });
  });

  it("affiche 'Révoqué' pour un client REJECTED (compte désactivé)", () => {
    expect(getVerifiedBadgeState(makeSession("CLIENT", "REJECTED"))).toEqual({
      show: true,
      variant: "revoked",
    });
  });
});
