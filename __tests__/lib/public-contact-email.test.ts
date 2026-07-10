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

  it("dérive contact@<domaine> depuis NEXTAUTH_URL en https", () => {
    process.env.NEXTAUTH_URL = "https://issyma.fr";
    expect(derivePublicContactEmail(null)).toBe("contact@issyma.fr");
  });

  it("retire le www.", () => {
    process.env.NEXTAUTH_URL = "https://www.demo.beliandjolie.com";
    expect(derivePublicContactEmail(null)).toBe("contact@demo.beliandjolie.com");
  });

  it("fallback sur companyEmail si NEXTAUTH_URL absent", () => {
    expect(derivePublicContactEmail("legacy@boutique.fr")).toBe("legacy@boutique.fr");
  });

  it("prio NEXTAUTH_URL même si companyEmail fourni", () => {
    process.env.NEXTAUTH_URL = "https://issyma.fr";
    expect(derivePublicContactEmail("legacy@boutique.fr")).toBe("contact@issyma.fr");
  });

  it("retourne null si rien", () => {
    expect(derivePublicContactEmail(null)).toBe(null);
    expect(derivePublicContactEmail("")).toBe(null);
    expect(derivePublicContactEmail(undefined)).toBe(null);
  });

  it("fallback si URL invalide", () => {
    process.env.NEXTAUTH_URL = "pas-une-url";
    expect(derivePublicContactEmail("fallback@x.fr")).toBe("fallback@x.fr");
  });
});
