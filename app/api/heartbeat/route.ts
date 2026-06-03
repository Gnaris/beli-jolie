import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/heartbeat — ping de présence client.
 *
 * Appelé toutes les 30s par le navigateur d'un client connecté pour
 * mettre à jour `User.lastSeenAt`. L'admin se sert de ce timestamp pour
 * afficher qui est actuellement sur le site (cf. `lib/online-status.ts`).
 *
 * - Anonyme / role != CLIENT → 204 silencieux (pas d'erreur, pas de log).
 * - Client connecté → met à jour `lastSeenAt = now()`.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") {
    return new NextResponse(null, { status: 204 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { lastSeenAt: new Date() },
  });

  return new NextResponse(null, { status: 204 });
}
