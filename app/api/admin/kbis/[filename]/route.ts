import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import path from "path";
import fs from "fs/promises";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/kbis/[filename]
 *
 * Sert les fichiers Kbis de manière sécurisée.
 * Les fichiers sont stockés dans /private/uploads/kbis/{siret}/{filename},
 * jamais accessibles directement — uniquement via cette route protégée.
 *
 * `filename` ici = juste le nom de fichier (sans dossier). On retrouve le
 * vrai chemin en cherchant le `User.kbisPath` qui se termine par ce nom.
 *
 * Sécurité :
 * - Vérifie que l'appelant est un ADMIN connecté
 * - Sanitize le nom de fichier pour éviter le path traversal
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  // Vérification de la session admin
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { filename } = await params;

  // Sanitize : on retire tout caractère de traversal de chemin
  const safeFilename = path.basename(filename);

  // On retrouve le `User.kbisPath` qui se termine par ce nom de fichier.
  // Pratique : ça gère à la fois l'ancienne arbo (`private/uploads/kbis/xxx.pdf`)
  // et la nouvelle (`private/uploads/kbis/{siret}/kbis-xxx.pdf`).
  const user = await prisma.user.findFirst({
    where: { kbisPath: { endsWith: `/${safeFilename}` } },
    select: { kbisPath: true },
  });

  // Fallback : ancien stockage à plat dans private/uploads/kbis/{filename}
  const candidatePath = user?.kbisPath ?? `private/uploads/kbis/${safeFilename}`;

  // On reconstruit le chemin absolu et on vérifie qu'on reste sous /private/.
  const privateRoot = path.resolve(process.cwd(), "private");
  const relative = candidatePath.replace(/^private[\\/]+/, "");
  const filePath = path.resolve(privateRoot, relative);
  if (path.relative(privateRoot, filePath).startsWith("..")) {
    return NextResponse.json({ error: "Chemin invalide." }, { status: 400 });
  }

  // Vérification que le fichier existe
  try {
    await fs.access(filePath);
  } catch {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  }

  // Lecture du fichier
  const fileBuffer = await fs.readFile(filePath);

  // Détermination du Content-Type selon l'extension
  const ext = safeFilename.split(".").pop()?.toLowerCase();
  const contentTypeMap: Record<string, string> = {
    pdf:  "application/pdf",
    jpg:  "image/jpeg",
    jpeg: "image/jpeg",
    png:  "image/png",
    webp: "image/webp",
  };
  const contentType = contentTypeMap[ext ?? ""] ?? "application/octet-stream";

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safeFilename}"`,
      // Pas de cache pour les documents sensibles
      "Cache-Control": "no-store",
    },
  });
}
