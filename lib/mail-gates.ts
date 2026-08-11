/**
 * Garde-fous d'envoi mail marketing.
 *
 * Fonction PURE : reçoit tout le contexte en input, renvoie la liste des
 * gates (blockers + warnings). Testable en isolation, réutilisable côté
 * serveur (bloque l'envoi) et côté client (affiche la check-list dans la modale).
 *
 * Règles validées avec la cliente le 2026-08-11.
 */

export type MailScenario =
  | "ABANDONED_CART"
  | "INACTIVE_CLIENT"
  | "NEWSLETTER"
  | "RESTOCK";

export const GATE_THRESHOLDS = {
  /** Anti-spam global : dernière communication marketing (toutes catégories) */
  MARKETING_MIN_INTERVAL_DAYS: 3,
  /** Panier : trop récent = client réfléchit encore */
  ABANDONED_CART_MIN_HOURS: 24,
  /** Panier : trop vieux = ce n'est plus un rappel, c'est du spam */
  ABANDONED_CART_MAX_DAYS: 30,
  /** Panier : cooldown entre deux relances */
  ABANDONED_CART_COOLDOWN_DAYS: 7,
  /** Inactivité minimum avant relance (2 semaines) */
  INACTIVE_MIN_DAYS: 15,
  /** Inactivité : cooldown entre deux relances */
  INACTIVE_COOLDOWN_DAYS: 30,
  /** Retour en stock : cooldown entre deux relances */
  RESTOCK_COOLDOWN_DAYS: 14,
  /** Retour en stock : fenêtre pour être considéré « récemment restocké » */
  RESTOCK_RECENT_WINDOW_DAYS: 7,
} as const;

export interface MailGateInput {
  scenario: MailScenario;
  now: Date;
  /** Case newsletter acceptée par le client (case unique RGPD) */
  acceptsNewsletter: boolean;
  /** Statut du compte : seuls les APPROVED reçoivent des mails marketing */
  status: "PENDING" | "APPROVED" | "REJECTED";
  cart: {
    itemCount: number;
    updatedAt: Date | null;
    /** true si TOUS les items du panier sont en rupture */
    allOutOfStock: boolean;
  };
  activity: {
    /** max(lastLoginAt, lastSeenAt) — null si jamais connecté */
    lastActivityAt: Date | null;
    daysSinceLastActivity: number | null;
  };
  history: {
    orderCount: number;
  };
  /**
   * Produits sélectionnés par l'admin pour un mail RESTOCK.
   * Legacy `favorites` conservé pour compat mais ignoré par les gates RESTOCK.
   */
  selectedProducts: {
    count: number;
    /** true si TOUS les produits sélectionnés ont du stock > 0 */
    allInStock: boolean;
  };
  favorites: {
    inStockCount: number;
    recentlyRestockedCount: number;
  };
  /** Dernière date d'envoi par scenario (null si jamais) */
  lastSentByScenario: Partial<Record<MailScenario, Date | null>>;
  /** Dernière date d'envoi TOUS scenarios confondus */
  lastMarketingSentAt: Date | null;
}

export type GateLevel = "blocker" | "warning";

export interface MailGate {
  code: string;
  message: string;
  level: GateLevel;
}

/**
 * Calcule les gates pour un scenario donné.
 * blockers = interdisent l'envoi. warnings = informatif, laisse passer.
 */
export function computeMailGates(input: MailGateInput): MailGate[] {
  const gates: MailGate[] = [];
  const { scenario, now } = input;

  // ─── Règles transverses (tous scenarios) ───
  if (!input.acceptsNewsletter) {
    gates.push({
      code: "NEWSLETTER_OPT_OUT",
      message: "Ce client s'est désinscrit des communications marketing (RGPD).",
      level: "blocker",
    });
  }
  if (input.status !== "APPROVED") {
    gates.push({
      code: "ACCOUNT_NOT_APPROVED",
      message:
        input.status === "PENDING"
          ? "Compte en attente de validation — aucun mail marketing."
          : "Compte rejeté — aucun mail marketing.",
      level: "blocker",
    });
  }

  // ─── Anti-spam global (warning) ───
  const marketingCooldownDays = daysBetween(input.lastMarketingSentAt, now);
  if (
    marketingCooldownDays !== null &&
    marketingCooldownDays < GATE_THRESHOLDS.MARKETING_MIN_INTERVAL_DAYS
  ) {
    const daysLeft = Math.ceil(
      GATE_THRESHOLDS.MARKETING_MIN_INTERVAL_DAYS - marketingCooldownDays,
    );
    gates.push({
      code: "MARKETING_COOLDOWN",
      message: `Un mail marketing a déjà été envoyé il y a ${formatDays(marketingCooldownDays)} — attendre ${daysLeft} jour${daysLeft > 1 ? "s" : ""} pour éviter le harcèlement.`,
      level: "warning",
    });
  }

  // ─── Règles par scenario ───
  switch (scenario) {
    case "ABANDONED_CART":
      gates.push(...gatesAbandonedCart(input));
      break;
    case "INACTIVE_CLIENT":
      gates.push(...gatesInactive(input));
      break;
    case "RESTOCK":
      gates.push(...gatesRestock(input));
      break;
    case "NEWSLETTER":
      // Aucune condition spécifique — validé avec cliente le 2026-08-11.
      // (Un client inscrit qui a coché la case peut recevoir la newsletter,
      // même s'il n'est jamais connecté depuis l'inscription.)
      break;
  }

  return gates;
}

function gatesAbandonedCart(input: MailGateInput): MailGate[] {
  const gates: MailGate[] = [];
  const { cart, now } = input;

  if (cart.itemCount === 0) {
    gates.push({
      code: "CART_EMPTY",
      message: "Le panier est vide — rien à rappeler.",
      level: "blocker",
    });
    return gates; // pas la peine de vérifier le reste
  }

  const hoursSince = hoursBetween(cart.updatedAt, now);
  if (hoursSince !== null && hoursSince < GATE_THRESHOLDS.ABANDONED_CART_MIN_HOURS) {
    gates.push({
      code: "CART_TOO_RECENT",
      message: `Panier modifié il y a ${Math.round(hoursSince)}h — attendre au moins ${GATE_THRESHOLDS.ABANDONED_CART_MIN_HOURS}h (le client réfléchit encore).`,
      level: "blocker",
    });
  }

  const daysSince = daysBetween(cart.updatedAt, now);
  if (daysSince !== null && daysSince > GATE_THRESHOLDS.ABANDONED_CART_MAX_DAYS) {
    gates.push({
      code: "CART_TOO_OLD",
      message: `Panier abandonné depuis ${Math.round(daysSince)} jours — au-delà de ${GATE_THRESHOLDS.ABANDONED_CART_MAX_DAYS} jours ce n'est plus un rappel, c'est du spam.`,
      level: "blocker",
    });
  }

  const lastAbandoned = input.lastSentByScenario.ABANDONED_CART ?? null;
  const abandonedCooldown = daysBetween(lastAbandoned, now);
  if (
    abandonedCooldown !== null &&
    abandonedCooldown < GATE_THRESHOLDS.ABANDONED_CART_COOLDOWN_DAYS
  ) {
    const daysLeft = Math.ceil(
      GATE_THRESHOLDS.ABANDONED_CART_COOLDOWN_DAYS - abandonedCooldown,
    );
    gates.push({
      code: "ABANDONED_CART_COOLDOWN",
      message: `Rappel panier déjà envoyé il y a ${formatDays(abandonedCooldown)} — attendre ${daysLeft} jour${daysLeft > 1 ? "s" : ""}.`,
      level: "blocker",
    });
  }

  if (cart.allOutOfStock) {
    gates.push({
      code: "CART_ALL_OUT_OF_STOCK",
      message: "Tous les produits du panier sont en rupture — envoi possible mais frustrant pour le client.",
      level: "warning",
    });
  }

  return gates;
}

function gatesInactive(input: MailGateInput): MailGate[] {
  const gates: MailGate[] = [];
  const { activity, history, cart, now } = input;

  const daysInactive = activity.daysSinceLastActivity;
  if (daysInactive === null || daysInactive < GATE_THRESHOLDS.INACTIVE_MIN_DAYS) {
    const shown = daysInactive === null ? "jamais connecté" : `${Math.round(daysInactive)} jours`;
    gates.push({
      code: "NOT_INACTIVE_ENOUGH",
      message: `Inactivité insuffisante (${shown}) — il faut au moins ${GATE_THRESHOLDS.INACTIVE_MIN_DAYS} jours sans activité.`,
      level: "blocker",
    });
  }

  if (history.orderCount === 0) {
    gates.push({
      code: "NO_PRIOR_ORDER",
      message: "Ce client n'a jamais passé de commande — c'est un prospect, pas un client à réactiver. Utilisez plutôt la newsletter.",
      level: "blocker",
    });
  }

  const lastInactive = input.lastSentByScenario.INACTIVE_CLIENT ?? null;
  const inactiveCooldown = daysBetween(lastInactive, now);
  if (
    inactiveCooldown !== null &&
    inactiveCooldown < GATE_THRESHOLDS.INACTIVE_COOLDOWN_DAYS
  ) {
    const daysLeft = Math.ceil(
      GATE_THRESHOLDS.INACTIVE_COOLDOWN_DAYS - inactiveCooldown,
    );
    gates.push({
      code: "INACTIVE_COOLDOWN",
      message: `Relance inactivité déjà envoyée il y a ${formatDays(inactiveCooldown)} — attendre ${daysLeft} jour${daysLeft > 1 ? "s" : ""}.`,
      level: "blocker",
    });
  }

  if (cart.itemCount > 0) {
    gates.push({
      code: "HAS_ACTIVE_CART",
      message: `Ce client a ${cart.itemCount} article${cart.itemCount > 1 ? "s" : ""} au panier — envoyer plutôt un « Panier abandonné ».`,
      level: "warning",
    });
  }

  return gates;
}

function gatesRestock(input: MailGateInput): MailGate[] {
  const gates: MailGate[] = [];
  const { selectedProducts, now } = input;

  if (selectedProducts.count === 0) {
    gates.push({
      code: "NO_PRODUCT_SELECTED",
      message: "Aucun produit sélectionné — choisissez au moins un produit à annoncer.",
      level: "blocker",
    });
    return gates;
  }

  if (!selectedProducts.allInStock) {
    gates.push({
      code: "SELECTED_PRODUCTS_OUT_OF_STOCK",
      message: "Un ou plusieurs produits sélectionnés sont en rupture de stock — retirez-les avant d'envoyer.",
      level: "blocker",
    });
  }

  const lastRestock = input.lastSentByScenario.RESTOCK ?? null;
  const restockCooldown = daysBetween(lastRestock, now);
  if (
    restockCooldown !== null &&
    restockCooldown < GATE_THRESHOLDS.RESTOCK_COOLDOWN_DAYS
  ) {
    const daysLeft = Math.ceil(GATE_THRESHOLDS.RESTOCK_COOLDOWN_DAYS - restockCooldown);
    gates.push({
      code: "RESTOCK_COOLDOWN",
      message: `Mail retour en stock déjà envoyé il y a ${formatDays(restockCooldown)} — attendre ${daysLeft} jour${daysLeft > 1 ? "s" : ""}.`,
      level: "blocker",
    });
  }

  return gates;
}

// ─── Helpers pure ────────────────────────────────────────────────

function daysBetween(from: Date | null | undefined, to: Date): number | null {
  if (!from) return null;
  const ms = to.getTime() - from.getTime();
  if (ms < 0) return 0;
  return ms / (1000 * 60 * 60 * 24);
}

function hoursBetween(from: Date | null | undefined, to: Date): number | null {
  if (!from) return null;
  const ms = to.getTime() - from.getTime();
  if (ms < 0) return 0;
  return ms / (1000 * 60 * 60);
}

function formatDays(days: number): string {
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours}h`;
  }
  const rounded = Math.round(days);
  return `${rounded} jour${rounded > 1 ? "s" : ""}`;
}

// ─── Liste complète des conditions (pour la grille UI) ──────────

export interface MailCondition {
  /** Code stable (utilisé comme key React) */
  code: string;
  /** Libellé court à afficher dans la chip */
  label: string;
  /** True si la condition est actuellement remplie */
  passed: boolean;
  /** true = warning (non-bloquant si failed), false = blocker (bloque si failed) */
  isSoft: boolean;
}

/**
 * Retourne TOUTES les conditions applicables au scenario donné, chacune avec
 * son état (passed / failed). Sert à afficher une grille de chips ✓/✗ dans
 * la modale d'envoi manuel — plus lisible que les seuls blockers.
 */
export function listMailConditions(input: MailGateInput): MailCondition[] {
  const { scenario, now } = input;
  const conditions: MailCondition[] = [];

  // Règles transverses
  conditions.push({
    code: "OPT_IN",
    label: "Newsletter acceptée",
    passed: input.acceptsNewsletter,
    isSoft: false,
  });
  conditions.push({
    code: "APPROVED",
    label: "Compte approuvé",
    passed: input.status === "APPROVED",
    isSoft: false,
  });
  const marketingDays = daysBetween(input.lastMarketingSentAt, now);
  conditions.push({
    code: "MARKETING_COOLDOWN",
    label: `Aucun mail marketing < ${GATE_THRESHOLDS.MARKETING_MIN_INTERVAL_DAYS}j`,
    passed: marketingDays === null || marketingDays >= GATE_THRESHOLDS.MARKETING_MIN_INTERVAL_DAYS,
    isSoft: true,
  });

  // Règles par scenario
  switch (scenario) {
    case "ABANDONED_CART": {
      const cart = input.cart;
      conditions.push({
        code: "CART_NOT_EMPTY",
        label: "Panier non vide",
        passed: cart.itemCount > 0,
        isSoft: false,
      });
      const hoursSince = hoursBetween(cart.updatedAt, now);
      conditions.push({
        code: "CART_AGE_MIN",
        label: `Abandonné ≥ ${GATE_THRESHOLDS.ABANDONED_CART_MIN_HOURS}h`,
        passed: hoursSince !== null && hoursSince >= GATE_THRESHOLDS.ABANDONED_CART_MIN_HOURS,
        isSoft: false,
      });
      const daysSince = daysBetween(cart.updatedAt, now);
      conditions.push({
        code: "CART_AGE_MAX",
        label: `Abandonné ≤ ${GATE_THRESHOLDS.ABANDONED_CART_MAX_DAYS}j`,
        passed: daysSince === null || daysSince <= GATE_THRESHOLDS.ABANDONED_CART_MAX_DAYS,
        isSoft: false,
      });
      const lastAbandonedDays = daysBetween(input.lastSentByScenario.ABANDONED_CART ?? null, now);
      conditions.push({
        code: "ABANDONED_COOLDOWN",
        label: `Aucun rappel panier < ${GATE_THRESHOLDS.ABANDONED_CART_COOLDOWN_DAYS}j`,
        passed: lastAbandonedDays === null || lastAbandonedDays >= GATE_THRESHOLDS.ABANDONED_CART_COOLDOWN_DAYS,
        isSoft: false,
      });
      conditions.push({
        code: "CART_STOCK",
        label: "Au moins un article en stock",
        passed: !cart.allOutOfStock,
        isSoft: true,
      });
      break;
    }

    case "INACTIVE_CLIENT": {
      const days = input.activity.daysSinceLastActivity;
      conditions.push({
        code: "INACTIVE_MIN",
        label: `Inactivité ≥ ${GATE_THRESHOLDS.INACTIVE_MIN_DAYS}j`,
        passed: days !== null && days >= GATE_THRESHOLDS.INACTIVE_MIN_DAYS,
        isSoft: false,
      });
      conditions.push({
        code: "HAS_ORDER",
        label: "A déjà passé une commande",
        passed: input.history.orderCount > 0,
        isSoft: false,
      });
      const lastInactiveDays = daysBetween(input.lastSentByScenario.INACTIVE_CLIENT ?? null, now);
      conditions.push({
        code: "INACTIVE_COOLDOWN",
        label: `Aucune relance inactivité < ${GATE_THRESHOLDS.INACTIVE_COOLDOWN_DAYS}j`,
        passed: lastInactiveDays === null || lastInactiveDays >= GATE_THRESHOLDS.INACTIVE_COOLDOWN_DAYS,
        isSoft: false,
      });
      conditions.push({
        code: "NO_ACTIVE_CART",
        label: "Panier actuellement vide",
        passed: input.cart.itemCount === 0,
        isSoft: true,
      });
      break;
    }

    case "RESTOCK": {
      conditions.push({
        code: "PRODUCTS_SELECTED",
        label: "Au moins 1 produit sélectionné",
        passed: input.selectedProducts.count > 0,
        isSoft: false,
      });
      conditions.push({
        code: "PRODUCTS_IN_STOCK",
        label: "Produits sélectionnés en stock",
        passed: input.selectedProducts.count === 0 || input.selectedProducts.allInStock,
        isSoft: false,
      });
      const lastRestockDays = daysBetween(input.lastSentByScenario.RESTOCK ?? null, now);
      conditions.push({
        code: "RESTOCK_COOLDOWN",
        label: `Aucun mail retour stock < ${GATE_THRESHOLDS.RESTOCK_COOLDOWN_DAYS}j`,
        passed: lastRestockDays === null || lastRestockDays >= GATE_THRESHOLDS.RESTOCK_COOLDOWN_DAYS,
        isSoft: false,
      });
      break;
    }

    case "NEWSLETTER":
      // Aucune condition spécifique — les transverses suffisent.
      break;
  }

  return conditions;
}

// ─── Selectors de lecture ────────────────────────────────────────

/** True si au moins un gate bloquant est présent */
export function hasBlockers(gates: MailGate[]): boolean {
  return gates.some((g) => g.level === "blocker");
}

/** Filtre uniquement les blockers */
export function getBlockers(gates: MailGate[]): MailGate[] {
  return gates.filter((g) => g.level === "blocker");
}

/** Filtre uniquement les warnings */
export function getWarnings(gates: MailGate[]): MailGate[] {
  return gates.filter((g) => g.level === "warning");
}
