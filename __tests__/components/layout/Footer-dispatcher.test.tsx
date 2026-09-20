import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tenant-preview", () => ({
  getEffectiveTenantSlug: vi.fn(),
}));

vi.mock("@/components/layout/FooterBeliandjolie", () => ({
  default: function FooterBeliandjolieMock() { return null; },
}));

vi.mock("@/components/layout/FooterIssyma", () => ({
  default: function FooterIssymaMock() { return null; },
}));

import Footer from "@/components/layout/Footer";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import FooterBeliandjolie from "@/components/layout/FooterBeliandjolie";
import FooterIssyma from "@/components/layout/FooterIssyma";

describe("Footer (aiguilleur tenant)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rend la version Issyma quand getEffectiveTenantSlug renvoie 'issyma'", async () => {
    vi.mocked(getEffectiveTenantSlug).mockResolvedValueOnce("issyma");
    const element = await Footer({ shopName: "FORCYMA" });
    expect(element.type).toBe(FooterIssyma);
  });

  it("rend la version Beliandjolie quand getEffectiveTenantSlug renvoie 'beliandjolie'", async () => {
    vi.mocked(getEffectiveTenantSlug).mockResolvedValueOnce("beliandjolie");
    const element = await Footer({ shopName: "Beli & Jolie" });
    expect(element.type).toBe(FooterBeliandjolie);
  });

  it("ignore la prop tenantSlug (deprecated) et se fie au helper", async () => {
    vi.mocked(getEffectiveTenantSlug).mockResolvedValueOnce("issyma");
    const element = await Footer({ shopName: "??", tenantSlug: "beliandjolie" });
    expect(element.type).toBe(FooterIssyma);
  });
});
