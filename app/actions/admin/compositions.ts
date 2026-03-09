"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

export async function createComposition(formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  await prisma.composition.create({ data: { name } });
  revalidatePath("/admin/compositions");
}

export async function updateComposition(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");
  await prisma.composition.update({ where: { id }, data: { name } });
  revalidatePath("/admin/compositions");
}

export async function deleteComposition(id: string) {
  await requireAdmin();
  const used = await prisma.productComposition.count({ where: { compositionId: id } });
  if (used > 0) throw new Error("Cette composition est utilisée par des produits.");
  await prisma.composition.delete({ where: { id } });
  revalidatePath("/admin/compositions");
}
