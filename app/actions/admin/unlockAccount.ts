"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Server Action — Débloque un compte verrouillé (supprime le lockout).
 * Réservée aux admins.
 */
export async function unlockAccount(email: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }

  const normalizedEmail = email.toLowerCase().trim();

  await prisma.accountLockout.deleteMany({
    where: { email: normalizedEmail },
  });

  revalidatePath("/admin/utilisateurs");
  return { success: true };
}
