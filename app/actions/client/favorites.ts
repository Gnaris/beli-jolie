"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireClient() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== "CLIENT" && session.user.role !== "ADMIN")) throw new Error("Non autorisé");
  return session.user.id;
}

export async function toggleFavorite(productId: string) {
  const userId = await requireClient();

  // Toggle en 1 ou 2 requêtes max : on tente la suppression, et si rien n'a
  // été supprimé (count=0), c'est qu'il n'y avait pas de favori → on crée.
  // Évite le findUnique préalable. Pas de revalidatePath : la page favoris
  // n'est pas cachée (elle dépend de la session, recalculée à chaque visite).
  const deleted = await prisma.favorite.deleteMany({
    where: { userId, productId },
  });

  if (deleted.count > 0) {
    return { isFavorite: false };
  }

  await prisma.favorite.create({ data: { userId, productId } });
  return { isFavorite: true };
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
