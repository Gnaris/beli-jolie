import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const users = await prisma.user.findMany({
    where: {
      role: "CLIENT",
      OR: [
        { email: { contains: q } },
        { firstName: { contains: q } },
        { lastName: { contains: q } },
        { company: { contains: q } },
      ],
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
    },
    take: 10,
    orderBy: { firstName: "asc" },
  });

  return NextResponse.json({ users });
}
