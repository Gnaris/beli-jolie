"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { UserStatus } from "@prisma/client";

/**
 * Server Action — Mise à jour du statut d'un compte client
 *
 * Sécurité : vérifie côté serveur que l'appelant est bien ADMIN
 * Utilisée depuis la page /admin/utilisateurs/[id]
 *
 * @param userId  - ID de l'utilisateur à mettre à jour
 * @param status  - Nouveau statut : APPROVED ou REJECTED
 */
export async function updateUserStatus(userId: string, status: UserStatus) {
  // Double vérification de sécurité côté serveur
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }

  // Vérification que l'utilisateur existe
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    throw new Error("Utilisateur introuvable.");
  }

  // On ne peut pas modifier le statut d'un autre admin
  if (user.role === "ADMIN") {
    throw new Error("Impossible de modifier le statut d'un administrateur.");
  }

  // Mise à jour du statut
  await prisma.user.update({
    where: { id: userId },
    data: { status },
  });

  // Revalidation du cache des pages admin concernées
  revalidatePath("/admin/utilisateurs");
  revalidatePath(`/admin/utilisateurs/${userId}`);
  revalidatePath("/admin");

  // Redirection vers la liste
  redirect("/admin/utilisateurs");
}
