"use server";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ankorstoreSearchProducts } from "@/lib/ankorstore-api";
import { extractReference } from "@/lib/ankorstore-match";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const products = await ankorstoreSearchProducts(query, 20);
    const results = products.map((p) => ({
      id: p.id,
      name: p.name,
      extractedRef: extractReference(p),
      variantCount: p.variants.length,
      firstImageUrl: p.images[0]?.url ?? null,
    }));
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
