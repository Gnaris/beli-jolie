/**
 * Tests pour GET /api/public/products.
 *
 * - Tenant != beliandjolie → 404 (endpoint réservé à Beli & Jolie).
 * - Mauvaise clé API → 401.
 * - Bonne clé + bon tenant → produit shape complet (couleur avec imageUrl,
 *   compositions, sizes, dimensions, statut, prix).
 * - Filtre `reference`, filtre `status`, pagination `page` + `perPage`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tenant", () => ({
  getCurrentTenant: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { NextRequest } from "next/server";
import { getCurrentTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/public/products/route";

function makeRequest(url = "https://beliandjolie.com/api/public/products", apiKey?: string) {
  const headers = new Headers();
  if (apiKey !== undefined) headers.set("x-api-key", apiKey);
  return new NextRequest(url, { headers });
}

const beliTenant = { id: "t-beli", slug: "beliandjolie", name: "Beli & Jolie" };
const issymaTenant = { id: "t-issyma", slug: "issyma", name: "FORCYMA" };

const productRow = {
  id: "prod-1",
  reference: "BJ-1234",
  status: "ONLINE",
  name: "Bague acier or",
  description: "Une jolie bague",
  countryIsoCode: "CN",
  dimensionLength: 20,
  dimensionWidth: 10,
  dimensionHeight: 5,
  dimensionDiameter: null,
  dimensionCircumference: null,
  category: { name: "Bague" },
  subCategories: [{ name: "Chevalière" }, { name: "Éternité" }],
  compositions: [
    { percentage: 100, composition: { name: "Acier inoxydable" } },
  ],
  colors: [
    {
      id: "pc-1",
      colorId: "c-or",
      sku: "BJ-1234_OR_UNIT_1",
      saleType: "UNIT",
      packQuantity: null,
      unitPrice: "4.20",
      stock: 12,
      weight: 0.02,
      color: { name: "Or", hex: "#D4AF37", patternImage: "/uploads/beliandjolie/motifs-couleurs/or.jpg" },
      variantSizes: [{ quantity: 1, size: { name: "TU" } }],
    },
  ],
  colorImages: [
    { colorId: "c-or", path: "/uploads/beliandjolie/produits/BJ-1234/or-1.webp", order: 0 },
  ],
};

describe("GET /api/public/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("404 si le tenant courant n'est pas beliandjolie", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(issymaTenant);
    const res = await GET(makeRequest("https://issyma.fr/api/public/products", "kebab"));
    expect(res.status).toBe(404);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it("404 si aucun tenant résolu", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(null);
    const res = await GET(makeRequest(undefined, "kebab"));
    expect(res.status).toBe(404);
  });

  it("401 si header X-API-Key manquant", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    const res = await GET(makeRequest(undefined, undefined));
    expect(res.status).toBe(401);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it("401 si mauvaise clé", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    const res = await GET(makeRequest(undefined, "pas-la-bonne"));
    expect(res.status).toBe(401);
  });

  it("200 + shape complet quand clé + tenant OK", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(1);
    vi.mocked(prisma.product.findMany).mockResolvedValue([productRow] as never);

    const res = await GET(makeRequest(undefined, "kebab"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
    expect(body.products).toHaveLength(1);

    const p = body.products[0];
    expect(p.reference).toBe("BJ-1234");
    expect(p.status).toBe("ONLINE");
    expect(p.name).toBe("Bague acier or");
    expect(p.description).toBe("Une jolie bague");
    expect(p.category).toBe("Bague");
    expect(p.subCategories).toEqual(["Chevalière", "Éternité"]);
    expect(p.manufacturingCountry).toBe("Chine");
    expect(p.dimensions).toEqual({
      length: 20,
      width: 10,
      height: 5,
      diameter: null,
      circumference: null,
    });
    expect(p.composition).toEqual([{ name: "Acier inoxydable", percent: 100 }]);
    expect(p.colors).toHaveLength(1);

    const c = p.colors[0];
    expect(c.name).toBe("Or");
    expect(c.hex).toBe("#D4AF37");
    // patternImage prioritaire sur les colorImages, URL absolue
    expect(c.imageUrl).toBe("https://beliandjolie.com/uploads/beliandjolie/motifs-couleurs/or.jpg");
    expect(c.variants).toHaveLength(1);
    expect(c.variants[0]).toMatchObject({
      sku: "BJ-1234_OR_UNIT_1",
      saleType: "UNIT",
      packQuantity: null,
      price: 4.2,
      stock: 12,
      weightKg: 0.02,
      sizes: [{ name: "TU", quantity: 1 }],
    });
  });

  it("retombe sur la première image de la couleur si patternImage absente", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(1);
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      {
        ...productRow,
        colors: [
          {
            ...productRow.colors[0],
            color: { name: "Argent", hex: "#C0C0C0", patternImage: null },
          },
        ],
        colorImages: [
          { colorId: "c-or", path: "/uploads/beliandjolie/produits/BJ-1234/argent-1.webp", order: 0 },
          { colorId: "c-or", path: "/uploads/beliandjolie/produits/BJ-1234/argent-2.webp", order: 1 },
        ],
      },
    ] as never);

    const res = await GET(makeRequest(undefined, "kebab"));
    const body = await res.json();
    expect(body.products[0].colors[0].imageUrl).toBe(
      "https://beliandjolie.com/uploads/beliandjolie/produits/BJ-1234/argent-1.webp",
    );
  });

  it("filtre par référence quand ?reference= est fourni", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    await GET(makeRequest("https://beliandjolie.com/api/public/products?reference=BJ-9999", "kebab"));
    const args = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(args?.where).toMatchObject({ reference: "BJ-9999" });
  });

  it("filtre par statut quand ?status=ARCHIVED", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    await GET(makeRequest("https://beliandjolie.com/api/public/products?status=archived", "kebab"));
    const args = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(args?.where).toMatchObject({ status: "ARCHIVED" });
  });

  it("ignore un statut invalide (renvoie tous les statuts)", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    await GET(makeRequest("https://beliandjolie.com/api/public/products?status=nimportequoi", "kebab"));
    const args = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(args?.where).not.toHaveProperty("status");
  });

  it("pagine avec perPage plafonné à 200", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(500);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    await GET(makeRequest("https://beliandjolie.com/api/public/products?page=3&perPage=999", "kebab"));
    const args = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(args?.take).toBe(200);
    expect(args?.skip).toBe(400); // (3-1) * 200
  });
});
