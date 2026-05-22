import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { efashionFetch } from "@/lib/efashion-client";
import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetMe } from "@/lib/efashion-api";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/efashion-image?id={efashionProductId}
 *
 * Proxy d'image pour la modale de liaison eFashion. Les images eFashion sont
 * servies depuis `wapi.efashion-paris.com` derrière un cookie de session (le
 * navigateur de l'admin n'a pas ce cookie). On les récupère donc côté serveur
 * via `efashionFetch` (qui gère le cookie jar) et on les re-sert.
 *
 * Réservée aux admins. URL stable : permet le cache navigateur.
 */

// Cache module-level du vendor id (évite 1 appel GraphQL par image).
// Nettoyé au reboot du process — ce qui suffit largement pour ce cas d'usage.
let cachedVendorId: number | null = null;

async function resolveVendorId(): Promise<number> {
  if (cachedVendorId !== null) return cachedVendorId;
  const me = await efashionGetMe();
  cachedVendorId = me.id_vendeur;
  return cachedVendorId;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const idParam = new URL(request.url).searchParams.get("id");
  const idProduit = idParam ? parseInt(idParam, 10) : NaN;
  if (!Number.isFinite(idProduit) || idProduit <= 0) {
    return NextResponse.json({ error: "id invalide" }, { status: 400 });
  }

  try {
    await ensureEfashionSession();
    const vendorId = await resolveVendorId();
    const efashionUrl =
      `/uploads/products/${vendorId}/Produits/accueil/${idProduit}-c.jpg`;

    const res = await efashionFetch(efashionUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: `eFashion a répondu ${res.status}` },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/jpeg";

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buf.length),
        // Cache navigateur 1h — les photos eFashion ne changent quasi jamais
        // pour un id_produit donné, mais on garde une durée raisonnable.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    logger.warn("[eFashion Image Proxy] échec", { idProduit, error });
    return NextResponse.json(
      { error: "Impossible de récupérer l'image" },
      { status: 502 },
    );
  }
}
