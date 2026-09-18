import { logger } from "@/lib/logger";

/**
 * Vérification de domaine Apple Pay.
 *
 * Apple exige que ce fichier soit accessible à
 * `https://<domaine>/.well-known/apple-developer-merchantid-domain-association`
 * pour prouver que le domaine appartient à un marchand Stripe autorisé.
 *
 * Le fichier est le MÊME pour tous les marchands qui utilisent le Merchant ID
 * partagé de Stripe (`merchant.com.stripe.checkout`). On le récupère
 * dynamiquement depuis Stripe et on le cache 24 h côté serveur : si Stripe
 * fait tourner le fichier, on suit sans re-déployer.
 *
 * Fallback : si le fetch Stripe échoue (réseau, maintenance), on renvoie une
 * copie figée du fichier — sinon Apple invalide TOUS les domaines vérifiés
 * pendant l'incident. La constante peut vieillir, elle sert uniquement de
 * filet ; le check du fetch fait foi.
 */

const STRIPE_FILE_URL =
  "https://docs.stripe.com/files/apple-pay/apple-developer-merchantid-domain-association";

// Snapshot du fichier Stripe (publique). Sert uniquement si le fetch échoue —
// Stripe fait rarement tourner ce fichier mais on ne dépend pas dessus.
const FALLBACK_CONTENT =
  "7B2270736D223A5B22394439324242463335443132443039443134454334423233413843373130343930463731423030343941464643303343464531393246324133303945413035423330222C22394239424537313941383437383333393943353942354241333336414430463232323542423241413334423445354238433631423738383632373033463830364245225D2C2276657273696F6E223A312C22637265617465644F6E223A313732383231323434323039362C227075626C6963496473223A5B226D65726368616E742E636F6D2E7374726970652E636865636B6F7574225D7D";

export const revalidate = 86400;

export async function GET() {
  try {
    const res = await fetch(STRIPE_FILE_URL, {
      next: { revalidate: 86400 },
    });
    if (res.ok) {
      const body = await res.text();
      return new Response(body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=86400, s-maxage=86400",
        },
      });
    }
    logger.error("[apple-pay-domain] Stripe fetch KO, fallback", {
      status: res.status,
    });
  } catch (err) {
    logger.error("[apple-pay-domain] Stripe fetch error, fallback", { error: err });
  }
  return new Response(FALLBACK_CONTENT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
