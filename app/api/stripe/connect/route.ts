import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfSensitive } from "@/lib/encryption";
import { invalidateStripeCache, isConnectEnabled, getConnectedAccountId } from "@/lib/stripe";
import { revalidatePath, revalidateTag } from "next/cache";
import Stripe from "stripe";

/**
 * GET /api/stripe/connect
 * Crée ou relie un compte connecté Express + génère un lien d'onboarding Stripe.
 * ?account_id=acct_xxx → relier un compte existant depuis la plateforme.
 * Sans param → crée un nouveau compte ou reprend un existant.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  if (!isConnectEnabled()) {
    return NextResponse.json(
      { error: "Stripe Connect non configuré (STRIPE_PLATFORM_SECRET_KEY manquante)." },
      { status: 500 }
    );
  }

  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: "NEXTAUTH_URL non configuré." }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_PLATFORM_SECRET_KEY!);
  const url = new URL(req.url);
  const linkAccountId = url.searchParams.get("account_id");

  try {
    let accountId = await getConnectedAccountId();

    // Si un account_id est passé en param → relier ce compte existant
    if (linkAccountId && linkAccountId.startsWith("acct_")) {
      // Vérifier que le compte existe sur la plateforme
      const account = await stripe.accounts.retrieve(linkAccountId);
      if (!account) {
        return NextResponse.redirect(
          `${baseUrl}/admin/parametres?tab=paiement&connect_error=${encodeURIComponent("Compte Stripe introuvable.")}`
        );
      }
      accountId = linkAccountId;

    }

    if (!accountId) {
      // Vérifier s'il y a un compte précédemment déconnecté (backup)
      const backupRow = await prisma.siteConfig.findUnique({
        where: { key: "stripe_connect_account_id_backup" },
      });
      if (backupRow?.value) {
        const { decryptIfSensitive } = await import("@/lib/encryption");
        accountId = decryptIfSensitive("stripe_connect_account_id", backupRow.value);

      }
    }

    if (!accountId) {
      // Aucun compte existant — en créer un nouveau
      const account = await stripe.accounts.create({
        type: "express",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;

      // Stocker l'account ID en BDD (chiffré)
      await prisma.siteConfig.upsert({
        where: { key: "stripe_connect_account_id" },
        update: { value: encryptIfSensitive("stripe_connect_account_id", accountId) },
        create: { key: "stripe_connect_account_id", value: encryptIfSensitive("stripe_connect_account_id", accountId) },
      });

      invalidateStripeCache();

    }

    // S'assurer que l'account_id est stocké en BDD (cas reconnexion depuis backup)
    await prisma.siteConfig.upsert({
      where: { key: "stripe_connect_account_id" },
      update: { value: encryptIfSensitive("stripe_connect_account_id", accountId) },
      create: { key: "stripe_connect_account_id", value: encryptIfSensitive("stripe_connect_account_id", accountId) },
    });
    // Nettoyer le backup
    await prisma.siteConfig.deleteMany({ where: { key: "stripe_connect_account_id_backup" } });
    invalidateStripeCache();

    // Vérifier si l'onboarding est déjà finalisé
    const account = await stripe.accounts.retrieve(accountId);
    if (account.details_submitted) {
      // Déjà finalisé — rediriger directement

      revalidatePath("/panier");
      revalidatePath("/panier/commande");
      revalidateTag("site-config", "default");
      return NextResponse.redirect(
        `${baseUrl}/admin/parametres?tab=paiement&connected=true`
      );
    }

    // Générer le lien d'onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      return_url: `${baseUrl}/api/stripe/callback?account_id=${accountId}`,
      refresh_url: `${baseUrl}/api/stripe/connect`,
      type: "account_onboarding",
    });

    return NextResponse.redirect(accountLink.url);
  } catch (err) {
    console.error("[Stripe Connect] Erreur:", err);
    const message = err instanceof Error ? err.message : "Erreur inattendue.";
    return NextResponse.redirect(
      `${baseUrl}/admin/parametres?tab=paiement&connect_error=${encodeURIComponent(message)}`
    );
  }
}
