"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  createEasyExpressShipment,
  fetchEasyExpressRates,
  splitWeightIntoParcels,
  MAX_PARCEL_WEIGHT_KG,
} from "@/lib/easy-express";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

interface ShippingResult {
  success: boolean;
  error?: string;
  trackingId?: string | null;
  labelUrl?: string | null;
  /**
   * Liste des transporteurs disponibles renvoyée par Easy-Express, à afficher
   * à l'admin si le transporteur initialement choisi par le client n'existe
   * plus dans la nouvelle cotation. L'admin peut alors en choisir un autre.
   */
  availableCarriers?: { id: string; name: string; price: number; delay: string }[];
  /** transactionId à renvoyer si l'admin choisit un autre transporteur. */
  transactionId?: string;
}

/**
 * Calcule le poids total d'une commande à partir de ses items + variantes liées.
 * Utilisé pour la cotation Easy-Express différée côté admin.
 */
async function computeOrderWeightKg(orderId: string): Promise<number> {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { quantity: true, variantSnapshot: true },
  });

  let total = 0;
  for (const item of items) {
    let weightPerUnit = 0;
    let packQty = 1;
    if (item.variantSnapshot) {
      try {
        const snap = JSON.parse(item.variantSnapshot) as {
          weight?: number;
          saleType?: string;
          packQuantity?: number;
        };
        weightPerUnit = Number(snap.weight ?? 0);
        if (snap.saleType === "PACK" && snap.packQuantity) {
          packQty = Number(snap.packQuantity);
        }
      } catch {
        // Snapshot illisible : on retombe à 0 pour cet item.
      }
    }
    total += weightPerUnit * packQty * item.quantity;
  }
  return Math.max(1, total);
}

/**
 * Génère le bordereau Easy-Express pour une commande déjà créée.
 *
 * Workflow :
 *   1. Récupère la commande
 *   2. Refait une cotation Easy-Express (le transactionId initial a expiré)
 *   3. Cherche le transporteur dont le nom correspond à celui choisi par le client
 *   4. Si trouvé : appelle le checkout, stocke trackingId + labelUrl
 *   5. Si pas trouvé : renvoie la liste à jour pour que l'admin choisisse
 *
 * Pour forcer un transporteur précis, passer `overrideCarrierId` (et le
 * `overrideTransactionId` correspondant qui vient du même appel /rates).
 */
export async function generateShipmentLabel(
  orderId: string,
  override?: { carrierId: string; transactionId: string },
): Promise<ShippingResult> {
  await requireAdmin();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      carrierName: true,
      shipFirstName: true,
      shipLastName: true,
      shipCompany: true,
      shipAddress1: true,
      shipAddress2: true,
      shipZipCode: true,
      shipCity: true,
      shipCountry: true,
      clientEmail: true,
      clientPhone: true,
    },
  });

  if (!order) return { success: false, error: "Commande introuvable." };

  const weightKg = await computeOrderWeightKg(orderId);

  // Mode override : l'admin a explicitement choisi un transporteur
  if (override) {
    return await runCheckout(order, weightKg, override.transactionId, override.carrierId);
  }

  // Mode normal : refaire une cotation et matcher par nom
  const rates = await fetchEasyExpressRates({
    receiverCountry: order.shipCountry,
    receiverZipCode: order.shipZipCode,
    weightKg,
  });

  if (!rates.success) {
    return { success: false, error: rates.error };
  }

  if (rates.carriers.length === 0) {
    return {
      success: false,
      error: "Aucun transporteur Easy-Express ne dessert ce pays.",
    };
  }

  const targetName = order.carrierName.trim().toLowerCase();
  const match = rates.carriers.find(
    (c) => c.name.trim().toLowerCase() === targetName,
  );

  if (!match) {
    // Le transporteur initial n'est plus dispo : renvoyer la liste à l'admin
    return {
      success: false,
      error:
        `Le transporteur initialement choisi (« ${order.carrierName} ») n'est plus disponible. ` +
        "Sélectionnez-en un autre dans la liste.",
      transactionId: rates.transactionId,
      availableCarriers: rates.carriers.map((c) => ({
        id: c.carrierId,
        name: c.name,
        price: c.price,
        delay: c.delay,
      })),
    };
  }

  return await runCheckout(order, weightKg, rates.transactionId, match.carrierId);
}

interface OrderForCheckout {
  id: string;
  orderNumber: string;
  shipFirstName: string;
  shipLastName: string;
  shipCompany: string | null;
  shipAddress1: string;
  shipAddress2: string | null;
  shipZipCode: string;
  shipCity: string;
  shipCountry: string;
  clientEmail: string;
  clientPhone: string;
}

async function runCheckout(
  order: OrderForCheckout,
  weightKg: number,
  transactionId: string,
  carrierId: string,
): Promise<ShippingResult> {
  // Garde-fou : Easy-Express plafonne le poids par colis (cf. splitWeightIntoParcels).
  const parcels = splitWeightIntoParcels(weightKg);
  if (parcels.length === 0) {
    return {
      success: false,
      error: `Poids invalide pour Easy-Express (limite ${MAX_PARCEL_WEIGHT_KG} kg / colis).`,
    };
  }

  const result = await createEasyExpressShipment({
    transactionId,
    carrierId,
    orderNumber: order.orderNumber,
    weightKg,
    toFirstName: order.shipFirstName,
    toLastName: order.shipLastName,
    toCompany: order.shipCompany,
    toEmail: order.clientEmail,
    toAddress1: order.shipAddress1,
    toAddress2: order.shipAddress2,
    toZipCode: order.shipZipCode,
    toCity: order.shipCity,
    toCountry: order.shipCountry,
    toPhone: order.clientPhone,
  });

  if (!result.success) {
    logger.warn("[generateShipmentLabel] Easy-Express checkout failed", {
      orderId: order.id,
      error: result.error,
    });
    return { success: false, error: result.error };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      eeTrackingId: result.trackingId,
      eeLabelUrl: result.labelUrl,
    },
  });

  revalidatePath(`/admin/commandes/${order.id}`);
  revalidatePath("/admin/commandes");

  return {
    success: true,
    trackingId: result.trackingId,
    labelUrl: result.labelUrl,
  };
}

/**
 * Saisie manuelle du suivi : utilisé quand l'admin a généré le bordereau
 * en dehors de notre système (portail Easy-Express direct, autre service…)
 * et veut juste enregistrer le numéro de suivi + le nom du transporteur.
 *
 * Met `eeLabelUrl` à null parce qu'on n'a pas de PDF récupérable.
 */
export async function setManualShipping(
  orderId: string,
  input: { carrierName: string; trackingId: string },
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const carrierName = input.carrierName.trim();
  const trackingId = input.trackingId.trim();

  if (!carrierName) return { success: false, error: "Nom du transporteur requis." };
  if (!trackingId) return { success: false, error: "Numéro de suivi requis." };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!order) return { success: false, error: "Commande introuvable." };

  await prisma.order.update({
    where: { id: orderId },
    data: {
      carrierName,
      eeTrackingId: trackingId,
      eeLabelUrl: null,
    },
  });

  revalidatePath(`/admin/commandes/${orderId}`);
  revalidatePath("/admin/commandes");

  return { success: true };
}

/**
 * Réinitialise le suivi (retire le numéro et l'URL du bordereau).
 * Sert quand l'admin s'est trompé et veut recommencer.
 */
export async function clearShipping(
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!order) return { success: false, error: "Commande introuvable." };

  await prisma.order.update({
    where: { id: orderId },
    data: {
      eeTrackingId: null,
      eeLabelUrl: null,
    },
  });

  revalidatePath(`/admin/commandes/${orderId}`);
  revalidatePath("/admin/commandes");

  return { success: true };
}
