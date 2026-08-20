"use client";

/**
 * MarketplacePushModal — composant modal unifié pour toutes les actions
 * marketplace : publier, resynchroniser, publier/lier, publier en lot.
 *
 * Remplace :
 *   - MarketplaceActionModal (mode="publish-or-link")
 *   - MarketplacePublishConfirmModal (mode="publish")
 *   - MarketplaceBulkPublishConfirmModal (mode="bulk-publish")
 *   - ConfirmModal interne à MarketplaceStatusButtons (mode="publish" ou "resync")
 *
 * Palette ardoise partout ; l'identité marketplace passe UNIQUEMENT par le
 * rond d'initiale P/A/E/F coloré (gradient figé — cf. CLAUDE.md).
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMarketplaceMaintenance } from "@/components/admin/products/MarketplaceMaintenanceContext";

export type MarketplaceKey = "pfs" | "ankorstore" | "efashion" | "faire" | "orderchamp";
export type PushMode =
  | "publish"
  | "resync"
  | "publish-or-link"
  | "bulk-publish";

interface BulkProduct {
  id: string;
  name: string;
  firstImage: string | null;
}

interface Props {
  open: boolean;
  marketplace: MarketplaceKey;
  mode: PushMode;
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  /** Mode publish-or-link : second CTA « Lier ». */
  onLink?: () => void;

  // ── Contenu mono-produit (publish / resync / publish-or-link) ──
  productName?: string;
  productReference?: string;
  productImage?: string | null;

  // ── Contenu multi-produits (bulk-publish) ──
  products?: BulkProduct[];

  // ── Corps de la modale ──
  /** Paragraphe libre (mode publish). */
  message?: ReactNode;
  /** Sous-titre facultatif rendu sous l'eyebrow. */
  subtitle?: string;
  /** Checklist "Ce qui sera renvoyé" (mode resync). */
  items?: string[];
  /** Bandeau info en bas. */
  infoMessage?: ReactNode;
  infoTone?: "neutral" | "warning";

  // ── Libellés & états CTA ──
  confirmLabel?: string;
  linkLabel?: string;
  /** publish-or-link : masque le CTA « Créer » si false. */
  canCreate?: boolean;
  /** publish-or-link : masque le CTA « Lier » si false. */
  canLink?: boolean;
  createDisabledReason?: string;
  busy?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Métadonnées marketplace — SEULES les couleurs des ronds d'initiale sont
// autorisées. Le reste de la modale reste 100 % ardoise.
// ─────────────────────────────────────────────────────────────────────────

const MP_META: Record<MarketplaceKey, { label: string; letter: string; gradient: string }> = {
  pfs: {
    label: "Paris Fashion Shop",
    letter: "P",
    gradient: "linear-gradient(135deg,#4f46e5,#6366f1)",
  },
  ankorstore: {
    label: "Ankorstore",
    letter: "A",
    gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
  },
  efashion: {
    label: "eFashion Paris",
    letter: "E",
    gradient: "linear-gradient(135deg,#db2777,#ec4899)",
  },
  faire: {
    label: "Faire",
    letter: "F",
    gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  },
  orderchamp: {
    label: "Orderchamp",
    letter: "O",
    gradient: "linear-gradient(135deg,#F97316,#FDBA74)",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────────────

export function MarketplacePushModal({
  open,
  marketplace,
  mode,
  title,
  onClose,
  onConfirm,
  onLink,
  productName,
  productReference,
  productImage,
  products,
  message,
  subtitle,
  items,
  infoMessage,
  infoTone = "neutral",
  confirmLabel,
  linkLabel = "Lier à une fiche existante",
  canCreate = true,
  canLink = false,
  createDisabledReason,
  busy = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const maintenance = useMarketplaceMaintenance();
  const marketplaceInMaintenance = maintenance[marketplace];

  if (!open || !mounted) return null;

  const meta = MP_META[marketplace];
  const defaultConfirmLabel =
    mode === "resync"
      ? "Envoyer maintenant"
      : mode === "bulk-publish"
        ? `Publier ${products?.length ?? 0} produits`
        : "Publier maintenant";
  const finalConfirmLabel = confirmLabel ?? defaultConfirmLabel;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-bg-primary rounded-3xl shadow-modal ring-1 ring-black/5 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="marketplace-push-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 sm:p-7">
          {/* Header : rond d'initiale coloré + eyebrow + titre */}
          <div className="flex items-start gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-extrabold text-xl flex-shrink-0"
              style={{ background: meta.gradient }}
              aria-hidden
            >
              {meta.letter}
            </div>
            <div className="min-w-0 pt-1">
              <div
                className="text-[10.5px] font-bold uppercase text-text-muted mb-1 font-body"
                style={{ letterSpacing: "0.2em" }}
              >
                {meta.label}
                {subtitle ? ` · ${subtitle}` : ""}
              </div>
              <h3
                id="marketplace-push-title"
                className="font-heading text-[22px] font-bold text-text-primary leading-tight"
              >
                {title}
              </h3>
            </div>
          </div>

          {/* Corps mono-produit */}
          {mode !== "bulk-publish" && productName && (
            <div className="mt-5 flex items-center gap-3 p-3 rounded-2xl bg-bg-secondary border border-border">
              <div className="w-14 h-14 rounded-xl bg-bg-tertiary border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                {productImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={productImage} alt="" className="w-full h-full object-cover" />
                ) : (
                  <svg
                    className="w-6 h-6 text-text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={1.6}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text-primary truncate font-body">
                  {productName}
                </div>
                {productReference && (
                  <div className="text-xs text-text-muted mt-0.5 font-mono">
                    {productReference}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Corps multi-produits (bulk) */}
          {mode === "bulk-publish" && products && products.length > 0 && (
            <div className="mt-5">
              <div
                className="text-[10.5px] font-bold uppercase text-text-muted mb-2 font-body"
                style={{ letterSpacing: "0.2em" }}
              >
                {products.length} produits sélectionnés
              </div>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 rounded-xl bg-bg-secondary border border-border">
                {products.slice(0, 14).map((p) => (
                  <div
                    key={p.id}
                    className="w-10 h-10 rounded-lg bg-bg-tertiary border border-border overflow-hidden flex-shrink-0"
                    title={p.name}
                  >
                    {p.firstImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.firstImage} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                ))}
                {products.length > 14 && (
                  <div className="w-10 h-10 rounded-lg bg-bg-tertiary border border-border-strong text-text-secondary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    +{products.length - 14}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Message texte libre (mode publish) */}
          {message && (
            <div className="mt-5 text-sm text-text-secondary leading-relaxed font-body">
              {message}
            </div>
          )}

          {/* Checklist resync */}
          {items && items.length > 0 && (
            <div className="mt-5">
              <div
                className="text-[10.5px] font-bold uppercase text-text-muted mb-3 font-body"
                style={{ letterSpacing: "0.2em" }}
              >
                Ce qui sera renvoyé
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                {items.map((it) => (
                  <div
                    key={it}
                    className="flex items-center gap-2 text-sm text-text-secondary font-body"
                  >
                    <span className="w-4 h-4 rounded-full bg-[color:var(--color-success-bg)] flex items-center justify-center flex-shrink-0">
                      <svg
                        className="w-2.5 h-2.5 text-[color:var(--color-success)]"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </span>
                    {it}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bandeau maintenance plateforme — au-dessus du corps */}
          {marketplaceInMaintenance && (
            <div className="mt-5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 flex items-start gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse mt-1.5" />
              <div className="text-xs text-[#B91C1C] leading-relaxed">
                <span className="font-bold uppercase tracking-wide">En maintenance sur la plateforme.</span>{" "}
                {meta.label} est actuellement bloquée pour toutes les boutiques — publier / synchroniser est
                impossible tant que la maintenance n&apos;est pas levée depuis « Contrôle plateforme ».
              </div>
            </div>
          )}

          {/* Zone "publish-or-link" — 2 gros boutons empilés dans le corps */}
          {mode === "publish-or-link" && (
            <div className="mt-5 space-y-2">
              {canCreate && (
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy || marketplaceInMaintenance}
                  title={marketplaceInMaintenance ? `${meta.label} en maintenance sur la plateforme` : undefined}
                  className="w-full flex items-start gap-3 p-4 rounded-2xl border border-border hover:border-border-dark bg-bg-primary transition-colors disabled:opacity-60 text-left"
                >
                  <svg
                    className="w-5 h-5 text-text-primary flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4.5v15m7.5-7.5h-15"
                    />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-text-primary text-sm font-body">
                      Créer une nouvelle fiche sur {meta.label}
                    </div>
                    <div className="text-[12px] text-text-secondary mt-0.5 font-body">
                      Publie ce produit pour la première fois. Une nouvelle fiche est créée avec les infos, photos, prix et stock actuels.
                    </div>
                  </div>
                </button>
              )}
              {!canCreate && createDisabledReason && (
                <div className="p-3 rounded-xl bg-bg-secondary border border-border text-xs text-text-secondary font-body">
                  <span className="font-semibold text-text-primary">
                    Publication impossible :
                  </span>{" "}
                  {createDisabledReason}
                </div>
              )}
              {canLink && onLink && (
                <button
                  type="button"
                  onClick={onLink}
                  disabled={busy}
                  className="w-full flex items-start gap-3 p-4 rounded-2xl border border-border hover:border-border-dark bg-bg-primary transition-colors disabled:opacity-60 text-left"
                >
                  <svg
                    className="w-5 h-5 text-text-primary flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                    />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-text-primary text-sm font-body">
                      {linkLabel}
                    </div>
                    <div className="text-[12px] text-text-secondary mt-0.5 font-body">
                      Rattache ce produit à une fiche déjà existante sur {meta.label} (utile pour retrouver un produit importé).
                    </div>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* Bandeau info */}
          {infoMessage && (
            <div
              className={`mt-5 flex items-start gap-2.5 p-3 rounded-xl border ${
                infoTone === "warning"
                  ? "bg-[color:var(--color-warning-bg)] border-[#FDE68A]"
                  : "bg-bg-secondary border-border"
              }`}
            >
              <svg
                className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                  infoTone === "warning"
                    ? "text-[color:var(--color-warning)]"
                    : "text-text-muted"
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p
                className={`text-xs leading-relaxed font-body ${
                  infoTone === "warning"
                    ? "text-[color:var(--color-warning)]"
                    : "text-text-secondary"
                }`}
              >
                {infoMessage}
              </p>
            </div>
          )}

          {/* Barre d'actions */}
          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2.5 text-sm font-semibold text-text-secondary rounded-xl hover:bg-bg-secondary transition-colors font-body disabled:opacity-60"
            >
              Annuler
            </button>
            {mode !== "publish-or-link" && (
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy || marketplaceInMaintenance}
                title={marketplaceInMaintenance ? `${meta.label} en maintenance sur la plateforme` : undefined}
                className="inline-flex items-center gap-2 pl-4 pr-5 py-2.5 text-sm font-semibold text-text-inverse bg-bg-dark hover:bg-black rounded-xl transition-colors font-body disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {mode === "resync" ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2.4}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2.4}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 19V5m0 0l-6 6m6-6l6 6"
                    />
                  </svg>
                )}
                {finalConfirmLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
