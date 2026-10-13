/**
 * Composition côté client (canvas) d'overlays sur une image de produit avant
 * téléchargement :
 *   - un pastille « 12,34 € » dans le coin bas-droite
 *   - un tampon « RUPTURE DE STOCK » en diagonale au centre, opacité réduite
 *
 * Les deux options sont indépendantes et combinables. Si aucune n'est demandée,
 * l'image source est renvoyée telle quelle (ré-encodée au format demandé).
 *
 * Utilisé par :
 *   - PhotosPanel (fiche produit admin)
 *   - OrderItemImage (modal zoom sur fiche commande admin)
 */

export interface OverlayOptions {
  /** Prix (en euros, nombre). Non affiché si null/undefined. */
  priceEuros?: number | null;
  /** Si true, superpose le tampon « Rupture de stock » en diagonale. */
  outOfStock?: boolean;
}

export type OverlayFormat = "webp" | "png" | "jpeg";

export function mimeTypeFor(format: OverlayFormat): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  return "image/webp";
}

export function extensionFor(format: OverlayFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

/**
 * Formate un prix en euros en français : "12,34 €".
 * Espace normale (U+0020) partout — assez bon pour un rendu canvas et simple
 * à matcher dans les tests (évite les surprises NBSP / fine).
 */
export function formatPriceEuros(value: number): string {
  const safe = Number.isFinite(value) && value >= 0 ? value : 0;
  const [intPart, decPart] = safe.toFixed(2).split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${withThousands},${decPart} €`;
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image_load_failed"));
      img.src = url;
    });
    return img;
  } finally {
    // On garde l'URL vivante pendant le drawImage ; le GC s'en occupera à la
    // prochaine révocation. Ici on révoque après que l'image soit chargée —
    // le canvas copie les pixels, pas besoin de garder l'URL plus longtemps.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function drawPricePill(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  priceText: string,
): void {
  // Taille proportionnelle à la plus petite dimension pour un rendu homogène
  // entre carré et portrait/paysage. Plancher à 18 px et plafond à 56 px pour
  // rester lisible sur les thumbs comme sur une large 1200.
  const base = Math.min(width, height);
  const fontSize = Math.max(18, Math.min(56, Math.round(base * 0.055)));
  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.35);
  const margin = Math.max(10, Math.round(base * 0.025));
  const radius = Math.round(fontSize * 0.4);

  ctx.save();
  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText(priceText);
  const textWidth = metrics.width;
  const pillWidth = textWidth + padX * 2;
  const pillHeight = fontSize + padY * 2;
  const x = width - margin - pillWidth;
  const y = height - margin - pillHeight;

  // Ombre portée douce pour détacher la pastille d'un fond clair.
  ctx.shadowColor = "rgba(15, 23, 42, 0.35)";
  ctx.shadowBlur = Math.round(fontSize * 0.4);
  ctx.shadowOffsetY = Math.round(fontSize * 0.1);

  ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
  roundedRectPath(ctx, x, y, pillWidth, pillHeight, radius);
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(priceText, x + padX, y + pillHeight / 2);
  ctx.restore();
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawOutOfStockStamp(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const text = "RUPTURE DE STOCK";
  const diagonal = Math.sqrt(width * width + height * height);
  // Taille calculée pour que le texte occupe ~35% de la diagonale (moitié du
  // réglage initial, demande cliente 2026-10-13 : « trop grand » auparavant).
  // Auto-ajusté en-dessous via measureText pour ne jamais déborder.
  let fontSize = Math.max(14, Math.round(diagonal * 0.0375));

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((-25 * Math.PI) / 180);

  ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
  const targetWidth = diagonal * 0.36;
  const metrics = ctx.measureText(text);
  if (metrics.width > targetWidth) {
    fontSize = Math.max(
      10,
      Math.floor(fontSize * (targetWidth / Math.max(metrics.width, 1))),
    );
    ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
  }

  const strokeWidth = Math.max(2, Math.round(fontSize * 0.08));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = "#DC2626";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * Charge le Blob source, applique les overlays demandés sur un canvas, puis
 * exporte le résultat dans `format`. Si aucun overlay n'est demandé et que le
 * format correspond déjà, renvoie le blob d'origine (évite une ré-encodage
 * sans gain).
 */
export async function composeImageWithOverlays(
  source: Blob,
  format: OverlayFormat,
  options: OverlayOptions,
): Promise<Blob> {
  const hasPrice =
    options.priceEuros !== null &&
    options.priceEuros !== undefined &&
    Number.isFinite(options.priceEuros);
  const hasStamp = !!options.outOfStock;

  // Pas d'overlay demandé → on peut renvoyer tel quel si le format source
  // matche déjà le format demandé.
  if (!hasPrice && !hasStamp) {
    if (source.type === mimeTypeFor(format)) return source;
  }

  const img = await loadImage(source);
  const canvas = document.createElement("canvas");
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_unavailable");

  // JPEG ne gère pas l'alpha → fond blanc pour éviter le noir sur transparent.
  if (format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(img, 0, 0, width, height);

  if (hasStamp) {
    drawOutOfStockStamp(ctx, width, height);
  }
  if (hasPrice) {
    drawPricePill(ctx, width, height, formatPriceEuros(options.priceEuros as number));
  }

  const quality = format === "jpeg" ? 0.95 : 0.98;
  const out = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), mimeTypeFor(format), quality);
  });
  if (!out) throw new Error("canvas_toblob_failed");
  return out;
}

/**
 * Télécharge un Blob (déjà composé) via un <a download>. Retourne quand le
 * clic a été dispatché. Révoque l'URL object après 1 s de confort.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Fetch une URL, applique les overlays, puis déclenche le téléchargement.
 * Point d'entrée haut-niveau pour les composants UI.
 */
export async function downloadImageWithOverlays(
  src: string,
  baseName: string,
  format: OverlayFormat,
  options: OverlayOptions,
): Promise<void> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`fetch_failed_${response.status}`);
  const source = await response.blob();
  const composed = await composeImageWithOverlays(source, format, options);
  const stem = baseName.replace(/\.[a-z0-9]{2,5}$/i, "");
  triggerBlobDownload(composed, `${stem}.${extensionFor(format)}`);
}
