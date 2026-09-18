"use server";

import Stripe from "stripe";
import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfSensitive } from "@/lib/encryption";
import { getStripeInstance, invalidateStripeCache } from "@/lib/stripe";
import { setSiteConfig } from "@/lib/site-config-write";
import { getCurrentTenantId } from "@/lib/tenant";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export type StripeConfigInput = {
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
};

/**
 * Persiste les 3 clés Stripe dans SiteConfig. Les valeurs sensibles
 * (`stripe_secret_key`, `stripe_webhook_secret`) sont chiffrées via
 * `encryptIfSensitive` — la clé publique reste en clair.
 * Une chaîne vide supprime la ligne SiteConfig (retour au fallback env).
 */
export async function updateStripeConfig(
  input: StripeConfigInput,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    // undefined = « ne touche pas » (champ laissé vide côté formulaire avec
    // placeholder « déjà en place »). "" = « vider explicitement ».
    // Sans cette distinction, un save partiel wipe la clé conservée en BDD
    // (bug qui a causé la disparition de la clé secrète Issyma).
    const entries: { key: string; value: string | undefined }[] = [
      { key: "stripe_secret_key", value: input.secretKey?.trim() },
      { key: "stripe_publishable_key", value: input.publishableKey?.trim() },
      { key: "stripe_webhook_secret", value: input.webhookSecret?.trim() },
    ];

    for (const { key, value } of entries) {
      if (value === undefined) continue;
      if (value === "") {
        await prisma.siteConfig.deleteMany({ where: { key } });
        continue;
      }
      const stored = encryptIfSensitive(key, value);
      await setSiteConfig(key, stored);
    }

    invalidateStripeCache();
    revalidateTag("site-config", "default");
    revalidatePath("/admin/bienvenue/stripe");
    revalidatePath("/admin/parametres");

    // Fire-and-forget : enregistre les domaines du tenant chez Apple Pay via
    // Stripe (une fois par domaine par compte Stripe). Idempotent — Stripe
    // renvoie l'entrée existante si le domaine est déjà enregistré.
    registerApplePayDomainsForCurrentTenant().catch((err) =>
      logger.error("[updateStripeConfig] Apple Pay register KO", { error: err }),
    );

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Déclare chaque domaine `TenantDomain` du tenant courant auprès de Stripe
 * pour activer Apple Pay. Sans ça, le bouton Apple Pay n'apparaît pas dans
 * `PaymentElement` même si l'appareil le supporte.
 *
 * Prérequis Apple : le fichier `/.well-known/apple-developer-merchantid-domain-association`
 * doit être servi sur le domaine (route Next.js dédiée). Stripe fait le check
 * HTTPS avant de valider l'enregistrement.
 */
async function registerApplePayDomainsForCurrentTenant(): Promise<void> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;
  const domains = await prisma.tenantDomain.findMany({
    where: { tenantId },
    select: { host: true },
  });
  if (domains.length === 0) return;

  const stripe = await getStripeInstance();
  for (const { host } of domains) {
    // On skip les hosts locaux : Stripe refuse localhost/IP privée pour Apple Pay.
    if (host === "localhost" || host.endsWith(".local") || host.startsWith("127.")) {
      continue;
    }
    try {
      await stripe.applePayDomains.create({ domain_name: host });
      logger.info("[apple-pay-domain] enregistré", { host });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // « already exists » = idempotence OK, on continue silencieusement.
      if (msg.toLowerCase().includes("already")) continue;
      logger.error("[apple-pay-domain] échec enregistrement", { host, error: msg });
    }
  }
}

/**
 * Vérifie une clé secrète Stripe en appelant l'API Stripe (retrieve balance).
 * Renvoie `{ valid, testMode, error? }` sans rien sauvegarder.
 */
export async function validateStripeSecret(
  secretKey: string,
): Promise<{ valid: boolean; testMode: boolean; error?: string }> {
  try {
    await requireAdmin();
    const key = secretKey.trim();
    if (!key.startsWith("sk_")) {
      return { valid: false, testMode: false, error: "Clé invalide (doit commencer par sk_)." };
    }
    const stripe = new Stripe(key);
    await stripe.balance.retrieve();
    return { valid: true, testMode: key.startsWith("sk_test_") };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Clé refusée par Stripe.";
    return { valid: false, testMode: false, error: msg };
  }
}
