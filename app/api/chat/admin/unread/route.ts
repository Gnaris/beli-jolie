import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return Response.json({ count: 0 });
  }

  const count = await prisma.message.count({
    where: {
      senderRole: "CLIENT",
      readAt: null,
      conversation: { type: "SUPPORT" },
    },
  });

  return Response.json({ count });
}
