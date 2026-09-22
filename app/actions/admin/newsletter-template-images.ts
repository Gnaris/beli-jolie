"use server";

/**
 * CRUD (hors upload) sur la bibliothèque d'images d'un modèle newsletter
 * format="html". L'upload lui-même passe par la route multipart
 * `/api/admin/newsletter-templates/[id]/images` (plus adapté que les server
 * actions pour un flux binaire avec preview immédiate côté client).
 *
 * Chaque image porte un `name` sluggé unique par template. C'est ce nom qui
 * est référencé dans le HTML via `{{img.<name>}}` — voir
 * `lib/newsletter-html-render.ts`.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  deleteFile,
  keyFromDbPath,
  moveFile,
  newsletterTemplateImageDir,
  slugify,
} from "@/lib/storage";

export async function renameNewsletterTemplateImage(
  imageId: string,
  newName: string,
): Promise<{ success: true; name: string; path: string } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const image = await prisma.newsletterTemplateImage.findFirst({
      where: { id: imageId, tenantId: tenant.id },
    });
    if (!image) return { success: false, error: "Image introuvable." };

    const cleanName = slugify(newName);
    if (!cleanName || cleanName === "sans-nom") {
      return { success: false, error: "Nom invalide (utilise lettres, chiffres et tirets)." };
    }
    if (cleanName === image.name) {
      return { success: true, name: image.name, path: image.path };
    }

    // Collision avec une autre image du même modèle ?
    const collision = await prisma.newsletterTemplateImage.findFirst({
      where: { templateId: image.templateId, name: cleanName, id: { not: imageId } },
      select: { id: true },
    });
    if (collision) {
      return { success: false, error: `Une autre image porte déjà le nom « ${cleanName} ». Choisis un autre nom.` };
    }

    // Déplacement du fichier sur disque + mise à jour du path en BDD.
    const dir = newsletterTemplateImageDir(image.templateId, tenant.slug);
    const oldKey = keyFromDbPath(image.path);
    const newKey = `${dir}/${cleanName}.webp`;
    const newDbPath = `/${newKey}`;
    try {
      await moveFile(oldKey, newKey);
    } catch (err) {
      logger.error("[renameNewsletterTemplateImage] rename FS", { imageId, error: err as Error });
      return { success: false, error: "Impossible de renommer le fichier sur le disque." };
    }

    await prisma.newsletterTemplateImage.update({
      where: { id: imageId },
      data: { name: cleanName, path: newDbPath },
    });

    revalidatePath(`/admin/marketing/mails/newsletter/${image.templateId}`);
    return { success: true, name: cleanName, path: newDbPath };
  } catch (err) {
    logger.error("[renameNewsletterTemplateImage]", { imageId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function updateNewsletterTemplateImageAlt(
  imageId: string,
  alt: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const image = await prisma.newsletterTemplateImage.findFirst({
      where: { id: imageId, tenantId: tenant.id },
      select: { id: true, templateId: true },
    });
    if (!image) return { success: false, error: "Image introuvable." };

    await prisma.newsletterTemplateImage.update({
      where: { id: imageId },
      data: { alt: alt.slice(0, 500) },
    });
    revalidatePath(`/admin/marketing/mails/newsletter/${image.templateId}`);
    return { success: true };
  } catch (err) {
    logger.error("[updateNewsletterTemplateImageAlt]", { imageId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function deleteNewsletterTemplateImage(
  imageId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const image = await prisma.newsletterTemplateImage.findFirst({
      where: { id: imageId, tenantId: tenant.id },
    });
    if (!image) return { success: false, error: "Image introuvable." };

    // Best-effort filesystem cleanup — la BDD passe avant, un fichier orphelin
    // est un moindre mal comparé à un record BDD orphelin (qui empêcherait la
    // ré-utilisation du nom).
    try {
      await deleteFile(keyFromDbPath(image.path));
    } catch (err) {
      logger.error("[deleteNewsletterTemplateImage] delete FS", { imageId, error: err as Error });
    }

    await prisma.newsletterTemplateImage.delete({ where: { id: imageId } });
    revalidatePath(`/admin/marketing/mails/newsletter/${image.templateId}`);
    return { success: true };
  } catch (err) {
    logger.error("[deleteNewsletterTemplateImage]", { imageId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}
