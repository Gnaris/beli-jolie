/**
 * Tests unitaires du helper lib/tenant.ts — vérifie la lecture des headers
 * x-tenant-* injectés par le middleware et les branches d'erreur.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(mockHeaders()),
}));

const findUniqueMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { tenantDomain: { findUnique: (...a: unknown[]) => findUniqueMock(...a) } },
}));

import {
  getCurrentTenantId,
  getCurrentTenantSlug,
  getCurrentTenant,
  requireCurrentTenant,
  resolveTenantByHost,
} from "@/lib/tenant";

function fakeHeaders(entries: Record<string, string | null>) {
  return {
    get(name: string): string | null {
      return entries[name] ?? null;
    },
  };
}

describe("lib/tenant", () => {
  beforeEach(() => {
    mockHeaders.mockReset();
    findUniqueMock.mockReset();
  });

  describe("getCurrentTenantId", () => {
    it("retourne l'id si le header est présent", async () => {
      mockHeaders.mockReturnValue(fakeHeaders({ "x-tenant-id": "abc123" }));
      expect(await getCurrentTenantId()).toBe("abc123");
    });

    it("retourne null si le header est absent", async () => {
      mockHeaders.mockReturnValue(fakeHeaders({}));
      expect(await getCurrentTenantId()).toBeNull();
    });
  });

  describe("getCurrentTenantSlug", () => {
    it("retourne le slug", async () => {
      mockHeaders.mockReturnValue(fakeHeaders({ "x-tenant-slug": "beli-jolie" }));
      expect(await getCurrentTenantSlug()).toBe("beli-jolie");
    });
  });

  describe("getCurrentTenant", () => {
    it("retourne l'objet complet quand les 3 headers sont présents", async () => {
      mockHeaders.mockReturnValue(
        fakeHeaders({
          "x-tenant-id": "abc",
          "x-tenant-slug": "beli-jolie",
          "x-tenant-name": "Beli & Jolie",
        })
      );
      const tenant = await getCurrentTenant();
      expect(tenant).toEqual({ id: "abc", slug: "beli-jolie", name: "Beli & Jolie" });
    });

    it("retourne null si un des headers manque", async () => {
      mockHeaders.mockReturnValue(
        fakeHeaders({ "x-tenant-id": "abc", "x-tenant-slug": "beli-jolie" })
      );
      expect(await getCurrentTenant()).toBeNull();
    });
  });

  describe("requireCurrentTenant", () => {
    it("renvoie le tenant quand présent", async () => {
      mockHeaders.mockReturnValue(
        fakeHeaders({
          "x-tenant-id": "abc",
          "x-tenant-slug": "beli-jolie",
          "x-tenant-name": "Beli & Jolie",
        })
      );
      const t = await requireCurrentTenant();
      expect(t.slug).toBe("beli-jolie");
    });

    it("throw quand le tenant n'est pas résolu", async () => {
      mockHeaders.mockReturnValue(fakeHeaders({}));
      await expect(requireCurrentTenant()).rejects.toThrow(/Aucun tenant/);
    });
  });

  describe("resolveTenantByHost", () => {
    it("normalise en lowercase et cherche en BDD", async () => {
      findUniqueMock.mockResolvedValue({
        tenant: { id: "t1", slug: "beli-jolie", name: "Beli & Jolie", isActive: true },
      });
      const tenant = await resolveTenantByHost("BeliAndJolie.COM");
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { host: "beliandjolie.com" },
        include: { tenant: true },
      });
      expect(tenant?.slug).toBe("beli-jolie");
    });

    it("retourne null si aucun mapping", async () => {
      findUniqueMock.mockResolvedValue(null);
      expect(await resolveTenantByHost("nope.com")).toBeNull();
    });

    it("retourne null si le tenant est inactif", async () => {
      findUniqueMock.mockResolvedValue({
        tenant: { id: "t1", slug: "beli-jolie", name: "Beli & Jolie", isActive: false },
      });
      expect(await resolveTenantByHost("beliandjolie.com")).toBeNull();
    });
  });
});
