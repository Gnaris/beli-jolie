"use server";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  refreshProductOnMarketplaces,
  type MarketplaceRefreshOptions,
  type MarketplaceRefreshOutcome,
} from "@/app/actions/admin/marketplace-refresh";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const body = await req.json();
  const { productId, options } = body as {
    productId: string;
    options: MarketplaceRefreshOptions;
  };

  if (!productId || !options) {
    return NextResponse.json({ error: "productId et options requis." }, { status: 400 });
  }

  try {
    const outcome: MarketplaceRefreshOutcome = await refreshProductOnMarketplaces(
      productId,
      options,
    );
    return NextResponse.json(outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
