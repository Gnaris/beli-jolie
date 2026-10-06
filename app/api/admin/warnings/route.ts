/**
 * GET /api/admin/warnings
 *
 * Compteurs live affichés dans la barre latérale admin (pastilles orange de
 * traductions manquantes + pastilles bleues de commandes/clients/SAV/avis
 * en attente). Appelé par `useLiveAdminWarnings()` toutes les ~25 s pour que
 * la cliente voie les pastilles bouger sans recharger la page.
 *
 * Scope tenant : la Prisma extension `tenant-scope` lit `x-tenant-id` dans
 * les headers de la requête, donc chaque appel ne voit que les données de
 * la boutique courante.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchAdminWarnings } from "@/lib/admin-warnings-server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const counts = await fetchAdminWarnings();
  return NextResponse.json(counts, {
    headers: {
      // Pas de cache HTTP : la pastille doit refléter la base en direct.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
