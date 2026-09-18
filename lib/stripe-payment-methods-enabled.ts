/**
 * Allowlist des méthodes de paiement Stripe optionnelles activées par tenant.
 *
 * Les 4 méthodes optionnelles (PayPal, Billie, Bancontact, iDEAL) doivent être
 * activées côté dashboard Stripe **et** cochées ici pour apparaître dans le
 * tunnel. `card` est le socle et n'a pas de toggle.
 *
 * Chaque toggle est stocké en SiteConfig sous la clé `stripe_pmt_<name>_enabled`
 * ("1" | "0"). Défaut : décoché tant que la cliente n'a pas confirmé
 * l'activation Stripe.
 *
 * Cache 60 s par tenant, invalidé par `revalidateTag("site-config")` après
 * chaque toggle admin.
 */
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantId } from "@/lib/tenant";

/** Méthodes Stripe optionnelles gérées par le toggle admin. */
export const OPTIONAL_STRIPE_METHODS = ["paypal", "billie", "bancontact", "ideal"] as const;
export type OptionalStripeMethod = (typeof OPTIONAL_STRIPE_METHODS)[number];

const CONFIG_KEY_PREFIX = "stripe_pmt_";
const CONFIG_KEY_SUFFIX = "_enabled";

function configKey(method: OptionalStripeMethod): string {
  return `${CONFIG_KEY_PREFIX}${method}${CONFIG_KEY_SUFFIX}`;
}

/** État de chaque toggle. Ordre : voir OPTIONAL_STRIPE_METHODS. */
export type StripeMethodsEnabled = Record<OptionalStripeMethod, boolean>;

const EMPTY: StripeMethodsEnabled = {
  paypal: false,
  billie: false,
  bancontact: false,
  ideal: false,
};

async function fetchEnabledMethods(tenantId: string): Promise<StripeMethodsEnabled> {
  const keys = OPTIONAL_STRIPE_METHODS.map(configKey);
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: keys } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value] as const));
  const result: StripeMethodsEnabled = { ...EMPTY };
  for (const m of OPTIONAL_STRIPE_METHODS) {
    result[m] = map.get(configKey(m))?.trim() === "1";
  }
  return result;
}

const cachedFetcher = unstable_cache(
  async (tenantId: string) => fetchEnabledMethods(tenantId),
  ["stripe-methods-enabled"],
  { revalidate: 60, tags: ["site-config"] },
);

/**
 * Retourne l'état des 4 toggles (utile pour l'UI admin).
 * En dehors d'un contexte requête, retourne EMPTY.
 */
export async function getStripeMethodsEnabled(): Promise<StripeMethodsEnabled> {
  const tid = await getCurrentTenantId();
  if (!tid) return EMPTY;
  return cachedFetcher(tid);
}

/**
 * Version sans cache — pour l'UI admin immédiatement après un save.
 */
export async function getStripeMethodsEnabledFresh(): Promise<StripeMethodsEnabled> {
  const tid = await getCurrentTenantId();
  if (!tid) return EMPTY;
  return fetchEnabledMethods(tid);
}

/**
 * Liste finale à passer à `stripe.paymentIntents.create({payment_method_types})`.
 * Ex : ["card"] si aucune option cochée, ["card","paypal","bancontact"] si 2 cochées.
 */
export async function getEnabledStripePaymentMethods(): Promise<string[]> {
  const enabled = await getStripeMethodsEnabled();
  const optional = OPTIONAL_STRIPE_METHODS.filter((m) => enabled[m]);
  return ["card", ...optional];
}

/** Nom du toggle SiteConfig pour une méthode donnée (utile côté server action). */
export function stripeMethodConfigKey(method: OptionalStripeMethod): string {
  return configKey(method);
}
