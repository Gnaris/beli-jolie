import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { refreshProductOnMarketplaces } from "@/app/actions/admin/marketplace-refresh";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/products/import/images/push-marketplaces
 *
 * Déclenche un refresh par produit sur les marketplaces sélectionnées,
 * après un import bulk d'images. Continue en cas d'erreur sur un produit
 * (ne fait jamais throw global).
 *
 * Body : { items: Array<{ productId: string; marketplaces: Array<"pfs"|"ankorstore"|"efashion"> }> }
 * Réponse : { results: Array<{ productId: string; success: boolean; messages: string[] }> }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: {
    items?: Array<{
      productId: string;
      marketplaces: Array<"pfs" | "ankorstore" | "efashion">;
    }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Aucun produit à pousser." }, { status: 400 });
  }

  const results: Array<{
    productId: string;
    success: boolean;
    messages: string[];
  }> = [];

  for (const item of items) {
    const messages: string[] = [];
    let success = true;

    try {
      const outcome = await refreshProductOnMarketplaces(item.productId, {
        local: false,
        pfs: item.marketplaces.includes("pfs"),
        ankorstore: item.marketplaces.includes("ankorstore"),
        efashion: item.marketplaces.includes("efashion"),
      });

      if (outcome.pfs) {
        if (outcome.pfs.status === "ok") messages.push("PFS : OK");
        else { messages.push(`PFS : ${outcome.pfs.message}`); success = false; }
      }
      if (outcome.ankorstore) {
        if (outcome.ankorstore.status === "queued") messages.push("Ankorstore : en file d'attente");
        else { messages.push(`Ankorstore : ${outcome.ankorstore.message}`); success = false; }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[push-marketplaces] échec produit", { productId: item.productId, error: message });
      messages.push(message);
      success = false;
    }

    results.push({ productId: item.productId, success, messages });
  }

  return NextResponse.json({ results });
}
