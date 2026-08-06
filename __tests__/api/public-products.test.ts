/**
 * Tests pour GET /api/public/products.
 *
 * - Tenant != beliandjolie → 404 (endpoint réservé à Beli & Jolie).
 * - Mauvaise clé API → 401.
 * - Bonne clé + bon tenant → produit shape complet.
 * - Header X-Product-Reference → renvoie { product } ou 404.
 * - Sinon → liste paginée (page, perPage, total, totalPages, hasMore).
 * - Filtre `status` (5 slugs FR : en-ligne, hors-ligne, brouillon, archive, synchronisation).
 * - Statut renvoyé en français.
 * - imageUrls[] absolues sur https://beliandjolie.com, plus de colorId ni hex.
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
      findFirst: vi.fn(),
    },
  },
}));

import { NextRequest } from "next/server";
import { getCurrentTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/public/products/route";

function makeRequest(
  url = "https://beliandjolie.com/api/public/products",
  opts: { apiKey?: string; ref?: string } = {},
) {
  const headers = new Headers();
  if (opts.apiKey !== undefined) headers.set("x-api-key", opts.apiKey);
  if (opts.ref !== undefined) headers.set("x-product-reference", opts.ref);
  return new NextRequest(url, { headers });
}

const beliTenant = { id: "t-beli", slug: "beliandjolie", name: "Beli & Jolie" };
const issymaTenant = { id: "t-issyma", slug: "issyma", name: "FORCYMA" };

const productRow = {
  id: "prod-1",
  reference: "BJ-1234",
  status: "ONLINE",
  isIncomplete: false,
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
  compositions: [{ percentage: 100, composition: { name: "Acier inoxydable" } }],
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
      color: { name: "Or" },
      variantSizes: [{ quantity: 1, size: { name: "TU" } }],
    },
  ],
  colorImages: [
    { colorId: "c-or", path: "/uploads/beliandjolie/produits/BJ-1234/or-1.webp" },
    { colorId: "c-or", path: "/uploads/beliandjolie/produits/BJ-1234/or-2.webp" },
    { colorId: "c-or", path: "/uploads/beliandjolie/produits/BJ-1234/or-3.webp" },
  ],
};

describe("GET /api/public/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("404 si tenant != beliandjolie", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(issymaTenant);
    const res = await GET(makeRequest("https://issyma.fr/api/public/products", { apiKey: "kebab" }));
    expect(res.status).toBe(404);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it("401 sans clé", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("401 mauvaise clé", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    const res = await GET(makeRequest(undefined, { apiKey: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("200 + shape complet + pagination + URLs absolues beliandjolie.com", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(1);
    vi.mocked(prisma.product.findMany).mockResolvedValue([productRow] as never);

    const res = await GET(makeRequest(undefined, { apiKey: "kebab" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.totalPages).toBe(1);
    expect(body.hasMore).toBe(false);

    const p = body.products[0];
    expect(p.reference).toBe("BJ-1234");
    expect(p.status).toBe("En ligne");
    expect(p.name).toBe("Bague acier or");
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

    const c = p.colors[0];
    expect(c.name).toBe("Or");
    // pas de colorId ni hex
    expect(c.colorId).toBeUndefined();
    expect(c.hex).toBeUndefined();
    // liste d'URLs absolues, toutes sur beliandjolie.com même appelé ailleurs
    expect(c.imageUrls).toEqual([
      "https://beliandjolie.com/uploads/beliandjolie/produits/BJ-1234/or-1.webp",
      "https://beliandjolie.com/uploads/beliandjolie/produits/BJ-1234/or-2.webp",
      "https://beliandjolie.com/uploads/beliandjolie/produits/BJ-1234/or-3.webp",
    ]);
    expect(c.variants[0]).toMatchObject({
      sku: "BJ-1234_OR_UNIT_1",
      saleType: "UNIT",
      price: 4.2,
      stock: 12,
    });
  });

  it("URLs absolues même si l'appel arrive sur localhost:3000 (dev)", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(1);
    vi.mocked(prisma.product.findMany).mockResolvedValue([productRow] as never);

    const res = await GET(
      makeRequest("http://localhost:3000/api/public/products", { apiKey: "kebab" }),
    );
    const body = await res.json();
    // Le lien reste sur beliandjolie.com, pas sur localhost.
    expect(body.products[0].colors[0].imageUrls[0]).toMatch(/^https:\/\/beliandjolie\.com\//);
  });

  it("header X-Product-Reference → renvoie { product } (pas de tableau)", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.findFirst).mockResolvedValue(productRow as never);

    const res = await GET(makeRequest(undefined, { apiKey: "kebab", ref: "BJ-1234" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.product).toBeDefined();
    expect(body.products).toBeUndefined();
    expect(body.product.reference).toBe("BJ-1234");
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    // Prisma a bien été appelé avec la référence
    expect(vi.mocked(prisma.product.findFirst).mock.calls[0][0]).toMatchObject({
      where: { reference: "BJ-1234" },
    });
  });

  it("header X-Product-Reference introuvable → 404", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null);

    const res = await GET(makeRequest(undefined, { apiKey: "kebab", ref: "BJ-INEXISTANT" }));
    expect(res.status).toBe(404);
  });

  it("pagination : page=2, perPage=100, calcule totalPages", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(500);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    const res = await GET(
      makeRequest("https://beliandjolie.com/api/public/products?page=2&perPage=100", {
        apiKey: "kebab",
      }),
    );
    const body = await res.json();

    expect(body.page).toBe(2);
    expect(body.perPage).toBe(100);
    expect(body.total).toBe(500);
    expect(body.totalPages).toBe(5);
    expect(body.hasMore).toBe(true);

    const args = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(args?.take).toBe(100);
    expect(args?.skip).toBe(100);
  });

  it("perPage plafonné à 200", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(500);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    await GET(
      makeRequest("https://beliandjolie.com/api/public/products?perPage=999", { apiKey: "kebab" }),
    );
    const args = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(args?.take).toBe(200);
  });

  it("filtre brouillon → OFFLINE + isIncomplete true", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    await GET(
      makeRequest("https://beliandjolie.com/api/public/products?status=brouillon", {
        apiKey: "kebab",
      }),
    );
    const args = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(args?.where).toMatchObject({ status: "OFFLINE", isIncomplete: true });
  });

  it("filtre hors-ligne exclut les brouillons", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    await GET(
      makeRequest("https://beliandjolie.com/api/public/products?status=hors-ligne", {
        apiKey: "kebab",
      }),
    );
    const args = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(args?.where).toMatchObject({ status: "OFFLINE", isIncomplete: false });
  });

  it("mapping statut en français pour tous les cas", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(4);
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { ...productRow, status: "ONLINE", isIncomplete: false },
      { ...productRow, status: "OFFLINE", isIncomplete: true },
      { ...productRow, status: "ARCHIVED", isIncomplete: false },
      { ...productRow, status: "SYNCING", isIncomplete: false },
    ] as never);

    const res = await GET(makeRequest(undefined, { apiKey: "kebab" }));
    const body = await res.json();
    expect(body.products.map((p: { status: string }) => p.status)).toEqual([
      "En ligne",
      "Brouillon",
      "Archivé",
      "En synchronisation",
    ]);
  });

  it("ignore un statut invalide (renvoie tous les statuts)", async () => {
    vi.mocked(getCurrentTenant).mockResolvedValue(beliTenant);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    await GET(
      makeRequest("https://beliandjolie.com/api/public/products?status=nawak", { apiKey: "kebab" }),
    );
    const args = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(args?.where).not.toHaveProperty("status");
  });
});
