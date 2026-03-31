import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/efashion-sync/mapping-data
 * Fetch BJ entities with their eFashion refs + all EfashionMapping records.
 * Admin only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const [categories, colors, compositions, mappings] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.color.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, hex: true, patternImage: true },
    }),
    prisma.composition.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.efashionMapping.findMany({
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({ categories, colors, compositions, mappings });
}
