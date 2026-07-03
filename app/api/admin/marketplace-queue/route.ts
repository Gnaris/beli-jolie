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
import { computeScheduledTimestamps } from "@/lib/marketplace-queue-scheduling";

const LIST_WINDOW_HOURS = 24;
// Borne large : ~30 jours. Empêche les intervalles absurdes qui feraient
// tenir des jobs QUEUED trop longtemps dans la table.
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  let body: { items?: ClientEnqueueInput[]; intervalMs?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const validation = validateEnqueueInput(body.items);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // intervalMs facultatif : absent, 0, ou négatif → pas d'étalement (démarrage immédiat).
  const rawInterval =
    typeof body.intervalMs === "number" && Number.isFinite(body.intervalMs)
      ? body.intervalMs
      : 0;
  if (rawInterval < 0 || rawInterval > MAX_INTERVAL_MS) {
    return NextResponse.json(
      { error: `intervalMs doit être entre 0 et ${MAX_INTERVAL_MS}.` },
      { status: 400 },
    );
  }

  // Calcule pour chaque input (dans l'ordre d'arrivée) la date de départ.
  // Groupé par productId : les items d'un même produit partent en même temps.
  const schedule = computeScheduledTimestamps(
    validation.items.map((i) => i.productId),
    rawInterval,
    new Date(),
  );

  const created = await prisma.$transaction(
    validation.items.map((input, index) =>
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
          scheduledFor: schedule[index] ?? null,
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
