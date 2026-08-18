"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import { validatePromotionInput } from "@/lib/promotion-validation";
import type { PromotionScope } from "@prisma/client";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
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
      products: { include: { product: { select: { id: true, name: true, reference: true } } } },
      usages: {
        include: {
          user: { select: { firstName: true, lastName: true, company: true } },
          order: { select: { orderNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}

/**
 * Listes pour alimenter les pickers Produits / Catégories / Collections
 * dans le formulaire de création/édition. Retourne des shapes légers.
 */
export async function getPromotionTargets() {
  await requireAdmin();

  const [products, categories, collections] = await Promise.all([
    prisma.product.findMany({
      where: { status: { in: ["ONLINE", "OFFLINE"] } },
      select: { id: true, name: true, reference: true },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.collection.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { products, categories, collections };
}

export interface PromotionInput {
  name: string;
  type: "CODE" | "AUTO";
  code?: string;
  scope: PromotionScope;
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  minOrderAmount?: number;
  maxUses?: number;
  maxUsesPerUser?: number;
  firstOrderOnly: boolean;
  stackable: boolean;
  startsAt: string;
  endsAt?: string;
  categoryIds?: string[];
  collectionIds?: string[];
  productIds?: string[];
}

/**
 * Refuse la création/màj d'une deuxième promo AUTO active dont la portée globale
 * empêcherait de savoir laquelle appliquer (ALL_PRODUCTS ou SHIPPING).
 * Les scopes ciblés (PRODUCTS/CATEGORIES/COLLECTIONS) peuvent coexister — le
 * moteur départage par « la meilleure gagne ».
 */
async function ensureNoConflictingAutoPromo(
  input: PromotionInput,
  excludeId: string | null,
): Promise<string | null> {
  if (input.type !== "AUTO") return null;
  if (input.scope !== "ALL_PRODUCTS" && input.scope !== "SHIPPING") return null;

  const existing = await prisma.promotion.findFirst({
    where: {
      type: "AUTO",
      scope: input.scope,
      isActive: true,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (!existing) return null;

  const label = input.scope === "ALL_PRODUCTS"
    ? "sur tous les produits"
    : "sur la livraison";
  return `Une autre promotion automatique ${label} est déjà active (« ${existing.name} »). Désactivez-la d'abord ou changez la portée.`;
}

/**
 * Résout le tenant courant et refuse si absent — les promos sont scopées par
 * tenant (index composite (tenantId, code)).
 *
 * Passe par `requireCurrentTenant()` qui lit le header `x-tenant-id` posé par
 * le middleware ET bind l'ALS. Un appel à `getCurrentTenantIdSync()` ne suffit
 * PAS dans une server action (ALS pas encore bindée avant le premier fetch).
 */
async function requireTenantId(): Promise<string> {
  const { requireCurrentTenant } = await import("@/lib/tenant");
  const tenant = await requireCurrentTenant();
  return tenant.id;
}

function validateScopeTargets(input: PromotionInput): string | null {
  if (input.scope === "PRODUCTS" && !(input.productIds?.length)) {
    return "Sélectionnez au moins un produit ciblé.";
  }
  if (input.scope === "CATEGORIES" && !(input.categoryIds?.length)) {
    return "Sélectionnez au moins une catégorie ciblée.";
  }
  if (input.scope === "COLLECTIONS" && !(input.collectionIds?.length)) {
    return "Sélectionnez au moins une collection ciblée.";
  }
  return null;
}

export async function createPromotion(input: PromotionInput) {
  await requireAdmin();

  if (!input.name.trim()) return { success: false, error: "Le nom est obligatoire." };
  if (input.type === "CODE" && !input.code?.trim()) return { success: false, error: "Le code est obligatoire." };

  const boundsError = validatePromotionInput(input);
  if (boundsError) return { success: false, error: boundsError };

  const targetError = validateScopeTargets(input);
  if (targetError) return { success: false, error: targetError };

  const conflict = await ensureNoConflictingAutoPromo(input, null);
  if (conflict) return { success: false, error: conflict };

  const tenantId = await requireTenantId();

  // Vérif code unique par tenant (Prisma renverra P2002 sinon, on veut un message clair)
  if (input.type === "CODE" && input.code) {
    const existing = await prisma.promotion.findFirst({
      where: { tenantId, code: input.code.toUpperCase().trim() },
      select: { id: true },
    });
    if (existing) return { success: false, error: "Un code identique existe déjà." };
  }

  try {
    const promo = await prisma.promotion.create({
      data: {
        name: input.name.trim(),
        type: input.type,
        code: input.type === "CODE" ? input.code!.toUpperCase().trim() : null,
        scope: input.scope,
        appliesToAll: input.scope === "ALL_PRODUCTS",
        discountKind: input.discountKind,
        discountValue: input.discountValue,
        minOrderAmount: input.minOrderAmount || null,
        maxUses: input.maxUses || null,
        maxUsesPerUser: input.maxUsesPerUser || null,
        firstOrderOnly: input.firstOrderOnly,
        stackable: input.stackable,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        categories: input.scope === "CATEGORIES" && input.categoryIds?.length
          ? { create: input.categoryIds.map((id) => ({ categoryId: id })) }
          : undefined,
        collections: input.scope === "COLLECTIONS" && input.collectionIds?.length
          ? { create: input.collectionIds.map((id) => ({ collectionId: id })) }
          : undefined,
        products: input.scope === "PRODUCTS" && input.productIds?.length
          ? { create: input.productIds.map((id) => ({ productId: id })) }
          : undefined,
      },
    });

    revalidateTag("promotions", "default");
    return { success: true, promotionId: promo.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Erreur lors de la création : ${msg}` };
  }
}

export async function updatePromotion(id: string, input: PromotionInput) {
  await requireAdmin();

  const boundsError = validatePromotionInput(input);
  if (boundsError) return { success: false, error: boundsError };

  const targetError = validateScopeTargets(input);
  if (targetError) return { success: false, error: targetError };

  const conflict = await ensureNoConflictingAutoPromo(input, id);
  if (conflict) return { success: false, error: conflict };

  const tenantId = await requireTenantId();

  if (input.type === "CODE" && input.code) {
    const existing = await prisma.promotion.findFirst({
      where: { tenantId, code: input.code.toUpperCase().trim(), NOT: { id } },
      select: { id: true },
    });
    if (existing) return { success: false, error: "Un code identique existe déjà." };
  }

  try {
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
        scope: input.scope,
        appliesToAll: input.scope === "ALL_PRODUCTS",
        discountKind: input.discountKind,
        discountValue: input.discountValue,
        minOrderAmount: input.minOrderAmount || null,
        maxUses: input.maxUses || null,
        maxUsesPerUser: input.maxUsesPerUser || null,
        firstOrderOnly: input.firstOrderOnly,
        stackable: input.stackable,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        categories: input.scope === "CATEGORIES" && input.categoryIds?.length
          ? { create: input.categoryIds.map((cid) => ({ categoryId: cid })) }
          : undefined,
        collections: input.scope === "COLLECTIONS" && input.collectionIds?.length
          ? { create: input.collectionIds.map((cid) => ({ collectionId: cid })) }
          : undefined,
        products: input.scope === "PRODUCTS" && input.productIds?.length
          ? { create: input.productIds.map((pid) => ({ productId: pid })) }
          : undefined,
      },
    });

    revalidateTag("promotions", "default");
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Erreur lors de la mise à jour : ${msg}` };
  }
}

export async function togglePromotion(id: string) {
  await requireAdmin();

  const promo = await prisma.promotion.findUnique({
    where: { id },
    select: { isActive: true, type: true, scope: true, name: true },
  });
  if (!promo) return { success: false, error: "Promotion introuvable." };

  const nextActive = !promo.isActive;

  // À la réactivation, on refait le garde-fou "1 seule AUTO ALL_PRODUCTS/SHIPPING"
  if (nextActive && promo.type === "AUTO" && (promo.scope === "ALL_PRODUCTS" || promo.scope === "SHIPPING")) {
    const other = await prisma.promotion.findFirst({
      where: {
        type: "AUTO",
        scope: promo.scope,
        isActive: true,
        NOT: { id },
      },
      select: { name: true },
    });
    if (other) {
      const label = promo.scope === "ALL_PRODUCTS" ? "sur tous les produits" : "sur la livraison";
      return {
        success: false,
        error: `Impossible d'activer : « ${other.name} » est déjà active ${label}.`,
      };
    }
  }

  await prisma.promotion.update({
    where: { id },
    data: { isActive: nextActive },
  });

  revalidateTag("promotions", "default");
  return { success: true };
}

export async function deletePromotion(id: string) {
  await requireAdmin();
  await prisma.promotion.delete({ where: { id } });
  revalidateTag("promotions", "default");
  return { success: true };
}
