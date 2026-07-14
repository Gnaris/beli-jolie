import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { derivePublicContactEmail } from "@/lib/public-contact-email";

describe("derivePublicContactEmail", () => {
  const original = process.env.NEXTAUTH_URL;
  beforeEach(() => {
    delete process.env.NEXTAUTH_URL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = original;
  });

  it("dérive contact@<domaine> depuis le domaine du tenant en https", async () => {
    process.env.NEXTAUTH_URL = "https://issyma.fr";
    expect(await derivePublicContactEmail(null)).toBe("contact@issyma.fr");
  });

  it("retire le www.", async () => {
    process.env.NEXTAUTH_URL = "https://www.demo.beliandjolie.com";
    expect(await derivePublicContactEmail(null)).toBe("contact@demo.beliandjolie.com");
  });

  it("fallback sur companyEmail si NEXTAUTH_URL absent", async () => {
    expect(await derivePublicContactEmail("legacy@boutique.fr")).toBe("legacy@boutique.fr");
  });

  it("prio domaine tenant même si companyEmail fourni", async () => {
    process.env.NEXTAUTH_URL = "https://issyma.fr";
    expect(await derivePublicContactEmail("legacy@boutique.fr")).toBe("contact@issyma.fr");
  });

  it("retourne null si rien", async () => {
    expect(await derivePublicContactEmail(null)).toBe(null);
    expect(await derivePublicContactEmail("")).toBe(null);
    expect(await derivePublicContactEmail(undefined)).toBe(null);
  });

  it("fallback si URL invalide", async () => {
    process.env.NEXTAUTH_URL = "pas-une-url";
    expect(await derivePublicContactEmail("fallback@x.fr")).toBe("fallback@x.fr");
  });
});
