import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listImportablePfsProducts } from "@/lib/pfs-import";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const products = await listImportablePfsProducts();
    return NextResponse.json({ products, count: products.length });
  } catch (err) {
    logger.error("[PFS Import] listImportable failed", { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
