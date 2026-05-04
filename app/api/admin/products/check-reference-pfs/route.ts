import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsCheckReference } from "@/lib/pfs-api";
import { getCachedHasPfsConfig } from "@/lib/cached-data";
import { logger } from "@/lib/logger";

type CheckResponse =
  | { status: "ok" }
  | { status: "exists"; message: string }
  | { status: "not_configured" }
  | { status: "error"; message: string };

export async function POST(request: Request): Promise<NextResponse<CheckResponse>> {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json(
      { status: "error", message: "Non autorisé" },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      reference?: string;
      currentProductId?: string;
    };

    const reference = (body.reference ?? "").trim().replace(/\s/g, "").toUpperCase();
    if (!reference) {
      return NextResponse.json({ status: "ok" });
    }

    const hasConfig = await getCachedHasPfsConfig();
    if (!hasConfig) {
      return NextResponse.json({ status: "not_configured" });
    }

    const pfsResult = await pfsCheckReference(reference);
    if (!pfsResult.exists || !pfsResult.product) {
      return NextResponse.json({ status: "ok" });
    }

    if (body.currentProductId) {
      const local = await prisma.product.findUnique({
        where: { id: body.currentProductId },
        select: { pfsProductId: true },
      });
      if (local?.pfsProductId && local.pfsProductId === pfsResult.product.id) {
        return NextResponse.json({ status: "ok" });
      }
    }

    return NextResponse.json({
      status: "exists",
      message: "Cette référence est déjà utilisée sur Paris Fashion Shop.",
    });
  } catch (err) {
    logger.error("[check-reference-pfs] failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({
      status: "error",
      message: "Vérification PFS impossible pour le moment.",
    });
  }
}
