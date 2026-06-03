/**
 * /api/admin/efashion-shooting-batch/commit
 *
 * POST : déclenche l'envoi groupé à eFashion (fire-and-forget). Retourne
 * immédiatement avec le nombre de produits embarqués. Le batch tourne en
 * arrière-plan et les erreurs sont loggées + visibles dans les Insights.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { commitEfashionShootingBatch } from "@/app/actions/admin/efashion-shooting-batch";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }
  const res = await commitEfashionShootingBatch();
  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({
    success: true,
    publishCount: res.publishCount,
    refreshCount: res.refreshCount,
  });
}
