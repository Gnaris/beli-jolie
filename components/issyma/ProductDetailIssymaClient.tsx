"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "@/components/ui/SmartImage";
import { Link } from "@/i18n/navigation";
import { addToCart } from "@/app/actions/client/cart";
import { useToast } from "@/components/ui/Toast";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";

const P = ISSYMA_PALETTE;

export interface IssymaVariant {
  id: string;
  groupKey: string;
  colorId: string | null;
  colorName: string | null;
  hex: string | null;
  patternImage: string | null;
  unitPrice: number;
  stock: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizes: { name: string; quantity: number }[];
}

export interface IssymaImageGroup {
  groupKey: string;
  images: string[];
}

export default function ProductDetailIssymaClient({
  name,
  reference,
  category,
  compositionsText,
  variants,
  imageGroups,
  isAuthenticated,
  showPrices,
  isRevoked,
}: {
  productId: string;
  name: string;
  reference: string;
  category: string;
  compositionsText: string;
  variants: IssymaVariant[];
  imageGroups: IssymaImageGroup[];
  isAuthenticated: boolean;
  showPrices: boolean;
  isRevoked: boolean;
}) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  // Regrouper par couleur : chaque couleur peut avoir plusieurs variantes
  // (UNIT et/ou PACK). On expose les 2 "modes de vente" dans un toggle.
  const colorGroups = useMemo(() => {
    const map = new Map<string, IssymaVariant[]>();
    for (const v of variants) {
      if (!map.has(v.groupKey)) map.set(v.groupKey, []);
      map.get(v.groupKey)!.push(v);
    }
    return [...map.entries()].map(([groupKey, vs]) => ({
      groupKey,
      colorName: vs[0].colorName,
      hex: vs[0].hex,
      patternImage: vs[0].patternImage,
      unitVariant: vs.find((v) => v.saleType === "UNIT") ?? null,
      packVariant: vs.find((v) => v.saleType === "PACK") ?? null,
    }));
  }, [variants]);

  const [activeGroupKey, setActiveGroupKey] = useState<string>(
    colorGroups[0]?.groupKey ?? ""
  );
  const [activeSaleType, setActiveSaleType] = useState<"UNIT" | "PACK">(() => {
    const g = colorGroups[0];
    if (!g) return "UNIT";
    return g.unitVariant ? "UNIT" : "PACK";
  });
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [activeSize, setActiveSize] = useState<string | null>(null);

  const currentGroup = colorGroups.find((g) => g.groupKey === activeGroupKey);

  // Si le mode courant n'existe pas pour la couleur choisie, bascule auto.
  useEffect(() => {
    if (!currentGroup) return;
    if (activeSaleType === "UNIT" && !currentGroup.unitVariant && currentGroup.packVariant) {
      setActiveSaleType("PACK");
    } else if (activeSaleType === "PACK" && !currentGroup.packVariant && currentGroup.unitVariant) {
      setActiveSaleType("UNIT");
    }
  }, [activeSaleType, currentGroup]);

  const currentVariant =
    activeSaleType === "UNIT"
      ? currentGroup?.unitVariant ?? currentGroup?.packVariant ?? null
      : currentGroup?.packVariant ?? currentGroup?.unitVariant ?? null;

  const currentImages =
    imageGroups.find((g) => g.groupKey === activeGroupKey)?.images ??
    imageGroups[0]?.images ??
    [];
  const mainImage = currentImages[activeImageIdx] ?? currentImages[0] ?? null;

  const hasSizes = (currentVariant?.sizes.length ?? 0) > 0;
  const price = currentVariant?.unitPrice ?? 0;
  const isPack = currentVariant?.saleType === "PACK";
  const packQty = currentVariant?.packQuantity ?? null;

  function handleAdd() {
    if (!currentVariant) return;
    if (hasSizes && !activeSize) {
      toast.error("Sélection incomplète", "Merci de choisir une taille.");
      return;
    }
    startTransition(async () => {
      try {
        await addToCart(currentVariant.id, quantity);
        toast.success("Ajouté au panier");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erreur d'ajout.";
        toast.error("Impossible d'ajouter", msg);
      }
    });
  }

  const hasBothSaleTypes = !!(currentGroup?.unitVariant && currentGroup?.packVariant);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-6 lg:gap-10">
      {/* GALERIE : image principale à gauche + vignettes verticales à droite */}
      <div className="grid grid-cols-[1fr_70px] sm:grid-cols-[1fr_76px] gap-3">
        <div
          className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl"
          style={{ background: P.blush100 }}
        >
          {mainImage ? (
            <Image
              src={mainImage}
              alt={name}
              fill
              sizes="(max-width: 768px) 100vw, 45vw"
              className="object-cover"
              priority
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className="serif font-bold"
                style={{ color: P.wine700, fontSize: "5rem", lineHeight: 1 }}
              >
                {name.trim().charAt(0).toUpperCase() || "?"}
              </span>
            </div>
          )}
        </div>

        {/* Vignettes verticales, scroll si > 3 */}
        <div
          className="flex flex-col gap-2 pr-1"
          style={{
            maxHeight: currentImages.length > 3 ? "calc(76px * 3 + 8px * 2)" : "auto",
            overflowY: currentImages.length > 3 ? "auto" : "visible",
          }}
        >
          {currentImages.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => setActiveImageIdx(i)}
              className="relative aspect-square w-full rounded-lg overflow-hidden transition shrink-0"
              style={{
                border: `1.5px solid ${i === activeImageIdx ? P.wine700 : P.borderSoft}`,
                background: P.paper,
              }}
            >
              <Image src={src} alt="" fill sizes="88px" className="object-cover" />
            </button>
          ))}
        </div>
      </div>

      {/* PANEL INFO */}
      <div>
        <p
          className="text-[10px] tracking-[0.32em] uppercase font-semibold"
          style={{ color: P.wine700 }}
        >
          {category}
        </p>

        <h1
          className="serif mt-2"
          style={{
            color: P.ink,
            fontSize: "clamp(1.6rem, 2.6vw, 2.2rem)",
            lineHeight: 1.1,
          }}
        >
          {name}
        </h1>

        <p className="mt-2 text-[11px] tracking-[0.24em] uppercase font-semibold" style={{ color: P.muted }}>
          Réf: {reference}
        </p>

        {compositionsText && (
          <p className="mt-3 text-[13px]" style={{ color: P.inkSoft }}>
            <span className="font-semibold" style={{ color: P.ink }}>Composition :</span> {compositionsText}
          </p>
        )}

        {/* Sélecteur couleur */}
        <div className="mt-4">
          <p className="text-[10px] tracking-[0.22em] uppercase font-semibold mb-2" style={{ color: P.muted }}>
            Couleur : <span style={{ color: P.ink }}>{currentGroup?.colorName ?? ""}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {colorGroups.map((c) => {
              const isActive = c.groupKey === activeGroupKey;
              const bg = c.patternImage
                ? `url(${c.patternImage}) center/cover`
                : c.hex ?? "#fff";
              return (
                <button
                  key={c.groupKey}
                  type="button"
                  onClick={() => {
                    setActiveGroupKey(c.groupKey);
                    setActiveImageIdx(0);
                    setActiveSize(null);
                  }}
                  className="w-7 h-7 rounded-full transition"
                  title={c.colorName ?? ""}
                  aria-label={c.colorName ?? "couleur"}
                  style={{
                    background: bg,
                    border: `2px solid ${isActive ? P.wine700 : P.borderSoft}`,
                    boxShadow: isActive ? `0 0 0 2px ${P.paper}` : "none",
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Toggle UNIT / PACK (uniquement si les 2 existent pour la couleur) */}
        {hasBothSaleTypes && (
          <div className="mt-4">
            <p className="text-[10px] tracking-[0.22em] uppercase font-semibold mb-2" style={{ color: P.muted }}>
              Mode de vente
            </p>
            <div
              className="inline-flex rounded-full p-1"
              style={{ background: P.paper, border: `1px solid ${P.borderSoft}` }}
            >
              {(["UNIT", "PACK"] as const).map((mode) => {
                const isActive = activeSaleType === mode;
                const label =
                  mode === "UNIT"
                    ? "À l'unité"
                    : `Lot de ${currentGroup?.packVariant?.packQuantity ?? "?"}`;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setActiveSaleType(mode)}
                    className="px-4 py-1.5 text-[11px] tracking-[0.15em] uppercase font-semibold rounded-full transition"
                    style={{
                      background: isActive ? P.wine700 : "transparent",
                      color: isActive ? P.cream : P.ink,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Réassurance rows (icônes + texte) */}
        <div className="mt-5 rounded-xl p-4 space-y-3" style={{ background: P.paper, border: `1px solid ${P.borderSoft}` }}>
          {[
            { title: "48h chrono", desc: "Traitement de commande" },
            { title: "10j max", desc: "Livraison partout en France" },
            { title: "14 jours", desc: "Retour gratuit sous 14 jours" },
          ].map((row, i) => (
            <div key={i} className="flex items-start gap-3">
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "#f2d9d3", color: P.wine700 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>
                </svg>
              </span>
              <div className="leading-tight">
                <p className="text-[12px] font-semibold" style={{ color: P.ink }}>{row.title}</p>
                <p className="text-[11px]" style={{ color: P.inkSoft }}>{row.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Bloc prix / lock / add-to-cart */}
        <div className="mt-5">
          {!isAuthenticated ? (
            <div
              className="rounded-2xl p-5 sm:p-6"
              style={{ background: `linear-gradient(135deg, ${P.wine900} 0%, ${P.wine700} 60%, ${P.wine600} 100%)` }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "rgba(244, 234, 217, 0.15)", color: P.cream }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <rect x="5" y="11" width="14" height="9" rx="2"/>
                    <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
                  </svg>
                </span>
                <div>
                  <p className="serif text-[16px] sm:text-[18px] font-semibold" style={{ color: P.cream }}>
                    Tarifs réservés aux professionnels
                  </p>
                  <p className="text-[12px] mt-1 leading-relaxed" style={{ color: `${P.cream2}cc` }}>
                    Créez votre compte pro (KBIS requis) pour voir les prix et passer commande.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <Link
                  href="/inscription"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold transition"
                  style={{ background: P.cream, color: P.wine800 }}
                >
                  Créer mon compte <span aria-hidden>→</span>
                </Link>
                <Link
                  href="/connexion"
                  className="inline-flex items-center justify-center gap-2 text-[11px] tracking-[0.18em] uppercase font-semibold px-3 py-2"
                  style={{ color: `${P.cream2}cc` }}
                >
                  Déjà pro ? Se connecter
                </Link>
              </div>
            </div>
          ) : !showPrices ? (
            <div
              className="rounded-2xl p-5 sm:p-6"
              style={{
                background: isRevoked ? "#fef2f2" : "#eff6ff",
                border: `1px solid ${isRevoked ? "#fecaca" : "#bfdbfe"}`,
              }}
            >
              <p className="text-[13px] font-semibold" style={{ color: isRevoked ? "#991b1b" : "#1e40af" }}>
                {isRevoked ? "Compte désactivé" : "Compte en attente de validation"}
              </p>
              <p className="text-[12px] mt-1" style={{ color: isRevoked ? "#7f1d1d" : "#1e3a8a" }}>
                {isRevoked
                  ? "Contactez-nous pour réactiver votre accès."
                  : "Nous vérifions vos documents. Vous serez notifié·e par email."}
              </p>
            </div>
          ) : (
            <div
              className="rounded-2xl p-5"
              style={{ background: P.paper, border: `1px solid ${P.borderSoft}` }}
            >
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-[10px] tracking-[0.22em] uppercase font-semibold" style={{ color: P.muted }}>
                  {isPack ? `Lot de ${packQty ?? "?"} — Prix HT` : "Prix HT unitaire"}
                </p>
                <p className="serif text-[26px] font-bold tabular-nums" style={{ color: P.wine700 }}>
                  {price.toFixed(2).replace(".", ",")} €
                </p>
              </div>
              {isPack && packQty && packQty > 0 && (
                <p className="text-[11px] mb-3" style={{ color: P.inkSoft }}>
                  Soit {(price / packQty).toFixed(2).replace(".", ",")} € / pièce
                </p>
              )}

              {hasSizes && (
                <div className="mt-3 mb-3">
                  <p className="text-[10px] tracking-[0.22em] uppercase font-semibold mb-2" style={{ color: P.muted }}>
                    Taille
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {currentVariant!.sizes.map((s) => {
                      const active = activeSize === s.name;
                      const oos = s.quantity <= 0;
                      return (
                        <button
                          key={s.name}
                          type="button"
                          disabled={oos}
                          onClick={() => setActiveSize(s.name)}
                          className="px-3 py-1.5 rounded-full text-[11px] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            background: active ? P.wine700 : P.paper,
                            color: active ? P.cream : P.ink,
                            border: `1.5px solid ${active ? P.wine700 : P.borderSoft}`,
                          }}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mb-3">
                <p className="text-[10px] tracking-[0.22em] uppercase font-semibold mb-2" style={{ color: P.muted }}>
                  Quantité {isPack ? "(lots)" : ""}
                </p>
                <div className="inline-flex items-center rounded-full overflow-hidden" style={{ border: `1.5px solid ${P.borderSoft}` }}>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-8 h-8 flex items-center justify-center"
                    style={{ color: P.ink }}
                  >
                    –
                  </button>
                  <span className="w-10 text-center text-[13px] font-semibold" style={{ color: P.ink }}>{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => q + 1)}
                    className="w-8 h-8 flex items-center justify-center"
                    style={{ color: P.ink }}
                  >
                    +
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAdd}
                disabled={isPending}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold transition disabled:opacity-60"
                style={{ background: P.wine700, color: P.cream }}
              >
                {isPending ? "Ajout..." : "Ajouter au panier"} <span aria-hidden>→</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
