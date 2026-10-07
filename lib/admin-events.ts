/**
 * Bus d'événements admin temps réel diffusés via SSE sur /api/admin/stream.
 * Même pattern que `chat-events` : singleton globalThis + filtre tenantId.
 *
 * Pensé pour les écrans admin qui doivent se rafraîchir sans action de la
 * cliente : nouvelle inscription, nouveau client qui vient de se connecter
 * (ou qui part), nouvelle commande qui tombe.
 */
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import { logger } from "@/lib/logger";

export type AdminEventType =
  | "CLIENT_NEW"      // Un nouveau client vient de s'inscrire
  | "CLIENT_STATUS"   // Un client est passé en ligne (ou hors ligne)
  | "ORDER_NEW";      // Une nouvelle commande vient d'être payée

export interface AdminEvent {
  type: AdminEventType;
  /**
   * Tenant propriétaire de l'event. Rempli automatiquement depuis l'ALS si
   * non fourni. Sans ce champ, un émetteur d'un tenant réveille les SSE de
   * tous les autres tenants — pour admin cela signifierait voir des toasts
   * de commandes de la boutique d'à côté.
   */
  tenantId?: string;
  timestamp: number;
  /** Pour CLIENT_NEW / CLIENT_STATUS */
  userId?: string;
  /** Pour CLIENT_STATUS */
  online?: boolean;
  /** Pour ORDER_NEW */
  orderId?: string;
  orderNumber?: string;
}

type Listener = (event: AdminEvent) => void;

const GLOBAL_KEY = "__bj_admin_event_listeners__" as const;

function getListeners(): Set<Listener> {
  const g = globalThis as unknown as Record<string, Set<Listener>>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Set<Listener>();
  }
  return g[GLOBAL_KEY];
}

export function emitAdminEvent(event: Omit<AdminEvent, "timestamp">): void {
  const tenantId = event.tenantId ?? getCurrentTenantIdSync() ?? undefined;
  if (!tenantId && typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
    // Fail-closed côté stream : sans tenantId, l'event sera filtré. On logge
    // pour repérer les callsites qui oublient de binder l'ALS, sinon un
    // oubli couperait silencieusement les notifications admin.
    logger.warn("[admin-events] emitAdminEvent sans tenantId — l'event sera filtré", {
      type: event.type,
    });
  }
  const full: AdminEvent = { ...event, tenantId, timestamp: Date.now() };
  const listeners = getListeners();
  for (const listener of listeners) {
    try { listener(full); } catch { /* ignore */ }
  }
}

export function subscribeAdminEvents(listener: Listener): () => void {
  const listeners = getListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
