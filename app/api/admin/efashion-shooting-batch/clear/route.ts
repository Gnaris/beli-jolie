/**
 * /api/admin/efashion-shooting-batch/clear
 *
 * POST : vide entièrement la file d'attente shooting eFashion
 *        (bouton « Tout vider » du drawer). Retourne le nombre d'items retirés.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { clearEfashionShootingBatch } from "@/app/actions/admin/efashion-shooting-batch";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }
  const res = await clearEfashionShootingBatch();
  return NextResponse.json({ success: true, removedCount: res.removedCount });
}
