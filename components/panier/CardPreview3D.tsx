"use client";

import { useMemo } from "react";

export type CardBrand =
  | "unknown"
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "diners"
  | "jcb"
  | "unionpay";

export type NumberStatus = "empty" | "partial" | "complete";

interface Props {
  brand: CardBrand;
  numberStatus: NumberStatus;
  holderName: string;
  expMonth: string;
  expYear: string;
  cvcFocused: boolean;
  className?: string;
}

const BRAND_LABELS: Record<CardBrand, string> = {
  unknown:  "CARTE",
  visa:     "VISA",
  mastercard: "MASTERCARD",
  amex:     "AMEX",
  discover: "DISCOVER",
  diners:   "DINERS",
  jcb:      "JCB",
  unionpay: "UNIONPAY",
};

export default function CardPreview3D({
  brand,
  numberStatus,
  holderName,
  expMonth,
  expYear,
  cvcFocused,
  className = "",
}: Props) {
  const brandLabel = BRAND_LABELS[brand] ?? "CARTE";
  const displayName = (holderName || "").trim().toUpperCase() || "NOM PRÉNOM";
  const displayExp = useMemo(() => {
    const mm = (expMonth || "").padStart(2, "0").slice(0, 2);
    const yy = (expYear || "").slice(-2).padStart(2, "0");
    if (!expMonth && !expYear) return "MM/AA";
    return `${mm}/${yy}`;
  }, [expMonth, expYear]);

  // 16 positions groupées 4-4-4-4
  const groups = [0, 1, 2, 3];

  return (
    <div
      className={`w-full max-w-[420px] ${className}`}
      style={{ perspective: "1400px" }}
    >
      <div
        className="relative w-full transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-0"
        style={{
          aspectRatio: "1.586 / 1",
          transformStyle: "preserve-3d",
          transform: cvcFocused ? "rotateY(180deg)" : "rotateY(0deg)",
          willChange: "transform",
        }}
      >
        {/* ─── FACE AVANT ─── */}
        <div
          className="absolute inset-0 rounded-[20px] overflow-hidden p-5 md:p-6 flex flex-col justify-between text-[#F4F4F5]"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            background:
              "linear-gradient(135deg, #52525B 0%, #27272A 55%, #18181B 100%)",
            border: "1px solid rgba(255,255,255,0.05)",
            boxShadow:
              "0 30px 60px -20px rgba(24,24,27,0.45), 0 8px 20px -6px rgba(24,24,27,0.2)",
          }}
        >
          {/* Reflets */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(120% 90% at 0% 0%, rgba(255,255,255,0.08) 0%, transparent 55%), radial-gradient(80% 60% at 100% 100%, rgba(0,0,0,0.20) 0%, transparent 55%)",
            }}
          />

          {/* Top row : chip + brand */}
          <div className="relative z-10 flex items-start justify-between">
            <div
              className="w-10 h-[30px] md:w-12 md:h-9 rounded-[5px] shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, #A1A1AA 0%, #71717A 45%, #D4D4D8 70%, #52525B 100%)",
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.20)",
              }}
              aria-hidden
            />
            <span
              className="font-semibold text-lg md:text-xl tracking-[0.05em]"
              style={{ color: "#F4F4F5" }}
              aria-label={`Marque de carte : ${brandLabel}`}
            >
              {brandLabel}
            </span>
          </div>

          {/* Numéro : 16 points/• remplis en fonction du statut */}
          <div
            className="relative z-10 flex items-center gap-3 md:gap-4 font-mono text-lg md:text-xl tracking-[0.12em]"
            aria-label="Numéro de carte"
          >
            {groups.map((g) => (
              <span key={g} className="inline-flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <NumberDot key={i} status={numberStatus} />
                ))}
              </span>
            ))}
          </div>

          {/* Bottom row */}
          <div className="relative z-10 flex items-end justify-between text-[10px] uppercase tracking-widest opacity-80">
            <div className="min-w-0">
              <div>Titulaire</div>
              <div className="mt-1 text-sm tracking-wider truncate max-w-[220px]">
                {displayName}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div>Expire</div>
              <div className="mt-1 text-sm font-mono">{displayExp}</div>
            </div>
          </div>
        </div>

        {/* ─── FACE ARRIÈRE ─── */}
        <div
          className="absolute inset-0 rounded-[20px] overflow-hidden p-5 md:p-6 flex flex-col justify-between text-[#F4F4F5]"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background:
              "linear-gradient(135deg, #52525B 0%, #27272A 55%, #18181B 100%)",
            border: "1px solid rgba(255,255,255,0.05)",
            boxShadow:
              "0 30px 60px -20px rgba(24,24,27,0.45), 0 8px 20px -6px rgba(24,24,27,0.2)",
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(120% 90% at 0% 0%, rgba(255,255,255,0.08) 0%, transparent 55%)",
            }}
          />

          {/* Bande magnétique */}
          <div
            className="relative z-10 h-11 md:h-12 mt-2"
            style={{ background: "#09090B" }}
            aria-hidden
          />

          {/* Bande signature + CVC placeholder (les vrais chiffres ne sont jamais affichés) */}
          <div
            className="relative z-10 flex items-center justify-between px-3 py-2 rounded-[4px] font-mono tracking-[0.25em]"
            style={{ background: "#E4E4E7", color: "#18181B" }}
          >
            <span className="text-[10px] uppercase tracking-widest opacity-60">
              CVC
            </span>
            <span>•••</span>
          </div>

          <div className="relative z-10 text-[10px] opacity-70 text-right">
            Signature autorisée du porteur
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Un « point » du numéro de carte.
 * - empty    : cercle gris opaque
 * - partial  : cercle qui pulse doucement (saisie en cours)
 * - complete : cercle plein blanc
 *
 * On n'affiche JAMAIS les vrais chiffres tapés : Stripe Elements est sandboxé
 * pour la conformité PCI et ne nous les donne pas.
 */
function NumberDot({ status }: { status: NumberStatus }) {
  if (status === "complete") {
    return (
      <span
        aria-hidden
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{ background: "currentColor", opacity: 1 }}
      />
    );
  }
  if (status === "partial") {
    return (
      <span
        aria-hidden
        className="inline-block w-2.5 h-2.5 rounded-full animate-pulse motion-reduce:animate-none"
        style={{ background: "currentColor", opacity: 0.7 }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block w-2.5 h-2.5 rounded-full"
      style={{ background: "currentColor", opacity: 0.4 }}
    />
  );
}
