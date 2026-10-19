"use client";

/**
 * Builder admin « Créer une commande pour cette cliente ».
 * - Recherche produit (minimum 2 lettres, debounced)
 * - Résultat = 1 carte par produit avec pastilles de couleurs ; clic sur une
 *   pastille → mini-modale (photo de la couleur + taille + quantité + Ajouter)
 * - Preview total HT
 * - Soumet → createAdminOrderForClient → redirect vers la fiche commande admin
 */

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  createAdminOrderForClient,
  searchProductsForAdminOrder,
  type AdminOrderProductResult,
  type AdminOrderVariantOption,
} from "@/app/actions/admin/create-admin-order";

interface Props {
  clientId: string;
  clientLabel: string;
  clientDiscountPercent: number;
}

interface Line {
  tempId: string;
  productName: string;
  productReference: string;
  variant: AdminOrderVariantOption;
  sizeId: string | null;
  sizeName: string | null;
  quantity: number;
  unitPrice: number;
}

function fmtEuros(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default function NouvelleCommandeAdmin({ clientId, clientLabel, clientDiscountPercent }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminOrderProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lines, setLines] = useState<Line[]>([]);

  // Mini-modale « choisir la variante à ajouter » (clic sur une pastille)
  const [picker, setPicker] = useState<{
    product: AdminOrderProductResult;
    variant: AdminOrderVariantOption;
    sizeId: string | null;
    quantity: number;
  } | null>(null);

  // Recherche debounced
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const res = await searchProductsForAdminOrder(q);
      if (res.success) setResults(res.results);
      else setResults([]);
      setSearching(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function priceForVariant(v: AdminOrderVariantOption): number {
    const base = v.unitPrice;
    const disc = clientDiscountPercent > 0 ? base * (1 - clientDiscountPercent / 100) : base;
    return Math.round(disc * 100) / 100;
  }

  function openPicker(product: AdminOrderProductResult, variant: AdminOrderVariantOption) {
    if (variant.stock <= 0) return;
    setPicker({
      product,
      variant,
      sizeId: variant.sizes[0]?.id ?? null,
      quantity: 1,
    });
  }

  function confirmPicker() {
    if (!picker) return;
    const { product, variant, sizeId, quantity } = picker;
    const sz = sizeId ? variant.sizes.find((s) => s.id === sizeId) ?? null : null;
    const line: Line = {
      tempId: `${variant.id}-${sizeId ?? "none"}-${Date.now()}`,
      productName: product.name,
      productReference: product.reference,
      variant,
      sizeId: sz?.id ?? null,
      sizeName: sz?.name ?? null,
      quantity: Math.max(1, Math.floor(quantity) || 1),
      unitPrice: priceForVariant(variant),
    };
    setLines((prev) => [...prev, line]);
    setPicker(null);
    setQuery("");
    setResults([]);
  }

  function removeLine(tempId: string) {
    setLines((prev) => prev.filter((l) => l.tempId !== tempId));
  }

  function updateLine(tempId: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)));
  }

  const subtotalHT = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  function handleSubmit() {
    if (lines.length === 0) {
      toast.error("Ajoutez au moins un article avant de créer la commande.");
      return;
    }
    for (const l of lines) {
      if (l.quantity <= 0) {
        toast.error("Chaque ligne doit avoir une quantité strictement positive.");
        return;
      }
      if (l.unitPrice < 0) {
        toast.error("Les prix unitaires doivent être positifs ou nuls.");
        return;
      }
    }

    startTransition(async () => {
      const res = await createAdminOrderForClient({
        clientId,
        items: lines.map((l) => ({
          variantId: l.variant.id,
          sizeId: l.sizeId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      });
      if (!res.success) {
        toast.error("Création impossible", res.error);
        return;
      }
      toast.success("Commande créée", `La cliente ${clientLabel} va la finaliser depuis son espace pro.`);
      router.push(`/admin/commandes/${res.orderId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Picker produits */}
      <section className="card p-6">
        <h2 className="font-heading text-lg font-semibold text-text-primary mb-3">Ajouter un article</h2>
        {clientDiscountPercent > 0 && (
          <p className="text-xs text-emerald-700 font-body mb-3 inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
            Remise permanente de la cliente : <strong>−{clientDiscountPercent}%</strong> (pré-appliquée aux prix, modifiable)
          </p>
        )}
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom ou référence du produit…"
            className="field-input w-full"
            autoFocus
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">Recherche…</span>
          )}
        </div>

        {results.length > 0 && (
          <ul className="mt-3 space-y-2 max-h-[32rem] overflow-y-auto">
            {results.map((p) => {
              const thumb =
                p.variants.find((v) => v.imagePath)?.imagePath ?? p.imagePath ?? null;
              return (
                <li
                  key={p.id}
                  className="border border-border rounded-xl p-3 flex items-start gap-3 hover:bg-bg-secondary/40 transition-colors"
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/uploads/${thumb}`}
                      alt={p.name}
                      className="w-14 h-14 rounded-lg object-cover border border-border shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-bg-tertiary border border-border shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-body font-semibold text-text-primary truncate">
                      {p.name}
                    </p>
                    <p className="text-[11px] text-text-muted font-mono truncate">{p.reference}</p>
                    {p.variants.length === 0 ? (
                      <p className="text-xs text-text-muted mt-1.5">Aucune couleur active disponible</p>
                    ) : (
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        {p.variants.map((v) => {
                          const label = v.colorName || "Couleur";
                          const out = v.stock <= 0;
                          const swatchStyle: React.CSSProperties = v.colorPatternImage
                            ? {
                                backgroundImage: `url(${v.colorPatternImage})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }
                            : { background: v.colorHex ?? "#9CA3AF" };
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => openPicker(p, v)}
                              disabled={out}
                              title={`${label}${v.saleType === "PACK" ? ` · Pack × ${v.packQuantity ?? 1}` : ""} · ${v.stock} en stock · ${fmtEuros(priceForVariant(v))}`}
                              className={`group inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border transition-colors ${
                                out
                                  ? "border-border opacity-40 cursor-not-allowed"
                                  : "border-border hover:border-text-primary hover:bg-bg-primary"
                              }`}
                            >
                              <span
                                className="inline-block w-5 h-5 rounded-full border border-border/60 shrink-0"
                                style={swatchStyle}
                                aria-hidden="true"
                              />
                              <span className="text-[11px] font-body text-text-secondary max-w-[7rem] truncate">
                                {label}
                              </span>
                              {v.saleType === "PACK" && (
                                <span className="text-[9px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-700 px-1 rounded">
                                  ×{v.packQuantity ?? 1}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {query.trim().length >= 2 && !searching && results.length === 0 && (
          <p className="text-sm text-text-muted mt-3">Aucun produit trouvé.</p>
        )}
      </section>

      {picker && (() => {
        const { product: pp, variant: vv } = picker;
        const img = vv.imagePath ?? pp.imagePath ?? null;
        const swatchStyle: React.CSSProperties = vv.colorPatternImage
          ? {
              backgroundImage: `url(${vv.colorPatternImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : { background: vv.colorHex ?? "#9CA3AF" };
        const currentSize = picker.sizeId
          ? vv.sizes.find((s) => s.id === picker.sizeId)
          : null;
        const stockForChoice = currentSize ? currentSize.quantity : vv.stock;
        const maxQty = Math.max(1, stockForChoice);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setPicker(null)}
          >
            <div
              className="w-full max-w-md bg-bg-primary border border-border rounded-2xl shadow-xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Ajouter cette variante à la commande"
            >
              <div className="flex items-start gap-3 p-4 border-b border-border">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/uploads/${img}`}
                    alt={pp.name}
                    className="w-20 h-20 rounded-xl object-cover border border-border shrink-0"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-bg-tertiary border border-border shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
                    Ajouter à la commande
                  </p>
                  <p className="text-sm font-body font-semibold text-text-primary truncate mt-0.5">
                    {pp.name}
                  </p>
                  <p className="text-[11px] text-text-muted font-mono truncate">{pp.reference}</p>
                  <p className="text-xs text-text-secondary font-body flex items-center gap-1.5 mt-1">
                    <span
                      className="inline-block w-3.5 h-3.5 rounded-full border border-border/60"
                      style={swatchStyle}
                      aria-hidden="true"
                    />
                    <span>{vv.colorName || "—"}</span>
                    {vv.saleType === "PACK" && (
                      <span className="text-[9px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-700 px-1 rounded">
                        Pack × {vv.packQuantity ?? 1}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPicker(null)}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-text-muted hover:bg-bg-secondary transition-colors shrink-0"
                  aria-label="Fermer"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="p-4 space-y-4">
                {vv.sizes.length > 1 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted mb-2">
                      Taille
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {vv.sizes.map((s) => {
                        const selected = picker.sizeId === s.id;
                        const sOut = s.quantity <= 0;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() =>
                              setPicker((p) =>
                                p ? { ...p, sizeId: s.id, quantity: Math.min(p.quantity, Math.max(1, s.quantity)) } : p,
                              )
                            }
                            disabled={sOut}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-body transition-colors ${
                              selected
                                ? "bg-bg-dark text-text-inverse border-transparent"
                                : sOut
                                  ? "border-border opacity-40 cursor-not-allowed"
                                  : "border-border hover:border-text-primary"
                            }`}
                          >
                            {s.name}
                            <span className={`ml-1.5 text-[10px] ${selected ? "opacity-80" : "text-text-muted"} tabular-nums`}>
                              {s.quantity}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-end gap-4">
                  <label className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted mb-1">
                      Quantité
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={maxQty}
                      value={picker.quantity}
                      onChange={(e) =>
                        setPicker((p) =>
                          p
                            ? {
                                ...p,
                                quantity: Math.max(1, Math.min(maxQty, Math.floor(Number(e.target.value) || 1))),
                              }
                            : p,
                        )
                      }
                      className="field-input w-24 tabular-nums"
                    />
                  </label>
                  <div className="flex flex-col text-right ml-auto">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted mb-1">
                      Prix unit. HT
                    </span>
                    <span className="text-base font-heading font-bold text-text-primary tabular-nums">
                      {fmtEuros(priceForVariant(vv))}
                    </span>
                    <span
                      className={`text-[11px] font-body tabular-nums ${
                        stockForChoice <= 0
                          ? "text-red-600"
                          : stockForChoice < 5
                            ? "text-amber-700"
                            : "text-emerald-700"
                      }`}
                    >
                      {stockForChoice} en stock
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-bg-secondary/40">
                <button
                  type="button"
                  onClick={() => setPicker(null)}
                  className="px-4 py-2 rounded-lg text-sm font-body text-text-secondary hover:bg-bg-secondary transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirmPicker}
                  disabled={stockForChoice <= 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Ajouter à la commande
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Lignes de la commande */}
      <section className="card p-6">
        <h2 className="font-heading text-lg font-semibold text-text-primary mb-4">
          Articles de la commande <span className="text-text-muted font-body font-medium">({lines.length})</span>
        </h2>
        {lines.length === 0 ? (
          <p className="text-sm text-text-muted font-body">Aucun article pour le moment. Utilisez la recherche ci-dessus.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.tempId} className="border border-border rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-body font-semibold text-text-primary truncate">
                    {l.productName}
                  </p>
                  <p className="text-xs text-text-muted font-body">
                    <span className="font-mono">{l.productReference}</span>
                    {" · "}
                    {l.variant.colorName || "—"}
                    {l.variant.sizes.length > 1 && (
                      <>
                        {" · "}
                        <select
                          value={l.sizeId ?? ""}
                          onChange={(e) => {
                            const sid = e.target.value || null;
                            const sz = l.variant.sizes.find((s) => s.id === sid);
                            updateLine(l.tempId, { sizeId: sid, sizeName: sz?.name ?? null });
                          }}
                          className="inline bg-transparent border border-border rounded px-1 py-0.5 text-xs"
                        >
                          {l.variant.sizes.map((s) => (
                            <option key={s.id} value={s.id}>Taille {s.name}</option>
                          ))}
                        </select>
                      </>
                    )}
                    {l.variant.sizes.length === 1 && l.sizeName && (
                      <> {" · "} Taille {l.sizeName}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex flex-col items-start">
                    <span className="text-[10px] uppercase tracking-wide text-text-muted">Qté</span>
                    <input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => updateLine(l.tempId, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                      className="field-input w-20 tabular-nums"
                    />
                  </label>
                  <label className="flex flex-col items-start">
                    <span className="text-[10px] uppercase tracking-wide text-text-muted">Prix unit. HT</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.unitPrice}
                      onChange={(e) => updateLine(l.tempId, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                      className="field-input w-28 tabular-nums"
                    />
                  </label>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] uppercase tracking-wide text-text-muted">Total HT</span>
                    <span className="text-sm font-heading font-bold text-text-primary tabular-nums">
                      {fmtEuros(l.unitPrice * l.quantity)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(l.tempId)}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                    title="Retirer"
                    aria-label="Retirer cet article"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {lines.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border flex items-center justify-between">
            <div>
              <p className="text-xs text-text-muted uppercase tracking-widest font-body font-bold">Sous-total HT</p>
              <p className="text-2xl font-heading font-bold text-text-primary tabular-nums">{fmtEuros(subtotalHT)}</p>
              <p className="text-[11px] text-text-muted font-body mt-1">
                La TVA et les frais de port seront calculés quand la cliente finalisera.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="btn-primary px-6 py-3 disabled:opacity-50 disabled:cursor-wait"
            >
              {isPending ? "Création…" : "Créer la commande"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
