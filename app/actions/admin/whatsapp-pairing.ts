"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { requireCurrentTenant } from "@/lib/tenant";
import { revalidatePath } from "next/cache";
import {
  disconnectWhatsappSession,
  getWhatsappSessionState,
  requestWhatsappPairingCode,
  type WhatsappSessionState,
} from "@/lib/whatsapp-session";
import { checkWhatsappNumber, type WhatsappCheckOutcome } from "@/lib/whatsapp-check";

/**
 * Server actions pour piloter la session WhatsApp **de la boutique courante**
 * depuis `/admin/parametres` → onglet « WhatsApp ».
 *
 * Chaque tenant a sa propre session Baileys isolée — une admin ne peut
 * piloter que la session de la boutique sur laquelle elle est connectée
 * (résolue via le `Host:` courant → `requireCurrentTenant()`).
 */

export interface WhatsappStatusResult {
  success: true;
  state: SerializedState;
}

interface SerializedState {
  status: WhatsappSessionState["status"];
  phoneNumber: string | null;
  pairingCode: string | null;
  pairingCodeExpiresAt: string | null;
  connectedSince: string | null;
  lastError: string | null;
}

function serialize(state: WhatsappSessionState): SerializedState {
  return {
    status: state.status,
    phoneNumber: state.phoneNumber,
    pairingCode: state.pairingCode,
    pairingCodeExpiresAt: state.pairingCodeExpiresAt?.toISOString() ?? null,
    connectedSince: state.connectedSince?.toISOString() ?? null,
    lastError: state.lastError,
  };
}

export async function getWhatsappStatus(): Promise<WhatsappStatusResult> {
  await requireAdmin();
  const { id, slug } = await requireCurrentTenant();
  return { success: true, state: serialize(getWhatsappSessionState(id, slug)) };
}

export async function startWhatsappPairing(
  phoneNumber: string,
): Promise<{ success: true; state: SerializedState } | { success: false; error: string }> {
  await requireAdmin();
  const { id, slug } = await requireCurrentTenant();
  try {
    await requestWhatsappPairingCode(id, slug, phoneNumber);
    return { success: true, state: serialize(getWhatsappSessionState(id, slug)) };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function stopWhatsappSession(): Promise<{ success: true; state: SerializedState }> {
  await requireAdmin();
  const { id, slug } = await requireCurrentTenant();
  await disconnectWhatsappSession(id, slug);
  return { success: true, state: serialize(getWhatsappSessionState(id, slug)) };
}

/**
 * Vérifie « ce client a-t-il WhatsApp ? » à la demande (clic sur l'icône orange
 * « Non vérifié »). Déclenché depuis `PhoneContactIcons`.
 *
 * - Si le résultat est ferme (yes/no), il est persisté en BDD (`User.hasWhatsapp`).
 * - `revalidatePath` sur les pages concernées pour que l'icône se mette à jour
 *   dès que la cliente navigue (en plus de l'update local côté composant).
 */
export async function verifyWhatsappForClient(
  userId: string,
  phone: string,
): Promise<{ outcome: WhatsappCheckOutcome }> {
  await requireAdmin();
  const { id, slug } = await requireCurrentTenant();
  const outcome = await checkWhatsappNumber(id, slug, phone, userId);
  if (outcome === "yes" || outcome === "no") {
    revalidatePath("/admin/clients");
    revalidatePath(`/admin/clients/${userId}`);
  }
  return { outcome };
}
