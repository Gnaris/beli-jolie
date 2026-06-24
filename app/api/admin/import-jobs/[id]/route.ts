import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import { logger } from "@/lib/logger";

// Large uploads: Next.js App Router (self-hosted) has no body size limit by default.
// If behind a reverse proxy, configure its limit to at least 300MB for image batches.
import path from "path";
import { processImageBatch, finalizeImageImport } from "@/lib/import-processor";
import { readdir, writeFile as writeFileAsync } from "fs/promises";

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

  // ── Action: cancel a job (manual dismiss from the widget) ──
  if (action === "cancel") {
    if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
      return NextResponse.json({ ok: true, alreadyClosed: true });
    }
    await prisma.importJob.update({
      where: { id },
      data: {
        status: "CANCELLED",
        errorMessage: "Annulé par l'administrateur.",
      },
    });
    return NextResponse.json({ ok: true });
  }

  // ── Action: finalize (anciennement « start ») ──
  // Appelée par le client après le dernier lot pour clôturer le job :
  // crée le brouillon d'erreurs, pose les flags marketplaces, marque COMPLETED.
  if (action === "start" || action === "finalize") {
    if (job.type !== "IMAGES" || !job.tempDir) {
      return NextResponse.json({ error: "Job invalide." }, { status: 400 });
    }
    if (job.status !== "UPLOADING") {
      return NextResponse.json({ error: "Le job n'est pas en attente de clôture." }, { status: 400 });
    }

    try {
      // Compat front-end legacy : si des images sont restées non traitées
      // dans tempDir (= front-end qui n'envoyait pas le batch processing en
      // live), on les traite ici en chunks avant de finaliser.
      const tempDirAbs = path.resolve(process.cwd(), job.tempDir);
      const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
      try {
        const files = await readdir(tempDirAbs);
        const pending = files.filter((f) => allowedExts.includes(path.extname(f).toLowerCase()));

        // Écrit les résolutions/overrides s'ils ont été passés par le front-end legacy
        const resolutionsJson = formData.get("resolutions") as string | null;
        if (resolutionsJson) {
          await writeFileAsync(path.join(tempDirAbs, "_resolutions.json"), resolutionsJson, "utf-8");
        }
        const overridesJson = formData.get("overrides") as string | null;
        if (overridesJson) {
          await writeFileAsync(path.join(tempDirAbs, "_overrides.json"), overridesJson, "utf-8");
        }

        if (pending.length > 0) {
          // S'assure que totalItems reflète bien tout ce qu'on s'apprête à traiter
          await prisma.importJob.update({
            where: { id },
            data: { status: "PROCESSING", totalItems: pending.length },
          });
          const CHUNK = 20;
          for (let i = 0; i < pending.length; i += CHUNK) {
            await processImageBatch(id, pending.slice(i, i + CHUNK));
          }
        } else {
          await prisma.importJob.update({ where: { id }, data: { status: "PROCESSING" } });
        }
      } catch {
        // tempDir absent → on finalise sans rien traiter
        await prisma.importJob.update({ where: { id }, data: { status: "PROCESSING" } });
      }

      await finalizeImageImport(id);
      return NextResponse.json({ ok: true });
    } catch (err) {
      logger.error("[import-jobs] Finalize error", { error: err });
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
    const batchFilenames: string[] = [];

    for (const file of files) {
      if (file.size > MAX_IMAGE_SIZE) continue;
      const ext = path.extname(file.name).toLowerCase();
      if (!allowedExts.includes(ext)) continue;

      const destPath = path.join(uploadDirAbs, file.name);
      const bytes = Buffer.from(await file.arrayBuffer());
      await writeFile(destPath, bytes);
      saved++;
      batchFilenames.push(file.name);
    }

    // Incrémente totalItems du nombre de fichiers reçus dans CE lot. Pas un
    // recount du dossier — les fichiers traités sont supprimés au fil de
    // l'eau, donc relire le dossier ferait osciller le compteur.
    await prisma.importJob.update({
      where: { id },
      data: { totalItems: { increment: saved } },
    });

    // ─── Traitement live : range les photos dès qu'elles arrivent ───
    let batchResult = { processed: 0, success: 0, errors: 0 };
    if (batchFilenames.length > 0) {
      try {
        batchResult = await processImageBatch(id, batchFilenames);
      } catch (err) {
        logger.error("[import-jobs] Batch processing error", { error: err });
        // On ne renvoie pas 500 : l'upload du fichier a réussi, le processing
        // a planté. Mieux vaut laisser le client envoyer le lot suivant que
        // de bloquer tout l'import.
      }
    }

    // Relit le total réel après l'increment pour le retourner au client.
    const updated = await prisma.importJob.findUnique({
      where: { id },
      select: { totalItems: true },
    });

    return NextResponse.json({
      saved,
      totalImages: updated?.totalItems ?? saved,
      processed: batchResult.processed,
      success: batchResult.success,
      errors: batchResult.errors,
    });
  } catch (err) {
    logger.error("[import-jobs] Upload batch error", { error: err });
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
