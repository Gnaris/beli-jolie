/**
 * Garde-fou : le panier doit refuser les produits qui ne sont plus ONLINE.
 *
 * Un produit archivé/hors-ligne ne doit plus pouvoir être ajouté au panier
 * via une page restée ouverte dans un onglet. Pareil pour augmenter la
 * quantité d'une ligne existante.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  cart: { findUnique: vi.fn(), create: vi.fn() },
  cartItem: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  productColor: { findUnique: vi.fn() },
}));

const mockSession = vi.hoisted(() => ({ user: { id: "user-1" } }));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addToCart, updateCartItem } from "@/app/actions/client/cart";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addToCart — refus si produit hors-ligne", () => {
  it("refuse un produit ARCHIVED", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValue({
      stock: 10,
      saleType: "UNIT",
      packQuantity: null,
      product: { status: "ARCHIVED" },
    });

    await expect(addToCart("var-1", 1)).rejects.toThrow(
      /n'est plus disponible/i,
    );
    expect(mockPrisma.cartItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.cartItem.update).not.toHaveBeenCalled();
  });

  it("refuse un produit OFFLINE", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValue({
      stock: 10,
      saleType: "UNIT",
      packQuantity: null,
      product: { status: "OFFLINE" },
    });

    await expect(addToCart("var-1", 1)).rejects.toThrow(
      /n'est plus disponible/i,
    );
  });

  it("refuse un produit SYNCING", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValue({
      stock: 10,
      saleType: "UNIT",
      packQuantity: null,
      product: { status: "SYNCING" },
    });

    await expect(addToCart("var-1", 1)).rejects.toThrow(
      /n'est plus disponible/i,
    );
  });

  it("accepte un produit ONLINE", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValue({
      stock: 10,
      saleType: "UNIT",
      packQuantity: null,
      product: { status: "ONLINE" },
    });
    mockPrisma.cart.findUnique.mockResolvedValue({ id: "cart-1" });
    mockPrisma.cartItem.findUnique.mockResolvedValue(null);

    await expect(addToCart("var-1", 1)).resolves.toBeUndefined();
    expect(mockPrisma.cartItem.create).toHaveBeenCalledOnce();
  });
});

describe("updateCartItem — refus d'augmenter si produit hors-ligne", () => {
  it("refuse d'augmenter la quantité d'un produit ARCHIVED", async () => {
    mockPrisma.cartItem.findFirst.mockResolvedValue({
      id: "ci-1",
      quantity: 1,
      variant: {
        stock: 10,
        saleType: "UNIT",
        packQuantity: null,
        product: { status: "ARCHIVED" },
      },
    });

    await expect(updateCartItem("ci-1", 2)).rejects.toThrow(
      /n'est plus disponible/i,
    );
    expect(mockPrisma.cartItem.update).not.toHaveBeenCalled();
  });

  it("autorise la suppression (qty=0) même si le produit est ARCHIVED", async () => {
    mockPrisma.cartItem.findFirst.mockResolvedValue({
      id: "ci-1",
      quantity: 2,
      variant: {
        stock: 10,
        saleType: "UNIT",
        packQuantity: null,
        product: { status: "ARCHIVED" },
      },
    });

    await expect(updateCartItem("ci-1", 0)).resolves.toBeUndefined();
    expect(mockPrisma.cartItem.delete).toHaveBeenCalledWith({
      where: { id: "ci-1" },
    });
  });

  it("autorise la mise à jour si le produit est ONLINE", async () => {
    mockPrisma.cartItem.findFirst.mockResolvedValue({
      id: "ci-1",
      quantity: 1,
      variant: {
        stock: 10,
        saleType: "UNIT",
        packQuantity: null,
        product: { status: "ONLINE" },
      },
    });

    await expect(updateCartItem("ci-1", 3)).resolves.toEqual({ quantity: 3, capped: false });
    expect(mockPrisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: "ci-1" },
      data: { quantity: 3 },
    });
  });
});
