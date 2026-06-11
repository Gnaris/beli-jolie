import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeColorName } from "@/lib/import-processor";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// POST — Check for position conflicts before image import
// Input: { files: { filename, reference, color, position }[] }
// Output: { conflicts: { filename, reference, color, position, existingImagePath, availablePositions }[] }
// ─────────────────────────────────────────────

interface FileEntry {
  filename: string;
  reference: string;
  color: string;
  position: number;
}

interface Conflict {
  filename: string;
  reference: string;
  color: string;
  position: number;
  existingImagePath: string;
  availablePositions: number[]; // 1-based
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const files: FileEntry[] = body.files ?? [];

    if (files.length === 0) {
      return NextResponse.json({ conflicts: [] });
    }

    // Collect unique references
    const refs = [...new Set(files.map((f) => f.reference.toUpperCase()))];

    // Load products with their variants + images
    const products = await prisma.product.findMany({
      where: { reference: { in: refs } },
      include: {
        colors: {
          include: {
            color: true,
            images: { select: { order: true, path: true } },
          },
        },
      },
    });

    const productMap = new Map(products.map((p) => [p.reference.toUpperCase(), p]));

    // ⚠️ La contrainte unique est sur (productId, colorId, order), pas
    // (productColorId, order). On agrège les images de toutes les variantes
    // d'un produit qui partagent la même couleur — c'est la portée réelle
    // qui peut générer une collision.
    const imagesByScope = new Map<string, { order: number; path: string }[]>();
    for (const product of products) {
      for (const pc of product.colors) {
        if (!pc.colorId) continue;
        const scopeKey = `${product.id}::${pc.colorId}`;
        const existing = imagesByScope.get(scopeKey) ?? [];
        imagesByScope.set(scopeKey, [...existing, ...pc.images]);
      }
    }

    const conflicts: Conflict[] = [];

    for (const file of files) {
      const product = productMap.get(file.reference.toUpperCase());
      if (!product) continue; // product not found — not a conflict, just an error at import time

      // Match color (single color only)
      const fileColorName = normalizeColorName(file.color.trim());

      const matchingVariants = product.colors.filter(
        (pc) => pc.color && normalizeColorName(pc.color.name) === fileColorName
      );

      if (matchingVariants.length === 0) continue; // color not found — not a conflict

      const matchedVariant = matchingVariants[0];
      const targetOrder = file.position - 1; // convert 1-based to 0-based

      const scopeKey = `${product.id}::${matchedVariant.colorId}`;
      const scopeImages = imagesByScope.get(scopeKey) ?? [];

      const existing = scopeImages.find((img) => img.order === targetOrder);
      if (existing) {
        const usedOrders = new Set(scopeImages.map((img) => img.order));
        const available: number[] = [];
        for (let pos = 1; pos <= 10; pos++) {
          if (!usedOrders.has(pos - 1)) available.push(pos);
        }

        conflicts.push({
          filename: file.filename,
          reference: file.reference,
          color: file.color,
          position: file.position,
          existingImagePath: existing.path,
          availablePositions: available,
        });
      }
    }

    return NextResponse.json({ conflicts });
  } catch (err) {
    logger.error("[check-conflicts]", { error: err });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur." },
      { status: 500 }
    );
  }
}
