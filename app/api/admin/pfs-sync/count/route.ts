import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pfsTotalProducts } from "@/lib/pfs-api";

// ─────────────────────────────────────────────
// GET — Get total PFS product count
// ─────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const count = await pfsTotalProducts();

    return NextResponse.json(
      { count },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
        },
      },
    );
  } catch (error) {
    console.error("[PFS Count] Error fetching product count:", error);
    return NextResponse.json(
      { error: "Erreur lors de la récupération du nombre de produits" },
      { status: 500 },
    );
  }
}
