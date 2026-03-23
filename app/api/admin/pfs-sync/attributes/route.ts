import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pfsGetColors, pfsGetCategories, pfsGetCompositions } from "@/lib/pfs-api-write";

/**
 * GET /api/admin/pfs-sync/attributes
 * Fetch available PFS attributes (colors, categories, compositions) for mapping UI.
 * Admin only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const [colors, categories, compositions] = await Promise.all([
      pfsGetColors(),
      pfsGetCategories(),
      pfsGetCompositions(),
    ]);

    return NextResponse.json({ colors, categories, compositions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
