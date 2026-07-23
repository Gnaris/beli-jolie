/**
 * GET /api/emails/track/pixel?t=<token>
 *
 * Endpoint public appelé par le pixel invisible inséré dans nos emails
 * marketing. Décode le token signé, marque `openedAt` sur EmailSend (1re
 * fois), et retourne un GIF transparent 1×1. Toujours 200 pour ne jamais
 * casser l'affichage de l'email si la BDD est en carafe.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decodeTrackingToken } from "@/lib/email-marketing/tokens";
import { logger } from "@/lib/logger";

// GIF transparent 1×1 (43 bytes)
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("t");
    if (token) {
      const payload = decodeTrackingToken(token);
      if (payload) {
        try {
          // Ne pas écraser un openedAt existant (on veut le 1er open).
          await prisma.emailSend.updateMany({
            where: { id: payload.id, openedAt: null },
            data: { openedAt: new Date() },
          });
        } catch (err) {
          logger.warn("[EmailTrack] Échec écriture openedAt", { error: err as Error });
        }
      }
    }
  } catch (err) {
    logger.warn("[EmailTrack] Requête pixel malformée", { error: err as Error });
  }

  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
    },
  });
}
