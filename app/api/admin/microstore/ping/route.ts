/**
 * POST /api/admin/microstore/ping
 *
 * Endpoint diagnostic : lit la clé Microstore stockée et fait un vrai appel
 * léger à `/user/self_staff_info` pour vérifier qu'elle est encore valide.
 * Retourne des détails précis pour aider à comprendre pourquoi une session
 * ne marche pas (concurrent use, expiration, clé absente, …).
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { getMicrostoreSessionKey, MC_API_BASE } from "@/lib/microstore-auth";

export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const key = await getMicrostoreSessionKey();
  if (!key) {
    return NextResponse.json({
      ok: false,
      stage: "no_key",
      message: "Aucune clé Microstore stockée pour ce tenant.",
    });
  }

  const url = new URL(`${MC_API_BASE}/user/self_staff_info`);
  url.searchParams.set("key", key);
  url.searchParams.set("version", "1.64.16");
  url.searchParams.set("pid", "5");
  url.searchParams.set("lang", "fr");

  const started = Date.now();
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
  } catch (err) {
    return NextResponse.json({
      ok: false,
      stage: "network",
      message: err instanceof Error ? err.message : "Erreur réseau.",
    });
  }
  const durationMs = Date.now() - started;

  const bodyText = await res.text();
  let data: { err?: number; msg?: string } | null = null;
  try {
    data = JSON.parse(bodyText);
  } catch {
    // ignore
  }

  const keyMasked = key.length > 12 ? `${key.substring(0, 4)}…${key.substring(key.length - 4)}` : "***";

  return NextResponse.json({
    ok: data?.err === 0,
    stage: "api_response",
    keyMasked,
    keyLength: key.length,
    httpStatus: res.status,
    durationMs,
    err: data?.err ?? null,
    msg: data?.msg ?? null,
    rawSnippet: bodyText.substring(0, 200),
  });
}
