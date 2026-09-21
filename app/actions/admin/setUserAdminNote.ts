"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Server Action — Note interne libre saisie par l'admin sur la fiche client.
 * Max 2000 caractères, vide = null (nettoie la ligne en BDD).
 */
export async function setUserAdminNote(
  userId: string,
  note: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  const trimmed = note.trim();
  if (trimmed.length > 2000) {
    return { success: false, error: "Note trop longue (max 2000 caractères)." };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) return { success: false, error: "Utilisateur introuvable." };
  if (user.role === "ADMIN") {
    return { success: false, error: "Impossible de modifier un administrateur." };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { adminNote: trimmed || null },
  });

  revalidatePath(`/admin/clients/${userId}`);
  return { success: true };
}
