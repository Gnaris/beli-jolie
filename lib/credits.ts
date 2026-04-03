import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Create a credit (avoir) for a user from a claim.
 */
export async function createCredit(params: {
  userId: string;
  amount: number;
  claimId?: string;
  expiresAt?: Date;
}) {
  const credit = await prisma.credit.create({
    data: {
      userId: params.userId,
      amount: params.amount,
      remainingAmount: params.amount,
      claimId: params.claimId,
      expiresAt: params.expiresAt,
    },
  });

  logger.info(`[Credits] Created credit ${credit.id}: ${params.amount}EUR for user ${params.userId}`);
  return credit;
}

/**
 * Get total available credit for a user.
 */
export async function getAvailableCredit(userId: string): Promise<number> {
  const credits = await prisma.credit.findMany({
    where: {
      userId,
      remainingAmount: { gt: 0 },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: { remainingAmount: true },
  });

  return credits.reduce((sum, c) => sum + Number(c.remainingAmount), 0);
}

/**
 * Apply credits to an order. Consumes oldest credits first (FIFO).
 * Returns the total amount applied.
 */
export async function applyCreditsToOrder(userId: string, orderId: string, maxAmount: number): Promise<number> {
  const credits = await prisma.credit.findMany({
    where: {
      userId,
      remainingAmount: { gt: 0 },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  let remaining = maxAmount;
  let totalApplied = 0;

  for (const credit of credits) {
    if (remaining <= 0) break;

    const available = Number(credit.remainingAmount);
    const toApply = Math.min(available, remaining);

    await prisma.$transaction([
      prisma.credit.update({
        where: { id: credit.id },
        data: { remainingAmount: { decrement: toApply } },
      }),
      prisma.creditUsage.create({
        data: {
          creditId: credit.id,
          orderId,
          amount: toApply,
        },
      }),
    ]);

    totalApplied += toApply;
    remaining -= toApply;
  }

  if (totalApplied > 0) {
    logger.info(`[Credits] Applied ${totalApplied}EUR credits for user ${userId} on order ${orderId}`);
  }

  return totalApplied;
}
