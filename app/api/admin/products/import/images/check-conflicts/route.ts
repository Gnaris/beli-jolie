import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeColorName } from "@/lib/import-processor";

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
            subColors: { include: { color: true } },
            images: { select: { order: true, path: true } },
          },
        },
      },
    });

    const productMap = new Map(products.map((p) => [p.reference.toUpperCase(), p]));

    const conflicts: Conflict[] = [];

    for (const file of files) {
      const product = productMap.get(file.reference.toUpperCase());
      if (!product) continue; // product not found — not a conflict, just an error at import time

      // Match color
      const fileColorParts = file.color.split(",").map((c) => normalizeColorName(c.trim())).sort();

      let matchingVariants = product.colors.filter((pc) => {
        const variantColors = [
          normalizeColorName(pc.color.name),
          ...pc.subColors.map((sc) => normalizeColorName(sc.color.name)),
        ].sort();
        return variantColors.length === fileColorParts.length &&
          variantColors.every((c, i) => c === fileColorParts[i]);
      });

      // Fallback: single color
      if (matchingVariants.length === 0 && fileColorParts.length === 1) {
        matchingVariants = product.colors.filter(
          (pc) => normalizeColorName(pc.color.name) === fileColorParts[0]
        );
      }

      if (matchingVariants.length === 0) continue; // color not found — not a conflict

      const matchedVariant = matchingVariants[0];
      const targetOrder = file.position - 1; // convert 1-based to 0-based

      // Check if an image already exists at this order
      const existing = matchedVariant.images.find((img) => img.order === targetOrder);
      if (existing) {
        // Compute available positions (1-based) for this variant
        const usedOrders = new Set(matchedVariant.images.map((img) => img.order));
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
    console.error("[check-conflicts]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur." },
      { status: 500 }
    );
  }
}
