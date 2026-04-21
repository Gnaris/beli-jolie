import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildMarketplaceArchive } from "@/lib/marketplace-excel/build-archive";
import { logger } from "@/lib/logger";

export const maxDuration = 300; // 5 min — image download + sharp conversion can take time

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

  const { productIds, includePfs, includeAnkorstore } = body as {
    productIds?: unknown;
    includePfs?: unknown;
    includeAnkorstore?: unknown;
  };

  if (!Array.isArray(productIds) || productIds.length === 0 || !productIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "productIds (string[]) requis" }, { status: 400 });
  }
  if (includePfs !== true && includeAnkorstore !== true) {
    return NextResponse.json({ error: "Sélectionner au moins un marketplace" }, { status: 400 });
  }

  try {
    const { zipBuffer, filename, warnings, counts } = await buildMarketplaceArchive({
      productIds: productIds as string[],
      includePfs: includePfs === true,
      includeAnkorstore: includeAnkorstore === true,
    });

    logger.info("[marketplace-export] archive built", { ...counts, warnings: warnings.length, filename });

    // Strict gate: any warning blocks the download so the admin must fix
    // the underlying data before re-exporting.
    if (warnings.length > 0) {
      return NextResponse.json(
        {
          error: "Export bloqué : avertissements à corriger",
          warnings,
          counts,
        },
        { status: 422 },
      );
    }

    return new NextResponse(zipBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(zipBuffer.length),
        "X-Export-Warnings": "0",
        "X-Export-Products": String(counts.products),
        "X-Export-Variants": String(counts.variants),
        "X-Export-Images": String(counts.images),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[marketplace-export] failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
