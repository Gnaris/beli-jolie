import { NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/image-jobs
 *
 * Retourne la liste unifiée des images en cours ou récemment traitées,
 * pour le widget « Images » du rail flottant admin. Deux sources sont
 * fusionnées :
 *
 *   1. `ImageProcessingJob` — les uploads unitaires depuis la fiche
 *      produit passent par la file `lib/image-queue`. Chaque ligne
 *      contient déjà `reference`, `colorName`, `colorHex`,
 *      `colorPatternImage` et `position` (posés à l'enqueue).
 *
 *   2. `ImportJob` (type=IMAGES) — l'import Excel en masse traite les
 *      images de manière synchrone et ne crée PAS de
 *      `ImageProcessingJob`. On lit alors le `_state.json` du tempDir
 *      pour reconstituer une ligne par photo, et on résout la palette
 *      des couleurs référencées en un seul findMany.
 *
 * Les entrées sont triées « la plus récente en premier » et plafonnées
 * à 100 (au-delà, le widget affiche « Voir plus »).
 */

const MAX_ITEMS = 100;
const RECENT_HOURS = 6;

type ItemStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

interface UnifiedImageItem {
  id: string;
  source: "form" | "bulk";
  status: ItemStatus;
  reference: string | null;
  colorName: string | null;
  colorHex: string | null;
  colorPatternImage: string | null;
  position: number | null;
  imagePath: string | null; // null si pas encore prêt (PENDING/PROCESSING/FAILED)
  error: string | null;
  createdAt: string; // ISO
}

interface StateImportedImage {
  filename: string;
  reference: string;
  color: string;
  position: number;
  imagePath: string;
  productId: string;
}

interface StateErrorRow {
  filename: string;
  reference: string;
  color: string;
  position: number;
  errors: string[];
}

interface ImageImportState {
  importedImages?: StateImportedImage[];
  errorRows?: StateErrorRow[];
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const since = new Date(Date.now() - RECENT_HOURS * 60 * 60 * 1000);

  try {
    const items: UnifiedImageItem[] = [];

    // ── Source 1 — Uploads unitaires (fiche produit)
    const formJobs = await prisma.imageProcessingJob.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS,
      select: {
        id: true,
        status: true,
        dbPath: true,
        error: true,
        createdAt: true,
        reference: true,
        colorName: true,
        colorHex: true,
        colorPatternImage: true,
        position: true,
      },
    });

    for (const j of formJobs) {
      items.push({
        id: `form:${j.id}`,
        source: "form",
        status: j.status as ItemStatus,
        reference: j.reference,
        colorName: j.colorName,
        colorHex: j.colorHex,
        colorPatternImage: j.colorPatternImage,
        position: j.position,
        imagePath: j.status === "DONE" ? j.dbPath : null,
        error: j.error,
        createdAt: j.createdAt.toISOString(),
      });
    }

    // ── Source 2 — Import Excel en masse (state.json du tempDir)
    const bulkJobs = await prisma.importJob.findMany({
      where: {
        type: "IMAGES",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, status: true, tempDir: true, createdAt: true },
    });

    const bulkStates: {
      job: (typeof bulkJobs)[number];
      state: ImageImportState;
    }[] = [];

    for (const job of bulkJobs) {
      if (!job.tempDir) continue;
      const statePath = path.resolve(process.cwd(), job.tempDir, "_state.json");
      try {
        const raw = await readFile(statePath, "utf-8");
        const state = JSON.parse(raw) as ImageImportState;
        bulkStates.push({ job, state });
      } catch {
        // Job trop récent (state.json pas encore écrit) ou déjà nettoyé — on ignore
      }
    }

    // Résolution palette pour toutes les couleurs référencées par les bulk imports.
    // findMany unique pour éviter N+1.
    const bulkColorNames = new Set<string>();
    for (const { state } of bulkStates) {
      for (const img of state.importedImages ?? []) bulkColorNames.add(img.color);
      for (const err of state.errorRows ?? []) if (err.color) bulkColorNames.add(err.color);
    }
    const paletteMap = new Map<string, { hex: string | null; patternImage: string | null }>();
    if (bulkColorNames.size > 0) {
      const rows = await prisma.color.findMany({
        where: { name: { in: Array.from(bulkColorNames) } },
        select: { name: true, hex: true, patternImage: true },
      });
      for (const r of rows) {
        paletteMap.set(r.name, { hex: r.hex ?? null, patternImage: r.patternImage ?? null });
      }
    }

    for (const { job, state } of bulkStates) {
      // Les succès n'ont pas de timestamp individuel dans state.json — on utilise
      // l'ordre + createdAt du job comme approximation. Ordre inverse pour que
      // la dernière image traitée apparaisse en tête si triée par createdAt égal.
      const importedList = state.importedImages ?? [];
      importedList.forEach((img, idx) => {
        const palette = paletteMap.get(img.color);
        const jobActive = job.status === "PENDING" || job.status === "PROCESSING" || job.status === "UPLOADING";
        // Les images déjà rangées (imagePath posé) sont DONE, même si le job global
        // est encore PROCESSING (il reste d'autres photos à traiter).
        items.push({
          id: `bulk:${job.id}:${idx}`,
          source: "bulk",
          status: img.imagePath ? "DONE" : jobActive ? "PROCESSING" : "DONE",
          reference: img.reference,
          colorName: img.color,
          colorHex: palette?.hex ?? null,
          colorPatternImage: palette?.patternImage ?? null,
          position: img.position,
          imagePath: img.imagePath || null,
          error: null,
          createdAt: job.createdAt.toISOString(),
        });
      });

      const errorList = state.errorRows ?? [];
      errorList.forEach((err, idx) => {
        const palette = paletteMap.get(err.color);
        items.push({
          id: `bulk:${job.id}:err:${idx}`,
          source: "bulk",
          status: "FAILED",
          reference: err.reference || null,
          colorName: err.color || null,
          colorHex: palette?.hex ?? null,
          colorPatternImage: palette?.patternImage ?? null,
          position: err.position || null,
          imagePath: null,
          error: (err.errors && err.errors[0]) || "Erreur inconnue",
          createdAt: job.createdAt.toISOString(),
        });
      });
    }

    // Tri global : plus récent en premier. Les bulk items partagent le createdAt
    // du job → on garde leur ordre naturel (forEach idx) grâce à un tri stable.
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    const truncated = items.length > MAX_ITEMS;
    return NextResponse.json({
      items: items.slice(0, MAX_ITEMS),
      totalCount: items.length,
      truncated,
    });
  } catch (err) {
    logger.error("[image-jobs GET] error", { error: err });
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
