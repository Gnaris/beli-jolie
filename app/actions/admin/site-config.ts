"use server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export async function updateMinOrderHT(value: number): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (value < 0) return { success: false, error: "Le montant doit être positif." };
    await prisma.siteConfig.upsert({
      where: { key: "min_order_ht" },
      update: { value: String(value) },
      create: { key: "min_order_ht", value: String(value) },
    });
    revalidatePath("/admin/parametres");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
