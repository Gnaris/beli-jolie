import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { randomUUID } from "crypto";
import { uploadToR2, deleteFromR2, r2KeyFromDbPath } from "@/lib/r2";

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
  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = CONTENT_TYPE_MAP[ext] || "image/png";

  try {
    await uploadToR2(`uploads/patterns/${filename}`, buffer, contentType);
  } catch (err) {
    console.error("[upload-pattern] Upload error:", err);
    return NextResponse.json({ error: "Erreur lors de l'enregistrement du fichier." }, { status: 500 });
  }

  return NextResponse.json({ path: `/uploads/patterns/${filename}` });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { filePath } = await req.json();
  if (!filePath || typeof filePath !== "string" || !filePath.startsWith("/uploads/patterns/")) {
    return NextResponse.json({ error: "Chemin invalide." }, { status: 400 });
  }

  try {
    await deleteFromR2(r2KeyFromDbPath(filePath));
  } catch {
    // File may already be deleted — ignore
  }

  return NextResponse.json({ ok: true });
}
