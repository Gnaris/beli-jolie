import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listRecentImageJobs, retryFailedImageJob } from "@/lib/image-queue";

/**
 * GET /api/admin/products/images/progress?productId=...
 *
 * Renvoie les jobs `ImageProcessingJob` actifs ou récemment terminés (6 h max).
 * Pollé toutes les ~2 s par `ImageProcessingWidget` pour afficher la
 * progression en temps réel. Si `productId` est fourni, ne renvoie que les
 * jobs de ce produit (utilisé pour le mini-indicateur sur la fiche produit).
 *
 * Réponse :
 *   {
 *     jobs: [{ id, productId, status, error, createdAt, completedAt }, ...]
 *   }
 *
 * POST /api/admin/products/images/progress
 *   body: { action: "retry", jobId: string }
 *
 * Relance un job FAILED → repasse en PENDING (le worker le reprendra).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const productId = request.nextUrl.searchParams.get("productId") || undefined;
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(500, parseInt(limitRaw, 10))) : undefined;

  const jobs = await listRecentImageJobs({ productId, limit });
  return NextResponse.json({ jobs }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const action = (body as { action?: string }).action;
  const jobId = (body as { jobId?: string }).jobId;

  if (action !== "retry" || !jobId) {
    return NextResponse.json({ error: "Action ou jobId manquant." }, { status: 400 });
  }

  await retryFailedImageJob(jobId);
  return NextResponse.json({ success: true }, { status: 200 });
}
