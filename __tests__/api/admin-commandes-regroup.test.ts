import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { GET } from "@/app/api/admin/commandes/[id]/regroup/route";

function makeReq() {
  return new Request(
    "http://test/api/admin/commandes/ord1/regroup",
  ) as unknown as import("next/server").NextRequest;
}

const params = (id: string) => Promise.resolve({ id });

const baseOrder = {
  id: "ord1",
  orderNumber: "K7X9M2PH",
  subtotalHT: 100,
  totalTTC: 120,
  shipFirstName: "Jean",
  shipLastName: "Dupont",
  shipCompany: "Ma Boutique",
  shipAddress1: "10 rue de la Paix",
  shipAddress2: null,
  shipZipCode: "75002",
  shipCity: "Paris",
  shipCountry: "France",
  clientEmail: "jean@example.com",
  clientPhone: "0102030405",
  clientCompany: "Facturation SARL",
  clientSiret: "12345678900011",
  clientVatNumber: "FR12345678900",
  items: [],
} as unknown as Awaited<ReturnType<typeof prisma.order.findUnique>>;

describe("GET /api/admin/commandes/[id]/regroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
  });

  it("refuse les non-admins avec 401", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u", role: "CLIENT" },
    } as never);
    const res = await GET(makeReq(), { params: params("ord1") });
    expect((res as unknown as Response).status).toBe(401);
  });

  it("refuse les non-connectés avec 401", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const res = await GET(makeReq(), { params: params("ord1") });
    expect((res as unknown as Response).status).toBe(401);
  });

  it("retourne 404 quand la commande est introuvable", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null as never);
    const res = await GET(makeReq(), { params: params("ord1") });
    expect((res as unknown as Response).status).toBe(404);
  });

  it("résout la catégorie via Product.reference et retourne items + adresses", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      ...baseOrder,
      items: [
        {
          id: "i1",
          productRef: "REF-A",
          productName: "Bague ajustable",
          colorName: "Doré",
          imagePath: "products/ref-a/1.jpg",
          unitPrice: 12.5,
          quantity: 3,
          createdAt: new Date(),
        },
        {
          id: "i2",
          productRef: "REF-B",
          productName: "Bracelet perles",
          colorName: null,
          imagePath: null,
          unitPrice: 5,
          quantity: 2,
          createdAt: new Date(),
        },
      ],
    } as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { reference: "REF-A", category: { name: "Bague" } },
      { reference: "REF-B", category: { name: "Bracelet" } },
    ] as never);

    const res = await GET(makeReq(), { params: params("ord1") });
    const body = await (res as unknown as Response).json();

    expect(body.orderNo).toBe("K7X9M2PH");
    expect(body.subtotalHT).toBe(100);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({
      categorie: "Bague",
      prixUnitaire: 12.5,
      quantite: 3,
      reference: "REF-A",
      name: "Bague ajustable",
      color: "Doré",
      image: "http://test/products/ref-a/1.jpg",
    });
    expect(body.items[1]).toEqual({
      categorie: "Bracelet",
      prixUnitaire: 5,
      quantite: 2,
      reference: "REF-B",
      name: "Bracelet perles",
      color: null,
      image: null,
    });
    expect(body.shipping.company).toBe("Ma Boutique");
    expect(body.shipping.city).toBe("Paris");
    expect(body.billing.company).toBe("Facturation SARL");
    expect(body.billing.siret).toBe("12345678900011");
  });

  it("fallback « Sans catégorie » si le produit n'est plus en base", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      ...baseOrder,
      items: [
        {
          id: "i1",
          productRef: "REF-DISPARU",
          unitPrice: 8,
          quantity: 1,
          createdAt: new Date(),
        },
      ],
    } as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);

    const res = await GET(makeReq(), { params: params("ord1") });
    const body = await (res as unknown as Response).json();

    expect(body.items[0].categorie).toBe("Sans catégorie");
  });

  it("n'appelle pas product.findMany quand la commande n'a aucun article", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      ...baseOrder,
      items: [],
    } as never);

    const res = await GET(makeReq(), { params: params("ord1") });
    const body = await (res as unknown as Response).json();

    expect(body.items).toEqual([]);
    expect(vi.mocked(prisma.product.findMany)).not.toHaveBeenCalled();
  });
});
