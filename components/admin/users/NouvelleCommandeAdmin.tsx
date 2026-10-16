"use client";

/**
 * Builder admin « Créer une commande pour cette cliente ».
 * - Recherche produit (minimum 2 lettres, debounced)
 * - Ajout d'une ligne : variante (couleur) + taille optionnelle + quantité +
 *   prix unitaire (pré-rempli = prix catalogue × (1 − remise %), modifiable)
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

  function addLine(product: AdminOrderProductResult, variant: AdminOrderVariantOption) {
    const sz = variant.sizes[0] ?? null;
    const line: Line = {
      tempId: `${variant.id}-${Date.now()}`,
      productName: product.name,
      productReference: product.reference,
      variant,
      sizeId: sz?.id ?? null,
      sizeName: sz?.name ?? null,
      quantity: 1,
      unitPrice: priceForVariant(variant),
    };
    setLines((prev) => [...prev, line]);
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
          <ul className="mt-3 space-y-1.5 max-h-96 overflow-y-auto">
            {results.flatMap((p) =>
              p.variants.length === 0
                ? [
                    <li
                      key={`${p.id}-empty`}
                      className="border border-border rounded-xl p-3 flex items-center gap-3 opacity-60"
                    >
                      {p.imagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/uploads/${p.imagePath}`} alt={p.name} className="w-12 h-12 rounded-lg object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-bg-tertiary border border-border shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-body font-semibold text-text-primary truncate">{p.name}</p>
                        <p className="text-xs text-text-muted">Aucune couleur active disponible</p>
                      </div>
                    </li>,
                  ]
                : p.variants.map((v) => (
                    <li
                      key={v.id}
                      className="border border-border rounded-xl p-3 flex items-center gap-3 hover:bg-bg-secondary/60 transition-colors"
                    >
                      {p.imagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/uploads/${p.imagePath}`} alt={p.name} className="w-12 h-12 rounded-lg object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-bg-tertiary border border-border shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-body font-semibold text-text-primary truncate">
                          {p.name}
                        </p>
                        <p className="text-xs text-text-muted font-body flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="font-mono">{p.reference}</span>
                          <span className="opacity-50">·</span>
                          {v.colorHex && (
                            <span
                              className="inline-block w-3 h-3 rounded-full border border-border/60"
                              style={{ background: v.colorHex }}
                              aria-hidden="true"
                            />
                          )}
                          <span>{v.colorName || "—"}</span>
                          <span className="opacity-50">·</span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                              v.saleType === "PACK"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {v.saleType === "PACK" ? `Pack × ${v.packQuantity ?? 1}` : "Unitaire"}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-heading font-bold text-text-primary tabular-nums">
                            {fmtEuros(priceForVariant(v))}
                          </p>
                          <p
                            className={`text-[11px] font-body tabular-nums ${
                              v.stock <= 0 ? "text-red-600" : v.stock < 5 ? "text-amber-700" : "text-emerald-700"
                            }`}
                          >
                            {v.stock} en stock
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addLine(p, v)}
                          disabled={v.stock <= 0}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                          Ajouter
                        </button>
                      </div>
                    </li>
                  )),
            )}
          </ul>
        )}

        {query.trim().length >= 2 && !searching && results.length === 0 && (
          <p className="text-sm text-text-muted mt-3">Aucun produit trouvé.</p>
        )}
      </section>

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
