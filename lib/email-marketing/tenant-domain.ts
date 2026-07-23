/**
 * lib/email-marketing/tenant-domain.ts
 *
 * Résout l'URL de base publique d'un tenant pour construire les liens
 * qu'on insère dans les emails (CTA "Reprendre ma commande", désinscription,
 * pixel de tracking…).
 *
 * Choisit d'abord le domaine `isPrimary=true`, sinon le premier trouvé.
 * Fallback : NEXTAUTH_URL si aucun domaine n'est déclaré (dev local).
 */
import { prisma } from "@/lib/prisma";

const cache = new Map<string, { url: string; expiresAt: number }>();
const TTL_MS = 5 * 60_000;

export async function getTenantBaseUrl(tenantId: string): Promise<string> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const domains = await prisma.tenantDomain.findMany({
    where: { tenantId },
    select: { host: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  let url: string;
  if (domains.length > 0) {
    const host = domains[0].host;
    url = `https://${host}`;
  } else {
    url = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
  }

  cache.set(tenantId, { url, expiresAt: Date.now() + TTL_MS });
  return url;
}

export function clearTenantBaseUrlCache(): void {
  cache.clear();
}
