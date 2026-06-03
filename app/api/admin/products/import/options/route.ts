/**
 * GET /api/admin/products/import/options
 *
 * Retourne toutes les listes d'entités utilisées dans l'écran de récapitulatif
 * d'import (dropdowns avec recherche + création à la volée). Évite N appels
 * séparés. Réponse compacte : juste id + name (+ relation parent pour les
 * sous-catégories, + hex pour les couleurs).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface ImportOption {
  id: string;
  name: string;
}
export interface ImportSubCategoryOption extends ImportOption {
  categoryId: string;
  categoryName: string;
}
export interface ImportColorOption extends ImportOption {
  hex: string | null;
  patternImage: string | null;
}
export interface ImportHsCodeOption {
  id: string;
  code: string;
  label: string | null;
}

export interface ImportOptionsResponse {
  categories: ImportOption[];
  subCategories: ImportSubCategoryOption[];
  colors: ImportColorOption[];
  compositions: ImportOption[];
  countries: ImportOption[];
  seasons: ImportOption[];
  hsCodes: ImportHsCodeOption[];
  tags: ImportOption[];
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const [categories, subCategories, colors, compositions, countries, seasons, hsCodes, tags] =
      await Promise.all([
        prisma.category.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.subCategory.findMany({
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            categoryId: true,
            category: { select: { name: true } },
          },
        }),
        prisma.color.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, hex: true, patternImage: true },
        }),
        prisma.composition.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.manufacturingCountry.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.season.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.hsCode.findMany({
          orderBy: { code: "asc" },
          select: { id: true, code: true, label: true },
        }),
        prisma.tag.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ]);

    const payload: ImportOptionsResponse = {
      categories,
      subCategories: subCategories.map((s) => ({
        id: s.id,
        name: s.name,
        categoryId: s.categoryId,
        categoryName: s.category.name,
      })),
      colors,
      compositions,
      countries,
      seasons,
      hsCodes,
      tags,
    };

    return NextResponse.json(payload);
  } catch (err) {
    logger.error("[import/options]", { error: err });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur." },
      { status: 500 },
    );
  }
}
