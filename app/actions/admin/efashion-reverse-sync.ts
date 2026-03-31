"use server";

import { requireAdmin } from "@/lib/auth";
import { syncProductToEfashion } from "@/lib/efashion-reverse-sync";

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
