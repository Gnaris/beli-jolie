import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { processProductImport } from "@/lib/import-processor";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// POST — Create a new import job (products)
// Saves the file to disk and starts background processing
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const type = formData.get("type") as string | null; // "PRODUCTS" or "IMAGES"
    const maxProductsRaw = formData.get("maxProducts") as string | null;
    const maxProducts = maxProductsRaw ? parseInt(maxProductsRaw) : 0;

    if (!file) return NextResponse.json({ error: "Aucun fichier fourni." }, { status: 400 });

    const MAX_SIZE = 50 * 1024 * 1024; // 50 MB for CSV/Excel
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 50 Mo)." }, { status: 400 });
    }

    if (type === "IMAGES") {
      // For images, create job in UPLOADING state — batches will be sent separately
      // Store RELATIVE path in DB to avoid path.join issues on Windows
      const tempDirName = `import_job_${Date.now()}`;
      const tempDirRelative = `private/uploads/import-jobs/${tempDirName}`;
      const tempDirAbsolute = path.join(process.cwd(), tempDirRelative);
      await mkdir(tempDirAbsolute, { recursive: true });

      const job = await prisma.importJob.create({
        data: {
          type: "IMAGES",
          status: "UPLOADING",
          filename: "Images",
          tempDir: tempDirRelative, // relative to project root
          adminId: session.user.id,
        },
      });

      return NextResponse.json({ jobId: job.id });
    }

    // PRODUCTS flow — save file to disk, start processing
    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".json") && !filename.endsWith(".xlsx") && !filename.endsWith(".xls")) {
      return NextResponse.json({ error: "Format non supporté (.json, .xlsx, .xls)." }, { status: 400 });
    }

    // Save file to private directory (store relative path in DB)
    const savedFilename = `${Date.now()}_${file.name}`;
    const filePathRelative = `private/uploads/import-jobs/${savedFilename}`;
    const filePathAbsolute = path.join(process.cwd(), filePathRelative);
    await mkdir(path.dirname(filePathAbsolute), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePathAbsolute, buffer);

    // Create job
    const job = await prisma.importJob.create({
      data: {
        type: "PRODUCTS",
        status: "PENDING",
        filename: file.name,
        filePath: filePathRelative,
        adminId: session.user.id,
      },
    });

    // Fire-and-forget: start background processing
    processProductImport(job.id, maxProducts > 0 ? maxProducts : undefined).catch((err) => {
      logger.error("[import-jobs] Background processing error", { error: err instanceof Error ? err.message : String(err) });
    });

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    logger.error("[import-jobs] POST error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// GET — List active import jobs for current admin
// ─────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    // Get active jobs (not completed/failed more than 1 hour ago)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const jobs = await prisma.importJob.findMany({
      where: {
        adminId: session.user.id,
        OR: [
          { status: { in: ["PENDING", "UPLOADING", "PROCESSING"] } },
          { status: { in: ["COMPLETED", "FAILED"] }, updatedAt: { gte: oneHourAgo } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return NextResponse.json({ jobs });
  } catch (err) {
    logger.error("[import-jobs] GET error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
