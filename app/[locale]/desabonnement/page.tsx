/**
 * Page publique de désinscription email.
 *
 * URL : /desabonnement?token=<signed>
 *
 * Le token porte : tenantId + email + scope. Vérification HMAC obligatoire.
 * Si valide, on ajoute (ou vérifie) la désinscription en BDD et on affiche
 * une confirmation. Si le token est absent/invalide, on affiche un message
 * d'erreur — sans jamais révéler l'existence ou non de l'email.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { decodeUnsubscribeToken } from "@/lib/email-marketing/tokens";
import { addUnsubscribe } from "@/lib/email-marketing/unsubscribe";
import { requireCurrentTenant } from "@/lib/tenant";
import type { EmailUnsubscribeScope } from "@prisma/client";
import { logger } from "@/lib/logger";

export const metadata: Metadata = {
  title: "Désinscription",
  robots: { index: false, follow: false },
};

const VALID_SCOPES: EmailUnsubscribeScope[] = [
  "MARKETING_ALL",
  "CART_REMINDERS",
  "STOCK_ALERTS",
  "NEWSLETTER",
  "INACTIVE_REMINDERS",
];

const SCOPE_LABELS: Record<EmailUnsubscribeScope, string> = {
  MARKETING_ALL: "toutes les communications commerciales",
  CART_REMINDERS: "les rappels de panier",
  STOCK_ALERTS: "les alertes de retour en stock",
  NEWSLETTER: "la newsletter",
  INACTIVE_REMINDERS: "les rappels d'inactivité",
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const payload = token ? decodeUnsubscribeToken(token) : null;
  const scope = payload?.s as EmailUnsubscribeScope | undefined;

  let status: "ok" | "invalid" = "invalid";
  let displayScope: EmailUnsubscribeScope | null = null;
  let displayEmail = "";

  if (payload && scope && VALID_SCOPES.includes(scope)) {
    try {
      // Le tenant peut être vérifié en croisant avec le tenant courant (le
      // lien pointe déjà sur le domaine du bon tenant). Mais on préfère
      // faire confiance au token signé pour tenantId — sinon un lien reçu
      // par erreur sur le mauvais domaine serait bloqué. Le tenant du
      // payload est autoritatif.
      const tenant = await requireCurrentTenant();
      // Sanity : refuser si le tenant du domaine ne correspond pas.
      if (tenant.id !== payload.t) {
        logger.warn("[Unsubscribe] Token pour tenant différent du domaine — refusé", {
          domainTenantId: tenant.id,
          tokenTenantId: payload.t,
        });
      } else {
        await addUnsubscribe(payload.t, payload.e, scope);
        status = "ok";
        displayScope = scope;
        displayEmail = payload.e;
      }
    } catch (err) {
      logger.error("[Unsubscribe] Échec désinscription", { error: err as Error });
    }
  }

  return (
    <div className="min-h-screen bg-bg-secondary flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-bg-primary border border-border rounded-2xl shadow-sm p-8 md:p-10 text-center">
        {status === "ok" ? (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-bg-dark text-text-inverse flex items-center justify-center text-2xl">
              ✓
            </div>
            <h1 className="font-heading font-bold text-2xl mt-6 text-text-primary">
              Désinscription confirmée
            </h1>
            <p className="text-text-secondary mt-4 leading-relaxed">
              {"L'adresse "}<strong className="text-text-primary">{displayEmail}</strong>{" ne recevra plus "}
              {displayScope ? SCOPE_LABELS[displayScope] : "ces emails"}.
            </p>
            <p className="text-text-muted text-sm mt-4">
              {"Les emails transactionnels (confirmations de commande, factures…) continuent d'être envoyés, ils ne sont pas concernés."}
            </p>
            <div className="mt-8">
              <Link
                href="/"
                className="inline-block bg-bg-dark text-text-inverse px-6 py-3 rounded-xl font-medium hover:opacity-90"
              >
                {"Retour à l'accueil"}
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-bg-tertiary text-text-secondary flex items-center justify-center text-2xl">
              !
            </div>
            <h1 className="font-heading font-bold text-2xl mt-6 text-text-primary">
              Lien invalide ou expiré
            </h1>
            <p className="text-text-secondary mt-4 leading-relaxed">
              {"Ce lien de désinscription n'a pas pu être vérifié. Il est possible qu'il ait été tronqué par votre messagerie."}
            </p>
            <p className="text-text-muted text-sm mt-4">
              {"Pour vous désinscrire, cliquez à nouveau sur le lien depuis l'email d'origine ou contactez-nous."}
            </p>
            <div className="mt-8">
              <Link
                href="/"
                className="inline-block bg-bg-dark text-text-inverse px-6 py-3 rounded-xl font-medium hover:opacity-90"
              >
                {"Retour à l'accueil"}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
