/**
 * Dédup cross-marketplace des fiches client par email.
 *
 * Chaque marketplace peut envoyer un email pour un client. Quand un même
 * humain achète sur plusieurs marketplaces, on ne veut PAS créer plusieurs
 * fiches — on cherche une fiche existante avec le même email et on lui
 * ajoute le badge du marketplace concerné.
 *
 * Certains emails sont "synthétiques" (générés par nous ou anonymisés par
 * le marketplace) et n'identifient pas un humain — on doit les exclure de
 * la dédup pour éviter d'agréger des personnes différentes sous une même
 * fausse identité.
 *
 * Patterns exclus :
 *  - Ankorstore : `orders+*@ankorstore.com` (le marketplace fournit ce mail
 *    de forwarding pour chaque commande, il est unique par commande PAS par
 *    retailer — dédup dessus serait catastrophique).
 *  - Microstore synthétique : `microstore-*@no-email.local` (généré par
 *    nous quand Microstore ne renvoie pas d'email).
 *  - Placeholders génériques : `noreply@`, `no-reply@`, `no-email@`.
 */
import { prisma } from "@/lib/prisma";

export function normalizeEmailForDedup(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (!trimmed.includes("@")) return null;
  return trimmed;
}

/**
 * `true` si l'email est un pseudo-email généré ou anonymisé et ne doit PAS
 * servir à dédupliquer un humain unique entre marketplaces.
 */
export function isSyntheticMarketplaceEmail(email: string): boolean {
  const e = email.toLowerCase();
  if (e.endsWith("@no-email.local")) return true; // Microstore fallback
  if (e.startsWith("orders+") && e.endsWith("@ankorstore.com")) return true;
  if (e.endsWith("@ankorstore.com") && e.startsWith("noreply")) return true;
  if (e.startsWith("noreply@") || e.startsWith("no-reply@") || e.startsWith("no-email@"))
    return true;
  return false;
}

/**
 * Cherche une AdminClientCard existante pour ce tenant par email — hors
 * emails synthétiques. Renvoie `null` si l'email est vide, synthétique ou
 * absent en base.
 */
export async function findClientCardByEmailForDedup(
  tenantId: string,
  rawEmail: string | null | undefined,
): Promise<{ id: string; lastOrderAt: Date | null } | null> {
  const email = normalizeEmailForDedup(rawEmail);
  if (!email) return null;
  if (isSyntheticMarketplaceEmail(email)) return null;
  const found = await prisma.adminClientCard.findFirst({
    where: { tenantId, email },
    select: { id: true, lastOrderAt: true },
  });
  return found;
}
