import { prisma } from "@/lib/prisma";

/**
 * Generate a unique claim reference: SAV-YYYY-XXXXXX
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

/**
 * Valid status transitions for claims.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_REVIEW", "REJECTED", "CLOSED"],
  IN_REVIEW: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["RETURN_PENDING", "RESOLUTION_PENDING", "RESOLVED"],
  RETURN_PENDING: ["RETURN_SHIPPED"],
  RETURN_SHIPPED: ["RETURN_RECEIVED"],
  RETURN_RECEIVED: ["RESOLUTION_PENDING", "RESOLVED"],
  RESOLUTION_PENDING: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  CLOSED: ["OPEN"],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
