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

  // Ankorstore : préchargement catalogue désactivé — remplacé par le module
  // lib/ankorstore-bo (reverse back-office) qui n'a pas besoin de cache global.
  // À supprimer avec le reste du legacy Ankorstore lors du grand nettoyage.

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

  // Worker de polling des commandes eFashion Paris. Même mécanique que PFS,
  // décalé de 5s au démarrage pour ne pas taper les 2 APIs en même temps.
  setTimeout(() => {
    void (async () => {
      try {
        const { startEfashionOrdersWorker } = await import("@/lib/efashion-orders-worker");
        startEfashionOrdersWorker();
      } catch (err) {
        logger.error("[eFashion Orders] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de polling des commandes Ankorstore (back-office reverse-engineered).
  // Tick 5 min. Ne fait AUCUNE mutation côté Ankor — lit page 1 puis re-fetch
  // le détail des commandes nouvelles ou dont le statut a changé.
  setTimeout(() => {
    void (async () => {
      try {
        const { startAnkorstoreOrdersWorker } = await import("@/lib/ankorstore-orders-worker");
        startAnkorstoreOrdersWorker();
      } catch (err) {
        logger.error("[Ankorstore Orders] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de polling des commandes Faire. Même mécanique que les autres
  // marketplaces. Faire ne fournit AUCUN webhook (§13 docs/faire-api.md) —
  // le polling est le seul moyen de détecter les nouvelles commandes.
  setTimeout(() => {
    void (async () => {
      try {
        const { startFaireOrdersWorker } = await import("@/lib/faire-orders-worker");
        startFaireOrdersWorker();
      } catch (err) {
        logger.error("[Faire Orders] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de polling des commandes Orderchamp. Tick 5 min. Kill-switch
  // `orderchamp_orders_worker_enabled` respecté par le worker lui-même.
  setTimeout(() => {
    void (async () => {
      try {
        const { startOrderchampOrdersWorker } = await import("@/lib/orderchamp-orders-worker");
        startOrderchampOrdersWorker();
      } catch (err) {
        logger.error("[Orderchamp Orders] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de polling des commandes Microstore. Tick 5 min.
  // Récupère page 1 clients (endpoint dédié `/customer/get_by_order`) puis
  // les commandes sur `[last_sync - 3j, today]`. Skip silencieusement si la
  // session Microstore n'est pas configurée pour le tenant (ou expirée).
  setTimeout(() => {
    void (async () => {
      try {
        const { startMicrostoreOrdersWorker } = await import("@/lib/microstore-orders-worker");
        startMicrostoreOrdersWorker();
      } catch (err) {
        logger.error("[Microstore Orders] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Détecteur de PaymentIntent Stripe orphelins (débit client sans commande).
  // Tick 1h. Filet post-incident Quinchon (16/08/2026). Voir lib/orphan-payment-intents-worker.ts.
  setTimeout(() => {
    void (async () => {
      try {
        const { startOrphanPaymentIntentsWorker } = await import("@/lib/orphan-payment-intents-worker");
        startOrphanPaymentIntentsWorker();
      } catch (err) {
        logger.error("[OrphanPI] Démarrage du worker échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Scheduler d'audit PFS automatique. Tick 5 min. Kill switch géré par tenant
  // dans SiteConfig `pfs_audit_auto_enabled`. En cas de moindre erreur pendant
  // un run auto, l'audit désactive le kill switch et prévient l'admin par mail.
  setTimeout(() => {
    void (async () => {
      try {
        const { startPfsAuditScheduler } = await import("@/lib/pfs-audit-scheduler");
        startPfsAuditScheduler();
      } catch (err) {
        logger.error("[PFS Audit Scheduler] Démarrage échoué", {
          error: err as Error,
        });
      }
    })();
  }, 5_000);

  // Worker de relance panier abandonné (pilote AbandonedCartJob).
  // Tick 10s pour rester précis sur des délais courts saisis en secondes/
  // minutes. Poll multi-tenant + wrap tenantALS.run par tenant côté worker.
  // Kill switch SiteConfig `abandoned_cart_automation_enabled` respecté.
  setTimeout(() => {
    void (async () => {
      try {
        const { startAbandonedCartWorker } = await import("@/lib/abandoned-cart-worker");
        startAbandonedCartWorker();
      } catch (err) {
        logger.error("[Abandoned Cart] Démarrage du worker échoué", {
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
