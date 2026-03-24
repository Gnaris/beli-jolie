import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pfsGetColors, pfsGetCategories, pfsGetCompositions, pfsGetCountries, pfsGetCollections, pfsGetFamilies, pfsGetGenders, pfsGetSizes } from "@/lib/pfs-api-write";

/**
 * GET /api/admin/pfs-sync/attributes
 * Fetch available PFS attributes (colors, categories, compositions, families, genders) for mapping UI.
 * Admin only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const [colors, categories, compositions, countries, collections, families, genders, sizes] = await Promise.all([
      pfsGetColors(),
      pfsGetCategories(),
      pfsGetCompositions(),
      pfsGetCountries(),
      pfsGetCollections(),
      pfsGetFamilies(),
      pfsGetGenders(),
      pfsGetSizes(),
    ]);

    return NextResponse.json({ colors, categories, compositions, countries, collections, families, genders, sizes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
