/**
 * Adresse email de contact visible côté cliente finale (mentions légales,
 * pieds de mail, factures PDF, bordereaux).
 *
 * Depuis la refonte onboarding : plus de champ Email saisi dans « Société ».
 * L'adresse est **dérivée automatiquement** du domaine du tenant courant :
 *   issyma.fr → contact@issyma.fr
 *   beliandjolie.com → contact@beliandjolie.com
 *
 * Multi-tenant : on lit le `Host:` de la requête courante (via
 * `getCurrentTenantBaseUrl`) et non `NEXTAUTH_URL` — sinon toutes les boutiques
 * renverraient contact@beliandjolie.com.
 *
 * Fallback : ancien `CompanyInfo.email` (rétrocompat pour les boutiques qui
 * n'ont pas encore été migrées).
 */
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";

export async function derivePublicContactEmail(
  fallbackCompanyEmail?: string | null,
): Promise<string | null> {
  try {
    const base = await getCurrentTenantBaseUrl();
    const host = new URL(base).hostname.replace(/^www\./, "");
    // Rejette les hôtes locaux/factices — pas d'adresse crédible dérivable
    if (host && host !== "localhost" && !host.startsWith("127.")) {
      return `contact@${host}`;
    }
  } catch {
    /* URL invalide → fallback */
  }
  return fallbackCompanyEmail?.trim() || null;
}
