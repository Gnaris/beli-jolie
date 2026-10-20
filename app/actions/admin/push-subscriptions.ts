"use server";

/**
 * Server actions pour les abonnements aux notifications push PWA.
 *
 * Appelées depuis `/admin/parametres` (carte "Notifications") via le
 * composant client `PushNotificationsCard`. Chaque appareil s'abonne
 * en appelant `subscribeToPush`, se désabonne via `unsubscribeFromPush`.
 *
 * L'abonnement est scopé à l'admin connecté ET au tenant courant : si le
 * même admin utilise ensuite une autre boutique, il devra se réabonner.
 */

import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { isPushConfigured } from "@/lib/push-notifications";

/** Payload tel que fourni par le navigateur après `pushManager.subscribe()`. */
export interface BrowserPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushDeviceDTO {
  id: string;
  label: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
}

/**
 * Enregistre un nouvel appareil pour recevoir les notifications.
 * Idempotent : si l'endpoint existe déjà (même navigateur qui réactive),
 * on met à jour les clés + le label plutôt que de dupliquer.
 */
export async function subscribeToPush(
  subscription: BrowserPushSubscription,
  userAgent?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { session, tenant } = await requireAdmin();

    if (!isPushConfigured()) {
      return { success: false, error: "Les notifications push ne sont pas configurées sur ce serveur." };
    }

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return { success: false, error: "Abonnement invalide." };
    }

    // Vérif longueurs — on a figé VarChar(500/128/32) dans le schéma.
    if (subscription.endpoint.length > 500) {
      return { success: false, error: "URL d'abonnement trop longue." };
    }

    // Déduit un label lisible depuis l'UA. Ex : « iPhone de Boris »
    const label = inferDeviceLabel(userAgent, session.user.name ?? session.user.email ?? "Admin");

    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        userId: session.user.id,
        tenantId: tenant.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        authKey: subscription.keys.auth,
        userAgent: userAgent?.slice(0, 500) ?? null,
        label,
      },
      update: {
        // Si l'endpoint existait déjà, on remet à jour les clés (elles
        // peuvent avoir été regénérées par le navigateur) et on rattache
        // au bon admin / tenant.
        userId: session.user.id,
        tenantId: tenant.id,
        p256dh: subscription.keys.p256dh,
        authKey: subscription.keys.auth,
        userAgent: userAgent?.slice(0, 500) ?? null,
        lastUsedAt: new Date(),
      },
    });

    revalidateTag(`push-devices:${session.user.id}`, "default");
    return { success: true };
  } catch (err) {
    logger.error("[push-subscriptions] subscribe failed", { error: err });
    return { success: false, error: "Impossible d'activer les notifications. Réessayez." };
  }
}

/**
 * Supprime l'abonnement d'un endpoint donné (par l'admin qui le possède,
 * ou par le navigateur quand l'utilisateur désactive les notifs).
 */
export async function unsubscribeFromPush(
  endpoint: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { session } = await requireAdmin();
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: session.user.id },
    });
    revalidateTag(`push-devices:${session.user.id}`, "default");
    return { success: true };
  } catch (err) {
    logger.error("[push-subscriptions] unsubscribe failed", { error: err });
    return { success: false, error: "Impossible de désactiver." };
  }
}

/** Supprime un appareil par son id (bouton « Oublier cet appareil »). */
export async function deletePushDevice(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { session } = await requireAdmin();
    await prisma.pushSubscription.deleteMany({
      where: { id, userId: session.user.id },
    });
    revalidateTag(`push-devices:${session.user.id}`, "default");
    return { success: true };
  } catch (err) {
    logger.error("[push-subscriptions] delete device failed", { error: err });
    return { success: false, error: "Suppression impossible." };
  }
}

/** Renomme un appareil (ex: « Mon iPhone perso »). */
export async function renamePushDevice(
  id: string,
  label: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { session } = await requireAdmin();
    const trimmed = label.trim().slice(0, 80);
    await prisma.pushSubscription.updateMany({
      where: { id, userId: session.user.id },
      data: { label: trimmed || null },
    });
    revalidateTag(`push-devices:${session.user.id}`, "default");
    return { success: true };
  } catch (err) {
    logger.error("[push-subscriptions] rename failed", { error: err });
    return { success: false, error: "Renommage impossible." };
  }
}

/** Liste des appareils de l'admin connecté (affichée dans Paramètres). */
export async function listMyPushDevices(): Promise<PushDeviceDTO[]> {
  const { session, tenant } = await requireAdmin();
  const rows = await prisma.pushSubscription.findMany({
    where: { userId: session.user.id, tenantId: tenant.id },
    select: {
      id: true,
      label: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { lastUsedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt.toISOString(),
  }));
}

/**
 * Envoie une notification de test à TOUS les appareils de l'admin connecté.
 * Utilisé par le bouton « Envoyer une notification test » dans Paramètres.
 */
export async function sendTestPushNotification(): Promise<{
  success: boolean;
  error?: string;
  devicesTargeted?: number;
}> {
  try {
    const { session, tenant } = await requireAdmin();
    const { sendPushToAdmins } = await import("@/lib/push-notifications");

    const count = await prisma.pushSubscription.count({
      where: { userId: session.user.id, tenantId: tenant.id },
    });
    if (count === 0) {
      return { success: false, error: "Aucun appareil enregistré." };
    }

    // On réutilise la fonction d'envoi mais limitée à l'admin courant via
    // un filtre custom — ici simple : on cible tous les admins du tenant,
    // ce qui inclut la cliente et basta (il n'y en a qu'un).
    await sendPushToAdmins(tenant.id, {
      title: "Notification de test",
      body: "Si vous voyez ce message, les notifications fonctionnent.",
      url: "/admin",
      tag: "test",
    });

    return { success: true, devicesTargeted: count };
  } catch (err) {
    logger.error("[push-subscriptions] test send failed", { error: err });
    return { success: false, error: "Envoi du test impossible." };
  }
}

/**
 * Déduit un libellé lisible depuis le User-Agent.
 * Ex : « iPhone de Boris », « Mac de Boris », « Appareil de Boris ».
 */
function inferDeviceLabel(userAgent: string | undefined, ownerName: string): string {
  const ua = (userAgent ?? "").toLowerCase();
  const owner = ownerName.split("@")[0]; // Si c'est un email, on prend la partie avant @
  if (ua.includes("iphone")) return `iPhone de ${owner}`;
  if (ua.includes("ipad")) return `iPad de ${owner}`;
  if (ua.includes("mac os") || ua.includes("macintosh")) return `Mac de ${owner}`;
  if (ua.includes("windows")) return `PC Windows de ${owner}`;
  if (ua.includes("android")) return `Android de ${owner}`;
  return `Appareil de ${owner}`;
}
