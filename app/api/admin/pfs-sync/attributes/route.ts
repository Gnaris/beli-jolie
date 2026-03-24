import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pfsGetColors, pfsGetCategories, pfsGetCompositions, pfsGetCountries, pfsGetCollections, pfsGetFamilies, pfsGetGenders } from "@/lib/pfs-api-write";

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
    const [colors, categories, compositions, countries, collections, families, genders] = await Promise.all([
      pfsGetColors(),
      pfsGetCategories(),
      pfsGetCompositions(),
      pfsGetCountries(),
      pfsGetCollections(),
      pfsGetFamilies(),
      pfsGetGenders(),
    ]);

    return NextResponse.json({ colors, categories, compositions, countries, collections, families, genders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
