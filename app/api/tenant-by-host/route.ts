import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Endpoint interne utilisé par le middleware pour résoudre un `Host` HTTP
 * en identifiant de boutique (tenant). Le middleware cache la réponse
 * en mémoire 60 s pour éviter un round-trip DB par requête.
 *
 * Retourne :
 *   - 200 { tenantId, slug, name } si le host est mappé à une boutique active
 *   - 404 { error: "unknown_host" } si aucune boutique ne revendique ce host
 *   - 503 { error: "db_unreachable" } si la BDD est en carafe
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host")?.toLowerCase();
  if (!host) {
    return NextResponse.json({ error: "missing_host" }, { status: 400 });
  }

  try {
    const mapping = await prisma.tenantDomain.findUnique({
      where: { host },
      include: { tenant: true },
    });

    if (!mapping || !mapping.tenant || !mapping.tenant.isActive) {
      return NextResponse.json(
        { error: "unknown_host" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        tenantId: mapping.tenant.id,
        slug: mapping.tenant.slug,
        name: mapping.tenant.name,
      },
      { headers: { "Cache-Control": "public, s-maxage=60" } }
    );
  } catch (err) {
    logger.error("[tenant-by-host] DB unreachable", { host, error: err });
    return NextResponse.json(
      { error: "db_unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
