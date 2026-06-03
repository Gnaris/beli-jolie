/**
 * Détermine si un client est actuellement « en ligne » sur le site.
 *
 * Règle : on considère le client en ligne s'il a envoyé un heartbeat
 * dans la dernière `ONLINE_WINDOW_MS`. Le heartbeat client ping toutes
 * les `HEARTBEAT_INTERVAL_MS`, donc la fenêtre tolère 1 ping manqué
 * (réseau qui hoquette, onglet en arrière-plan…).
 */

export const HEARTBEAT_INTERVAL_MS = 30_000; // 30s entre 2 pings client
export const ONLINE_WINDOW_MS = 60_000;      // 60s = 1 raté toléré

export function isOnline(
  lastSeenAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastSeenAt) return false;
  return now.getTime() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

/**
 * Borne « considéré en ligne si >= ce timestamp », utilisée comme filtre
 * Prisma (`where: { lastSeenAt: { gte: getOnlineThreshold() } }`).
 *
 * Encapsulé dans un helper pour éviter `Date.now()` au top-level d'un
 * Server Component (que la règle React Compiler `purity` interdit).
 */
export function getOnlineThreshold(now: Date = new Date()): Date {
  return new Date(now.getTime() - ONLINE_WINDOW_MS);
}
