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

  // Précharge le catalogue Ankorstore en arrière-plan si la marketplace est
  // activée. Évite la 1re attente de ~30s-1min à l'ouverture de la modale
  // « Lier à un produit Ankorstore » après un redémarrage pm2.
  // Non bloquant : lancé après 5s pour laisser le serveur finir de démarrer
  // (sinon on tape Ankorstore avant même que les routes soient prêtes).
  setTimeout(() => {
    void (async () => {
      try {
        const { getCachedAnkorstoreEnabled } = await import("@/lib/cached-data");
        const enabled = await getCachedAnkorstoreEnabled();
        if (!enabled) return;
        const { preloadCatalogInBackground } = await import(
          "@/lib/ankorstore-catalog-cache"
        );
        logger.info("[Ankorstore Catalog] Préchargement au démarrage déclenché");
        preloadCatalogInBackground();
      } catch (err) {
        logger.warn("[Ankorstore Catalog] Préchargement au démarrage échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

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
