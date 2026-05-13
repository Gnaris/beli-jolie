/**
 * Vérifie le 3ᵉ filet de sécurité de `ankorstoreSearchProducts` :
 * quand `/product-variants?filter[skuOrName]` ET `/products?filter[skuOrName]`
 * ne renvoient rien, on parcourt les produits page par page et on filtre
 * côté code par référence extraite ou par nom contenant la query.
 *
 * Cas d'usage réel : une référence en fin de nom collée à un tiret
 * (ex : "Boucles d'oreilles en acier inoxydable - A405") que le tokenizer
 * Ankorstore n'isole pas comme un mot, donc `filter[skuOrName]=A405` peut
 * renvoyer 0 alors que le produit existe bel et bien.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/ankorstore-auth", () => ({
  ANKORSTORE_BASE_URL: "https://test.ankorstore.invalid/api/v1",
  getAnkorstoreHeaders: vi.fn().mockResolvedValue({ Authorization: "Bearer test" }),
  invalidateAnkorstoreToken: vi.fn(),
}));

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface MockProductOpts {
  id: string;
  name: string;
  variantSkus?: (string | null)[];
}

function mockProductItem(opts: MockProductOpts) {
  const variantIds = (opts.variantSkus ?? []).map((_, i) => `${opts.id}-v${i}`);
  return {
    id: opts.id,
    attributes: {
      externalId: null,
      name: opts.name,
      description: "",
      retailPrice: 20,
      wholesalePrice: 10,
      vatRate: 20,
      active: true,
      archived: false,
      images: [],
    },
    relationships: {
      productVariant: { data: variantIds.map((id) => ({ id })) },
    },
  };
}

function mockVariantIncluded(opts: MockProductOpts) {
  return (opts.variantSkus ?? []).map((sku, i) => ({
    id: `${opts.id}-v${i}`,
    type: "productVariant",
    attributes: {
      sku,
      ian: null,
      name: sku ?? "var",
      retailPrice: 20,
      wholesalePrice: 10,
      availableQuantity: 5,
      stockQuantity: 5,
      isAlwaysInStock: false,
    },
  }));
}

describe("ankorstoreSearchProducts — fallback scan complet", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("trouve le produit via scan complet quand les 2 filter[skuOrName] renvoient vide", async () => {
    // 1. /product-variants?filter[skuOrName]=A405 → vide
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [], included: [] }));
    // 2. /products?filter[skuOrName]=A405 → vide (fallback legacy)
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [], included: [] }));
    // 3. /products?include=productVariant&page[limit]=50 → page 1 (le produit A405 est dedans)
    const target = {
      id: "p-target",
      name: "Boucles d'oreilles en acier inoxydable - A405",
      variantSkus: ["sku-quelconque-sans-a405"],
    };
    const noise = {
      id: "p-noise",
      name: "Bague turquoise",
      variantSkus: ["TURQ_1"],
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [mockProductItem(noise), mockProductItem(target)],
        included: [
          ...mockVariantIncluded(noise),
          ...mockVariantIncluded(target),
        ],
        meta: { page: { hasMore: false } },
      })
    );

    const { ankorstoreSearchProducts } = await import("@/lib/ankorstore-api");
    const results = await ankorstoreSearchProducts("A405", 20);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("p-target");
    expect(results[0].name).toContain("A405");
  });

  it("ne déclenche PAS le scan complet si la recherche par SKU a déjà des résultats", async () => {
    // 1. /product-variants → renvoie un produit
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "v1",
            attributes: {
              sku: "A405_C1",
              ian: null,
              name: "Rouge",
              retailPrice: 20,
              wholesalePrice: 10,
              availableQuantity: 3,
              stockQuantity: 3,
              isAlwaysInStock: false,
            },
            relationships: { product: { data: { id: "p1" } } },
          },
        ],
        included: [
          {
            id: "p1",
            type: "product",
            attributes: {
              externalId: null,
              name: "A405 produit",
              description: "",
              retailPrice: 20,
              wholesalePrice: 10,
              vatRate: 20,
              active: true,
              archived: false,
              images: [],
            },
          },
        ],
      })
    );

    const { ankorstoreSearchProducts } = await import("@/lib/ankorstore-api");
    const results = await ankorstoreSearchProducts("A405", 20);

    // Une seule requête : pas de fallback déclenché
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("p1");
  });

  it("retourne vide si même le scan complet ne trouve rien", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [], included: [] }));
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [], included: [] }));
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [
          mockProductItem({
            id: "p-noise",
            name: "Sans rapport",
            variantSkus: ["XYZ_1"],
          }),
        ],
        included: mockVariantIncluded({
          id: "p-noise",
          name: "Sans rapport",
          variantSkus: ["XYZ_1"],
        }),
        meta: { page: { hasMore: false } },
      })
    );

    const { ankorstoreSearchProducts } = await import("@/lib/ankorstore-api");
    const results = await ankorstoreSearchProducts("A405", 20);
    expect(results).toEqual([]);
  });
});
