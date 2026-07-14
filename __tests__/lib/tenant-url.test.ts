import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";

describe("getCurrentTenantBaseUrl", () => {
  const original = process.env.NEXTAUTH_URL;
  beforeEach(() => {
    delete process.env.NEXTAUTH_URL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = original;
  });

  it("retombe sur NEXTAUTH_URL quand ni requête ni ALS ne sont dispos", async () => {
    process.env.NEXTAUTH_URL = "https://issyma.fr";
    expect(await getCurrentTenantBaseUrl()).toBe("https://issyma.fr");
  });

  it("retire le slash final", async () => {
    process.env.NEXTAUTH_URL = "https://beliandjolie.com/";
    expect(await getCurrentTenantBaseUrl()).toBe("https://beliandjolie.com");
  });

  it("fallback localhost si NEXTAUTH_URL absent", async () => {
    expect(await getCurrentTenantBaseUrl()).toBe("http://localhost:3000");
  });
});
