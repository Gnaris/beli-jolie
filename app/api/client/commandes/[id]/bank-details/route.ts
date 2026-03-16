import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

/**
 * GET /api/client/commandes/[id]/bank-details
 * Récupère les instructions de virement bancaire depuis Stripe
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { id } = await params;

  const order = await prisma.order.findFirst({
    where: { id, userId: session.user.id },
    select: { stripePaymentIntentId: true, paymentStatus: true, totalTTC: true },
  });

  if (!order || !order.stripePaymentIntentId) {
    return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  }

  if (order.paymentStatus !== "awaiting_transfer") {
    return NextResponse.json({ error: "Pas de virement en attente." }, { status: 400 });
  }

  try {
    const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);

    const bankTransfer = pi.next_action?.display_bank_transfer_instructions;
    if (!bankTransfer) {
      return NextResponse.json({ error: "Instructions de virement non disponibles." }, { status: 404 });
    }

    // Extraire les détails selon le type
    const details = bankTransfer.financial_addresses?.[0];

    return NextResponse.json({
      amount: (pi.amount / 100).toFixed(2),
      currency: pi.currency?.toUpperCase(),
      reference: bankTransfer.reference,
      iban: details?.iban?.iban ?? null,
      bic: details?.iban?.bic ?? null,
      accountHolderName: details?.iban?.account_holder_name ?? null,
    });
  } catch (err) {
    console.error("[bank-details] Erreur Stripe:", err);
    return NextResponse.json({ error: "Impossible de récupérer les détails." }, { status: 500 });
  }
}
