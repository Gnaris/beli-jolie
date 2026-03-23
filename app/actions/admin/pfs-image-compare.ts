"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processProductImage, getImagePaths } from "@/lib/image-processor";
import { downloadImage } from "@/lib/pfs-sync";
import { unlink } from "fs/promises";
import path from "path";
import { z } from "zod";

const modificationsSchema = z.object({
  replacements: z.array(z.object({
    colorId: z.string().min(1),
    position: z.number().int().min(0).max(4),
    pfsImagePath: z.string().url(),
    replacedImageId: z.string().min(1).optional(),
  })),
  deletions: z.array(z.string().min(1)),
  reorders: z.array(z.object({
    imageId: z.string().min(1),
    newOrder: z.number().int().min(0).max(4),
  })),
});

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

interface ImageReplacement {
  colorId: string;
  position: number;
  pfsImagePath: string;
  replacedImageId?: string;
}

interface ImageModifications {
  replacements: ImageReplacement[];
  deletions: string[];
  reorders: Array<{ imageId: string; newOrder: number }>;
}

/** Delete the 3 WebP files (large, medium, thumb) from disk. */
async function deleteImageFiles(dbPath: string) {
  if (!dbPath || !dbPath.endsWith(".webp")) return;
  const paths = getImagePaths(dbPath);
  const root = process.cwd();
  for (const p of [paths.large, paths.medium, paths.thumb]) {
    try {
      await unlink(path.join(root, "public", p));
    } catch {
      // File may not exist — ignore
    }
  }
}

/**
 * Apply image modifications from PfsImageCompareModal to the existing product.
 * - Downloads PFS images and processes them to WebP (3 sizes)
 * - Deletes removed images from disk and DB
 * - Reorders existing images
 */
export async function applyImageModifications(
  productId: string,
  modifications: ImageModifications
): Promise<{ success: boolean; applied: number; error?: string }> {
  await requireAdmin();

  // Validate input schema
  const parsed = modificationsSchema.safeParse(modifications);
  if (!parsed.success) {
    return { success: false, applied: 0, error: "Données de modifications invalides." };
  }
  const validMods = parsed.data;

  let applied = 0;

  try {
    // ── 1. Apply deletions ──
    for (const imageId of validMods.deletions) {
      const img = await prisma.productColorImage.findUnique({
        where: { id: imageId },
      });
      if (img && img.productId === productId) {
        await deleteImageFiles(img.path);
        await prisma.productColorImage.delete({ where: { id: imageId } });
        applied++;
      }
    }

    // ── 2. Apply replacements (download PFS images) ──
    const ALLOWED_DOMAINS = ["static.parisfashionshops.com"];

    for (const r of validMods.replacements) {
      // Validate PFS image URL domain
      try {
        const url = new URL(r.pfsImagePath);
        if (!ALLOWED_DOMAINS.includes(url.hostname)) {
          console.warn(`[applyImageModifications] Blocked download from unauthorized domain: ${url.hostname}`);
          continue;
        }
      } catch {
        console.warn(`[applyImageModifications] Invalid URL: ${r.pfsImagePath}`);
        continue;
      }

      // Verify variant exists before downloading
      const variant = await prisma.productColor.findFirst({
        where: { productId, colorId: r.colorId },
      });
      if (!variant) {
        console.warn(`[applyImageModifications] No variant found for colorId=${r.colorId} on product=${productId}`);
        continue;
      }

      // Verify replacedImageId belongs to this product (IDOR protection)
      if (r.replacedImageId) {
        const targetImg = await prisma.productColorImage.findUnique({
          where: { id: r.replacedImageId },
        });
        if (!targetImg || targetImg.productId !== productId) {
          console.warn(`[applyImageModifications] IDOR blocked: image ${r.replacedImageId} does not belong to product ${productId}`);
          continue;
        }
      }

      // Download image from PFS CDN
      const buffer = await downloadImage(r.pfsImagePath, 2);
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = await processProductImage(
        buffer,
        "public/uploads/products",
        filename
      );

      if (r.replacedImageId) {
        // Replace existing image: delete old files, update record
        const oldImg = await prisma.productColorImage.findUnique({
          where: { id: r.replacedImageId },
        });
        if (oldImg) {
          await deleteImageFiles(oldImg.path);
          await prisma.productColorImage.update({
            where: { id: r.replacedImageId },
            data: { path: result.dbPath, order: r.position },
          });
        }
      } else {
        // New image in empty slot
        await prisma.productColorImage.create({
          data: {
            productId,
            colorId: r.colorId,
            productColorId: variant.id,
            path: result.dbPath,
            order: r.position,
          },
        });
      }
      applied++;
    }

    // ── 3. Apply reorders ──
    for (const r of validMods.reorders) {
      const img = await prisma.productColorImage.findUnique({
        where: { id: r.imageId },
      });
      if (img && img.productId === productId) {
        await prisma.productColorImage.update({
          where: { id: r.imageId },
          data: { order: r.newOrder },
        });
        applied++;
      }
    }

    revalidateTag("products", "default");

    return { success: true, applied };
  } catch (err) {
    console.error("[applyImageModifications] Error:", err);
    return {
      success: false,
      applied,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
