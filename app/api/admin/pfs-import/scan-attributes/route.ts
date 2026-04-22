import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { scanPfsAttributes } from "@/lib/pfs-import";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const scan = await scanPfsAttributes();
    return NextResponse.json(scan);
  } catch (err) {
    logger.error("[PFS Import] scanAttributes failed", { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
