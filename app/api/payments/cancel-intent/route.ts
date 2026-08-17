import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getStripeInstance } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";

const CancelSchema = z.object({
  paymentIntentId: z.string().min(1).startsWith("pi_"),
});

/**
 * POST /api/payments/cancel-intent
 *
 * Annule un PaymentIntent Stripe qu'un client a créé mais qu'il abandonne
 * (changement d'adresse / de transporteur pendant la saisie CB, fermeture
 * d'onglet, navigation retour). Sans ça, le PI reste `requires_payment_method`
 * chez Stripe indéfiniment — pollution + risque de re-paiement fantôme
 * (retour navigateur, onglet dupliqué). Audit checkout §10.
 *
 * Idempotent : si le PI est déjà annulé, déjà confirmé, déjà rattaché à une
 * commande, ou introuvable, on renvoie 200 (rien à faire) plutôt que de
 * remonter une erreur au navigateur.
 */
export async function POST(req: Request) {
  const rateLimited = checkRateLimit(req, "cancel-intent", 10, 60_000);
  if (rateLimited) return rateLimited;

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, skipped: "invalid_body" });
  }
  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: true, skipped: "invalid_pi_id" });
  }
  const { paymentIntentId } = parsed.data;

  // Si le PI est déjà rattaché à une commande, on ne touche à rien — un webhook
  // ou placeOrder a fini son travail entre-temps.
  const alreadyOrder = await prisma.order.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true },
  });
  if (alreadyOrder) {
    return NextResponse.json({ ok: true, skipped: "already_ordered" });
  }

  let stripe;
  try {
    stripe = await getStripeInstance();
  } catch {
    return NextResponse.json({ ok: true, skipped: "stripe_unconfigured" });
  }

  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    // Sécurité : le PI doit appartenir à l'utilisateur courant.
    if (pi.metadata?.userId && pi.metadata.userId !== session.user.id) {
      logger.warn("[cancel-intent] Tentative d'annulation d'un PI d'autrui", {
        paymentIntentId,
        piUserId: pi.metadata.userId,
        sessionUserId: session.user.id,
      });
      return NextResponse.json({ error: "Interdit." }, { status: 403 });
    }
    if (pi.status === "succeeded" || pi.status === "canceled") {
      return NextResponse.json({ ok: true, skipped: pi.status });
    }
    await stripe.paymentIntents.cancel(paymentIntentId);
    return NextResponse.json({ ok: true, canceled: true });
  } catch (err) {
    logger.warn("[cancel-intent] Annulation Stripe échouée", {
      paymentIntentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: true, skipped: "stripe_error" });
  }
}
