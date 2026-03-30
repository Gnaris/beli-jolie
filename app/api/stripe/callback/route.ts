import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfSensitive } from "@/lib/encryption";
import { invalidateStripeCache, isConnectEnabled } from "@/lib/stripe";
import { revalidatePath, revalidateTag } from "next/cache";
import Stripe from "stripe";
import { logger } from "@/lib/logger";

/**
 * GET /api/stripe/callback
 * Retour après l'onboarding Stripe. Vérifie que le compte est bien configuré.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/connexion", req.url));
  }

  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id");
  const baseUrl = process.env.NEXTAUTH_URL || url.origin;

  if (!accountId || !isConnectEnabled()) {
    return NextResponse.redirect(
      `${baseUrl}/admin/parametres?tab=paiement&connect_error=${encodeURIComponent("Paramètres manquants.")}`
    );
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_PLATFORM_SECRET_KEY!);
    const account = await stripe.accounts.retrieve(accountId);

    if (!account.details_submitted) {
      // L'utilisateur n'a pas finalisé l'onboarding — rediriger pour réessayer
      return NextResponse.redirect(
        `${baseUrl}/admin/parametres?tab=paiement&connect_error=${encodeURIComponent("Inscription non finalisée. Cliquez à nouveau pour reprendre.")}`
      );
    }

    // Ajouter la commission par défaut si pas encore définie
    if (!account.metadata?.commission_rate) {
      await stripe.accounts.update(accountId, {
        metadata: { commission_rate: "0.25" },
      });
    }

    // Stocker/mettre à jour l'account ID (chiffré)
    await prisma.siteConfig.upsert({
      where: { key: "stripe_connect_account_id" },
      update: { value: encryptIfSensitive("stripe_connect_account_id", accountId) },
      create: { key: "stripe_connect_account_id", value: encryptIfSensitive("stripe_connect_account_id", accountId) },
    });

    invalidateStripeCache();
    revalidatePath("/admin/parametres");
    revalidatePath("/panier");
    revalidatePath("/panier/commande");
    revalidateTag("site-config", "default");

    return NextResponse.redirect(
      `${baseUrl}/admin/parametres?tab=paiement&connected=true`
    );
  } catch (err) {
    logger.error("[Stripe Connect] Callback error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.redirect(
      `${baseUrl}/admin/parametres?tab=paiement&connect_error=${encodeURIComponent("Erreur inattendue. Réessayez.")}`
    );
  }
}
