import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import sharp from "sharp";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";
import {
  newsletterTemplateImageDir,
  slugify,
  uploadFile,
} from "@/lib/storage";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/newsletter-templates/[id]/images
 *
 * Upload d'une image de bibliothèque pour un modèle newsletter format="html".
 * Body multipart : `image` (fichier), `name` (nom court, sluggé), `alt`
 * (optionnel — texte alternatif).
 *
 * Retour : `{ id, name, path, alt, sizeBytes, width, height, tag }` où `tag`
 * est le token prêt à coller dans le HTML (`{{img.<name>}}`).
 *
 * Le fichier est stocké en WebP (qualité 92, 1600 px max) sous
 * `/uploads/{tenant}/newsletters/{templateId}/{name}.webp`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { id: templateId } = await params;
  const tenant = await requireCurrentTenant();

  const template = await prisma.newsletterTemplate.findFirst({
    where: { id: templateId, tenantId: tenant.id },
    select: { id: true, format: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  }
  if (template.format !== "html") {
    return NextResponse.json({ error: "La bibliothèque d'images est réservée aux modèles HTML." }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("image") as File | null;
  const rawName = String(formData.get("name") ?? "");
  const alt = String(formData.get("alt") ?? "").slice(0, 500);

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Format non supporté (accepté : JPG, PNG, WEBP, GIF)." }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Fichier trop lourd (max 10 Mo)." }, { status: 400 });
  }

  const name = slugify(rawName);
  if (!name || name === "sans-nom") {
    return NextResponse.json({ error: "Nom invalide (utilise lettres, chiffres et tirets)." }, { status: 400 });
  }

  const collision = await prisma.newsletterTemplateImage.findFirst({
    where: { templateId, name },
    select: { id: true },
  });
  if (collision) {
    return NextResponse.json(
      { error: `Une image nommée « ${name} » existe déjà dans ce modèle. Choisis un autre nom ou supprime l'ancienne.` },
      { status: 409 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const pipeline = sharp(buffer).rotate();
    const meta = await pipeline.metadata();
    const webpBuffer = await pipeline
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 92, effort: 4 })
      .toBuffer();

    const dir = newsletterTemplateImageDir(templateId, tenant.slug);
    const key = `${dir}/${name}.webp`;
    await uploadFile(key, webpBuffer);
    const dbPath = `/${key}`;

    const created = await prisma.newsletterTemplateImage.create({
      data: {
        tenantId: tenant.id,
        templateId,
        name,
        path: dbPath,
        alt,
        sizeBytes: webpBuffer.length,
        width: meta.width ?? null,
        height: meta.height ?? null,
      },
      select: { id: true, name: true, path: true, alt: true, sizeBytes: true, width: true, height: true },
    });

    return NextResponse.json({ ...created, tag: `{{img.${created.name}}}` });
  } catch (err) {
    logger.error("[newsletter-template-images] upload", { templateId, error: err as Error });
    return NextResponse.json({ error: "Erreur de traitement de l'image." }, { status: 500 });
  }
}
