/**
 * Vérifications de sécurité pour les fichiers uploadés dans le formulaire
 * d'inscription B2B (Kbis, justificatif d'entreprise).
 *
 * Le flow existant vérifie déjà :
 *   1. MIME whitelist        (côté route.ts)
 *   2. Extension whitelist   (côté route.ts)
 *   3. Magic bytes           (côté route.ts)
 *   4. Taille max            (côté route.ts)
 *
 * Ce module ajoute une couche « anti-malveillance » supplémentaire pour
 * bloquer les fichiers polyglots (JPEG-avec-PHP-dedans), les PDF
 * auto-exécutants, et les documents Word binaires à macros.
 */

import sharp from "sharp";

// ─────────────────────────────────────────────────────────
// Images : re-encodage Sharp = purge complète des payloads
// ─────────────────────────────────────────────────────────

/** MIME acceptés pour les images de justificatif. */
export const IMAGE_MIME_WHITELIST = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ImageMime = (typeof IMAGE_MIME_WHITELIST)[number];

export interface SanitizedImage {
  buffer: Buffer;
  mime: ImageMime;
  extension: "jpg" | "png" | "webp";
}

/**
 * Re-encode une image via Sharp pour purger tout contenu non-pixel :
 * EXIF, XMP, IPTC, ICC, thumbnails secondaires, commentaires, code embarqué
 * dans les segments propriétaires, données steganographiques post-EOI, etc.
 *
 * Si l'image ne peut pas être décodée par Sharp, c'est qu'elle n'est pas
 * une vraie image → throw. Cela couvre les polyglots type "PHP + JPEG"
 * (le décodeur Sharp reconnaît le format déclaré mais ignore la charge
 * utile malicieuse, et le buffer de sortie ne contient plus que des
 * pixels ré-encodés).
 *
 * Sortie : buffer sûr + mime type détecté par le décodeur (pas celui
 * déclaré côté client, qui n'est pas fiable).
 */
export async function sanitizeImage(
  input: Buffer,
  declaredMime: string,
): Promise<SanitizedImage> {
  if (!IMAGE_MIME_WHITELIST.includes(declaredMime as ImageMime)) {
    throw new Error("Format d'image non autorisé.");
  }

  const pipeline = sharp(input, { failOn: "warning" }).rotate();
  const meta = await pipeline.metadata();

  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
    throw new Error("Le contenu du fichier ne correspond pas à une image.");
  }

  // Aligne le mime réel sur le format détecté (pas sur le declaredMime).
  if (meta.format === "jpeg") {
    const buffer = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    return { buffer, mime: "image/jpeg", extension: "jpg" };
  }
  if (meta.format === "png") {
    const buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    return { buffer, mime: "image/png", extension: "png" };
  }
  const buffer = await pipeline.webp({ quality: 90, effort: 4 }).toBuffer();
  return { buffer, mime: "image/webp", extension: "webp" };
}

// ─────────────────────────────────────────────────────────
// PDF : refus des documents à actions automatiques
// ─────────────────────────────────────────────────────────

/**
 * Motifs PDF qui déclenchent une exécution automatique ou embarquent
 * du code exécutable. Un Kbis / justificatif d'entreprise légitime
 * ne contient jamais ces éléments — leur présence est un signal fort
 * de malveillance.
 */
const PDF_SUSPICIOUS_PATTERNS: readonly RegExp[] = [
  /\/JavaScript\b/i,   // Bloc JS embarqué
  /\/JS\b/i,           // Alias JS
  /\/Launch\b/i,       // Action Launch (exec fichier externe)
  /\/OpenAction\b/i,   // Action au chargement
  /\/AA\b/i,           // Additional Actions (trigger sur événement)
  /\/EmbeddedFile\b/i, // Fichier embarqué (souvent .exe déguisé)
  /\/RichMedia\b/i,    // Flash / vidéo embarqué (déprécié + vecteur)
];

/**
 * Vérifie que le PDF ne contient pas d'action automatique ni de
 * JavaScript. Ne re-encode pas (impossible sans lib PDF lourde),
 * mais bloque les patterns malveillants les plus courants.
 *
 * Throw si suspect.
 */
export function assertPdfSafe(input: Buffer): void {
  // Sanity : magic bytes %PDF-
  const header = input.subarray(0, 5).toString("latin1");
  if (!header.startsWith("%PDF-")) {
    throw new Error("Le fichier n'est pas un PDF valide.");
  }

  // Analyse en latin1 pour ne pas casser les octets binaires.
  const text = input.toString("latin1");
  for (const pattern of PDF_SUSPICIOUS_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(
        "Ce PDF contient du code exécutable ou une action automatique. " +
        "Merci de fournir un PDF standard (export d'un scan ou d'un document).",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────
// Word : accepter .docx uniquement (refus .doc binaire)
// ─────────────────────────────────────────────────────────

/**
 * MIME + extension acceptés pour un justificatif d'entreprise.
 * Volontairement PAS de `.doc` (format binaire OLE2, vecteur macros).
 */
export const DOCUMENT_MIME_WHITELIST = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
] as const;

export const DOCUMENT_EXTENSION_WHITELIST = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "docx",
] as const;

export function isImageMime(mime: string): mime is ImageMime {
  return (IMAGE_MIME_WHITELIST as readonly string[]).includes(mime);
}

export function isPdfMime(mime: string): boolean {
  return mime === "application/pdf";
}

export function isDocxMime(mime: string): boolean {
  return (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}
