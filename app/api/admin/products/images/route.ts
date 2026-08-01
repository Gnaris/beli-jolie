import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enqueueImageJob } from "@/lib/image-queue";
import { prisma } from "@/lib/prisma";
import {
  productImageDir,
  productImageBaseName,
  slugify,
  withTenantSlug,
} from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/products/images
 *
 * Upload d'une image produit. Le fichier brut est stocké sur disque puis
 * un job `ImageProcessingJob` (PENDING) est inséré : la conversion en 3
 * formats WebP par sharp est faite en arrière-plan par le worker
 * `lib/image-queue.ts`. La route retourne immédiatement le chemin final
 * que prendra l'image — l'admin peut sauver le produit avec ce chemin
 * sans attendre la fin du traitement (l'image apparaîtra dès que le
 * worker aura traité ce job, suivi en direct par `ImageProcessingWidget`).
 *
 * Champs FormData :
 *   - `image`     : fichier (obligatoire)
 *   - `reference` : référence du produit (obligatoire si produit existant)
 *   - `color`     : nom de la couleur (optionnel)
 *   - `position`  : 1-based, optionnel
 *   - `productId` : ID BJ du produit si existant — sert à poser le drapeau
 *                   `*SyncRequired = true` à la fin du traitement
 *
 * Retourne `{ path: "/uploads/produits/{ref}/{ref}-{couleur}-{n}.webp", jobId }`.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const tenant = await requireCurrentTenant();

  const formData = await request.formData();
  const file = formData.get("image") as File | null;
  const reference = ((formData.get("reference") as string | null) || "").trim();
  const color = ((formData.get("color") as string | null) || "").trim();
  const productId = ((formData.get("productId") as string | null) || "").trim() || null;
  const positionRaw = (formData.get("position") as string | null) || "";
  const positionParsed = parseInt(positionRaw, 10);
  const position = Number.isFinite(positionParsed) && positionParsed > 0 ? positionParsed : 1;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/bmp", "image/heic"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté. Accepté : JPG, PNG, WEBP, GIF, TIFF, BMP." },
      { status: 400 }
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "L'image ne doit pas dépasser 10 Mo." },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    // Construit le chemin cible (identique à l'ancienne route synchrone) +
    // nonce aléatoire pour éviter toute collision quand N uploads arrivent
    // dans la même milliseconde via la nouvelle file asynchrone.
    let destDir: string;
    let basename: string;
    if (reference) {
      destDir = productImageDir(reference, tenant.slug);
      const stamp = Date.now().toString(36);
      const nonce = Math.random().toString(36).slice(2, 6);
      const head = productImageBaseName(reference, color || null, position);
      basename = `${head}-${stamp}${nonce}`;
    } else {
      destDir = withTenantSlug("uploads/produits/_brouillon", tenant.slug);
      const stamp = Date.now().toString(36);
      const nonce = Math.random().toString(36).slice(2, 6);
      const colorPart = color ? `-${slugify(color)}` : "";
      basename = `brouillon${colorPart}-${stamp}${nonce}`;
    }

    const dbPath = `/${destDir.replace(/^public\//, "")}/${basename}.webp`;
    const fileExt = mimeToExt(file.type) || "bin";

    // Résout la palette de la couleur choisie pour l'afficher dans le widget
    // « Images » (hex ou motif). Best-effort : on n'échoue pas l'upload si la
    // couleur n'est pas trouvée — le widget affichera juste un gris neutre.
    let colorHex: string | null = null;
    let colorPatternImage: string | null = null;
    if (color) {
      try {
        const paletteRow = await prisma.color.findFirst({
          where: { name: color },
          select: { hex: true, patternImage: true },
        });
        if (paletteRow) {
          colorHex = paletteRow.hex ?? null;
          colorPatternImage = paletteRow.patternImage ?? null;
        }
      } catch {
        // ignore, la palette est purement décorative
      }
    }

    const { jobId } = await enqueueImageJob({
      rawBuffer: buffer,
      fileExt,
      productId,
      destDir,
      filename: basename,
      dbPath,
      reference: reference || null,
      colorName: color || null,
      colorHex,
      colorPatternImage,
      position,
    });

    return NextResponse.json({ path: dbPath, jobId }, { status: 202 });
  } catch (err) {
    logger.error("[products/images] Enqueue error", { error: err });
    return NextResponse.json({ error: "Erreur lors de la mise en file de l'image." }, { status: 500 });
  }
}

function mimeToExt(mime: string): string | null {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/tiff": return "tif";
    case "image/bmp": return "bmp";
    case "image/heic": return "heic";
    default: return null;
  }
}
