/**
 * Configuration du montant minimum de commande.
 *
 * 4 modes exposés à l'admin :
 *  - `none`             : aucun minimum
 *  - `all`              : un seul seuil pour toutes les commandes
 *  - `first_only`       : seuil sur la 1ʳᵉ commande, aucun sur les suivantes
 *  - `first_then_rest`  : seuil distinct pour la 1ʳᵉ et pour les suivantes
 *
 * SiteConfig :
 *  - `min_order_mode`      : "none" | "all" | "first_only" | "first_then_rest"
 *  - `min_order_ht`        : seuil pour le mode `all` (aussi lu comme fallback
 *                            legacy si `min_order_mode` n'est pas encore posé)
 *  - `min_order_ht_first`  : seuil 1ʳᵉ commande (`first_only` / `first_then_rest`)
 *  - `min_order_ht_rest`   : seuil commandes suivantes (`first_then_rest`)
 *
 * Compat : si `min_order_mode` est absent mais `min_order_ht > 0`, on retombe
 * sur `all` (comportement historique). Sinon `none`.
 */
import { prisma } from "@/lib/prisma";

export type MinOrderMode = "none" | "all" | "first_only" | "first_then_rest";

export interface MinOrderConfig {
  mode: MinOrderMode;
  valueAll: number;
  valueFirst: number;
  valueRest: number;
}

const MODES: readonly MinOrderMode[] = ["none", "all", "first_only", "first_then_rest"] as const;

function parseAmount(raw: string | undefined | null): number {
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isMinOrderMode(value: unknown): value is MinOrderMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export async function readMinOrderConfig(): Promise<MinOrderConfig> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      key: {
        in: ["min_order_mode", "min_order_ht", "min_order_ht_first", "min_order_ht_rest"],
      },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const valueAll = parseAmount(map.get("min_order_ht"));
  const valueFirst = parseAmount(map.get("min_order_ht_first"));
  const valueRest = parseAmount(map.get("min_order_ht_rest"));

  const rawMode = map.get("min_order_mode");
  let mode: MinOrderMode;
  if (isMinOrderMode(rawMode)) {
    mode = rawMode;
  } else {
    mode = valueAll > 0 ? "all" : "none";
  }

  return { mode, valueAll, valueFirst, valueRest };
}

/**
 * Compte les commandes non-annulées du client. `0` = c'est sa première
 * commande. Sert à trancher entre `valueFirst` et `valueRest`.
 */
export async function isFirstOrderForUser(userId: string): Promise<boolean> {
  const count = await prisma.order.count({
    where: { userId, status: { not: "CANCELLED" } },
  });
  return count === 0;
}

export function resolveMinOrderForCounters(
  config: MinOrderConfig,
  isFirstOrder: boolean,
): number {
  switch (config.mode) {
    case "none":
      return 0;
    case "all":
      return config.valueAll;
    case "first_only":
      return isFirstOrder ? config.valueFirst : 0;
    case "first_then_rest":
      return isFirstOrder ? config.valueFirst : config.valueRest;
    default:
      return 0;
  }
}

/**
 * Renvoie le montant minimum HT applicable à un client donné, selon la
 * config et le nombre de ses commandes existantes. `userId = null` = visiteur
 * non connecté : on renvoie le seuil le plus haut susceptible d'être appliqué
 * (utilisé côté panier public quand on ne sait pas encore qui commande).
 */
export async function getEffectiveMinOrderHT(
  userId: string | null,
): Promise<number> {
  const config = await readMinOrderConfig();
  if (config.mode === "none") return 0;
  if (config.mode === "all") return config.valueAll;
  if (!userId) {
    // Visiteur : on montre le pire cas — celui d'une 1ʳᵉ commande.
    return config.valueFirst;
  }
  const first = await isFirstOrderForUser(userId);
  return resolveMinOrderForCounters(config, first);
}
