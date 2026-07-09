"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";

type MarketplaceCode = "PFS" | "ANKOR" | "EF" | "Faire" | string;

interface Props {
  open: boolean;
  marketplaceName: string;
  marketplaceCode: MarketplaceCode;
  productName: string;
  productReference?: string;
  productImage?: string | null;
  variantsCount?: number;
  subtitle?: string;
  infoMessage?: ReactNode;
  infoTone?: "neutral" | "warning";
  confirmLabel?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

type PaletteKey = "slate" | "sky" | "rose" | "amber";

const PALETTE_BY_CODE: Record<string, PaletteKey> = {
  PFS: "slate",
  ANKOR: "sky",
  EF: "rose",
  Faire: "amber",
};

const PALETTE: Record<PaletteKey, {
  logoGradient: string;
  logoShadow: string;
  aurora: string;
  eyebrow: string;
  dot: string;
  halo: string;
  infoBg: string;
  infoBorder: string;
  infoText: string;
  infoIcon: string;
}> = {
  slate: {
    logoGradient: "linear-gradient(135deg, #64748b 0%, #334155 50%, #1e293b 100%)",
    logoShadow: "0 10px 30px -8px rgba(51,65,85,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
    aurora: "from-slate-100 via-bg-primary to-bg-primary",
    eyebrow: "text-slate-700",
    dot: "bg-slate-500",
    halo: "bg-slate-400/30",
    infoBg: "bg-slate-50",
    infoBorder: "border-slate-200",
    infoText: "text-slate-700",
    infoIcon: "text-slate-500",
  },
  sky: {
    logoGradient: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 50%, #075985 100%)",
    logoShadow: "0 10px 30px -8px rgba(14,165,233,0.55), inset 0 1px 0 rgba(255,255,255,0.4)",
    aurora: "from-sky-50 via-bg-primary to-bg-primary",
    eyebrow: "text-sky-700",
    dot: "bg-sky-500",
    halo: "bg-sky-400/30",
    infoBg: "bg-sky-50",
    infoBorder: "border-sky-200",
    infoText: "text-sky-900",
    infoIcon: "text-sky-600",
  },
  rose: {
    logoGradient: "linear-gradient(135deg, #ec4899 0%, #db2777 50%, #9d174d 100%)",
    logoShadow: "0 10px 30px -8px rgba(219,39,119,0.55), inset 0 1px 0 rgba(255,255,255,0.4)",
    aurora: "from-rose-50 via-bg-primary to-bg-primary",
    eyebrow: "text-rose-700",
    dot: "bg-rose-500",
    halo: "bg-rose-400/30",
    infoBg: "bg-rose-50",
    infoBorder: "border-rose-200",
    infoText: "text-rose-900",
    infoIcon: "text-rose-600",
  },
  amber: {
    logoGradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #92400e 100%)",
    logoShadow: "0 10px 30px -8px rgba(217,119,6,0.55), inset 0 1px 0 rgba(255,255,255,0.4)",
    aurora: "from-amber-50 via-bg-primary to-bg-primary",
    eyebrow: "text-amber-700",
    dot: "bg-amber-500",
    halo: "bg-amber-400/30",
    infoBg: "bg-amber-50",
    infoBorder: "border-amber-200",
    infoText: "text-amber-900",
    infoIcon: "text-amber-600",
  },
};

function getInitial(code: MarketplaceCode): string {
  if (code === "PFS") return "P";
  if (code === "ANKOR") return "A";
  if (code === "EF") return "E";
  if (code === "Faire") return "F";
  return code.charAt(0).toUpperCase();
}

export default function MarketplacePublishConfirmModal({
  open,
  marketplaceName,
  marketplaceCode,
  productName,
  productReference,
  productImage,
  variantsCount,
  subtitle,
  infoMessage,
  infoTone = "neutral",
  confirmLabel = "Oui, publier",
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const backdrop = useBackdropClose(onClose);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const palette = PALETTE[PALETTE_BY_CODE[marketplaceCode] ?? "slate"];
  const initial = getInitial(marketplaceCode);

  const defaultSubtitle = `Une nouvelle fiche va être créée avec les infos, photos, prix et stock actuels.`;
  const defaultInfo = (
    <>
      La publication utilise <strong>vos infos, photos, prix et stock actuels</strong>. Vous pourrez tout modifier après.
    </>
  );

  // Info tone override — warning force amber pour Faire (brouillon)
  const infoPalette = infoTone === "warning" ? PALETTE.amber : palette;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="bg-bg-primary w-full max-w-lg rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête aurora */}
        <div className={`relative overflow-hidden bg-gradient-to-br ${palette.aurora} px-6 pt-6 pb-5`}>
          <div className={`absolute -top-12 -right-10 w-40 h-40 rounded-full blur-3xl ${palette.halo} pointer-events-none`} />

          <div className="relative flex items-start gap-4">
            <div className="relative shrink-0">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center font-heading font-extrabold text-white text-lg"
                style={{ background: palette.logoGradient, boxShadow: palette.logoShadow }}
              >
                {initial}
              </div>
              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white" />
            </div>

            <div className="min-w-0 flex-1">
              <div className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-bold ${palette.eyebrow} mb-1`}>
                <span className={`w-1.5 h-1.5 rounded-full ${palette.dot}`} />
                Confirmation
              </div>
              <h3 className="font-heading text-xl font-bold text-text-primary leading-tight">
                Publier sur {marketplaceName}&nbsp;?
              </h3>
              <p className="text-[12.5px] text-text-secondary font-body mt-1">
                {subtitle ?? defaultSubtitle}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Fermer"
              className="w-8 h-8 rounded-lg text-text-muted hover:bg-bg-secondary hover:text-text-primary flex items-center justify-center shrink-0 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Carte produit */}
          <div className="relative mt-5 flex items-center gap-3 rounded-2xl bg-bg-primary/70 backdrop-blur border border-white ring-1 ring-border px-3 py-2.5">
            <div className="w-11 h-11 rounded-lg bg-bg-secondary flex items-center justify-center text-text-muted shrink-0 overflow-hidden">
              {productImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={productImage} alt="" className="w-full h-full object-cover" />
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8l4-4h8l4 4M4 8l8 12M4 8h16m-4 12L20 8" />
                </svg>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-text-primary truncate">{productName}</div>
              {(productReference || variantsCount) && (
                <div className="text-[11px] text-text-secondary flex items-center gap-2 mt-0.5">
                  {productReference && <span className="font-mono">{productReference}</span>}
                  {productReference && variantsCount ? <span className="w-1 h-1 rounded-full bg-text-muted/50" /> : null}
                  {variantsCount ? (
                    <span>
                      {variantsCount} variante{variantsCount > 1 ? "s" : ""}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bandeau info */}
        <div className="p-5">
          <div className={`rounded-2xl border ${infoPalette.infoBg} ${infoPalette.infoBorder} p-3 flex items-start gap-2.5`}>
            <svg className={`w-4 h-4 ${infoPalette.infoIcon} mt-0.5 shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className={`text-[12px] ${infoPalette.infoText} leading-snug`}>
              {infoMessage ?? defaultInfo}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-[13px] text-text-secondary hover:text-text-primary font-body font-medium px-4 py-2.5 rounded-xl hover:bg-bg-secondary disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="text-[13px] font-bold text-white bg-ink hover:bg-ink/90 px-5 py-2.5 rounded-xl shadow-[0_10px_24px_-8px_rgba(15,23,42,0.35)] inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
          >
            {busy ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Publication…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {confirmLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
