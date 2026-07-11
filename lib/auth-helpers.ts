import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentTenant, type CurrentTenant } from "@/lib/tenant";

/**
 * Helpers centralisés pour les server actions et les API routes.
 *
 * L'ancien pattern (`async function requireAdmin() { ... }` copié dans chaque
 * fichier de server actions) ne récupère pas le tenant courant. Les nouveaux
 * helpers ci-dessous retournent aussi le tenant résolu par le middleware pour
 * que les mutations puissent scoper toutes leurs opérations (INSERT tenantId,
 * findMany + where.tenantId, revalidateTag préfixé, etc.).
 *
 * Migration progressive :
 *   - Les fichiers server actions peuvent garder leur `requireAdmin()` local
 *     tant qu'ils ne touchent pas à des données multi-tenant.
 *   - Dès qu'une action lit/écrit une table portant `tenantId`, on remplace
 *     l'appel par `const { tenant } = await requireAdmin();` et on ajoute
 *     `tenantId: tenant.id` dans les mutations et les where.
 */

export type AdminContext = {
  session: Session;
  tenant: CurrentTenant;
};

export type AuthContext = {
  session: Session;
  tenant: CurrentTenant;
};

const NO_TENANT_MSG =
  "Tenant non résolu — vérifie que la requête traverse bien le middleware et que le host est enregistré dans TenantDomain.";

/**
 * Vérifie que le user de la session appartient bien au tenant du host courant.
 * Sans ce check, un admin de la boutique A dont le cookie session serait exporté
 * (compromission client, phishing) pourrait accéder à /admin sur la boutique B
 * puisque le JWT est signé avec le même NEXTAUTH_SECRET.
 */
function assertUserBelongsToTenant(session: Session, tenant: CurrentTenant): void {
  const userTenantId = (session.user as { tenantId?: string | null }).tenantId;
  // Cas 1 : le token porte un tenantId différent du host courant → rejet.
  if (userTenantId && userTenantId !== tenant.id) {
    throw new Error(
      `Session hors boutique (user=${userTenantId}, host=${tenant.id}). Reconnectez-vous depuis le bon domaine.`
    );
  }
  // Cas 2 : le token n'a pas de tenantId (session très ancienne créée avant
  // la refonte). On accepte pour l'instant — l'utilisateur sera migré à sa
  // prochaine reconnexion (jwt callback lira le tenantId du DB).
}

/**
 * Exige un utilisateur admin authentifié ET un tenant résolu.
 * Retourne les deux pour éviter des appels redondants.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  const tenant = await getCurrentTenant();
  if (!tenant) {
    throw new Error(NO_TENANT_MSG);
  }
  assertUserBelongsToTenant(session, tenant);
  return { session, tenant };
}

/**
 * Exige n'importe quel utilisateur authentifié + un tenant résolu.
 * Utilisé par les actions client (panier, favoris, commandes…).
 */
export async function requireAuth(): Promise<AuthContext> {
  const session = await getServerSession(authOptions);
  if (!session) {
    throw new Error("Vous devez être connecté.");
  }
  const tenant = await getCurrentTenant();
  if (!tenant) {
    throw new Error(NO_TENANT_MSG);
  }
  assertUserBelongsToTenant(session, tenant);
  return { session, tenant };
}

/**
 * Variante « molle » : retourne le tenant si résolu, `null` sinon, sans throw.
 * Utile pour les routes publiques qui adaptent leur affichage selon la
 * boutique mais doivent aussi rendre quelque chose si le host est inconnu
 * (page d'erreur générique en 404 par exemple).
 */
export async function tryGetAdmin(): Promise<AdminContext | null> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const userTenantId = (session.user as { tenantId?: string | null }).tenantId;
  if (userTenantId && userTenantId !== tenant.id) return null;
  return { session, tenant };
}
