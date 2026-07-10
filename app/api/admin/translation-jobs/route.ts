import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  enqueueTranslationJob,
  listRecentTranslationJobs,
  dismissDoneTranslationJobs,
  SUPPORTED_ENTITY_TYPES,
  type TranslationEntityType,
} from "@/lib/translation-queue";

/**
 * Routes de la file d'attente des lots de traduction.
 *
 * GET    /api/admin/translation-jobs        → jobs récents (polling tiroir)
 * POST   /api/admin/translation-jobs        → enqueue nouveau lot
 * DELETE /api/admin/translation-jobs?status=done → dismiss tous les DONE/FAILED
 */

async function guardAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  return null;
}

export async function GET() {
  const guard = await guardAdmin();
  if (guard) return guard;
  const jobs = await listRecentTranslationJobs();
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const guard = await guardAdmin();
  if (guard) return guard;

  const body = (await req.json().catch(() => null)) as
    | { section?: unknown; entityType?: unknown; items?: unknown }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const section = typeof body.section === "string" ? body.section.trim() : "";
  const entityType = typeof body.entityType === "string" ? body.entityType.trim() : "";
  const rawItems = Array.isArray(body.items) ? body.items : null;

  if (!section) {
    return NextResponse.json({ error: "Section requise" }, { status: 400 });
  }
  if (!entityType || !(SUPPORTED_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return NextResponse.json({ error: "Type d'entité non supporté" }, { status: 400 });
  }
  if (!rawItems || rawItems.length === 0) {
    return NextResponse.json({ error: "Aucun élément à traduire" }, { status: 400 });
  }

  const items = rawItems
    .filter(
      (it: unknown): it is { id: string; text: string } =>
        typeof it === "object" &&
        it !== null &&
        typeof (it as { id?: unknown }).id === "string" &&
        typeof (it as { text?: unknown }).text === "string",
    )
    .filter((it) => it.id.length > 0 && it.text.trim().length > 0);

  if (items.length === 0) {
    return NextResponse.json({ error: "Aucun élément valide" }, { status: 400 });
  }

  const { jobId } = await enqueueTranslationJob({
    section,
    entityType: entityType as TranslationEntityType,
    items,
  });
  return NextResponse.json({ jobId });
}

export async function DELETE(req: NextRequest) {
  const guard = await guardAdmin();
  if (guard) return guard;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  if (status !== "done") {
    return NextResponse.json({ error: "Statut non pris en charge" }, { status: 400 });
  }
  const removed = await dismissDoneTranslationJobs();
  return NextResponse.json({ removed });
}
