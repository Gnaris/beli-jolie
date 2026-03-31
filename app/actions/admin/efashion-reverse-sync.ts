"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncProductToEfashion } from "@/lib/efashion-reverse-sync";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export async function forceEfashionSync(
  productId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await syncProductToEfashion(productId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
