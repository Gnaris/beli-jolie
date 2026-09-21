import { prisma } from "@/lib/prisma";

/**
 * Génère une référence Service Client unique : SAV-YYYY-XXXXXX
 * (scopée au tenant courant par l'extension prisma-tenant-scope).
 */
export async function generateClaimReference(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SAV-${year}-`;

  const lastClaim = await prisma.claim.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });

  let nextNum = 1;
  if (lastClaim) {
    const lastNum = parseInt(lastClaim.reference.replace(prefix, ""), 10);
    if (!isNaN(lastNum)) nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(6, "0")}`;
}

/** Pagination des listes Service Client (identique admin + client). */
export const CLAIMS_PAGE_SIZE = 50;
