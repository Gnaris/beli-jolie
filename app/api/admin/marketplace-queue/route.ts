/**
 * /api/admin/marketplace-queue
 *
 * POST : enqueue 1+ jobs dans la file marketplace serveur
 *   body : { items: Array<{ productId, reference, productName, firstImage?, options, mode?, marketplace? }> }
 *   réponse : { created: number, items: <jobs sérialisés> }
 *
 * GET  : liste les jobs courants (non-CANCELLED, < 24h d'âge)
 *   réponse : { items: <jobs sérialisés>, generatedAt: ISO }
 *
 * Sérialisation : on remappe vers la forme attendue par le widget côté client
 * (status : QUEUED|IN_PROGRESS|AWAITING_CALLBACK|SUCCEEDED|FAILED → 'queued'|'in_progress'|'awaiting_callback'|'done').
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  serializeJob,
  type ClientEnqueueInput,
  validateEnqueueInput,
  mapMarketplaceToDb,
  mapModeToDb,
} from "@/lib/marketplace-queue-serializer";

const LIST_WINDOW_HOURS = 24;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  let body: { items?: ClientEnqueueInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const validation = validateEnqueueInput(body.items);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const created = await prisma.$transaction(
    validation.items.map((input) =>
      prisma.marketplaceRefreshJob.create({
        data: {
          productId: input.productId,
          marketplace: mapMarketplaceToDb(input.marketplace ?? "pfs"),
          mode: mapModeToDb(input.mode ?? "refresh"),
          payload: {
            reference: input.reference,
            productName: input.productName,
            firstImage: input.firstImage ?? null,
            options: input.options,
          },
          status: "QUEUED",
        },
      }),
    ),
  );

  return NextResponse.json({
    created: created.length,
    items: created.map(serializeJob),
  });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - LIST_WINDOW_HOURS * 60 * 60 * 1000);

  const jobs = await prisma.marketplaceRefreshJob.findMany({
    where: {
      status: { not: "CANCELLED" },
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    items: jobs.map(serializeJob),
    generatedAt: new Date().toISOString(),
  });
}
