"use server";

/**
 * Server actions utilitaires pour la carte "Clients" du widget flottant
 * d'import commandes/clients.
 *
 * Note : l'import de clients n'est pas une opération séparée — les fiches
 * clients (AdminClientCard) sont créées automatiquement à chaque import de
 * commandes via `upsertClientCardFrom*` dans les libs marketplaces. Ce
 * fichier n'expose donc plus qu'un compteur pour le widget.
 */

import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export type MarketplaceClientSource =
  | "PFS"
  | "EFASHION"
  | "ANKORSTORE"
  | "FAIRE"
  | "MICROSTORE";

function buildCardFilter(source: MarketplaceClientSource, tenantId: string) {
  const key = {
    PFS: "hasPfs",
    EFASHION: "hasEfashion",
    ANKORSTORE: "hasAnkorstore",
    FAIRE: "hasFaire",
    MICROSTORE: "hasMicrostore",
  }[source];
  return { where: { tenantId, [key]: true } };
}

/**
 * Compte les fiches client (AdminClientCard) liées à un marketplace.
 * Utilisé par la carte "Clients" du widget pour montrer "X fiches liées".
 */
export async function countMarketplaceClientCards(
  source: MarketplaceClientSource,
): Promise<number> {
  try {
    const { tenant } = await requireAdmin();
    return prisma.adminClientCard.count(buildCardFilter(source, tenant.id));
  } catch {
    return 0;
  }
}

export interface RecentClientCard {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  email: string | null;
  city: string | null;
  countryCode: string | null;
  lastOrderAt: string | null;
}

/**
 * N dernières fiches touchées (créées ou mises à jour) pour ce marketplace,
 * triées par `updatedAt` desc. Affiché dans la carte "Clients" pour donner
 * une preuve visible que la synchro touche bien des fiches.
 */
export async function getRecentMarketplaceClientCards(
  source: MarketplaceClientSource,
  limit: number = 3,
): Promise<RecentClientCard[]> {
  try {
    const { tenant } = await requireAdmin();
    const filter = buildCardFilter(source, tenant.id);
    const rows = await prisma.adminClientCard.findMany({
      ...filter,
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        email: true,
        city: true,
        countryCode: true,
        lastOrderAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      lastOrderAt: r.lastOrderAt ? r.lastOrderAt.toISOString() : null,
    }));
  } catch {
    return [];
  }
}
