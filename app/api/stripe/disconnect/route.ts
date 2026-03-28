import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateStripeCache, getConnectedAccountId } from "@/lib/stripe";
import { revalidatePath, revalidateTag } from "next/cache";

/**
 * POST /api/stripe/disconnect
 * Déconnecte le compte Stripe Connect de cette instance.
 * Conserve l'account_id dans stripe_connect_account_id_backup pour reconnexion rapide.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const accountId = await getConnectedAccountId();
  if (!accountId) {
    return NextResponse.json({ error: "Aucun compte Connect connecté." }, { status: 400 });
  }

  console.log(`[Stripe Connect] Déconnexion du compte: ${accountId}`);

  // Sauvegarder l'account_id pour reconnexion future, puis supprimer l'actif
  const currentRow = await prisma.siteConfig.findUnique({
    where: { key: "stripe_connect_account_id" },
  });

  await Promise.all([
    // Backup de l'account_id (valeur déjà chiffrée)
    currentRow
      ? prisma.siteConfig.upsert({
          where: { key: "stripe_connect_account_id_backup" },
          update: { value: currentRow.value },
          create: { key: "stripe_connect_account_id_backup", value: currentRow.value },
        })
      : Promise.resolve(),
    // Supprimer l'entrée active
    prisma.siteConfig.deleteMany({
      where: { key: "stripe_connect_account_id" },
    }),
  ]);

  invalidateStripeCache();
  revalidatePath("/admin/parametres");
  revalidateTag("site-config", "default");

  return NextResponse.json({ success: true });
}
