"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import {
  disconnectWhatsappSession,
  getWhatsappSessionState,
  requestWhatsappPairingCode,
  type WhatsappSessionState,
} from "@/lib/whatsapp-session";
import { checkWhatsappNumber, type WhatsappCheckOutcome } from "@/lib/whatsapp-check";

/**
 * Server actions pour piloter la session WhatsApp partagée depuis
 * `/admin/parametres` → onglet « WhatsApp ».
 *
 * Session UNIQUE pour tous les tenants (BJ + Issyma) — pas de scoping tenant
 * sur ces actions ; `requireAdmin()` suffit (toute admin peut piloter la
 * session partagee).
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
  return { success: true, state: serialize(getWhatsappSessionState()) };
}

export async function startWhatsappPairing(
  phoneNumber: string,
): Promise<{ success: true; state: SerializedState } | { success: false; error: string }> {
  await requireAdmin();
  try {
    await requestWhatsappPairingCode(phoneNumber);
    return { success: true, state: serialize(getWhatsappSessionState()) };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function stopWhatsappSession(): Promise<{ success: true; state: SerializedState }> {
  await requireAdmin();
  await disconnectWhatsappSession();
  return { success: true, state: serialize(getWhatsappSessionState()) };
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
  const outcome = await checkWhatsappNumber(phone, userId);
  if (outcome === "yes" || outcome === "no") {
    revalidatePath("/admin/clients");
    revalidatePath(`/admin/clients/${userId}`);
  }
  return { outcome };
}
