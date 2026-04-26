import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { scanPfsAttributes } from "@/lib/pfs-import";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const maxImportable = limitParam ? parseInt(limitParam, 10) : 100;
    const refsParam = searchParams.get("references");
    const references = refsParam ? refsParam.split(",").map((r) => r.trim()).filter(Boolean) : undefined;

    const scan = await scanPfsAttributes({ maxImportable, references });
    return NextResponse.json(scan);
  } catch (err) {
    logger.error("[PFS Import] scanAttributes failed", { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
