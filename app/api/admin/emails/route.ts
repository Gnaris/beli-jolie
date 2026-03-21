import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const userId = searchParams.get("userId");

  const where = userId ? { userId } : {};

  const [emails, total] = await Promise.all([
    prisma.sentEmail.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        toEmail: true,
        toName: true,
        subject: true,
        sentAt: true,
        attachments: true,
        user: { select: { firstName: true, lastName: true, company: true } },
      },
    }),
    prisma.sentEmail.count({ where }),
  ]);

  return NextResponse.json({
    emails,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
