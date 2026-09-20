import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const cookiesMock = vi.fn();
const getCurrentTenantSlugMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantSlug: () => getCurrentTenantSlugMock(),
}));

import { getEffectiveTenantSlug } from "@/lib/tenant-preview";

const originalNodeEnv = process.env.NODE_ENV;

function setCookie(value: string | undefined) {
  cookiesMock.mockReturnValue({
    get: (name: string) =>
      name === "bj_home_preview" && value !== undefined ? { value } : undefined,
  });
}

describe("getEffectiveTenantSlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe("en dev", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("respecte le cookie preview quand il vaut 'issyma'", async () => {
      setCookie("issyma");
      getCurrentTenantSlugMock.mockResolvedValue("beliandjolie");
      await expect(getEffectiveTenantSlug()).resolves.toBe("issyma");
    });

    it("respecte le cookie preview quand il vaut 'beliandjolie'", async () => {
      setCookie("beliandjolie");
      getCurrentTenantSlugMock.mockResolvedValue("issyma");
      await expect(getEffectiveTenantSlug()).resolves.toBe("beliandjolie");
    });

    it("ignore un cookie preview de valeur inconnue et retombe sur le middleware", async () => {
      setCookie("xyz");
      getCurrentTenantSlugMock.mockResolvedValue("issyma");
      await expect(getEffectiveTenantSlug()).resolves.toBe("issyma");
    });

    it("sans cookie preview, retombe sur le middleware", async () => {
      setCookie(undefined);
      getCurrentTenantSlugMock.mockResolvedValue("beliandjolie");
      await expect(getEffectiveTenantSlug()).resolves.toBe("beliandjolie");
    });

    it("fallback beliandjolie si middleware renvoie null", async () => {
      setCookie(undefined);
      getCurrentTenantSlugMock.mockResolvedValue(null);
      await expect(getEffectiveTenantSlug()).resolves.toBe("beliandjolie");
    });
  });

  describe("en prod", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("ignore totalement le cookie preview", async () => {
      setCookie("issyma");
      getCurrentTenantSlugMock.mockResolvedValue("beliandjolie");
      await expect(getEffectiveTenantSlug()).resolves.toBe("beliandjolie");
      expect(cookiesMock).not.toHaveBeenCalled();
    });

    it("utilise le slug résolu par le middleware", async () => {
      getCurrentTenantSlugMock.mockResolvedValue("issyma");
      await expect(getEffectiveTenantSlug()).resolves.toBe("issyma");
    });

    it("fallback beliandjolie si middleware renvoie null", async () => {
      getCurrentTenantSlugMock.mockResolvedValue(null);
      await expect(getEffectiveTenantSlug()).resolves.toBe("beliandjolie");
    });
  });
});
