"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────

async function requireClient() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Non authentifié.");
  return session.user.id;
}

/** Récupère ou crée le panier de l'utilisateur */
async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId } });
}

// ─────────────────────────────────────────────
// Lecture du panier (données complètes)
// ─────────────────────────────────────────────

export async function getCart() {
  const userId = await requireClient();

  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          saleOption: {
            include: {
              productColor: {
                include: {
                  product: {
                    include: {
                      category: true,
                    },
                  },
                  color: true,
                  images: { orderBy: { order: "asc" }, take: 1 },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return cart;
}

// ─────────────────────────────────────────────
// Nombre total d'articles (pour badge Navbar)
// ─────────────────────────────────────────────

export async function getCartCount(): Promise<number> {
  const session = await getServerSession(authOptions);
  if (!session) return 0;

  const cart = await prisma.cart.findUnique({
    where: { userId: session.user.id },
    include: { items: { select: { quantity: true } } },
  });

  if (!cart) return 0;
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

// ─────────────────────────────────────────────
// Ajouter / incrémenter un article
// ─────────────────────────────────────────────

export async function addToCart(saleOptionId: string, quantity: number = 1) {
  const userId = await requireClient();
  const cart = await getOrCreateCart(userId);

  const existing = await prisma.cartItem.findUnique({
    where: { cartId_saleOptionId: { cartId: cart.id, saleOptionId } },
  });

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity },
    });
  } else {
    await prisma.cartItem.create({
      data: { cartId: cart.id, saleOptionId, quantity },
    });
  }

  revalidatePath("/panier");
}

// ─────────────────────────────────────────────
// Modifier la quantité d'une ligne
// ─────────────────────────────────────────────

export async function updateCartItem(cartItemId: string, quantity: number) {
  const userId = await requireClient();

  // Vérifier que l'item appartient bien à l'utilisateur
  const item = await prisma.cartItem.findFirst({
    where: { id: cartItemId, cart: { userId } },
  });
  if (!item) throw new Error("Article introuvable.");

  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: cartItemId } });
  } else {
    await prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity },
    });
  }

  revalidatePath("/panier");
}

// ─────────────────────────────────────────────
// Supprimer une ligne du panier
// ─────────────────────────────────────────────

export async function removeFromCart(cartItemId: string) {
  const userId = await requireClient();

  const item = await prisma.cartItem.findFirst({
    where: { id: cartItemId, cart: { userId } },
  });
  if (!item) throw new Error("Article introuvable.");

  await prisma.cartItem.delete({ where: { id: cartItemId } });
  revalidatePath("/panier");
}

// ─────────────────────────────────────────────
// Vider le panier
// ─────────────────────────────────────────────

export async function clearCart() {
  const userId = await requireClient();

  const cart = await prisma.cart.findUnique({ where: { userId } });
  if (!cart) return;

  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  revalidatePath("/panier");
}

// ─────────────────────────────────────────────
// Adresses de livraison
// ─────────────────────────────────────────────

export async function getShippingAddresses() {
  const userId = await requireClient();
  return prisma.shippingAddress.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function saveShippingAddress(data: {
  id?: string;
  label: string;
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  zipCode: string;
  city: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
}) {
  const userId = await requireClient();

  // Si marquée comme défaut, retirer le défaut des autres
  if (data.isDefault) {
    await prisma.shippingAddress.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
  }

  if (data.id) {
    // Mise à jour
    const addr = await prisma.shippingAddress.findFirst({
      where: { id: data.id, userId },
    });
    if (!addr) throw new Error("Adresse introuvable.");

    return prisma.shippingAddress.update({
      where: { id: data.id },
      data: {
        label:     data.label,
        firstName: data.firstName,
        lastName:  data.lastName,
        company:   data.company ?? null,
        address1:  data.address1,
        address2:  data.address2 ?? null,
        zipCode:   data.zipCode,
        city:      data.city,
        country:   data.country,
        phone:     data.phone ?? null,
        isDefault: data.isDefault ?? false,
      },
    });
  }

  // Création
  return prisma.shippingAddress.create({
    data: {
      userId,
      label:     data.label,
      firstName: data.firstName,
      lastName:  data.lastName,
      company:   data.company ?? null,
      address1:  data.address1,
      address2:  data.address2 ?? null,
      zipCode:   data.zipCode,
      city:      data.city,
      country:   data.country,
      phone:     data.phone ?? null,
      isDefault: data.isDefault ?? false,
    },
  });
}

export async function deleteShippingAddress(addressId: string) {
  const userId = await requireClient();
  const addr = await prisma.shippingAddress.findFirst({
    where: { id: addressId, userId },
  });
  if (!addr) throw new Error("Adresse introuvable.");
  await prisma.shippingAddress.delete({ where: { id: addressId } });
}
