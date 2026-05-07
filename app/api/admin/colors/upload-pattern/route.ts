import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { randomUUID } from "crypto";
import { uploadFile, deleteFile, keyFromDbPath, colorPatternDir, slugify } from "@/lib/storage";
import { logger } from "@/lib/logger";

const MAX_SIZE = 512 * 1024; // 500 KB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

const CONTENT_TYPE_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const colorName = ((formData.get("colorName") as string | null) || "").trim();
  if (!file) {
    return NextResponse.json({ error: "Aucun fichier fourni." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté. Utilisez PNG, JPG ou WebP." },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "Image trop lourde (max 500 KB)." },
      { status: 400 },
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const baseSlug = colorName ? slugify(colorName) : randomUUID();
  // Suffixe court pour éviter la collision quand l'admin réimporte un motif
  // pour la même couleur.
  const stamp = Date.now().toString(36);
  const filename = colorName
    ? `${baseSlug}-${stamp}.${ext}`
    : `${baseSlug}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = CONTENT_TYPE_MAP[ext] || "image/png";

  const dir = colorPatternDir();
  try {
    await uploadFile(`${dir}/${filename}`, buffer, contentType);
  } catch (err) {
    logger.error("[upload-pattern] Upload error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Erreur lors de l'enregistrement du fichier." }, { status: 500 });
  }

  return NextResponse.json({ path: `/${dir}/${filename}` });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { filePath } = await req.json();
  // Accept both legacy `/uploads/patterns/...` and new `/uploads/motifs-couleurs/...`
  if (
    !filePath ||
    typeof filePath !== "string" ||
    !(filePath.startsWith("/uploads/motifs-couleurs/") || filePath.startsWith("/uploads/patterns/"))
  ) {
    return NextResponse.json({ error: "Chemin invalide." }, { status: 400 });
  }

  try {
    await deleteFile(keyFromDbPath(filePath));
  } catch {
    // File may already be deleted — ignore
  }

  return NextResponse.json({ ok: true });
}
