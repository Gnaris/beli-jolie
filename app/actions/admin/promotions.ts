"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Acces non autorise.");
  return session;
}

export async function getPromotions() {
  await requireAdmin();

  return prisma.promotion.findMany({
    include: {
      _count: { select: { usages: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPromotion(id: string) {
  await requireAdmin();

  return prisma.promotion.findUnique({
    where: { id },
    include: {
      categories: { include: { category: { select: { id: true, name: true } } } },
      collections: { include: { collection: { select: { id: true, name: true } } } },
      products: { include: { product: { select: { id: true, name: true } } } },
      usages: {
        include: { user: { select: { firstName: true, lastName: true, company: true } }, order: { select: { orderNumber: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}

interface PromotionInput {
  name: string;
  type: "CODE" | "AUTO";
  code?: string;
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  discountValue: number;
  minOrderAmount?: number;
  maxUses?: number;
  maxUsesPerUser?: number;
  firstOrderOnly: boolean;
  appliesToAll: boolean;
  startsAt: string;
  endsAt?: string;
  categoryIds?: string[];
  collectionIds?: string[];
  productIds?: string[];
}

export async function createPromotion(input: PromotionInput) {
  await requireAdmin();

  if (!input.name.trim()) return { success: false, error: "Le nom est obligatoire." };
  if (input.type === "CODE" && !input.code?.trim()) return { success: false, error: "Le code est obligatoire." };

  try {
    const promo = await prisma.promotion.create({
      data: {
        name: input.name.trim(),
        type: input.type,
        code: input.type === "CODE" ? input.code!.toUpperCase().trim() : null,
        discountKind: input.discountKind,
        discountValue: input.discountValue,
        minOrderAmount: input.minOrderAmount || null,
        maxUses: input.maxUses || null,
        maxUsesPerUser: input.maxUsesPerUser || null,
        firstOrderOnly: input.firstOrderOnly,
        appliesToAll: input.appliesToAll,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        categories: input.categoryIds?.length
          ? { create: input.categoryIds.map((id) => ({ categoryId: id })) }
          : undefined,
        collections: input.collectionIds?.length
          ? { create: input.collectionIds.map((id) => ({ collectionId: id })) }
          : undefined,
        products: input.productIds?.length
          ? { create: input.productIds.map((id) => ({ productId: id })) }
          : undefined,
      },
    });

    revalidateTag("promotions", "default");
    return { success: true, promotionId: promo.id };
  } catch {
    return { success: false, error: "Erreur lors de la creation de la promotion." };
  }
}

export async function updatePromotion(id: string, input: PromotionInput) {
  await requireAdmin();

  try {
    // Delete existing targeting relations
    await prisma.$transaction([
      prisma.promotionCategory.deleteMany({ where: { promotionId: id } }),
      prisma.promotionCollection.deleteMany({ where: { promotionId: id } }),
      prisma.promotionProduct.deleteMany({ where: { promotionId: id } }),
    ]);

    await prisma.promotion.update({
      where: { id },
      data: {
        name: input.name.trim(),
        type: input.type,
        code: input.type === "CODE" ? input.code!.toUpperCase().trim() : null,
        discountKind: input.discountKind,
        discountValue: input.discountValue,
        minOrderAmount: input.minOrderAmount || null,
        maxUses: input.maxUses || null,
        maxUsesPerUser: input.maxUsesPerUser || null,
        firstOrderOnly: input.firstOrderOnly,
        appliesToAll: input.appliesToAll,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        categories: input.categoryIds?.length
          ? { create: input.categoryIds.map((cid) => ({ categoryId: cid })) }
          : undefined,
        collections: input.collectionIds?.length
          ? { create: input.collectionIds.map((cid) => ({ collectionId: cid })) }
          : undefined,
        products: input.productIds?.length
          ? { create: input.productIds.map((pid) => ({ productId: pid })) }
          : undefined,
      },
    });

    revalidateTag("promotions", "default");
    return { success: true };
  } catch {
    return { success: false, error: "Erreur lors de la mise a jour de la promotion." };
  }
}

export async function togglePromotion(id: string) {
  await requireAdmin();

  const promo = await prisma.promotion.findUnique({ where: { id }, select: { isActive: true } });
  if (!promo) return { success: false, error: "Promotion introuvable." };

  await prisma.promotion.update({
    where: { id },
    data: { isActive: !promo.isActive },
  });

  revalidateTag("promotions", "default");
  return { success: true };
}
