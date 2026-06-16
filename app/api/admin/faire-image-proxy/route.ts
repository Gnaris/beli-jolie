/**
 * Proxy d'image Faire — sert les images `cdn.faire.com` via notre domaine
 * pour contourner les bloqueurs navigateur (uBlock, Privacy Badger, etc.)
 * qui ciblent les CDN tiers.
 *
 * GET /api/admin/faire-image-proxy?url=<encoded cdn.faire.com URL>
 *
 * Sécurité :
 *  - Réservé aux admins (cohérent avec les autres endpoints `/api/admin/*`).
 *  - Whitelist STRICTE de l'origine : seules les URLs sur `cdn.faire.com`
 *    sont autorisées, pour éviter tout SSRF.
 *  - Headers cache long côté navigateur (les CDN Faire sont content-addressed,
 *    donc l'URL change si l'image change — safe de cacher 1 an).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";

const ALLOWED_HOST = "cdn.faire.com";
const ONE_YEAR_SECONDS = 31_536_000;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  // Whitelist stricte
  if (target.protocol !== "https:" || target.hostname !== ALLOWED_HOST) {
    return NextResponse.json({ error: "host not allowed" }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        // Faire est derrière Cloudflare — UA "bot" déclenche 403.
        "User-Agent":
          "Mozilla/5.0 (compatible; BeliJolie/1.0; +https://beliandjolie.com)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!upstream.ok) {
      logger.warn("[Faire Image Proxy] upstream failed", {
        status: upstream.status,
        url: target.toString(),
      });
      return new NextResponse(null, { status: upstream.status });
    }
    const contentType = upstream.headers.get("content-type") ?? "image/webp";
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
      },
    });
  } catch (err) {
    logger.warn("[Faire Image Proxy] fetch threw", {
      error: String(err),
      url: target.toString(),
    });
    return new NextResponse(null, { status: 502 });
  }
}
