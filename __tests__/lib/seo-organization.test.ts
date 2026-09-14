/**
 * Tests unitaires pour buildOrganizationSchema — vérifie l'injection des
 * champs SEO clés : logo, sameAs (réseaux sociaux), aggregateRating (moyenne
 * des avis clients).
 */
import { describe, it, expect } from "vitest";
import { buildOrganizationSchema } from "@/lib/seo";

describe("buildOrganizationSchema", () => {
  const baseData = {
    name: "Beli & Jolie",
    url: "https://beliandjolie.com",
    description: "Grossiste bijoux fantaisie",
  };

  it("émet Organization minimal quand seuls name/url/description sont fournis", () => {
    const schema = buildOrganizationSchema(baseData);
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("Organization");
    expect(schema.name).toBe("Beli & Jolie");
    expect(schema.url).toBe("https://beliandjolie.com");
    expect(schema.logo).toBeUndefined();
    expect(schema.sameAs).toBeUndefined();
    expect(schema.aggregateRating).toBeUndefined();
    expect(schema.contactPoint).toBeUndefined();
    expect(schema.address).toBeUndefined();
  });

  it("injecte logo + image alias quand logoUrl est fourni", () => {
    const schema = buildOrganizationSchema({
      ...baseData,
      logoUrl: "https://beliandjolie.com/uploads/logo/logo-x.png",
    });
    expect(schema.logo).toBe("https://beliandjolie.com/uploads/logo/logo-x.png");
    expect(schema.image).toBe("https://beliandjolie.com/uploads/logo/logo-x.png");
  });

  it("omet sameAs si aucun réseau social", () => {
    const schema = buildOrganizationSchema({ ...baseData, sameAs: [] });
    expect(schema.sameAs).toBeUndefined();
  });

  it("expose sameAs quand ≥ 1 réseau social", () => {
    const schema = buildOrganizationSchema({
      ...baseData,
      sameAs: [
        "https://www.instagram.com/beliandjolie",
        "https://www.facebook.com/beliandjolie",
      ],
    });
    expect(schema.sameAs).toEqual([
      "https://www.instagram.com/beliandjolie",
      "https://www.facebook.com/beliandjolie",
    ]);
  });

  it("injecte aggregateRating quand ≥ 1 avis approuvé", () => {
    const schema = buildOrganizationSchema({
      ...baseData,
      aggregateRating: { ratingValue: 4.6, reviewCount: 27 },
    });
    expect(schema.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.6,
      reviewCount: 27,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it("n'injecte PAS aggregateRating quand reviewCount = 0", () => {
    const schema = buildOrganizationSchema({
      ...baseData,
      aggregateRating: { ratingValue: 0, reviewCount: 0 },
    });
    expect(schema.aggregateRating).toBeUndefined();
  });

  it("n'injecte PAS aggregateRating quand aggregateRating est null", () => {
    const schema = buildOrganizationSchema({ ...baseData, aggregateRating: null });
    expect(schema.aggregateRating).toBeUndefined();
  });

  it("compose logo + sameAs + aggregateRating + contact + address simultanément", () => {
    const schema = buildOrganizationSchema({
      ...baseData,
      email: "contact@beliandjolie.com",
      phone: "+33782758158",
      address: {
        street: "90 rue de la Haie Coq",
        city: "Aubervilliers",
        postalCode: "93300",
        country: "France",
      },
      logoUrl: "https://beliandjolie.com/uploads/logo/logo-x.png",
      sameAs: ["https://www.instagram.com/beliandjolie"],
      aggregateRating: { ratingValue: 4.9, reviewCount: 12 },
    });

    expect(schema.logo).toBeDefined();
    expect(schema.sameAs).toHaveLength(1);
    expect(schema.aggregateRating).toBeDefined();
    expect(schema.contactPoint).toMatchObject({
      "@type": "ContactPoint",
      email: "contact@beliandjolie.com",
      telephone: "+33782758158",
    });
    expect(schema.address).toMatchObject({
      "@type": "PostalAddress",
      streetAddress: "90 rue de la Haie Coq",
      addressLocality: "Aubervilliers",
      postalCode: "93300",
      addressCountry: "France",
    });
  });
});
