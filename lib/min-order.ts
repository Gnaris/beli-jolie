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
 * Override par client (permanent tant que non retiré) :
 *  - `User.minimumOrderOverrideHt` : null = suit le global · 0 = aucun min
 *    pour ce client · > 0 = seuil personnel qui remplace le global.
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

export type EffectiveMinOrderSource =
  | "none"
  | "override_zero"
  | "override_client"
  | "global_all"
  | "global_first"
  | "global_rest";

export interface EffectiveMinOrder {
  /** Seuil HT à appliquer côté UI/garde-fou (0 = pas de blocage). */
  amountHT: number;
  /** Origine du seuil retenu. */
  source: EffectiveMinOrderSource;
}

/**
 * Renvoie le montant minimum HT applicable à un client donné, avec son
 * origine. `userId = null` = visiteur non connecté : on renvoie le pire cas
 * global (utilisé côté panier public quand on ne sait pas encore qui commande).
 *
 * Priorité :
 *  1. `User.minimumOrderOverrideHt` (non-null) — remplace le global,
 *     0 = client sans aucun minimum.
 *  2. Sinon → global via `readMinOrderConfig()` + `isFirstOrderForUser`.
 */
export async function getEffectiveMinOrder(
  userId: string | null,
): Promise<EffectiveMinOrder> {
  const config = await readMinOrderConfig();

  // Baseline global (indépendant de l'override client)
  let amountHT = 0;
  let source: EffectiveMinOrderSource = "none";
  if (config.mode === "all") {
    amountHT = config.valueAll;
    source = amountHT > 0 ? "global_all" : "none";
  } else if (config.mode === "first_only" || config.mode === "first_then_rest") {
    if (!userId) {
      amountHT = config.valueFirst;
      source = amountHT > 0 ? "global_first" : "none";
    } else {
      const first = await isFirstOrderForUser(userId);
      if (config.mode === "first_only") {
        amountHT = first ? config.valueFirst : 0;
        source = amountHT > 0 ? "global_first" : "none";
      } else {
        amountHT = first ? config.valueFirst : config.valueRest;
        source = amountHT > 0 ? (first ? "global_first" : "global_rest") : "none";
      }
    }
  }

  if (!userId) return { amountHT, source };

  // Lecture défensive : si la BDD ou le client Prisma n'a pas encore la
  // nouvelle colonne (dev sans `prisma generate` ou hot-reload stale), on
  // retombe sur le baseline global au lieu de faire planter la page /panier.
  let user: { minimumOrderOverrideHt: unknown } | null = null;
  try {
    user = (await prisma.user.findUnique({
      where: { id: userId },
      select: { minimumOrderOverrideHt: true },
    })) as typeof user;
  } catch {
    user = null;
  }

  if (user && user.minimumOrderOverrideHt != null) {
    const override = Number(user.minimumOrderOverrideHt);
    const valid = Number.isFinite(override) && override >= 0 ? override : 0;
    return {
      amountHT: valid,
      source: valid > 0 ? "override_client" : "override_zero",
    };
  }

  return { amountHT, source };
}

/**
 * Renvoie le montant minimum HT applicable, en un seul nombre. Compat avec
 * les appels existants qui n'ont pas besoin de la source.
 */
export async function getEffectiveMinOrderHT(
  userId: string | null,
): Promise<number> {
  return (await getEffectiveMinOrder(userId)).amountHT;
}
