/**
 * GET /api/admin/ankorstore-operations?productIds=p1,p2,...
 *
 * Renvoie l'opération Ankorstore la plus récente (non-CANCELLED) pour chaque
 * productId demandé. Le widget MarketplaceRefreshWidget poll cet endpoint
 * pour suivre l'avancement en mode callback-only.
 *
 * Suit la chaîne du refresh à 2 phases : quand REFRESH_DELETE_OLD passe en
 * SUCCEEDED et que REFRESH_CREATE_NEW est créée, "latest" bascule
 * automatiquement sur la phase 2.
 *
 * Réponse :
 * {
 *   "<productId>": {
 *     latest: {
 *       id, type, status, errorMessage, completedAt, createdAt
 *     } | null
 *   }
 * }
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const url = new URL(request.url);
  const productIdsParam = url.searchParams.get("productIds") ?? "";
  const productIds = productIdsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (productIds.length === 0) {
    return NextResponse.json({});
  }
  if (productIds.length > 200) {
    return NextResponse.json({ error: "Too many productIds (max 200)" }, { status: 400 });
  }

  // Fetch ALL non-cancelled ops for the requested products, ordered by createdAt desc.
  // Then keep only the most recent per product.
  const ops = await prisma.ankorstoreOperation.findMany({
    where: {
      productId: { in: productIds },
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      productId: true,
      type: true,
      status: true,
      errorMessage: true,
      completedAt: true,
      createdAt: true,
    },
  });

  const latestByProduct = new Map<string, (typeof ops)[number]>();
  for (const op of ops) {
    if (!latestByProduct.has(op.productId)) {
      latestByProduct.set(op.productId, op);
    }
  }

  const map: Record<
    string,
    {
      latest: {
        id: string;
        type: string;
        status: string;
        errorMessage: string | null;
        completedAt: string | null;
        createdAt: string;
      } | null;
    }
  > = {};
  for (const pid of productIds) {
    const op = latestByProduct.get(pid) ?? null;
    map[pid] = {
      latest: op
        ? {
            id: op.id,
            type: op.type,
            status: op.status,
            errorMessage: op.errorMessage,
            completedAt: op.completedAt ? op.completedAt.toISOString() : null,
            createdAt: op.createdAt.toISOString(),
          }
        : null,
    };
  }
  return NextResponse.json(map);
}
