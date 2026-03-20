import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const MAX_SIZE = 512 * 1024; // 500 KB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "patterns");

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

  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  } catch (err) {
    console.error("[upload-pattern] Write error:", err);
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

  const absolute = path.join(process.cwd(), "public", filePath);
  try {
    await unlink(absolute);
  } catch {
    // File may already be deleted — ignore
  }

  return NextResponse.json({ ok: true });
}
