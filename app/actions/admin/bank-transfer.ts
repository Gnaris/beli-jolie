"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfSensitive } from "@/lib/encryption";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import { logger } from "@/lib/logger";
import { isPlausibleIban, normalizeIban } from "@/lib/bank-transfer-config";
import { notifyOrderStatusChange } from "@/lib/notifications";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Non autorisé.");
  }
  return session;
}

export interface BankTransferConfigInput {
  enabled: boolean;
  holder: string;
  iban: string;
}

/**
 * Persiste la configuration virement bancaire (par tenant).
 * IBAN normalisé + chiffré via SENSITIVE_KEYS.
 * Si `enabled=true` mais titulaire ou IBAN vide → refus (garde-fou UI).
 */
export async function setBankTransferConfig(
  input: BankTransferConfigInput,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const holder = input.holder.trim();
    const iban = normalizeIban(input.iban);

    if (input.enabled) {
      if (!holder) return { success: false, error: "Le titulaire du compte est obligatoire." };
      if (!iban) return { success: false, error: "L'IBAN est obligatoire." };
      if (!isPlausibleIban(iban)) {
        return { success: false, error: "Format d'IBAN invalide. Vérifiez la saisie." };
      }
    }

    // Titulaire : en clair. IBAN : chiffré (SENSITIVE_KEYS).
    if (holder) {
      await setSiteConfig("bank_transfer_holder", holder);
    } else {
      await unsetSiteConfig("bank_transfer_holder");
    }

    if (iban) {
      const stored = encryptIfSensitive("bank_transfer_iban", iban);
      await setSiteConfig("bank_transfer_iban", stored);
    } else {
      await unsetSiteConfig("bank_transfer_iban");
    }

    await setSiteConfig("bank_transfer_enabled", input.enabled ? "1" : "0");

    revalidateTag("site-config", "default");
    revalidatePath("/admin/parametres");

    return { success: true };
  } catch (e) {
    logger.error("[setBankTransferConfig] Erreur", { error: e });
    return { success: false, error: e instanceof Error ? e.message : "Erreur." };
  }
}

/**
 * Marque un virement bancaire comme reçu.
 * - Refuse si la commande n'est pas en mode virement ou si déjà payée.
 * - Passe `paymentStatus` à "paid" + horodate + trace l'admin.
 * - Envoie l'email de confirmation client (fire-and-forget).
 */
export async function confirmBankTransfer(
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireAdmin();
    const adminId = session.user.id;

    const order = await prisma.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        paymentMode: true,
        orderNumber: true,
      },
    });
    if (!order) return { success: false, error: "Commande introuvable." };
    if (order.paymentMode !== "BANK_TRANSFER") {
      return { success: false, error: "Cette commande n'est pas un paiement par virement." };
    }
    if (order.paymentStatus === "paid") {
      return { success: false, error: "Le paiement a déjà été confirmé." };
    }
    if (order.status === "CANCELLED") {
      return { success: false, error: "Cette commande est annulée." };
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: "paid",
        bankTransferConfirmedAt: new Date(),
        bankTransferConfirmedBy: adminId,
      },
    });

    logger.info("[confirmBankTransfer] Virement confirmé", {
      orderId,
      orderNumber: order.orderNumber,
      adminId,
    });

    // Email « virement reçu, commande en préparation » (fire-and-forget).
    notifyOrderStatusChange({
      orderId,
      newStatus: "BANK_TRANSFER_CONFIRMED",
    }).catch((err) =>
      logger.error("[confirmBankTransfer] Email client error", { error: err }),
    );

    revalidatePath("/admin/commandes");
    revalidatePath(`/admin/commandes/${orderId}`);
    revalidatePath("/commandes");
    revalidatePath(`/commandes/${orderId}`);

    return { success: true };
  } catch (e) {
    logger.error("[confirmBankTransfer] Erreur", { error: e });
    return { success: false, error: e instanceof Error ? e.message : "Erreur." };
  }
}
