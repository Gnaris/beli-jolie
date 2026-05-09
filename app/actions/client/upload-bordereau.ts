"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { uploadFile, bordereauDir, slugify } from "@/lib/storage";
import { logger } from "@/lib/logger";
import crypto from "node:crypto";

const MAX_BYTES = 5 * 1024 * 1024; // 5 Mo

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg":      "jpg",
  "image/jpg":       "jpg",
  "image/png":       "png",
};

export interface UploadBordereauResult {
  success: true;
  path:    string; // ex: /uploads/bordereaux/abc123.pdf
}

export interface UploadBordereauError {
  success: false;
  error:   string;
}

/**
 * Upload d'un bordereau d'expédition fourni par le client (Transporteur Privé).
 *
 * Range le fichier dans `public/uploads/bordereaux/{clientId}/commande-{orderRef}.{ext}`
 * (ou avec un id aléatoire si la référence de commande n'est pas fournie),
 * et renvoie son chemin public.
 */
export async function uploadBordereau(
  formData: FormData,
): Promise<UploadBordereauResult | UploadBordereauError> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { success: false, error: "Fichier manquant." };
  }

  if (file.size === 0) {
    return { success: false, error: "Le fichier est vide." };
  }
  if (file.size > MAX_BYTES) {
    return { success: false, error: "Le fichier dépasse 5 Mo." };
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return {
      success: false,
      error:   "Format non supporté. Acceptés : PDF, JPG, PNG.",
    };
  }

  const ext = EXTENSIONS[file.type] ?? "bin";
  const orderRef = ((formData.get("orderRef") as string | null) || "").trim();
  const uniqueId = crypto.randomBytes(6).toString("hex");
  const dir = bordereauDir(session.user.id);
  const filename = orderRef
    ? `commande-${slugify(orderRef)}-${uniqueId}.${ext}`
    : `bordereau-${uniqueId}.${ext}`;
  const key = `${dir}/${filename}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadFile(key, buffer, file.type);
    return { success: true, path: `/${key}` };
  } catch (err) {
    logger.error("[uploadBordereau] erreur écriture fichier", {
      error: err,
    });
    return { success: false, error: "Impossible d'enregistrer le bordereau." };
  }
}
