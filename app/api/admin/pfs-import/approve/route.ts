import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { approveAndImportPfsProduct } from "@/lib/pfs-import";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const { pfsId } = body as { pfsId?: unknown };
  if (typeof pfsId !== "string" || pfsId.trim().length === 0) {
    return NextResponse.json({ error: "pfsId requis" }, { status: 400 });
  }

  try {
    const result = await approveAndImportPfsProduct(pfsId.trim());
    revalidateTag("products", "default");
    return NextResponse.json(result);
  } catch (err) {
    logger.error("[PFS Import] approveProduct failed", { err: (err as Error).message, pfsId });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
