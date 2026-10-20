/**
 * Notifications push PWA — envoi côté serveur.
 *
 * S'appuie sur `web-push` (standard VAPID RFC 8292). Envoie des notifs à
 * tous les appareils admin d'un tenant (iPhone, Mac, Windows, Android),
 * avec nettoyage automatique des endpoints expirés (410/404).
 *
 * Appelé en fire-and-forget depuis :
 *   - `lib/admin-events.ts` (nouvelle commande, nouveau client inscrit)
 *   - `lib/chat-events.ts` (message chat / Service Client côté admin)
 *
 * Les clés VAPID viennent de `.env` (VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT).
 * Si elles manquent, la fonction loggue et sort sans crasher — permet de
 * déployer la feature progressivement sans casser le reste.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// On lit process.env directement plutôt que d'importer `@/lib/env` : la
// validation Zod de ce dernier est eager (crash au premier import) et
// alourdirait tous les tests qui touchent au module. Les clés VAPID sont
// optionnelles — on vérifie leur présence à chaque appel.

export interface PushPayload {
  /** Titre affiché en gras sur la notification. */
  title: string;
  /** Corps du message (1-2 lignes). */
  body: string;
  /** URL ouverte au clic (ex: `/admin/commandes/CMD-123`). */
  url?: string;
  /**
   * Regroupe les notifications du même type : une 2ᵉ commande qui tombe
   * avant que la 1ʳᵉ soit lue remplacera la précédente au lieu d'empiler.
   */
  tag?: string;
  /** Icône de la notification (défaut `/apple-icon`). */
  icon?: string;
  /** Badge monochrome Android (défaut `/icon`). */
  badge?: string;
  /** Garde la notif à l'écran tant qu'elle n'est pas tapée. */
  requireInteraction?: boolean;
  /** Données libres transmises au service worker. */
  data?: Record<string, unknown>;
}

/**
 * Instance `web-push` paresseuse — on l'importe à la demande car le package
 * utilise `node:crypto` et casserait un import côté edge/middleware.
 * On met en cache l'instance configurée pour éviter de reconfigurer VAPID
 * à chaque envoi.
 *
 * ⚠️ web-push est un module CommonJS. Sous Node ESM, `await import("web-push")`
 * retourne `{ default: { setVapidDetails, sendNotification, ... }, … }` — les
 * fonctions ne sont PAS directement sur l'objet retourné. On déréférence
 * `.default` (avec fallback sur l'objet lui-même pour les bundlers qui le
 * flatten déjà).
 */
type WebPushAPI = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { TTL?: number },
  ) => Promise<unknown>;
};
let webPushCached: WebPushAPI | null = null;

async function getWebPush(): Promise<WebPushAPI | null> {
  if (webPushCached) return webPushCached;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:contact@beliandjolie.com";

  if (!publicKey || !privateKey) {
    logger.warn("[push] VAPID keys absentes — notifications push désactivées");
    return null;
  }

  const mod = await import("web-push");
  const api = ((mod as unknown as { default?: WebPushAPI }).default ?? (mod as unknown as WebPushAPI));
  if (typeof api.setVapidDetails !== "function") {
    logger.error("[push] web-push import malformé — setVapidDetails introuvable");
    return null;
  }
  api.setVapidDetails(subject, publicKey, privateKey);
  webPushCached = api;
  return api;
}

/**
 * Vrai = clés VAPID présentes, service push opérationnel.
 * Utilisé par l'UI Paramètres pour afficher « push non configuré » sans crash.
 */
export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Expose l'instance web-push configurée pour les actions qui envoient à un
 * sous-ensemble d'abonnements (ex: bouton « Tester » qui cible uniquement
 * l'admin connecté, pas tous les admins du tenant). Retourne null si VAPID
 * n'est pas configuré — le caller doit tester.
 */
export async function getWebPushForTest(): Promise<WebPushAPI | null> {
  return getWebPush();
}

/**
 * Envoie une notification à tous les appareils admin d'un tenant donné.
 *
 * Scope figé par `tenantId` — on NE lit JAMAIS le tenant depuis l'ALS ici
 * car cette fonction peut être appelée depuis un worker ou un hook où
 * l'ALS est perdu. Le caller a toujours un tenantId disponible (events
 * `admin-events` et `chat-events` le portent déjà).
 *
 * Fire-and-forget : les erreurs sont loggées, jamais thrown.
 */
export async function sendPushToAdmins(
  tenantId: string | undefined,
  payload: PushPayload,
): Promise<void> {
  if (!tenantId) return;

  try {
    const wp = await getWebPush();
    if (!wp) return;

    // Récupère tous les abonnements des admins actifs du tenant.
    // Un admin peut avoir plusieurs appareils (iPhone + Mac + bureau).
    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        tenantId,
        user: { role: "ADMIN" },
      },
      select: {
        id: true,
        endpoint: true,
        p256dh: true,
        authKey: true,
      },
    });

    if (subscriptions.length === 0) return;

    const body = JSON.stringify(payload);
    const expiredIds: string[] = [];
    const usedIds: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await wp.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.authKey },
            },
            body,
            // TTL 24h : si le push n'est pas distribué dans la journée
            // (téléphone éteint longtemps), le service l'oublie — pas la
            // peine de recevoir une alerte « nouvelle commande » 3 jours
            // après coup.
            { TTL: 24 * 60 * 60 },
          );
          usedIds.push(sub.id);
        } catch (err: unknown) {
          // 410 Gone / 404 Not Found = l'abonnement n'est plus valide
          // (navigateur désinstallé, cookies effacés…). On le purge.
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 410 || statusCode === 404) {
            expiredIds.push(sub.id);
          } else {
            logger.error("[push] Envoi échoué", {
              error: err,
              endpoint: sub.endpoint.slice(0, 60) + "…",
            });
          }
        }
      }),
    );

    // Nettoyage endpoints morts (hors transaction : on ne veut pas que ça
    // bloque l'event source).
    if (expiredIds.length > 0) {
      await prisma.pushSubscription
        .deleteMany({ where: { id: { in: expiredIds } } })
        .catch((err) => logger.error("[push] Cleanup expired failed", { error: err }));
    }

    // Bump lastUsedAt pour afficher « vu il y a 2 min » dans l'UI
    // Paramètres. Pas critique si ça rate.
    if (usedIds.length > 0) {
      await prisma.pushSubscription
        .updateMany({
          where: { id: { in: usedIds } },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => { /* non critique */ });
    }
  } catch (err) {
    logger.error("[push] sendPushToAdmins failed", { error: err, tenantId });
  }
}
