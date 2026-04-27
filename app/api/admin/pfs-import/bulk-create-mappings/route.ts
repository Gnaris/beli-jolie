import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createOrLinkMapping, type PfsAttributeType } from "@/lib/pfs-import";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

const ALLOWED_TYPES: PfsAttributeType[] = ["category", "color", "composition", "country", "season", "size"];

interface BulkItem {
  type: string;
  pfsRef: string;
  label: string;
  pfsGender?: string;
  pfsFamilyName?: string;
  pfsCategoryName?: string;
  hex?: string | null;
}

/**
 * POST — Crée toutes les correspondances manquantes en une seule requête.
 * Body: { items: BulkItem[] }
 * Retourne: { results: { pfsRef, type, id, name, ok, error? }[] }
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items requis (tableau non vide)" }, { status: 400 });
  }

  const results: { pfsRef: string; type: string; id?: string; name?: string; ok: boolean; error?: string }[] = [];
  const tagsToInvalidate = new Set<string>();

  const tagByType: Record<string, string> = {
    category: "categories",
    color: "colors",
    composition: "compositions",
    country: "countries",
    season: "seasons",
    size: "sizes",
  };

  for (const item of items as BulkItem[]) {
    const { type, pfsRef, label, pfsGender, pfsFamilyName, pfsCategoryName, hex } = item;
    if (!type || !ALLOWED_TYPES.includes(type as PfsAttributeType) || !pfsRef?.trim() || !label?.trim()) {
      results.push({ pfsRef: pfsRef ?? "", type: type ?? "", ok: false, error: "Données invalides" });
      continue;
    }
    try {
      const result = await createOrLinkMapping({
        type: type as PfsAttributeType,
        pfsRef: pfsRef.trim(),
        label: label.trim(),
        pfsGender,
        pfsFamilyName,
        pfsCategoryName,
        hex: typeof hex === "string" ? hex : null,
      });
      results.push({ pfsRef, type, id: result.id, name: result.name, ok: true });
      tagsToInvalidate.add(tagByType[type] ?? type);
    } catch (err) {
      logger.error("[PFS Import] bulkCreateMapping item failed", { type, pfsRef, err: (err as Error).message });
      results.push({ pfsRef, type, ok: false, error: (err as Error).message });
    }
  }

  // Invalider les caches en une passe
  for (const tag of tagsToInvalidate) {
    revalidateTag(tag, "default");
  }

  return NextResponse.json({ results });
}
