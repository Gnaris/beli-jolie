import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { checkRateLimit, getClientIpFromHeaders } from "@/lib/rate-limit";
import { getCurrentTenantId } from "@/lib/tenant";
import { notifyPaymentErrorIfTechnical } from "@/lib/payment-error-notify";

/**
 * POST /api/telemetry/payment-error
 *
 * Reçoit une erreur remontée par le navigateur pendant le tunnel de paiement
 * Stripe (chargement du PaymentElement OU confirmation du PaymentIntent).
 * Sans cette route, une erreur affichée dans l'iframe Stripe ne laisse
 * AUCUNE trace côté serveur — impossible d'enquêter quand un client se
 * plaint de « Veuillez réessayer plus tard ».
 *
 * Rate limit : 20/min par IP (un client peut réessayer plusieurs fois).
 * Session recommandée mais pas obligatoire : le tunnel exige d'être connecté
 * de toute façon, mais on ne veut pas jeter la télémétrie si la session a
 * expiré au moment de l'erreur.
 */

const PaymentErrorSchema = z.object({
  /** "load" = PaymentElement n'a pas pu s'initialiser. "confirm" = échec au clic Payer. */
  stage: z.enum(["load", "confirm"]),
  /** ID du PaymentIntent en cours (préfixe `pi_`). Vide si l'erreur survient avant sa création. */
  paymentIntentId: z.string().max(80).optional(),
  /** Origine du tunnel : checkout classique ou bouton « payer par carte » sur commande virement. */
  source: z.enum(["checkout", "pay-order-by-card"]),
  /** Méthodes proposées dans le formulaire (ex. ["card","paypal","billie","bancontact","ideal"]). */
  offeredMethods: z.array(z.string().max(30)).max(20).optional(),
  /** Méthode que le client venait de choisir au moment de l'erreur (si connue). */
  attemptedMethod: z.string().max(30).optional(),
  /** Erreur Stripe.js : type, code, decline_code, message brut. */
  stripeError: z
    .object({
      type: z.string().max(80).optional(),
      code: z.string().max(80).optional(),
      declineCode: z.string().max(80).optional(),
      message: z.string().max(500).optional(),
      paymentMethodType: z.string().max(30).optional(),
    })
    .optional(),
  /** Contexte navigateur — utile pour distinguer bugs mobile/desktop, iOS/Android. */
  page: z.string().max(200).optional(),
  /** Order ID pour le bouton « payer par carte » (source=pay-order-by-card). */
  orderId: z.string().max(80).optional(),
  /** Montant TTC affiché à l'écran, en centimes. */
  amountCents: z.number().int().nonnegative().optional(),
});

export async function POST(req: Request) {
  const limited = checkRateLimit(req, "telemetry-payment-error", 20, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide." }, { status: 400 });
  }

  const parsed = PaymentErrorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const data = parsed.data;
  const session = await getServerSession(authOptions);
  const tenantId = await getCurrentTenantId();

  const ctx = {
    stage: data.stage,
    source: data.source,
    paymentIntentId: data.paymentIntentId ?? null,
    orderId: data.orderId ?? null,
    amountCents: data.amountCents ?? null,
    offeredMethods: data.offeredMethods ?? null,
    attemptedMethod: data.attemptedMethod ?? null,
    stripeError: data.stripeError ?? null,
    page: data.page ?? null,
    userId: session?.user?.id ?? null,
    userEmail: session?.user?.email ?? null,
    tenantId: tenantId ?? null,
    ip: getClientIpFromHeaders(req.headers),
    userAgent: req.headers.get("user-agent") ?? null,
  };

  logger.warn("[payment-telemetry] Erreur navigateur Stripe", ctx);

  // Fire-and-forget : n'attend PAS l'envoi du mail pour rendre la réponse
  // (l'utilisateur affiche déjà son message d'erreur, la latence télémétrie
  // doit rester nulle). Toute exception est absorbée dans le module notify.
  void notifyPaymentErrorIfTechnical(ctx);

  return NextResponse.json({ ok: true });
}
