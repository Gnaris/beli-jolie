/**
 * instrumentation-node.ts
 *
 * Chargé uniquement par instrumentation.ts quand NEXT_RUNTIME === "nodejs".
 * Installe les handlers globaux pour que TOUTE erreur non rattrapée
 * (uncaughtException, unhandledRejection) passe par notre logger
 * et soit visible dans les logs PM2 au format multi-ligne FR.
 *
 * Note : on ne fait PAS process.exit(1) après uncaughtException — on préfère
 * logger et continuer. Si le process devient vraiment instable, PM2 finira
 * par le redémarrer naturellement (boucle de crash visible côté ops).
 */
import { logger } from "@/lib/logger";
import sharp from "sharp";

const GUARD = Symbol.for("beliandjolie.instrumentation.installed");
const g = globalThis as Record<symbol, unknown>;

if (!g[GUARD]) {
  g[GUARD] = true;

  // VPS 2 cœurs : on bride sharp à 1 thread par opération pour qu'un import
  // d'images PFS ne sature pas la machine et laisse un cœur disponible
  // pour servir les visiteurs. Aucun impact sur la qualité — seulement la
  // vitesse de conversion d'une image individuelle.
  try {
    sharp.concurrency(1);
  } catch (err) {
    logger.warn("[Sharp] Impossible de configurer la concurrence", {
      error: err as Error,
    });
  }

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
