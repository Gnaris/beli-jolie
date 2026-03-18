/**
 * POST /api/admin/products/import/draft/[id]/fix
 *
 * Auto-fix an error in a draft row by creating missing entities.
 *
 * body: {
 *   action: "create_category" | "create_color"
 *   categoryName?: string        (for create_category)
 *   colorName?: string           (for create_color)
 *   colorHex?: string            (for create_color, default #9CA3AF)
 * }
 *
 * Returns: { ok: true, entity: {...} } — caller then retries the row.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const draft = await prisma.importDraft.findUnique({ where: { id } });
  if (!draft || draft.adminId !== session.user.id) {
    return NextResponse.json({ error: "Brouillon introuvable" }, { status: 404 });
  }

  const body: {
    action: "create_category" | "create_color";
    categoryName?: string;
    colorName?: string;
    colorHex?: string;
  } = await req.json();

  try {
    if (body.action === "create_category") {
      const name = body.categoryName?.trim();
      if (!name) return NextResponse.json({ error: "Nom de catégorie requis." }, { status: 400 });

      const existing = await prisma.category.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const category = await prisma.category.create({ data: { name, slug } });
      return NextResponse.json({ ok: true, entity: category });
    }

    if (body.action === "create_color") {
      const name = body.colorName?.trim();
      const hex = body.colorHex?.trim() || "#9CA3AF";
      if (!name) return NextResponse.json({ error: "Nom de couleur requis." }, { status: 400 });

      const existing = await prisma.color.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const color = await prisma.color.create({ data: { name, hex } });
      return NextResponse.json({ ok: true, entity: color });
    }

    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (err) {
    console.error("[draft/fix]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 500 });
  }
}
