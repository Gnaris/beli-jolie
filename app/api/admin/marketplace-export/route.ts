/**
 * POST /api/admin/marketplace-export
 *
 * Body : { marketplace: "pfs" | "efashion" | "microstore" | "ankorstore",
 *          productIds: string[] }
 *
 * Returns : `application/zip` binary with `Content-Disposition: attachment`.
 * The ZIP contains all generated Excel files and (for PFS/Efashion/Microstore)
 * a folder of images converted to JPG.
 *
 * The validator runs again here for safety even though the UI already showed
 * the preview — products that became invalid between preview and download
 * are silently skipped (Excel rows simply don't include them).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { runMarketplaceExport } from "@/lib/marketplace-excel/export-orchestrator";
import { recordMarketplaceExport } from "@/lib/marketplace-export-tracking";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const BodySchema = z.object({
  marketplace: z.enum(["pfs", "efashion", "microstore", "ankorstore", "faire"]),
  productIds: z.array(z.string().min(1)).min(1),
  mode: z.enum(["both", "excel-only", "images-only"]).optional().default("both"),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Paramètres invalides", details: parsed.error.issues },
      { status: 400 },
    );
  }

  if (parsed.data.marketplace === "ankorstore" && parsed.data.mode === "images-only") {
    return NextResponse.json(
      {
        error:
          "Ankorstore ne supporte pas l'export d'images seules : les images sont récupérées via les URLs du site.",
      },
      { status: 400 },
    );
  }
  if (parsed.data.marketplace === "faire" && parsed.data.mode === "images-only") {
    return NextResponse.json(
      {
        error:
          "Faire ne supporte pas l'export d'images seules : les images sont récupérées via les URLs du site.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runMarketplaceExport(
      parsed.data.marketplace,
      parsed.data.productIds,
      parsed.data.mode,
    );

    const ignoredCount = result.ignored.length;
    const eligibleCount = result.eligible.length;
    logger.info(
      `[marketplace-export] ${result.marketplace} : ${eligibleCount} OK, ${ignoredCount} ignorés (${result.outputType.toUpperCase()} ${result.fileBuffer.length} bytes)`,
    );

    // Horodate les produits éligibles → la liste admin pourra afficher
    // "Exporté il y a 3j" et le filtre "Jamais exporté" pourra les exclure.
    // Une erreur d'écriture ne doit pas faire échouer le téléchargement.
    try {
      await recordMarketplaceExport(
        result.marketplace,
        result.eligible.map((e) => e.productId),
      );
    } catch (err) {
      logger.error("[marketplace-export] tracking lastExportedAt failed", { error: err });
    }

    const contentType =
      result.outputType === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/zip";

    return new NextResponse(new Uint8Array(result.fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Length": String(result.fileBuffer.length),
        // Custom headers so the client can show "X exportés, Y ignorés" in a toast.
        "X-Export-Eligible": String(eligibleCount),
        "X-Export-Ignored": String(ignoredCount),
        "X-Export-Type": result.outputType,
      },
    });
  } catch (err) {
    logger.error("[marketplace-export] échec", { error: err });
    return NextResponse.json(
      {
        error: "Échec de la génération de l'export",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
