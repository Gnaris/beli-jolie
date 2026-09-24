/**
 * Sécurité upload chat : couches successives contre virus / scripts.
 *
 * 1. Whitelist stricte MIME + extension (images + PDF uniquement).
 * 2. Vérification des « octets magiques » du fichier — empêche qu'un
 *    `virus.exe` renommé en `.pdf` avec un MIME menteur passe la douane.
 * 3. Refus des doubles extensions (`facture.pdf.exe`, `photo.jpg.bat`, …).
 * 4. Refus des noms de fichiers avec caractères de contrôle / null bytes.
 *
 * Volontairement pas de dépendance externe (`file-type` = 200 Ko de deps).
 * Signatures maintenues ici, ajouts au cas par cas.
 */

export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export const ALLOWED_DOC_MIMES = [
  "application/pdf",
] as const;

export const ALLOWED_MIMES: readonly string[] = [
  ...ALLOWED_IMAGE_MIMES,
  ...ALLOWED_DOC_MIMES,
];

/** Extensions autorisées, alignées avec ALLOWED_MIMES. */
const ALLOWED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif",
  "pdf",
]);

/**
 * Extensions dangereuses interdites en toute position du nom, y compris en
 * extension intermédiaire (`facture.exe.pdf` = piège classique : Windows exécute
 * l'.exe si l'extension finale est masquée par l'UI).
 */
const DANGEROUS_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "pif", "scr", "vbs", "vbe", "js", "jse",
  "wsf", "wsh", "msi", "msp", "hta", "cpl", "jar", "ps1", "psm1", "sh",
  "app", "deb", "rpm", "dll", "so", "dylib",
  "html", "htm", "xhtml", "svg", "xml",
  "zip", "rar", "7z", "tar", "gz", "iso",
  "php", "asp", "aspx", "jsp", "py", "rb",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv",
]);

export interface UploadValidationOk {
  ok: true;
  extension: string;
}
export interface UploadValidationErr {
  ok: false;
  error: string;
}
export type UploadValidation = UploadValidationOk | UploadValidationErr;

/**
 * Vérifie le nom de fichier : caractères interdits + double extension
 * dangereuse. Retourne l'extension finale en minuscules si OK.
 */
export function validateFileName(fileName: string): UploadValidation {
  if (!fileName || fileName.length > 255) {
    return { ok: false, error: "Nom de fichier invalide." };
  }
  // Refuse les caractères de contrôle et null bytes (\x00 → tronque le path côté OS).
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(fileName)) {
    return { ok: false, error: "Nom de fichier contient des caractères interdits." };
  }
  // Refuse les séparateurs de chemin (défense en profondeur, path traversal).
  if (fileName.includes("/") || fileName.includes("\\")) {
    return { ok: false, error: "Nom de fichier invalide." };
  }

  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2) {
    return { ok: false, error: "Fichier sans extension refusé." };
  }
  const finalExt = parts[parts.length - 1];

  // Toutes les extensions intermédiaires (parts[1..n-1]) — si l'une est
  // dangereuse, on refuse même si l'extension finale semble propre.
  for (let i = 1; i < parts.length; i++) {
    if (DANGEROUS_EXTENSIONS.has(parts[i])) {
      return {
        ok: false,
        error: `Fichier refusé (extension interdite « .${parts[i]} »).`,
      };
    }
  }

  if (!ALLOWED_EXTENSIONS.has(finalExt)) {
    return {
      ok: false,
      error: `Extension « .${finalExt} » non autorisée. Seuls les images et PDF sont acceptés.`,
    };
  }

  return { ok: true, extension: finalExt };
}

/**
 * Vérifie que les premiers octets du buffer correspondent au MIME déclaré.
 * Empêche l'attaque « virus renommé » : même si le navigateur/upload donne un
 * MIME `application/pdf`, on refuse si les bytes ne commencent pas par `%PDF-`.
 *
 * Retourne true si conforme, false si mismatch.
 */
export function verifyMagicBytes(mimeType: string, buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  const b = buffer;

  switch (mimeType) {
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

    case "image/png":
      return (
        b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
        b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
      );

    case "image/webp":
      // "RIFF" .... "WEBP"
      return (
        b.length >= 12 &&
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
      );

    case "image/gif":
      // "GIF87a" ou "GIF89a"
      return (
        b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
        (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
      );

    case "image/heic":
    case "image/heif":
      // Boîte ISOBMFF : offset 4 = "ftyp".
      return (
        b.length >= 12 &&
        b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
      );

    case "application/pdf":
      // "%PDF-"
      return (
        b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 &&
        b[4] === 0x2d
      );

    default:
      // Type non prévu — la whitelist en amont devrait déjà l'avoir refusé,
      // mais par défense on rejette.
      return false;
  }
}
