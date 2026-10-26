/**
 * Indexation Google (Search Console, oct. 2026) — garde-fous :
 *  - sitemap découpé par langue (l'ancien sitemap unique faisait 50 290 URLs,
 *    au-dessus de la limite Google de 50 000 → erreur « Trop d'URL ») ;
 *  - robots.txt pointe vers l'index des sitemaps et bloque les pages privées
 *    aussi sous préfixe de langue (/fr/panier…) ;
 *  - titre SEO produit = nom + référence (évite des centaines de titres
 *    identiques).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const productFindMany = vi.fn();
const collectionFindMany = vi.fn();
const categoryFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findMany: (...a: unknown[]) => productFindMany(...a) },
    collection: { findMany: (...a: unknown[]) => collectionFindMany(...a) },
    category: { findMany: (...a: unknown[]) => categoryFindMany(...a) },
  },
}));
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: vi.fn(async () => "tenant-bj"),
  getCurrentTenantSlug: vi.fn(async () => "beliandjolie"),
}));
vi.mock("@/lib/public-product-visibility", () => ({
  PUBLIC_SELLABLE_COLORS_CLAUSE: { some: {} },
}));
let hostHeader = "beliandjolie.com";
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", hostHeader]]),
}));

import sitemap, { generateSitemaps } from "@/app/sitemap";
import robots from "@/app/robots";
import { GET as sitemapIndex } from "@/app/sitemap_index.xml/route";
import { buildProductSeoTitle } from "@/lib/product-url";

beforeEach(() => {
  hostHeader = "beliandjolie.com";
  productFindMany.mockReset().mockResolvedValue([
    { name: "Bague ajustable en acier inoxydable", reference: "A108", updatedAt: new Date("2026-10-01") },
  ]);
  collectionFindMany.mockReset().mockResolvedValue([{ slug: "automne", updatedAt: new Date("2026-10-01") }]);
  categoryFindMany.mockReset().mockResolvedValue([{ slug: "bagues" }]);
});

describe("sitemap par langue", () => {
  it("génère 1 sitemap par langue", async () => {
    const ids = (await generateSitemaps()).map((s) => s.id);
    expect(ids).toEqual(["fr", "en", "de", "it", "es"]);
  });

  it("ne contient que les URLs de la langue demandée, avec hreflang vers les autres", async () => {
    const entries = await sitemap({ id: Promise.resolve("de") });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.url.startsWith("https://beliandjolie.com/de")).toBe(true);
    const product = entries.find((e) => e.url.includes("/produits/"))!;
    expect(product.url).toBe("https://beliandjolie.com/de/produits/bague-ajustable-en-acier-inoxydable-a108");
    expect(product.alternates?.languages).toMatchObject({
      "x-default": "https://beliandjolie.com/fr/produits/bague-ajustable-en-acier-inoxydable-a108",
      fr: "https://beliandjolie.com/fr/produits/bague-ajustable-en-acier-inoxydable-a108",
      es: "https://beliandjolie.com/es/produits/bague-ajustable-en-acier-inoxydable-a108",
    });
  });

  it("reste sous la limite Google de 50 000 URLs même avec un gros catalogue", async () => {
    await sitemap({ id: Promise.resolve("fr") });
    const take = productFindMany.mock.calls[0]![0].take as number;
    expect(take).toBeLessThanOrEqual(49000);
  });

  it("utilise le domaine sans www", async () => {
    hostHeader = "www.beliandjolie.com";
    const entries = await sitemap({ id: Promise.resolve("fr") });
    expect(entries[0]!.url.startsWith("https://beliandjolie.com/fr")).toBe(true);
  });

  it("l'index liste les 5 sitemaps de langue", async () => {
    const xml = await (await sitemapIndex()).text();
    expect(xml).toContain("<sitemapindex");
    for (const l of ["fr", "en", "de", "it", "es"]) {
      expect(xml).toContain(`<loc>https://beliandjolie.com/sitemap/${l}.xml</loc>`);
    }
  });
});

describe("robots.txt", () => {
  it("pointe vers l'index des sitemaps", async () => {
    const r = await robots();
    expect(r.sitemap).toBe("https://beliandjolie.com/sitemap_index.xml");
  });

  it("bloque les pages privées aussi sous préfixe de langue, sans bloquer les fiches produit", async () => {
    const r = await robots();
    const rules = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    const disallow = rules.disallow as string[];
    expect(disallow).toContain("/fr/panier");
    expect(disallow).toContain("/de/espace-pro");
    expect(disallow.some((d) => d.includes("*"))).toBe(false);
    expect(disallow.some((d) => "/fr/produits/bague-a108".startsWith(d))).toBe(false);
  });
});

describe("buildProductSeoTitle", () => {
  it("ajoute la référence au nom", () => {
    expect(buildProductSeoTitle("Bague ajustable en acier inoxydable", "A108")).toBe(
      "Bague ajustable en acier inoxydable – A108",
    );
  });
  it("n'ajoute pas la référence si elle est déjà dans le nom", () => {
    expect(buildProductSeoTitle("Lot BRACELET33 acier", "bracelet33")).toBe("Lot BRACELET33 acier");
  });
  it("garde le nom seul sans référence", () => {
    expect(buildProductSeoTitle("Collier en acier inoxydable", "  ")).toBe("Collier en acier inoxydable");
  });
});
