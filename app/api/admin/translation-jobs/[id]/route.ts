import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dismissTranslationJob } from "@/lib/translation-queue";

/**
 * DELETE /api/admin/translation-jobs/[id]
 * Cache un job du tiroir sans le supprimer (soft delete via dismissedAt).
 * Utilisé par le bouton croix sur une ligne DONE/FAILED du tiroir.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  await dismissTranslationJob(id);
  return NextResponse.json({ ok: true });
}
