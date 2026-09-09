"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Server Action — Bascule la préférence newsletter d'un client depuis l'admin
 *
 * Cas d'usage : la cliente appelle par téléphone pour se désinscrire (ou pour
 * se réinscrire). L'admin peut forcer l'état ici sans que le client se
 * connecte lui-même. RGPD : la case couvre newsletter + relances panier.
 */
export async function setUserNewsletter(userId: string, accept: boolean) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Acces non autorise.");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) throw new Error("Utilisateur introuvable.");
  if (user.role === "ADMIN") throw new Error("Impossible de modifier un administrateur.");

  await prisma.user.update({
    where: { id: userId },
    data: { acceptsNewsletter: Boolean(accept) },
  });

  revalidatePath(`/admin/clients/${userId}`);
  revalidatePath("/admin/clients");
  return { success: true, acceptsNewsletter: Boolean(accept) };
}
