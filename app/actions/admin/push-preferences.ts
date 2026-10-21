"use server";

/**
 * Server action — enregistre les préférences de notifications push PWA
 * pour le tenant courant (scopé à la boutique).
 *
 * Appelée depuis `PushNotificationsCard` quand l'admin modifie un toggle
 * ou un template. Validation côté serveur : chaque champ title/body est
 * limité en longueur (évite d'envoyer un roman à Apple qui serait tronqué
 * silencieusement).
 */

import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-helpers";
import { setSiteConfig } from "@/lib/site-config-write";
import { logger } from "@/lib/logger";
import {
  PUSH_PREFS_SITE_CONFIG_KEY,
  PUSH_EVENT_TYPES,
  PUSH_EVENT_LABELS,
  PUSH_EVENT_PREVIEW_VALUES,
  DEFAULT_PUSH_PREFERENCES,
  renderTemplate,
  type PushPreferences,
  type PushEventPreference,
  type PushEventType,
} from "@/lib/push-preferences";

const TITLE_MAX_LEN = 80;
const BODY_MAX_LEN = 160;

export async function savePushPreferences(
  input: PushPreferences,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { tenant } = await requireAdmin();

    // Validation + nettoyage par type.
    const sanitized: PushPreferences = { ...DEFAULT_PUSH_PREFERENCES };
    for (const type of PUSH_EVENT_TYPES) {
      const entry = input[type];
      if (!entry) continue;
      const title = (entry.title ?? "").trim().slice(0, TITLE_MAX_LEN);
      const body = (entry.body ?? "").trim().slice(0, BODY_MAX_LEN);
      if (!title) {
        return { success: false, error: `Titre manquant pour « ${type} ».` };
      }
      if (!body) {
        return { success: false, error: `Message manquant pour « ${type} ».` };
      }
      const sane: PushEventPreference = {
        enabled: entry.enabled === true,
        emailEnabled: entry.emailEnabled === true,
        title,
        body,
      };
      sanitized[type] = sane;
    }

    await setSiteConfig(
      PUSH_PREFS_SITE_CONFIG_KEY,
      JSON.stringify(sanitized),
      { tenantId: tenant.id },
    );

    // Les hooks push lisent les prefs à chaque event — pas de cache mémoire
    // à invalider côté serveur. On revalide juste le tag pour que la carte
    // Paramètres se re-render si on navigue.
    revalidateTag("push-preferences", "default");
    return { success: true };
  } catch (err) {
    logger.error("[push-prefs] save failed", { error: err });
    return { success: false, error: "Impossible d'enregistrer les préférences." };
  }
}

/**
 * Envoie une notification de test d'un TYPE d'événement spécifique, UNIQUEMENT
 * aux appareils de l'admin connecté (pas aux autres admins du tenant).
 *
 * Le template fourni par l'UI (`title` + `body`) est celui actuellement visible
 * à l'écran — permet de tester une modification AVANT de l'enregistrer. Si on
 * se contentait de relire la BDD, l'admin ne pourrait pas prévisualiser son
 * nouveau texte sans l'avoir sauvé d'abord.
 *
 * Les valeurs d'exemple (`Bijoux Dupont`, `250,00 €`…) sont partagées avec
 * l'aperçu UI via `PUSH_EVENT_PREVIEW_VALUES`.
 */
export async function sendTestPushForEventType(
  type: PushEventType,
  title: string,
  body: string,
): Promise<{ success: boolean; error?: string; devicesTargeted?: number }> {
  try {
    const { session, tenant } = await requireAdmin();

    const { isPushConfigured } = await import("@/lib/push-notifications");
    if (!isPushConfigured()) {
      return { success: false, error: "Les notifications push ne sont pas configurées sur ce serveur." };
    }

    // Scopé userId + tenantId : garde-fou multi-tenant. Si un même compte
    // admin existait dans 2 boutiques (impossible aujourd'hui, mais le
    // schéma User l'autorise via @@unique([tenantId, email])), on ne
    // sélectionne QUE ses abonnements de la boutique courante.
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: session.user.id, tenantId: tenant.id },
      select: { id: true, endpoint: true, p256dh: true, authKey: true },
    });
    if (subs.length === 0) {
      return { success: false, error: "Aucun appareil enregistré pour cet admin." };
    }

    // Rendu du template avec les valeurs d'exemple.
    const rendered = {
      title: renderTemplate(title.trim() || DEFAULT_PUSH_PREFERENCES[type].title, PUSH_EVENT_PREVIEW_VALUES),
      body: renderTemplate(body.trim() || DEFAULT_PUSH_PREFERENCES[type].body, PUSH_EVENT_PREVIEW_VALUES),
    };
    if (!rendered.title) rendered.title = PUSH_EVENT_LABELS[type].title;
    if (!rendered.body) rendered.body = "Aperçu de la notification";

    // Envoi direct via web-push, scopé aux endpoints de l'admin uniquement.
    // On ne passe pas par `sendPushToAdmins` qui cible TOUS les admins du
    // tenant — ici c'est un test personnel.
    const { getWebPushForTest } = await import("@/lib/push-notifications");
    const wp = await getWebPushForTest();
    if (!wp) {
      return { success: false, error: "Service push indisponible." };
    }

    const payload = JSON.stringify({
      title: rendered.title,
      body: rendered.body,
      url: urlForType(type),
      tag: `test-${type}`,
    });

    let sent = 0;
    const expiredIds: string[] = [];
    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await wp.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.authKey } },
            payload,
            { TTL: 60 },
          );
          sent++;
        } catch (err: unknown) {
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 410 || code === 404) expiredIds.push(s.id);
        }
      }),
    );

    if (expiredIds.length > 0) {
      await prisma.pushSubscription
        .deleteMany({ where: { id: { in: expiredIds } } })
        .catch(() => { /* best effort */ });
    }

    if (sent === 0) {
      return { success: false, error: "Envoi échoué sur tous les appareils (abonnements expirés ?)." };
    }
    return { success: true, devicesTargeted: sent };
  } catch (err) {
    logger.error("[push-prefs] test send failed", { error: err, type });
    return { success: false, error: "Envoi test impossible." };
  }
}

/** URL de destination par type (clic sur la notification test). */
function urlForType(type: PushEventType): string {
  switch (type) {
    case "order_new":    return "/admin/commandes";
    case "client_new":   return "/admin/clients";
    case "claim_new":    return "/admin/sav";
    case "chat_message": return "/admin/messagerie";
  }
}

/**
 * Reset un type d'événement à sa valeur par défaut (bouton « Réinitialiser »).
 */
export async function resetPushPreferenceType(
  type: PushEventType,
): Promise<{ success: boolean; error?: string; defaults?: PushEventPreference }> {
  try {
    const { tenant } = await requireAdmin();
    // On lit les prefs actuelles, remplace l'entrée visée par le défaut,
    // réécrit l'ensemble.
    const { getPushPreferences } = await import("@/lib/push-preferences-server");
    const current = await getPushPreferences(tenant.id);
    current[type] = { ...DEFAULT_PUSH_PREFERENCES[type] };
    await setSiteConfig(
      PUSH_PREFS_SITE_CONFIG_KEY,
      JSON.stringify(current),
      { tenantId: tenant.id },
    );
    revalidateTag("push-preferences", "default");
    return { success: true, defaults: { ...DEFAULT_PUSH_PREFERENCES[type] } };
  } catch (err) {
    logger.error("[push-prefs] reset failed", { error: err });
    return { success: false, error: "Reset impossible." };
  }
}
