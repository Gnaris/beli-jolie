import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status"); // APPROVED or REJECTED
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") || "20", 10)));

  const where: Record<string, unknown> = { prepareJobId: id };
  if (status) where.status = status;

  const [products, total] = await Promise.all([
    prisma.pfsStagedProduct.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        reference: true,
        pfsReference: true,
        name: true,
        categoryName: true,
        status: true,
        variants: true,
        compositions: true,
        isBestSeller: true,
        createdProductId: true,
        existsInDb: true,
        createdAt: true,
        updatedAt: true,
        // NO imagesByColor - images are deleted after reject
      },
    }),
    prisma.pfsStagedProduct.count({ where }),
  ]);

  return NextResponse.json({ products, total, page, totalPages: Math.ceil(total / limit) });
}
