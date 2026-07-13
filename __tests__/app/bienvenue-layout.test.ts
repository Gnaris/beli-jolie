/**
 * Verifie que /admin/bienvenue est verrouille une fois l'onboarding termine :
 * un admin qui retape l'URL doit etre renvoye vers /admin, sinon il pourrait
 * resoumettre les etapes du wizard et casser sa config (Stripe, e-mail, ...).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  isOnboardingCompleted: vi.fn(),
  getOnboardingStatus: vi.fn(),
  getCompanyInfo: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((_: string) => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/onboarding", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onboarding")>("@/lib/onboarding");
  return {
    ...actual,
    isOnboardingCompleted: mocks.isOnboardingCompleted,
    getOnboardingStatus: mocks.getOnboardingStatus,
  };
});
vi.mock("@/app/actions/admin/company-info", () => ({
  getCompanyInfo: mocks.getCompanyInfo,
}));
vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));
vi.mock("@/components/admin/onboarding/WizardShell", () => ({
  default: () => null,
}));

import WizardLayout from "@/app/(admin)/admin/bienvenue/layout";

describe("WizardLayout (verrouillage post-onboarding)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOnboardingStatus.mockResolvedValue({ completedAt: null, stepsCompleted: [] });
    mocks.getCompanyInfo.mockResolvedValue({ shopName: "" });
    mocks.headers.mockResolvedValue(new Headers({ "x-current-path": "/admin/bienvenue" }));
  });

  it("redirige vers /admin si l'onboarding est deja termine", async () => {
    mocks.isOnboardingCompleted.mockResolvedValue(true);
    await expect(WizardLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin");
    // Optimisation : on court-circuite avant de charger le reste
    expect(mocks.getOnboardingStatus).not.toHaveBeenCalled();
    expect(mocks.getCompanyInfo).not.toHaveBeenCalled();
  });

  it("laisse passer et charge le wizard tant que l'onboarding n'est pas termine", async () => {
    mocks.isOnboardingCompleted.mockResolvedValue(false);
    const result = await WizardLayout({ children: React.createElement("div") });
    expect(result).toBeTruthy();
    expect(mocks.getOnboardingStatus).toHaveBeenCalled();
    // Aucune redirection vers /admin dans ce cas
    for (const call of mocks.redirect.mock.calls) {
      expect(call[0]).not.toBe("/admin");
    }
  });
});
