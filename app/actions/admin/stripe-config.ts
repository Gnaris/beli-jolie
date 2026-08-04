"use server";

import Stripe from "stripe";
import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfSensitive } from "@/lib/encryption";
import { invalidateStripeCache } from "@/lib/stripe";
import { setSiteConfig } from "@/lib/site-config-write";

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
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
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
