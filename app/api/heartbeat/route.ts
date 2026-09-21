import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/heartbeat — ping de présence client.
 *
 * Appelé toutes les 30 s par le navigateur d'un client connecté pour
 * mettre à jour `User.lastSeenAt`. L'admin se sert de ce timestamp pour
 * afficher qui est actuellement sur le site (cf. `lib/online-status.ts`).
 *
 * Le body optionnel `{ activeConversationId }` permet au widget chat / à la
 * page réclamation de signaler que le client est **en train de lire cette
 * conversation-là**. Sert au système de notification différée (5 min) — on
 * n'envoie pas d'email si le client est déjà sur la conv concernée.
 * Valeur `null` = le client a fermé le chat / quitté la page.
 *
 * - Anonyme / role != CLIENT → 204 silencieux (pas d'erreur, pas de log).
 * - Client connecté → met à jour `lastSeenAt = now()` (+ éventuellement
 *   `activeConversationId`).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") {
    return new NextResponse(null, { status: 204 });
  }

  let activeConversationId: string | null | undefined;
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { activeConversationId?: string | null };
      if (body && "activeConversationId" in body) {
        const raw = body.activeConversationId;
        // Accepte string non vide OU null explicite. Ignore le reste.
        if (raw === null) activeConversationId = null;
        else if (typeof raw === "string" && raw.length > 0 && raw.length < 100) {
          activeConversationId = raw;
        }
      }
    }
  } catch {
    // Body absent / invalide → simple heartbeat sans mise à jour de la conv.
  }

  const data: { lastSeenAt: Date; activeConversationId?: string | null } = {
    lastSeenAt: new Date(),
  };
  if (activeConversationId !== undefined) {
    data.activeConversationId = activeConversationId;
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  return new NextResponse(null, { status: 204 });
}
