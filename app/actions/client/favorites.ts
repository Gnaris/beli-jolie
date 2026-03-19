"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireClient() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== "CLIENT" && session.user.role !== "ADMIN")) throw new Error("Non autorisé");
  return session.user.id;
}

export async function toggleFavorite(productId: string) {
  const userId = await requireClient();

  const existing = await prisma.favorite.findUnique({
    where: { userId_productId: { userId, productId } },
  });

  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    revalidatePath("/favoris");
    return { isFavorite: false };
  } else {
    await prisma.favorite.create({ data: { userId, productId } });

    // Increment favorites counter in activity tracking (fire-and-forget)
    prisma.userActivity.updateMany({
      where: { userId },
      data: { favAddsCount: { increment: 1 } },
    }).catch(() => {});

    revalidatePath("/favoris");
    return { isFavorite: true };
  }
}

export async function getFavoriteIds(): Promise<string[]> {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== "CLIENT" && session.user.role !== "ADMIN")) return [];
  const favorites = await prisma.favorite.findMany({
    where: { userId: session.user.id },
    select: { productId: true },
  });
  return favorites.map((f) => f.productId);
}
