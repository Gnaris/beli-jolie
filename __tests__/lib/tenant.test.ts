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
const findFirstMock = vi.fn();
const tenantFindUniqueMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenantDomain: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      findFirst: (...a: unknown[]) => findFirstMock(...a),
    },
    tenant: {
      findUnique: (...a: unknown[]) => tenantFindUniqueMock(...a),
    },
  },
}));

const alsMock = { current: null as string | null };
vi.mock("@/lib/tenant-als", () => ({
  bindTenantId: vi.fn(),
  getCurrentTenantIdSync: () => alsMock.current,
}));

import {
  getCurrentTenantId,
  getCurrentTenantSlug,
  getCurrentTenant,
  requireCurrentTenant,
  resolveTenantByHost,
  getTenantBaseUrl,
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
    findFirstMock.mockReset();
    tenantFindUniqueMock.mockReset();
    alsMock.current = null;
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

  // Cas fire-and-forget (worker, audit auto) : headers() throw hors request scope.
  // Sans le fallback ALS + BDD, l'audit PFS crashait avec « headers was called
  // outside a request scope » quand il essayait d'importer une variante PFS
  // orpheline via pullAddLocalVariantFromPfs → requireCurrentTenant.
  describe("fallback hors request scope (fire-and-forget)", () => {
    it("getCurrentTenantId retombe sur l'ALS quand headers() throw", async () => {
      mockHeaders.mockImplementation(() => {
        throw new Error("headers was called outside a request scope");
      });
      alsMock.current = "t-audit";
      expect(await getCurrentTenantId()).toBe("t-audit");
    });

    it("getCurrentTenant reconstitue le tenant depuis l'ALS + BDD", async () => {
      mockHeaders.mockImplementation(() => {
        throw new Error("headers was called outside a request scope");
      });
      alsMock.current = "t-issyma";
      tenantFindUniqueMock.mockResolvedValue({
        id: "t-issyma",
        slug: "issyma",
        name: "FORCYMA",
        isActive: true,
      });
      const t = await getCurrentTenant();
      expect(t).toEqual({ id: "t-issyma", slug: "issyma", name: "FORCYMA" });
    });

    it("getCurrentTenant renvoie null si tenant BDD inactif", async () => {
      mockHeaders.mockImplementation(() => {
        throw new Error("headers was called outside a request scope");
      });
      alsMock.current = "t-off";
      tenantFindUniqueMock.mockResolvedValue({
        id: "t-off",
        slug: "off",
        name: "Off",
        isActive: false,
      });
      expect(await getCurrentTenant()).toBeNull();
    });

    it("requireCurrentTenant marche depuis un fire-and-forget wrappé en tenantALS.run", async () => {
      mockHeaders.mockImplementation(() => {
        throw new Error("headers was called outside a request scope");
      });
      alsMock.current = "t-issyma";
      tenantFindUniqueMock.mockResolvedValue({
        id: "t-issyma",
        slug: "issyma",
        name: "FORCYMA",
        isActive: true,
      });
      const t = await requireCurrentTenant();
      expect(t.slug).toBe("issyma");
    });

    it("getCurrentTenantSlug retombe sur l'ALS + BDD quand headers() throw", async () => {
      mockHeaders.mockImplementation(() => {
        throw new Error("headers was called outside a request scope");
      });
      alsMock.current = "t-issyma";
      tenantFindUniqueMock.mockResolvedValue({ slug: "issyma" });
      expect(await getCurrentTenantSlug()).toBe("issyma");
    });

    it("renvoie null si ni ALS ni headers ne fournissent d'id (script CLI)", async () => {
      mockHeaders.mockImplementation(() => {
        throw new Error("headers was called outside a request scope");
      });
      alsMock.current = null;
      expect(await getCurrentTenantId()).toBeNull();
      expect(await getCurrentTenant()).toBeNull();
      expect(await getCurrentTenantSlug()).toBeNull();
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

  describe("getTenantBaseUrl", () => {
    it("renvoie https://<primary host> quand un TenantDomain existe", async () => {
      findFirstMock.mockResolvedValue({ host: "issyma.fr" });
      const url = await getTenantBaseUrl("t-issyma");
      expect(url).toBe("https://issyma.fr");
      expect(findFirstMock).toHaveBeenCalledWith({
        where: { tenantId: "t-issyma" },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { host: true },
      });
    });

    it("renvoie null quand aucun TenantDomain n'existe", async () => {
      findFirstMock.mockResolvedValue(null);
      expect(await getTenantBaseUrl("t-nope")).toBeNull();
    });
  });
});
