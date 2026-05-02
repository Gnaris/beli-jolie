/**
 * /api/admin/pfs-refresh — endpoint dédié au widget de rafraîchissement PFS
 * (composant `PfsRefreshContext`).
 *
 * Le widget envoie juste `{ productId }` et attend `{ success, error? }` —
 * c'est un wrapper léger autour de `refreshProductOnMarketplaces` configuré
 * pour ne toucher qu'à PFS (pas de bump local).
 */
"use server";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { refreshProductOnMarketplaces } from "@/app/actions/admin/marketplace-refresh";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json(
      { success: false, error: "Accès non autorisé." },
      { status: 401 },
    );
  }

  let body: { productId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Corps de requête invalide." },
      { status: 400 },
    );
  }

  const productId = body?.productId;
  if (!productId || typeof productId !== "string") {
    return NextResponse.json(
      { success: false, error: "productId requis." },
      { status: 400 },
    );
  }

  try {
    const outcome = await refreshProductOnMarketplaces(productId, {
      local: false,
      pfs: true,
    });

    if (outcome.pfs?.status === "ok") {
      return NextResponse.json({ success: true, archived: outcome.pfs.archived });
    }
    if (outcome.pfs?.status === "not_found") {
      return NextResponse.json({ success: false, error: outcome.pfs.message });
    }
    return NextResponse.json({
      success: false,
      error: outcome.pfs?.message ?? "Erreur inconnue lors du refresh PFS.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Erreur inconnue.",
      },
      { status: 500 },
    );
  }
}
