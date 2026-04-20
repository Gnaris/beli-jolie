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
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  reference: true,
                  status: true,
                  discountPercent: true,
                  category: { select: { name: true } },
                },
              },
              color: { select: { id: true, name: true, hex: true } },
              subColors: { orderBy: { position: "asc" }, select: { color: { select: { name: true } } } },
              variantSizes: { select: { size: { select: { name: true } }, quantity: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!cart) return null;

  // Fetch images per (productId, colorId) pair
  const pairs = [
    ...new Map(
      cart.items
        .filter((item) => item.variant.colorId != null)
        .map((item) => [
          `${item.variant.productId}__${item.variant.colorId}`,
          { productId: item.variant.productId, colorId: item.variant.colorId! },
        ])
    ).values(),
  ];

  const images = pairs.length > 0 ? await prisma.productColorImage.findMany({
    where: {
      OR: pairs.map((p) => ({ productId: p.productId, colorId: p.colorId })),
    },
    orderBy: { order: "asc" },
    select: { productId: true, colorId: true, path: true, order: true },
  }) : [];

  // Group images by "productId__colorId"
  const imagesByKey = new Map<string, typeof images>();
  for (const img of images) {
    const key = `${img.productId}__${img.colorId}`;
    const list = imagesByKey.get(key) ?? [];
    list.push(img);
    imagesByKey.set(key, list);
  }

  // Attach first image to each item + transform variantSizes → sizes
  const itemsWithImages = cart.items.map((item) => {
    const key = `${item.variant.productId}__${item.variant.colorId}`;
    const imgs = imagesByKey.get(key) ?? [];
    const { variantSizes, ...variantRest } = item.variant;
    return {
      ...item,
      variant: {
        ...variantRest,
        sizes: (variantSizes ?? []).map((vs) => ({ name: vs.size.name, quantity: vs.quantity })),
      },
      variantImages: imgs,
    };
  });

  return { ...cart, items: itemsWithImages };
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

export async function addToCart(variantId: string, quantity: number = 1) {
  const userId = await requireClient();

  // Validate stock before adding
  const variant = await prisma.productColor.findUnique({
    where: { id: variantId },
    select: { stock: true, saleType: true, packQuantity: true },
  });
  if (!variant) throw new Error("Variante introuvable.");

  const effectiveStock = variant.saleType === "PACK" && variant.packQuantity
    ? Math.floor(variant.stock / variant.packQuantity)
    : variant.stock;

  if (effectiveStock <= 0) throw new Error("Ce produit est en rupture de stock.");

  const cart = await getOrCreateCart(userId);

  const existing = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
  });

  const newQty = (existing?.quantity ?? 0) + quantity;
  if (newQty > effectiveStock) {
    throw new Error(`Stock insuffisant. Disponible : ${effectiveStock}.`);
  }

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: newQty },
    });
  } else {
    await prisma.cartItem.create({
      data: { cartId: cart.id, variantId, quantity },
    });
  }

  // Increment cart adds counter in activity tracking (fire-and-forget)
  prisma.userActivity.updateMany({
    where: { userId },
    data: { cartAddsCount: { increment: 1 } },
  }).catch(() => {});

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
    include: { variant: { select: { stock: true, saleType: true, packQuantity: true } } },
  });
  if (!item) throw new Error("Article introuvable.");

  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: cartItemId } });
  } else {
    const v = item.variant;
    const effectiveStock = v.saleType === "PACK" && v.packQuantity
      ? Math.floor(v.stock / v.packQuantity)
      : v.stock;
    if (quantity > effectiveStock) {
      throw new Error(`Stock insuffisant. Disponible : ${effectiveStock}.`);
    }
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
