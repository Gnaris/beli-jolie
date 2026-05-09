/**
 * instrumentation.ts
 *
 * Hook de démarrage Next.js 16 (runtime serveur).
 * Installe les handlers globaux pour que TOUTE erreur non rattrapée
 * (uncaughtException, unhandledRejection) passe par notre logger
 * et soit visible dans les logs PM2 au format multi-ligne FR.
 *
 * Note : on ne fait PAS process.exit(1) après uncaughtException — on préfère
 * logger et continuer. Si le process devient vraiment instable, PM2 finira
 * par le redémarrer naturellement (boucle de crash visible côté ops).
 */
const GUARD = Symbol.for("beliandjolie.instrumentation.installed");

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Évite de réenregistrer les handlers en cas de re-évaluation du module (HMR, etc.)
  const g = globalThis as Record<symbol, unknown>;
  if (g[GUARD]) return;
  g[GUARD] = true;

  const { logger } = await import("@/lib/logger");

  process.on("uncaughtException", (err: Error) => {
    logger.error("Plantage non rattrapé", {
      event: "Plantage non rattrapé",
      error: err,
    });
  });

  process.on("unhandledRejection", (reason: unknown) => {
    let err: Error;
    try {
      err = reason instanceof Error ? reason : new Error(String(reason));
    } catch {
      err = new Error("Promesse rejetée avec une raison non sérialisable");
    }
    logger.error("Promesse rejetée non rattrapée", {
      event: "Promesse rejetée non rattrapée",
      error: err,
    });
  });
}
