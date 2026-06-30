import type { Prisma } from "@prisma/client";

export function buildExportWhereClause(): Prisma.ProductWhereInput {
  return {
    status: "ONLINE",
    OR: [
      { note: null },
      { note: { not: { contains: "Complété par l'IA" } } },
    ],
  };
}
