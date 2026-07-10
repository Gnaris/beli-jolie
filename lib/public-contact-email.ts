/**
 * Adresse email de contact visible côté cliente finale (mentions légales,
 * pieds de mail, factures PDF, bordereaux).
 *
 * Depuis la refonte onboarding : plus de champ Email saisi dans « Société ».
 * L'adresse est **dérivée automatiquement** du domaine du site :
 *   NEXTAUTH_URL=https://issyma.fr → contact@issyma.fr
 *
 * Fallback : ancien `CompanyInfo.email` (rétrocompat pour les boutiques qui
 * n'ont pas encore été migrées).
 */
export function derivePublicContactEmail(fallbackCompanyEmail?: string | null): string | null {
  const url = process.env.NEXTAUTH_URL?.trim();
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host) return `contact@${host}`;
    } catch {
      /* URL invalide → fallback */
    }
  }
  return fallbackCompanyEmail?.trim() || null;
}
