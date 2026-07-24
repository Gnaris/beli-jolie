/**
 * POST /api/admin/microstore/import-token
 * body: { token: string, maskToken: string }
 *
 * Enregistre une clé de session Microstore capturée depuis une session
 * `web.mc.app` déjà active (via bookmarklet). Contrairement au flow QR, ça
 * n'invalide PAS la session web existante — les deux coexistent.
 *
 * La clé est validée en faisant un appel `startup` réel avant de persister,
 * pour rejeter les valeurs vides / expirées.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  decodeMicrostoreTokenExpiration,
  primeMicrostoreSessionKey,
  MC_API_BASE,
} from "@/lib/microstore-auth";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import { encryptIfSensitive } from "@/lib/encryption";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

async function testMicrostoreKey(token: string): Promise<{ ok: boolean; error?: string }> {
  const url = new URL(`${MC_API_BASE}/user/self_staff_info`);
  url.searchParams.set("key", token);
  url.searchParams.set("version", "1.64.16");
  url.searchParams.set("pid", "5");
  url.searchParams.set("lang", "fr");
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://web.mc.app/",
      },
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Impossible de contacter Microstore pour valider la clé." };
  }
  if (!res.ok) return { ok: false, error: `Microstore HTTP ${res.status}` };
  const data = (await res.json().catch(() => null)) as { err?: number; msg?: string } | null;
  if (!data) return { ok: false, error: "Réponse Microstore invalide." };
  if (data.err === 0) return { ok: true };
  return { ok: false, error: `Clé invalide (err ${data.err}: ${data.msg ?? "?"})` };
}

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    ctx = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { token?: string; maskToken?: string }
    | null;
  const token = body?.token?.trim();
  const maskToken = body?.maskToken?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "token manquant" }, { status: 400 });
  }

  const test = await testMicrostoreKey(token);
  if (!test.ok) {
    return NextResponse.json({ error: test.error ?? "Clé invalide." }, { status: 400 });
  }

  try {
    await setSiteConfig(
      "microstore_session_key",
      encryptIfSensitive("microstore_session_key", token),
    );
    if (maskToken) {
      await setSiteConfig(
        "microstore_mask_token",
        encryptIfSensitive("microstore_mask_token", maskToken),
      );
    }
    const expSec = maskToken ? decodeMicrostoreTokenExpiration(maskToken) : null;
    if (expSec) {
      await setSiteConfig("microstore_expires_at", String(expSec));
    } else {
      await unsetSiteConfig("microstore_expires_at");
    }
    await setSiteConfig("microstore_enabled", "true");

    primeMicrostoreSessionKey(ctx.tenant.id, token);
    revalidateTag(`site-config:${ctx.tenant.id}`, "default");

    const expiresAtIso = expSec ? new Date(expSec * 1000).toISOString() : null;
    return NextResponse.json({ status: "success", expiresAt: expiresAtIso });
  } catch (err) {
    logger.error("[Microstore] import-token persist failed", { error: err });
    return NextResponse.json(
      { error: "Impossible d'enregistrer la clé Microstore." },
      { status: 500 },
    );
  }
}
