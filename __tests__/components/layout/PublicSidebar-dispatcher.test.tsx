import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tenant-preview", () => ({
  getEffectiveTenantSlug: vi.fn(),
}));

vi.mock("@/components/layout/PublicSidebarBeliandjolie", () => ({
  default: function PublicSidebarBeliandjolieMock() { return null; },
}));

vi.mock("@/components/layout/PublicSidebarIssyma", () => ({
  default: function PublicSidebarIssymaMock() { return null; },
}));

import PublicSidebar from "@/components/layout/PublicSidebar";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import PublicSidebarBeliandjolie from "@/components/layout/PublicSidebarBeliandjolie";
import PublicSidebarIssyma from "@/components/layout/PublicSidebarIssyma";

describe("PublicSidebar (aiguilleur tenant)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rend la version Issyma quand getEffectiveTenantSlug renvoie 'issyma'", async () => {
    vi.mocked(getEffectiveTenantSlug).mockResolvedValueOnce("issyma");
    const element = await PublicSidebar({ shopName: "FORCYMA" });
    expect(element.type).toBe(PublicSidebarIssyma);
  });

  it("rend la version Beliandjolie quand getEffectiveTenantSlug renvoie 'beliandjolie'", async () => {
    vi.mocked(getEffectiveTenantSlug).mockResolvedValueOnce("beliandjolie");
    const element = await PublicSidebar({ shopName: "Beli & Jolie" });
    expect(element.type).toBe(PublicSidebarBeliandjolie);
  });

  it("ignore la prop tenantSlug (deprecated) et se fie au helper", async () => {
    vi.mocked(getEffectiveTenantSlug).mockResolvedValueOnce("issyma");
    const element = await PublicSidebar({ shopName: "??", tenantSlug: "beliandjolie" });
    // Le prop dit BJ mais le helper (cookie dev par ex.) dit Issyma → Issyma gagne.
    expect(element.type).toBe(PublicSidebarIssyma);
  });
});
