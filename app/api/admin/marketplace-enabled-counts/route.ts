/**
 * POST /api/admin/marketplace-enabled-counts
 *
 * Compteurs "combien de produits ont chaque marketplace activé/désactivé"
 * parmi une liste d'IDs. Utilisé par la modale de rafraîchissement pour
 * afficher en amont combien seront traités et combien seront sautés à cause
 * de la désactivation (Product.*Enabled = false).
 *
 * Body :  { productIds: string[] }
 * Réponse :
 *   {
 *     pfs:        { enabled: number, disabled: number },
 *     ankorstore: { enabled: number, disabled: number },
 *     efashion:   { enabled: number, disabled: number },
 *     faire:      { enabled: number, disabled: number },
 *   }
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getProductsMarketplaceEnabled } from "@/lib/marketplace-enabled";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  let body: { productIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  const ids = Array.isArray(body.productIds)
    ? body.productIds.filter((v): v is string => typeof v === "string")
    : [];

  const counts = {
    pfs: { enabled: 0, disabled: 0 },
    ankorstore: { enabled: 0, disabled: 0 },
    efashion: { enabled: 0, disabled: 0 },
    faire: { enabled: 0, disabled: 0 },
    microstore: { enabled: 0, disabled: 0 },
  };

  if (ids.length === 0) {
    return NextResponse.json(counts);
  }

  const map = await getProductsMarketplaceEnabled(ids);
  for (const id of ids) {
    const flags = map.get(id);
    if (!flags) continue; // ID inconnu — ignoré
    (["pfs", "ankorstore", "efashion", "faire", "microstore"] as const).forEach((k) => {
      if (flags[k]) counts[k].enabled += 1;
      else counts[k].disabled += 1;
    });
  }

  return NextResponse.json(counts);
}
