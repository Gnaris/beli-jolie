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

  // Précharge le catalogue Ankorstore en arrière-plan pour chaque tenant
  // ayant la marketplace activée. Évite la 1re attente de ~30s-1min à
  // l'ouverture de la modale « Lier à un produit Ankorstore » après un
  // redémarrage pm2.
  // Multi-tenant : chaque tenant a son propre compte Ankorstore
  // (client_id/secret) → un cache et un préchargement par tenant, wrappés
  // dans `tenantALS.run(tenantId, …)` pour que l'auth trouve les bonnes
  // credentials (le cache d'auth Ankorstore est indexé par tenantId).
  // Non bloquant : lancé après 5s pour laisser le serveur finir de démarrer.
  setTimeout(() => {
    void (async () => {
      try {
        const { prisma } = await import("@/lib/prisma");
        const { tenantALS } = await import("@/lib/tenant-als");
        const { preloadCatalogInBackground, startCatalogAutoReload } = await import(
          "@/lib/ankorstore-catalog-cache"
        );

        const tenants = await prisma.tenant.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
        });

        for (const t of tenants) {
          try {
            const rows = await prisma.siteConfig.findMany({
              where: {
                tenantId: t.id,
                key: { in: ["ankors_client_id", "ankors_enabled"] },
              },
              select: { key: true, value: true },
            });
            const map = new Map(rows.map((r) => [r.key, r.value]));
            const hasId = (map.get("ankors_client_id") ?? "").trim().length > 0;
            const enabled = map.get("ankors_enabled") !== "false";
            if (!hasId || !enabled) continue;

            await tenantALS.run(t.id, async () => {
              logger.info("[Ankorstore Catalog] Préchargement au démarrage déclenché", {
                tenantId: t.id,
                tenant: t.name,
              });
              preloadCatalogInBackground(t.id);
              startCatalogAutoReload(t.id);
            });
          } catch (err) {
            logger.warn("[Ankorstore Catalog] Préchargement échoué pour un tenant", {
              tenantId: t.id,
              tenant: t.name,
              error: err as Error,
            });
          }
        }
      } catch (err) {
        logger.warn("[Ankorstore Catalog] Préchargement au démarrage échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de la file de rafraîchissement marketplace (pilote MarketplaceRefreshJob).
  // Démarré aussi après 5s pour laisser le serveur initialiser ses routes et son
  // accès BDD. Le worker est idempotent : il sweep les IN_PROGRESS orphelins au
  // premier tick et n'a pas besoin d'attendre d'évènement extérieur.
  setTimeout(() => {
    void (async () => {
      try {
        const { startMarketplaceQueueWorker } = await import("@/lib/marketplace-queue-worker");
        startMarketplaceQueueWorker();
      } catch (err) {
        logger.error("[Marketplace Queue] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de la file de traitement images (pilote ImageProcessingJob).
  // Reprend les jobs PROCESSING orphelins en PENDING au démarrage — la
  // conversion sharp est idempotente, donc rejouable sans risque.
  setTimeout(() => {
    void (async () => {
      try {
        const { startImageQueueWorker } = await import("@/lib/image-queue");
        startImageQueueWorker();
      } catch (err) {
        logger.error("[Image Queue] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de la file de traduction (pilote TranslationJob).
  // Consomme les lots créés par le bouton « Tout traduire » côté admin. Reprend
  // les PROCESSING orphelins en PENDING au démarrage — la traduction est
  // idempotente (upsert par entityId + locale).
  setTimeout(() => {
    void (async () => {
      try {
        const { startTranslationQueueWorker } = await import("@/lib/translation-queue");
        startTranslationQueueWorker();
      } catch (err) {
        logger.error("[Translation Queue] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de notification "mails non lus". Tick 60s.
  // Envoie un mail à l'adresse perso de la cliente quand la boîte pro
  // contient de nouveaux messages non lus, selon la config du tenant.
  setTimeout(() => {
    void (async () => {
      try {
        const { startMailNotifyWorker } = await import("@/lib/mail-notify-worker");
        startMailNotifyWorker();
      } catch (err) {
        logger.error("[MailNotify] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de polling des commandes PFS. Tick 5 min.
  // Récupère uniquement le résumé (page 1) puis re-fetch le détail des
  // commandes nouvelles ou dont le statut a changé. Lecture seule côté PFS.
  setTimeout(() => {
    void (async () => {
      try {
        const { startPfsOrdersWorker } = await import("@/lib/pfs-orders-worker");
        startPfsOrdersWorker();
      } catch (err) {
        logger.error("[PFS Orders] Démarrage du worker échoué", {
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
