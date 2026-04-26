import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createOrLinkMapping, type PfsAttributeType } from "@/lib/pfs-import";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

const ALLOWED_TYPES: PfsAttributeType[] = ["category", "color", "composition", "country", "season", "size"];

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const { type, pfsRef, label, linkToExistingId, pfsGender, pfsFamilyName, pfsCategoryName } = body as {
    type?: unknown;
    pfsRef?: unknown;
    label?: unknown;
    linkToExistingId?: unknown;
    pfsGender?: unknown;
    pfsFamilyName?: unknown;
    pfsCategoryName?: unknown;
  };

  if (typeof type !== "string" || !ALLOWED_TYPES.includes(type as PfsAttributeType)) {
    return NextResponse.json({ error: "type invalide" }, { status: 400 });
  }
  if (typeof pfsRef !== "string" || pfsRef.trim().length === 0) {
    return NextResponse.json({ error: "pfsRef requis" }, { status: 400 });
  }
  if (typeof label !== "string" || label.trim().length === 0) {
    return NextResponse.json({ error: "label requis" }, { status: 400 });
  }
  if (linkToExistingId !== undefined && typeof linkToExistingId !== "string") {
    return NextResponse.json({ error: "linkToExistingId invalide" }, { status: 400 });
  }

  try {
    const result = await createOrLinkMapping({
      type: type as PfsAttributeType,
      pfsRef: pfsRef.trim(),
      label: label.trim(),
      linkToExistingId: (linkToExistingId as string | undefined) ?? undefined,
      pfsGender: typeof pfsGender === "string" ? pfsGender : undefined,
      pfsFamilyName: typeof pfsFamilyName === "string" ? pfsFamilyName : undefined,
      pfsCategoryName: typeof pfsCategoryName === "string" ? pfsCategoryName : undefined,
    });

    // Invalider les caches correspondants
    const tagByType: Record<PfsAttributeType, string> = {
      category: "categories",
      color: "colors",
      composition: "compositions",
      country: "countries",
      season: "seasons",
      size: "sizes",
    };
    revalidateTag(tagByType[type as PfsAttributeType], "default");

    return NextResponse.json(result);
  } catch (err) {
    logger.error("[PFS Import] createMapping failed", { err: (err as Error).message, type, pfsRef });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
