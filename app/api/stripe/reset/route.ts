import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateStripeCache, getConnectedAccountId, isConnectEnabled } from "@/lib/stripe";
import { revalidatePath, revalidateTag } from "next/cache";
import Stripe from "stripe";

/**
 * POST /api/stripe/reset
 * Supprime le compte Stripe Connect et le backup.
 * La prochaine connexion créera un tout nouveau compte.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  // Supprimer le compte Express côté Stripe (non-bloquant)
  const accountId = await getConnectedAccountId();
  if (accountId && isConnectEnabled()) {
    try {
      const stripe = new Stripe(process.env.STRIPE_PLATFORM_SECRET_KEY!);
      await stripe.accounts.del(accountId);

    } catch (err) {
      console.warn("[Stripe Connect] Erreur suppression (non-bloquante):", err);
    }
  }

  // Supprimer toutes les entrées Connect en BDD (actif + backup)
  await prisma.siteConfig.deleteMany({
    where: {
      key: { in: ["stripe_connect_account_id", "stripe_connect_account_id_backup"] },
    },
  });

  invalidateStripeCache();
  revalidatePath("/admin/parametres");
  revalidatePath("/panier");
  revalidatePath("/panier/commande");
  revalidateTag("site-config", "default");

  return NextResponse.json({ success: true });
}
