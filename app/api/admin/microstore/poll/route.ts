/**
 * POST /api/admin/microstore/poll
 * body: { code: string }
 *
 * Interroge Microstore pour savoir si le QR a été scanné.
 * - status "waiting" → le client re-poll après ~1s
 * - status "success" → serveur persiste le token chiffré en SiteConfig
 *   (microstore_session_key + microstore_mask_token + microstore_enabled=true)
 * - status "error"   → le client affiche l'erreur (ex: "expired" → refaire un QR)
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  pollMicrostoreScan,
  primeMicrostoreSessionKey,
  decodeMicrostoreTokenExpiration,
} from "@/lib/microstore-auth";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import { encryptIfSensitive } from "@/lib/encryption";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    ctx = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "code manquant" }, { status: 400 });
  }

  const result = await pollMicrostoreScan(code);

  if (result.status === "success") {
    try {
      await setSiteConfig(
        "microstore_session_key",
        encryptIfSensitive("microstore_session_key", result.token),
      );
      await setSiteConfig(
        "microstore_mask_token",
        encryptIfSensitive("microstore_mask_token", result.maskToken),
      );
      const expSec = decodeMicrostoreTokenExpiration(result.maskToken);
      if (expSec) {
        await setSiteConfig("microstore_expires_at", String(expSec));
      } else {
        await unsetSiteConfig("microstore_expires_at");
      }
      await setSiteConfig("microstore_enabled", "true");
      // Renvoie l'expiration au client pour affichage immédiat sans reload.
      // (on ne renvoie évidemment PAS le token lui-même)
      const expiresAtIso = expSec ? new Date(expSec * 1000).toISOString() : null;
      primeMicrostoreSessionKey(ctx.tenant.id, result.token);
      revalidateTag(`site-config:${ctx.tenant.id}`, "default");
      return NextResponse.json({ status: "success", expiresAt: expiresAtIso });
    } catch (err) {
      logger.error("[Microstore] persist token failed", { error: err });
      return NextResponse.json(
        { error: "Impossible d'enregistrer la clé Microstore." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(result);
}
