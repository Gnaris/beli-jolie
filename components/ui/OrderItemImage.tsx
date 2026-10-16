"use client";

import { useState } from "react";
import Image from "next/image";
import {
  downloadImageWithOverlays,
  formatPriceEuros,
  type OverlayFormat,
} from "@/lib/download-image-overlays";
import {
  usePersistedOverlayToggles,
  OverlayToggles,
} from "@/components/admin/products/DownloadOverlayToggles";
import ReferenceBadgePreview from "@/components/admin/products/ReferenceBadgePreview";
import { useToast } from "@/components/ui/Toast";

interface OrderItemImageProps {
  src: string | null;
  alt: string;
  /** Tailwind classes for the outer container size, e.g. "w-12 h-12 sm:w-16 sm:h-16" */
  sizeClass?: string;
  /** Si true, affiche dans la modale un bouton de téléchargement avec cases
   *  à cocher « Prix » / « Rupture de stock » / « Référence ». Utilisé sur
   *  /admin/commandes/[id] et le panier client admin. */
  allowDownload?: boolean;
  /** Prix (unitaire) à afficher dans le coin bas-droite si la case est cochée. */
  priceEuros?: number | null;
  /** Référence produit à afficher en haut-droite si la case est cochée. */
  reference?: string | null;
  /** Désactive la case « Référence » (ex. 1ʳᵉ image avec badge déjà cuit côté
   *  serveur). */
  disableReference?: boolean;
  /** Préfixe du nom de fichier téléchargé (sans extension). */
  downloadBaseName?: string;
}

function slugifyForFile(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "photo"
  );
}

export default function OrderItemImage({
  src,
  alt,
  sizeClass = "w-14 h-14",
  allowDownload = false,
  priceEuros = null,
  reference = null,
  disableReference = false,
  downloadBaseName,
}: OrderItemImageProps) {
  const [open, setOpen] = useState(false);

  if (!src) {
    return (
      <div className={`${sizeClass} shrink-0 bg-bg-tertiary border border-border rounded-lg overflow-hidden flex items-center justify-center`}>
        <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
        </svg>
      </div>
    );
  }

  const baseName = downloadBaseName || slugifyForFile(alt);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${sizeClass} shrink-0 bg-bg-tertiary border border-border rounded-lg overflow-hidden cursor-zoom-in transition-shadow hover:shadow-md`}
      >
        <Image src={src} alt={alt} width={80} height={80} unoptimized className="w-full h-full object-cover" />
      </button>

      {open && (
        <Lightbox
          src={src}
          alt={alt}
          allowDownload={allowDownload}
          priceEuros={priceEuros}
          reference={reference}
          disableReference={disableReference}
          baseName={baseName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Vue agrandie (lightbox) de l'image produit sur la fiche commande.
 * Sur la fiche admin (`allowDownload=true`), ajoute :
 *   - un bouton télécharger (3 formats via menu simple)
 *   - 2 cases à cocher qui composent les overlays à l'export
 *     (prix bas-droite + tampon « Rupture de stock » diagonale)
 */
function Lightbox({
  src,
  alt,
  allowDownload,
  priceEuros,
  reference,
  disableReference,
  baseName,
  onClose,
}: {
  src: string;
  alt: string;
  allowDownload: boolean;
  priceEuros: number | null;
  reference: string | null;
  disableReference: boolean;
  baseName: string;
  onClose: () => void;
}) {
  // Les toggles persistés ne touchent pas le contexte React (pas de ToastProvider
  // requis). Sans `allowDownload`, aucun appel à useToast — on reste compatible
  // avec les callers client qui n'ont pas de ToastProvider dans l'arbre.
  const toggles = usePersistedOverlayToggles();

  const trimmedRef = typeof reference === "string" ? reference.trim() : "";
  const refAvailable = !disableReference && trimmedRef.length > 0;
  const effectivePrice = allowDownload && toggles.showPrice ? priceEuros : null;
  const effectiveReference = allowDownload && toggles.showReference && refAvailable
    ? trimmedRef
    : null;
  const showStamp = allowDownload && toggles.showOutOfStock;
  const hasPrice =
    effectivePrice !== null &&
    effectivePrice !== undefined &&
    Number.isFinite(effectivePrice);
  const hasReference = effectiveReference !== null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 sm:bg-black/80 flex items-center justify-center p-0 sm:p-4 animate-lightbox-in touch-manipulation"
      onClick={onClose}
    >
      <div
        className="relative max-h-[100dvh] max-w-[100vw] sm:max-h-[90vh] sm:max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
          className="max-h-[100dvh] max-w-[100vw] sm:max-h-[90vh] sm:max-w-[90vw] object-contain sm:shadow-2xl sm:rounded-xl animate-lightbox-img-in touch-pinch-zoom select-none"
        />
        {showStamp && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden sm:rounded-xl">
            <span
              className="font-black uppercase tracking-wider"
              style={{
                color: "#DC2626",
                fontSize: "clamp(14px, 3.5vw, 36px)",
                transform: "rotate(-25deg)",
                opacity: 0.55,
                WebkitTextStroke: "1px rgba(255,255,255,0.9)",
                textShadow: "0 1px 2px rgba(0,0,0,0.25)",
                whiteSpace: "nowrap",
              }}
            >
              Rupture de stock
            </span>
          </div>
        )}
        {hasPrice && (
          <span
            className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-slate-900/90 px-3 py-1.5 text-sm font-bold text-white shadow-lg"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatPriceEuros(effectivePrice as number)}
          </span>
        )}
        {hasReference && (
          <ReferenceBadgePreview reference={effectiveReference as string} size="zoom" />
        )}
      </div>

      {allowDownload && (
        <DownloadControls
          src={src}
          baseName={baseName}
          priceEuros={priceEuros}
          reference={trimmedRef || null}
          disableReference={disableReference}
          toggles={toggles}
        />
      )}

      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-11 h-11 sm:w-9 sm:h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl backdrop-blur-sm transition-transform hover:scale-110 animate-zoom-fade"
      >
        &times;
      </button>
    </div>
  );
}

/**
 * Pavé bas-gauche : cases à cocher + 3 boutons de format. Isolé pour que
 * `useToast()` ne soit appelé QUE sur la fiche admin (le ToastProvider y est
 * monté), et jamais sur les pages client qui n'en ont pas.
 */
function DownloadControls({
  src,
  baseName,
  priceEuros,
  reference,
  disableReference,
  toggles,
}: {
  src: string;
  baseName: string;
  priceEuros: number | null;
  reference: string | null;
  disableReference: boolean;
  toggles: ReturnType<typeof usePersistedOverlayToggles>;
}) {
  const toast = useToast();
  const [busyFormat, setBusyFormat] = useState<OverlayFormat | null>(null);

  async function handleDownload(format: OverlayFormat) {
    if (busyFormat) return;
    setBusyFormat(format);
    try {
      const refAvailable = !disableReference && !!reference;
      await downloadImageWithOverlays(src, baseName, format, {
        priceEuros: toggles.showPrice ? priceEuros : null,
        outOfStock: toggles.showOutOfStock,
        reference: toggles.showReference && refAvailable ? reference : null,
      });
    } catch {
      toast.error(
        "Téléchargement impossible",
        "Impossible de convertir cette image dans ce format.",
      );
    } finally {
      setBusyFormat(null);
    }
  }

  return (
    <div
      className="absolute left-4 bottom-4 sm:bottom-6 w-[min(320px,calc(100vw-2rem))] space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <OverlayToggles
        variant="dark"
        showPrice={toggles.showPrice}
        showOutOfStock={toggles.showOutOfStock}
        showReference={toggles.showReference}
        onChangePrice={toggles.setShowPrice}
        onChangeOutOfStock={toggles.setShowOutOfStock}
        onChangeReference={toggles.setShowReference}
        priceEuros={priceEuros}
        reference={reference}
        disableReference={disableReference}
      />
      <div className="flex items-center gap-2">
        {(["webp", "png", "jpeg"] as OverlayFormat[]).map((f) => (
          <button
            key={f}
            type="button"
            disabled={!!busyFormat}
            onClick={() => handleDownload(f)}
            className="flex-1 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 px-3 py-2 text-xs font-bold text-white font-body backdrop-blur-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title={`Télécharger en ${f.toUpperCase()}`}
            aria-label={`Télécharger en ${f.toUpperCase()}`}
          >
            {busyFormat === f ? (
              <span className="inline-flex items-center justify-center gap-1">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" strokeWidth={4} opacity="0.25" />
                  <path strokeWidth={4} d="M12 2a10 10 0 0110 10" />
                </svg>
                …
              </span>
            ) : (
              f.toUpperCase()
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
