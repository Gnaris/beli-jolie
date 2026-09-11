import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Aperçu du panier réel d'un client dans l'éditeur newsletter.
 * On s'assure que la lecture BDD passe bien par le tenant courant et que le
 * filtre ONLINE + stock effectif > 0 est appliqué (même règle que le worker
 * de relance panier abandonné).
 */

const TENANT_ID = "tenant_bj";

interface CartItem {
  quantity: number;
  variant: {
    unitPrice: unknown;
    stock: number;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    color: { name: string | null } | null;
    product: { name: string; status: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING" };
    images: { path: string }[];
  };
}

const cartByUser = new Map<string, CartItem[]>();
let lastWhere: unknown = null;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cart: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; user?: { tenantId?: string } } }) => {
        lastWhere = where;
        const items = cartByUser.get(where.userId);
        if (!items) return null;
        return { items };
      }),
    },
  },
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({
    session: { user: { id: "admin_1", role: "ADMIN" } },
    tenant: { id: TENANT_ID, slug: "bj", name: "BJ" },
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getClientCartPreview } from "@/app/actions/admin/newsletter-templates";

beforeEach(() => {
  cartByUser.clear();
  lastWhere = null;
});

describe("getClientCartPreview", () => {
  it("scope la lecture au tenant courant via user.tenantId", async () => {
    await getClientCartPreview("u1");
    expect(lastWhere).toMatchObject({ userId: "u1", user: { tenantId: TENANT_ID } });
  });

  it("retourne un panier vide si le client n'a pas de Cart", async () => {
    const res = await getClientCartPreview("u1");
    expect(res).toEqual({ items: [], totalCents: 0 });
  });

  it("mappe les items ONLINE avec stock > 0 et calcule les totaux en centimes", async () => {
    cartByUser.set("u1", [
      {
        quantity: 2,
        variant: {
          unitPrice: 15.5,
          stock: 10,
          saleType: "UNIT",
          packQuantity: null,
          color: { name: "Rouge" },
          product: { name: "Bracelet", status: "ONLINE" },
          images: [{ path: "/uploads/tenant/prod/img1.webp" }],
        },
      },
    ]);
    const res = await getClientCartPreview("u1");
    expect(res.items).toEqual([
      {
        productName: "Bracelet",
        colorName: "Rouge",
        quantity: 2,
        totalCents: 3100,
        imagePath: "/uploads/tenant/prod/img1.webp",
      },
    ]);
    expect(res.totalCents).toBe(3100);
  });

  it("exclut les items produit non ONLINE", async () => {
    cartByUser.set("u1", [
      {
        quantity: 1,
        variant: {
          unitPrice: 10,
          stock: 5,
          saleType: "UNIT",
          packQuantity: null,
          color: null,
          product: { name: "Offline", status: "OFFLINE" },
          images: [],
        },
      },
      {
        quantity: 1,
        variant: {
          unitPrice: 20,
          stock: 5,
          saleType: "UNIT",
          packQuantity: null,
          color: null,
          product: { name: "Online", status: "ONLINE" },
          images: [],
        },
      },
    ]);
    const res = await getClientCartPreview("u1");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].productName).toBe("Online");
    expect(res.totalCents).toBe(2000);
  });

  it("exclut les packs dont le stock effectif est nul (stock/packQty < 1)", async () => {
    cartByUser.set("u1", [
      {
        quantity: 1,
        variant: {
          unitPrice: 30,
          stock: 3,
          saleType: "PACK",
          packQuantity: 4, // stock effectif = floor(3/4) = 0
          color: null,
          product: { name: "PackKO", status: "ONLINE" },
          images: [],
        },
      },
      {
        quantity: 1,
        variant: {
          unitPrice: 30,
          stock: 8,
          saleType: "PACK",
          packQuantity: 4, // stock effectif = 2
          color: null,
          product: { name: "PackOK", status: "ONLINE" },
          images: [],
        },
      },
    ]);
    const res = await getClientCartPreview("u1");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].productName).toBe("PackOK");
  });
});
