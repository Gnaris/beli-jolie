"use server";

/**
 * Server action admin pour poser / retirer le minimum de commande personnel
 * d'un client :
 *  - null = ce client suit la valeur globale (Paramètres)
 *  - 0    = aucun minimum pour ce client (VIP)
 *  - > 0  = seuil HT propre au client (permanent tant que non retiré)
 *
 * Le global est piloté par `updateMinOrderConfig` (Paramètres → Minimum
 * de commande). La résolution effective vit dans `lib/min-order.ts`.
 */
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type ActionResult = { success: true } | { success: false; error: string };

async function requireAdminSession(): Promise<ActionResult | null> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }
  return null;
}

async function assertClientEditable(userId: string): Promise<ActionResult | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) return { success: false, error: "Utilisateur introuvable." };
  if (user.role === "ADMIN") {
    return { success: false, error: "Impossible de modifier un administrateur." };
  }
  return null;
}

export interface UpdateClientMinOrderOverrideInput {
  /**
   * null   → aucune valeur perso, on applique le minimum global
   * 0      → aucun minimum pour ce client (VIP)
   * > 0    → seuil HT propre au client
   */
  minimumOrderOverrideHt: number | null;
}

export async function updateClientMinOrderOverride(
  userId: string,
  input: UpdateClientMinOrderOverrideInput,
): Promise<ActionResult> {
  const auth = await requireAdminSession();
  if (auth) return auth;
  const editable = await assertClientEditable(userId);
  if (editable) return editable;

  const raw = input.minimumOrderOverrideHt;
  if (raw != null) {
    if (!Number.isFinite(raw) || raw < 0) {
      return { success: false, error: "Le montant doit être positif ou zéro." };
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      minimumOrderOverrideHt: raw == null ? null : raw,
    },
  });

  revalidatePath(`/admin/clients/${userId}`);
  return { success: true };
}
