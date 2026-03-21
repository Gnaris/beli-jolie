import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { retryPfsProducts } from "@/lib/pfs-sync";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const references = body.references as string[];

    if (!Array.isArray(references) || references.length === 0) {
      return NextResponse.json({ error: "references[] requis" }, { status: 400 });
    }

    if (references.length > 50) {
      return NextResponse.json({ error: "Maximum 50 références par requête" }, { status: 400 });
    }

    const results = await retryPfsProducts(references);

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
