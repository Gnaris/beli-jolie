/**
 * Constantes de config « retour en stock » — pur, sans dépendance serveur.
 *
 * Vit dans un fichier séparé pour que le composant client
 * `RestockConfigEditor` puisse importer les bornes du délai sans tirer
 * `lib/restock-trigger.ts` (et donc Prisma + next/headers) dans son bundle.
 */

/** Clé SiteConfig du kill switch global « retour en stock ». */
export const RESTOCK_AUTOMATION_ENABLED_SITE_CONFIG_KEY = "restock_automation_enabled";
/** Clé SiteConfig du délai configuré (en secondes). */
export const RESTOCK_DELAY_SITE_CONFIG_KEY = "restock_delay_seconds";

/** Délai par défaut avant envoi du mail récap : 24 h. */
export const RESTOCK_DEFAULT_DELAY_SECONDS = 24 * 60 * 60;

/**
 * Plage autorisée pour le compteur. La cliente a demandé de ne pas poser de
 * borne basse — elle peut tester à 1 s si elle le souhaite (à ses risques).
 * La borne haute reste à 365 jours pour que `setTimeout` interne du worker
 * ne déborde pas (le vrai bug serait un délai > 2³¹ ms ≈ 24.8 jours sur un
 * `setTimeout` unique, mais ici c'est planifié via `scheduledSendAt` en BDD
 * donc on peut aller plus loin).
 */
export const RESTOCK_MIN_DELAY_SECONDS = 1;
export const RESTOCK_MAX_DELAY_SECONDS = 365 * 24 * 3600;
