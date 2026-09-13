import { describe, it, expect } from "vitest";
import {
  buildDefaultCategorySeo,
  resolveCategorySeo,
  buildFaqJsonLd,
  buildBreadcrumbJsonLd,
} from "@/lib/category-seo";

describe("buildDefaultCategorySeo", () => {
  it("génère une trame française à partir du nom de la catégorie", () => {
    const seo = buildDefaultCategorySeo({
      categoryName: "Blouses",
      shopName: "FORCYMA",
      productCount: 42,
      locale: "fr",
    });
    expect(seo.title).toContain("Grossiste");
    expect(seo.title).toContain("blouses");
    expect(seo.title).toContain("FORCYMA");
    expect(seo.intro).toContain("blouses");
    // Pas de FAQ par défaut — la section n'apparaît que si l'admin en saisit.
    expect(seo.faq).toEqual([]);
  });

  it("génère une trame anglaise pour la locale en, sans FAQ par défaut", () => {
    const seo = buildDefaultCategorySeo({
      categoryName: "Necklaces",
      shopName: "Beli & Jolie",
      productCount: 10,
      locale: "en",
    });
    expect(seo.title).toContain("Wholesale");
    expect(seo.title.toLowerCase()).toContain("necklaces");
    expect(seo.faq).toEqual([]);
  });
});

describe("resolveCategorySeo", () => {
  const baseArgs = {
    categoryName: "Blouses",
    categoryNameLocalized: "Blouses",
    shopName: "FORCYMA",
    productCount: 42,
    locale: "fr" as const,
  };
  const emptyOverride = {
    seoTitle: null,
    seoIntro: null,
    seoSecondary: null,
    seoFaq: null,
  };

  it("retombe sur la trame par défaut quand toutes les valeurs sont vides (FAQ vide)", () => {
    const seo = resolveCategorySeo({
      ...baseArgs,
      overridesBase: emptyOverride,
      overridesTranslation: null,
    });
    expect(seo.title).toContain("Grossiste");
    expect(seo.faq).toEqual([]);
  });

  it("prend l'override FR sur Category quand la locale est fr", () => {
    const seo = resolveCategorySeo({
      ...baseArgs,
      overridesBase: {
        seoTitle: "Mon titre perso",
        seoIntro: "Mon intro perso",
        seoSecondary: null,
        seoFaq: [{ q: "Q1 ?", a: "R1." }],
      },
      overridesTranslation: null,
    });
    expect(seo.title).toBe("Mon titre perso");
    expect(seo.intro).toBe("Mon intro perso");
    // Secondary vide → défaut
    expect(seo.secondary).toContain("blouses");
    expect(seo.faq).toEqual([{ q: "Q1 ?", a: "R1." }]);
  });

  it("prend l'override de CategoryTranslation quand la locale est en", () => {
    const seo = resolveCategorySeo({
      ...baseArgs,
      locale: "en",
      categoryNameLocalized: "Blouses",
      overridesBase: {
        seoTitle: "Titre FR",
        seoIntro: "Intro FR",
        seoSecondary: null,
        seoFaq: null,
      },
      overridesTranslation: {
        seoTitle: "My English title",
        seoIntro: null,
        seoSecondary: null,
        seoFaq: null,
      },
    });
    expect(seo.title).toBe("My English title");
    // Intro EN vide → PAS le FR mais la trame par défaut EN
    expect(seo.intro.toLowerCase()).toContain("wholesale");
    expect(seo.intro).not.toContain("Intro FR");
  });

  it("ignore les entrées FAQ mal formées (q ou a manquant)", () => {
    const seo = resolveCategorySeo({
      ...baseArgs,
      overridesBase: {
        seoTitle: null,
        seoIntro: null,
        seoSecondary: null,
        seoFaq: [
          { q: "Q1", a: "R1" },
          { q: "", a: "R2" }, // ignoré
          { q: "Q3", a: "" }, // ignoré
          { q: "Q4", a: "R4" },
        ] as unknown,
      },
      overridesTranslation: null,
    });
    expect(seo.faq).toEqual([
      { q: "Q1", a: "R1" },
      { q: "Q4", a: "R4" },
    ]);
  });

  it("retombe sur une FAQ vide si la valeur n'est pas un tableau (pas de trame par défaut)", () => {
    const seo = resolveCategorySeo({
      ...baseArgs,
      overridesBase: {
        seoTitle: null,
        seoIntro: null,
        seoSecondary: null,
        seoFaq: "not-an-array",
      },
      overridesTranslation: null,
    });
    expect(seo.faq).toEqual([]);
  });
});

describe("buildFaqJsonLd", () => {
  it("renvoie un FAQPage valide schema.org", () => {
    const jsonLd = buildFaqJsonLd([
      { q: "Q1 ?", a: "R1." },
      { q: "Q2 ?", a: "R2." },
    ]);
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Q1 ?",
          acceptedAnswer: { "@type": "Answer", text: "R1." },
        },
        {
          "@type": "Question",
          name: "Q2 ?",
          acceptedAnswer: { "@type": "Answer", text: "R2." },
        },
      ],
    });
  });

  it("renvoie null si aucune question", () => {
    expect(buildFaqJsonLd([])).toBeNull();
  });
});

describe("buildBreadcrumbJsonLd", () => {
  it("construit une hiérarchie Accueil > Catégories > catégorie", () => {
    const jsonLd = buildBreadcrumbJsonLd({
      siteUrl: "https://issyma.fr",
      locale: "fr",
      categoryName: "Blouses",
      slug: "blouses",
      labels: { home: "Accueil", categories: "Catégories" },
    });
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: "https://issyma.fr/fr" },
        { "@type": "ListItem", position: 2, name: "Catégories", item: "https://issyma.fr/fr/categories" },
        { "@type": "ListItem", position: 3, name: "Blouses", item: "https://issyma.fr/fr/categories/blouses" },
      ],
    });
  });
});
