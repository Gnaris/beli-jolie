import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir, readdir } from "fs/promises";
import { logger } from "@/lib/logger";

// Large uploads: Next.js App Router (self-hosted) has no body size limit by default.
// If behind a reverse proxy, configure its limit to at least 300MB for image batches.
import path from "path";
import { processImageImport } from "@/lib/import-processor";
import { writeFile as writeFileAsync } from "fs/promises";

// ─────────────────────────────────────────────
// GET — Get job progress
// ─────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const job = await prisma.importJob.findUnique({ where: { id } });
  if (!job || job.adminId !== session.user.id) {
    return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
  }

  return NextResponse.json({ job });
}

// ─────────────────────────────────────────────
// POST — Upload image batch OR start processing
// ─────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const job = await prisma.importJob.findUnique({ where: { id } });
  if (!job || job.adminId !== session.user.id) {
    return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
  }

  const formData = await req.formData();
  const action = formData.get("action") as string | null;

  // ── Action: start processing ──
  if (action === "start") {
    if (job.type !== "IMAGES" || !job.tempDir) {
      return NextResponse.json({ error: "Job invalide." }, { status: 400 });
    }
    if (job.status !== "UPLOADING") {
      return NextResponse.json({ error: "Le job n'est pas en attente d'upload." }, { status: 400 });
    }

    // Resolve relative tempDir to absolute
    const tempDirAbs = path.resolve(process.cwd(), job.tempDir);

    // Count total files
    try {
      const files = await readdir(tempDirAbs);
      const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
      const imageCount = files.filter((f) => allowedExts.includes(path.extname(f).toLowerCase())).length;

      // Write conflict resolutions file if provided
      const resolutionsJson = formData.get("resolutions") as string | null;
      if (resolutionsJson) {
        const resPath = path.join(tempDirAbs, "_resolutions.json");
        await writeFileAsync(resPath, resolutionsJson, "utf-8");
      }

      // Write file overrides (position/color changes) if provided
      const overridesJson = formData.get("overrides") as string | null;
      if (overridesJson) {
        const ovPath = path.join(tempDirAbs, "_overrides.json");
        await writeFileAsync(ovPath, overridesJson, "utf-8");
      }

      await prisma.importJob.update({
        where: { id },
        data: { totalItems: imageCount, status: "PENDING" },
      });

      // Fire-and-forget
      processImageImport(id).catch((err) => {
        logger.error("[import-jobs] Image processing error", { error: err instanceof Error ? err.message : String(err) });
      });

      return NextResponse.json({ ok: true, totalImages: imageCount });
    } catch (err) {
      logger.error("[import-jobs] Start error", { error: err instanceof Error ? err.message : String(err) });
      return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
    }
  }

  // ── Action: upload image batch ──
  if (job.type !== "IMAGES" || !job.tempDir) {
    return NextResponse.json({ error: "Job invalide pour upload d'images." }, { status: 400 });
  }
  if (job.status !== "UPLOADING") {
    return NextResponse.json({ error: "Le job n'accepte plus de fichiers." }, { status: 400 });
  }

  // Resolve relative tempDir to absolute
  const uploadDirAbs = path.resolve(process.cwd(), job.tempDir);

  const files = formData.getAll("images") as File[];
  if (files.length === 0) {
    return NextResponse.json({ error: "Aucune image fournie." }, { status: 400 });
  }

  const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB per image
  const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

  try {
    await mkdir(uploadDirAbs, { recursive: true });
    let saved = 0;

    for (const file of files) {
      if (file.size > MAX_IMAGE_SIZE) continue;
      const ext = path.extname(file.name).toLowerCase();
      if (!allowedExts.includes(ext)) continue;

      const destPath = path.join(uploadDirAbs, file.name);
      const bytes = Buffer.from(await file.arrayBuffer());
      await writeFile(destPath, bytes);
      saved++;
    }

    // Update total count
    const allFiles = await readdir(uploadDirAbs);
    const totalImages = allFiles.filter((f) => allowedExts.includes(path.extname(f).toLowerCase())).length;

    await prisma.importJob.update({
      where: { id },
      data: { totalItems: totalImages },
    });

    return NextResponse.json({ saved, totalImages });
  } catch (err) {
    logger.error("[import-jobs] Upload batch error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
