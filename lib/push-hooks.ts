/**
 * Déclencheurs des notifications push PWA.
 *
 * S'abonne au bus d'événements internes (`admin-events` + `chat-events`) et
 * envoie une notification push à TOUS les appareils admin du tenant concerné
 * à chaque fois qu'un évènement d'intérêt se produit :
 *
 *   - ORDER_NEW         → "Nouvelle commande 230,00 € de ACME"
 *   - CLIENT_NEW        → "Nouveau client — ACME Co" (lien /admin/clients)
 *   - NEW_MESSAGE ADMIN → "Nouveau message de ACME" ou "Nouveau SAV" selon context
 *
 * Titre + body + enabled rendus via `lib/push-preferences.ts` — l'admin peut
 * personnaliser le texte de chaque type d'événement dans
 * `/admin/parametres` → carte Notifications push. Les templates acceptent
 * des placeholders `{customer}`, `{amount}`, `{orderNumber}`, `{sender}`,
 * `{preview}`, `{subject}`, `{reference}`.
 *
 * Isolation stricte par tenant : chaque event porte un tenantId ; les
 * lookups Prisma sont wrappés dans tenantALS.run pour que l'extension scope
 * les SELECT (jamais fuite d'une boutique vers l'autre).
 *
 * Démarré par `instrumentation-node.ts` au boot du serveur. Appel idempotent :
 * un garde-fou évite les double-inscriptions en cas de HMR dev.
 */

import { subscribeAdminEvents, type AdminEvent } from "@/lib/admin-events";
import { subscribeChatEvents, type ChatEvent } from "@/lib/chat-events";
import { sendPushToAdmins } from "@/lib/push-notifications";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { logger } from "@/lib/logger";
import { getPushPreferences } from "@/lib/push-preferences-server";
import { renderTemplate, type PushEventType } from "@/lib/push-preferences";
import { clientRegistrationStatusLabel } from "@/lib/registration-status-label";

const GUARD = Symbol.for("beliandjolie.push-hooks.installed");

export function registerPushHooks(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[GUARD]) return;
  g[GUARD] = true;

  subscribeAdminEvents((event) => {
    void dispatchAdminEvent(event).catch((err) =>
      logger.error("[push-hooks] admin event dispatch failed", { error: err, type: event.type }),
    );
  });

  subscribeChatEvents((event) => {
    void dispatchChatEvent(event).catch((err) =>
      logger.error("[push-hooks] chat event dispatch failed", { error: err, type: event.type }),
    );
  });

  logger.info("[push-hooks] Abonné à admin-events + chat-events");
}

async function dispatchAdminEvent(event: AdminEvent): Promise<void> {
  if (!event.tenantId) return;
  const tenantId = event.tenantId;
  const prefs = await getPushPreferences(tenantId);

  if (event.type === "ORDER_NEW" && event.orderId) {
    if (!prefs.order_new.enabled) return;
    const data = await tenantALS.run(tenantId, async () => {
      return prisma.order.findFirst({
        where: { id: event.orderId },
        select: {
          id: true,
          orderNumber: true,
          totalTTC: true,
          user: { select: { company: true, firstName: true, lastName: true } },
        },
      });
    });
    if (!data) return;
    const values = {
      customer: data.user?.company
        || `${data.user?.firstName ?? ""} ${data.user?.lastName ?? ""}`.trim()
        || "Un client",
      amount: formatEuro(data.totalTTC),
      orderNumber: data.orderNumber,
    };
    await sendPushToAdmins(tenantId, {
      title: renderTemplate(prefs.order_new.title, values),
      body: renderTemplate(prefs.order_new.body, values),
      url: `/admin/commandes/${data.id}`,
      // Un tag unique par commande : plusieurs commandes = plusieurs notifs
      // qui s'empilent (vs 1 tag "order-new" qui aurait écrasé la précédente).
      tag: `order-${data.id}`,
      requireInteraction: true,
    });
    return;
  }

  if (event.type === "CLIENT_NEW" && event.userId) {
    if (!prefs.client_new.enabled) return;
    const user = await tenantALS.run(tenantId, async () => {
      return prisma.user.findFirst({
        where: { id: event.userId },
        select: { company: true, firstName: true, lastName: true, status: true },
      });
    });
    if (!user) return;
    // Statut porté par l'event (posé juste après la création) ; fallback sur
    // la lecture BDD si l'émetteur n'a pas rempli le champ — par ex. test ou
    // ancien callsite non migré.
    const resolvedStatus = event.clientStatus ?? user.status ?? "PENDING";
    const values = {
      customer: user.company
        || `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
        || "Un visiteur",
      statusLabel: clientRegistrationStatusLabel(resolvedStatus),
    };
    await sendPushToAdmins(tenantId, {
      title: renderTemplate(prefs.client_new.title, values),
      body: renderTemplate(prefs.client_new.body, values),
      url: `/admin/clients`,
      tag: `client-${event.userId}`,
    });
    return;
  }

  // CLIENT_STATUS (online/offline) → pas de push, trop bruyant au quotidien.
}

async function dispatchChatEvent(event: ChatEvent): Promise<void> {
  if (!event.tenantId) return;
  if (event.type !== "NEW_MESSAGE") return;
  // Seuls les messages à destination de l'admin déclenchent une notif push.
  if (event.targetRole !== "ADMIN") return;
  if (!event.messageData) return;

  const tenantId = event.tenantId;
  const prefs = await getPushPreferences(tenantId);
  const isClaim = event.context === "claim";

  // Un SAV existant reprend le template `claim_new` (comme la création), le
  // chat normal reprend `chat_message`. Permet à la cliente d'avoir un seul
  // ton pour tout ce qui est SAV, et un autre pour le chat.
  const key: PushEventType = isClaim ? "claim_new" : "chat_message";
  if (!prefs[key].enabled) return;

  const sender = event.messageData.senderName || "Un client";
  const content = event.messageData.content?.trim();
  // Snippet court : 100 caractères max — Apple coupe plus loin, pas la peine
  // d'envoyer un roman qui serait tronqué sans ellipse.
  const preview = content
    ? content.length > 100
      ? content.slice(0, 97) + "…"
      : content
    : (event.messageData.attachments && event.messageData.attachments.length > 0
      ? "Pièce jointe"
      : "Nouveau message");

  // Placeholders disponibles pour les deux types : customer + sender +
  // preview + subject + reference. Les clés absentes retombent sur "" via
  // renderTemplate — pas d'erreur si l'admin met {reference} sur chat_message
  // alors que ce placeholder n'est pas fourni, le fallback vide est propre.
  const values: Record<string, string> = {
    sender,
    customer: sender,
    preview,
  };

  if (isClaim) {
    // On enrichit avec la référence et le sujet du SAV.
    const claim = await tenantALS.run(tenantId, async () => {
      return prisma.conversation.findFirst({
        where: { id: event.conversationId },
        select: { subject: true, claim: { select: { id: true, reference: true, subject: true } } },
      });
    });
    if (claim?.claim?.reference) values.reference = claim.claim.reference;
    const subject = claim?.claim?.subject || claim?.subject || "";
    if (subject) values.subject = subject;
  }

  // Lien utile côté admin selon le type.
  const url = isClaim
    ? await resolveClaimUrl(tenantId, event.conversationId)
    : `/admin/messagerie?conv=${event.conversationId}`;

  await sendPushToAdmins(tenantId, {
    title: renderTemplate(prefs[key].title, values),
    body: renderTemplate(prefs[key].body, values),
    url: url ?? "/admin/messagerie",
    // Regroupé par conversation : les 10 messages d'un même échange
    // n'empilent pas 10 notifs — la plus récente remplace la précédente.
    tag: `conv-${event.conversationId}`,
    requireInteraction: isClaim, // Un SAV reste à l'écran tant qu'il n'est pas lu.
  });
}

async function resolveClaimUrl(tenantId: string, conversationId: string): Promise<string | null> {
  try {
    const conv = await tenantALS.run(tenantId, async () => {
      return prisma.conversation.findFirst({
        where: { id: conversationId },
        select: { claim: { select: { id: true, reference: true } } },
      });
    });
    const ref = conv?.claim?.reference;
    if (!ref) return "/admin/sav";
    return `/admin/sav/${ref}`;
  } catch {
    return "/admin/sav";
  }
}

function formatEuro(value: unknown): string {
  if (value == null) return "";
  // Decimal Prisma arrive comme string ou number selon le driver.
  const n = typeof value === "number" ? value : Number(value?.toString?.() ?? value);
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}
