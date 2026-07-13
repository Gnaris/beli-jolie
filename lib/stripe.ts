import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

/**
 * Configuration Stripe hybride : lit d'abord SiteConfig (BDD chiffrée),
 * fallback sur les variables d'environnement. Permet à chaque boutique
 * (clone) de brancher son propre compte Stripe depuis l'UI d'admin sans
 * toucher au `.env` du serveur.
 *
 * Clés SiteConfig (voir `SENSITIVE_KEYS` dans lib/encryption.ts) :
 * - `stripe_secret_key`     : chiffrée
 * - `stripe_publishable_key`: en clair (publique par nature)
 * - `stripe_webhook_secret` : chiffrée
 */

// CRITIQUE multi-tenant : instance Stripe PAR clé secrète (donc par tenant).
// Sans ça, la 1ère instance créée serait réutilisée pour tous les tenants →
// paiements BJ atterrissent sur le compte Stripe d'Issyma.
const stripeInstanceBySecretKey = new Map<string, Stripe>();

const CONFIG_KEYS = [
  "stripe_secret_key",
  "stripe_publishable_key",
  "stripe_webhook_secret",
] as const;

type StripeConfig = {
  secretKey: string | null;
  publishableKey: string | null;
  webhookSecret: string | null;
};

async function readStripeConfig(): Promise<StripeConfig> {
  let dbMap = new Map<string, string>();
  try {
    // Résout tenantId (ALS + fallback headers) pour scoper explicitement.
    // Sans ça, findMany peut fuiter les rows du tenant voisin, et le décrypt
    // échoue si l'autre tenant a été chiffré avec une AUTRE ENCRYPTION_KEY
    // (erreur "Unsupported state or unable to authenticate data").
    let tid: string | null = null;
    try {
      const { getCurrentTenantIdSync } = await import("@/lib/tenant-als");
      tid = getCurrentTenantIdSync();
      if (!tid) {
        const { headers } = await import("next/headers");
        const h = await headers();
        tid = h.get("x-tenant-id");
      }
    } catch { /* hors requête */ }

    const rows = await prisma.siteConfig.findMany({
      where: tid
        ? { tenantId: tid, key: { in: [...CONFIG_KEYS] } }
        : { key: { in: [...CONFIG_KEYS] } },
    });
    dbMap = new Map(
      rows
        .filter((r) => r.value?.trim())
        .map((r) => [r.key, decryptIfSensitive(r.key, r.value).trim()]),
    );
  } catch {
    // BDD indisponible (ex. tests unitaires sans Prisma) → fallback env pur.
  }

  const pick = (dbKey: (typeof CONFIG_KEYS)[number], envKey: string): string | null =>
    dbMap.get(dbKey) || process.env[envKey]?.trim() || null;

  return {
    secretKey: pick("stripe_secret_key", "STRIPE_SECRET_KEY"),
    publishableKey: pick(
      "stripe_publishable_key",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    ),
    webhookSecret: pick("stripe_webhook_secret", "STRIPE_WEBHOOK_SECRET"),
  };
}

export async function getStripeInstance(): Promise<Stripe> {
  const { secretKey } = await readStripeConfig();
  if (!secretKey) {
    throw new Error(
      "Stripe non configuré. STRIPE_SECRET_KEY manquante dans .env ou dans SiteConfig.",
    );
  }
  const existing = stripeInstanceBySecretKey.get(secretKey);
  if (existing) return existing;
  const instance = new Stripe(secretKey);
  stripeInstanceBySecretKey.set(secretKey, instance);
  return instance;
}

export async function getStripeWebhookSecret(): Promise<string> {
  const { webhookSecret } = await readStripeConfig();
  if (!webhookSecret) {
    throw new Error("Stripe webhook secret non configuré (STRIPE_WEBHOOK_SECRET).");
  }
  return webhookSecret;
}

export async function getStripePublishableKey(): Promise<string | null> {
  const { publishableKey } = await readStripeConfig();
  return publishableKey;
}

export async function isStripeConfigured(): Promise<boolean> {
  const { secretKey, publishableKey } = await readStripeConfig();
  return !!secretKey && !!publishableKey;
}

/**
 * Extrait le préfixe « compte Stripe » (ex. `51TrMm244zIFhBc1`) d'une clé
 * secrète ou publique. Toutes les clés d'un même compte Stripe partagent ce
 * préfixe — utile pour détecter que sk et pk ne viennent pas du même compte.
 */
export function stripeAccountPrefix(key: string | null | undefined): string | null {
  if (!key) return null;
  const m = key.match(/^(?:sk|pk)_(?:live|test)_([0-9A-Za-z]{16})/);
  return m ? m[1] : null;
}

/**
 * Etat des 3 clés Stripe **en BDD uniquement**, scopé au tenant courant.
 * Sert au formulaire onboarding : évite d'afficher « déjà en place » quand la
 * valeur ne vient que du fallback `.env` (piège pour un tenant secondaire).
 */
export async function getStripeConfigDbState(): Promise<{
  hasSecret: boolean;
  hasPublishable: boolean;
  hasWebhook: boolean;
}> {
  const empty = { hasSecret: false, hasPublishable: false, hasWebhook: false };
  try {
    let tid: string | null = null;
    try {
      const { getCurrentTenantIdSync } = await import("@/lib/tenant-als");
      tid = getCurrentTenantIdSync();
      if (!tid) {
        const { headers } = await import("next/headers");
        const h = await headers();
        tid = h.get("x-tenant-id");
      }
    } catch {
      /* hors requête */
    }
    if (!tid) return empty;
    const rows = await prisma.siteConfig.findMany({
      where: { tenantId: tid, key: { in: [...CONFIG_KEYS] } },
      select: { key: true, value: true },
    });
    const present = new Set(
      rows.filter((r) => r.value?.trim()).map((r) => r.key),
    );
    return {
      hasSecret: present.has("stripe_secret_key"),
      hasPublishable: present.has("stripe_publishable_key"),
      hasWebhook: present.has("stripe_webhook_secret"),
    };
  } catch {
    return empty;
  }
}

export type StripeAccountInfo = {
  /** true = les 3 clés sont résolues (BDD ou env). N'implique pas qu'elles matchent. */
  configured: boolean;
  /** Etat BDD-only du tenant courant (le vrai « déjà en place »). */
  keysFromDb: { hasSecret: boolean; hasPublishable: boolean; hasWebhook: boolean };
  /** sk et pk viennent de deux comptes Stripe différents (paiement impossible). */
  mismatch: boolean;
  secretAccountPrefix: string | null;
  publishableAccountPrefix: string | null;
  /** Détail du compte Stripe résolu via `accounts.retrieve()`. */
  account: {
    id: string;
    name: string;
    email: string | null;
    testMode: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  } | null;
  accountError: string | null;
};

/**
 * Interroge Stripe (`accounts.retrieve()`) pour connaître le compte réellement
 * branché : nom commercial, email, mode LIVE/TEST. Détecte aussi le cas où la
 * clé secrète et la clé publique appartiennent à deux comptes différents.
 */
export async function getStripeAccountInfo(): Promise<StripeAccountInfo> {
  const [{ secretKey, publishableKey, webhookSecret }, keysFromDb] =
    await Promise.all([readStripeConfig(), getStripeConfigDbState()]);

  const secretAccountPrefix = stripeAccountPrefix(secretKey);
  const publishableAccountPrefix = stripeAccountPrefix(publishableKey);
  const mismatch =
    !!secretAccountPrefix &&
    !!publishableAccountPrefix &&
    secretAccountPrefix !== publishableAccountPrefix;

  const configured = !!secretKey && !!publishableKey && !!webhookSecret;

  if (!secretKey || mismatch) {
    return {
      configured,
      keysFromDb,
      mismatch,
      secretAccountPrefix,
      publishableAccountPrefix,
      account: null,
      accountError: null,
    };
  }

  try {
    const stripe = await getStripeInstance();
    const acct = await stripe.accounts.retrieve();
    const name =
      acct.business_profile?.name ||
      acct.settings?.dashboard?.display_name ||
      acct.email ||
      acct.id;
    return {
      configured,
      keysFromDb,
      mismatch,
      secretAccountPrefix,
      publishableAccountPrefix,
      account: {
        id: acct.id,
        name,
        email: acct.email ?? null,
        testMode: secretKey.startsWith("sk_test_"),
        chargesEnabled: !!acct.charges_enabled,
        payoutsEnabled: !!acct.payouts_enabled,
      },
      accountError: null,
    };
  } catch (err) {
    return {
      configured,
      keysFromDb,
      mismatch,
      secretAccountPrefix,
      publishableAccountPrefix,
      account: null,
      accountError: err instanceof Error ? err.message : "Erreur Stripe.",
    };
  }
}

/** État détaillé pour l'UI admin (indique quelle brique manque). */
export async function getStripeConfigStatus(): Promise<{
  hasSecret: boolean;
  hasPublishable: boolean;
  hasWebhook: boolean;
  testMode: boolean;
  ready: boolean;
  source: "database" | "env" | "none";
}> {
  const { secretKey, publishableKey, webhookSecret } = await readStripeConfig();

  let source: "database" | "env" | "none" = "none";
  try {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: [...CONFIG_KEYS] } },
      select: { key: true },
    });
    if (rows.length > 0) source = "database";
    else if (secretKey || publishableKey || webhookSecret) source = "env";
  } catch {
    if (secretKey || publishableKey || webhookSecret) source = "env";
  }

  return {
    hasSecret: !!secretKey,
    hasPublishable: !!publishableKey,
    hasWebhook: !!webhookSecret,
    testMode: !!secretKey?.startsWith("sk_test_"),
    ready: !!secretKey && !!publishableKey && !!webhookSecret,
    source,
  };
}

export function invalidateStripeCache() {
  stripeInstanceBySecretKey.clear();
}

export function buildStatementDescriptor(shopName: string): string | undefined {
  const cleaned = shopName
    .replace(/[<>\\'"*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);
  if (cleaned.length < 5 || !/[a-zA-Z]/.test(cleaned)) return undefined;
  return cleaned;
}
