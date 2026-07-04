"use client";

import Image from "next/image";
import { getTotalUnits } from "@/lib/order-item-display";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OrderItemView {
  id: string;
  productName: string;
  productRef: string;
  colorName: string;
  imagePath: string | null;
  saleType: string;
  packQty: number | null;
  size: string | null;
  sizesJson: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  isCompensation: boolean;
}

interface ModificationView {
  orderItemId: string;
  originalQuantity: number;
  newQuantity: number;
  originalUnitPrice: number | null;
  newUnitPrice: number | null;
  reason: "OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE";
  priceDifference: number;
  createdAt: string;
  productName: string;
  productRef: string;
  colorName: string;
  imagePath: string | null;
  unitPrice: number;
}

interface Props {
  orderNumber: string;
  paidTTC: number;
  finalTTC: number;
  subtotalHT: number;
  tvaProducts: number;
  carrierPrice: number;
  tvaShipping: number;
  carrierName: string;
  tvaRate: number;
  clientNotifiedAt: string | null;
  items: OrderItemView[];
  modifications: ModificationView[];
  hasCreditNote: boolean;
  creditNoteHref?: string;
}

const REASON_LABELS: Record<string, string> = {
  OUT_OF_STOCK: "Rupture de stock",
  CLIENT_REQUEST: "À votre demande",
  COMMERCIAL_GESTURE: "Geste commercial",
};

const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €";

/* ------------------------------------------------------------------ */
/*  Composant principal                                                */
/* ------------------------------------------------------------------ */

export default function OrderColumnsView({
  paidTTC,
  finalTTC,
  subtotalHT,
  tvaProducts,
  carrierPrice,
  tvaShipping,
  carrierName,
  tvaRate,
  clientNotifiedAt,
  items,
  modifications,
  hasCreditNote,
  creditNoteHref,
}: Props) {
  const orderedItems = items.filter((i) => !i.isCompensation && i.quantity > 0);
  const compensationItems = items.filter((i) => i.isCompensation && i.quantity > 0);

  const totalUnits = [...orderedItems, ...compensationItems].reduce((s, i) => s + getTotalUnits(i), 0);
  const totalModels = new Set([...orderedItems, ...compensationItems].map((i) => i.productRef)).size;

  const creditAmount = Math.max(0, paidTTC - finalTTC);
  const hasChanges = modifications.length > 0 || compensationItems.length > 0;
  const isVatExempt = tvaRate === 0;

  return (
    <div className="space-y-6">
      {/* Bannière informative si modifications */}
      {hasChanges && (
        <section className="rounded-xl border-l-4 border-l-amber-500 bg-amber-50 p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-white border border-amber-200 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-amber-900 text-base">Votre commande a été ajustée</p>
              <p className="text-sm text-amber-800 mt-1.5 leading-relaxed">
                {modifications.length > 0 && compensationItems.length > 0 && (
                  <>
                    Quelques articles ont été ajustés et{" "}
                    <span className="font-semibold">
                      {compensationItems.length} article{compensationItems.length > 1 ? "s" : ""} ajouté{compensationItems.length > 1 ? "s" : ""}
                    </span>
                    .
                  </>
                )}
                {modifications.length > 0 && compensationItems.length === 0 && (
                  <>Quelques articles ont été ajustés.</>
                )}
                {modifications.length === 0 && compensationItems.length > 0 && (
                  <>
                    <span className="font-semibold">
                      {compensationItems.length} article{compensationItems.length > 1 ? "s" : ""} {compensationItems.length > 1 ? "ont été ajoutés" : "a été ajouté"}
                    </span>{" "}
                    à votre commande.
                  </>
                )}
                {creditAmount > 0 && (
                  <>
                    {" "}Un avoir de <span className="font-semibold tabular-nums">{fmt(creditAmount)}</span> vous sera remboursé sous 3 à 5 jours ouvrés.
                  </>
                )}
                {clientNotifiedAt && (
                  <span className="block mt-2 text-xs text-amber-700">
                    Récapitulatif envoyé par email le {new Date(clientNotifiedAt).toLocaleDateString("fr-FR")} à{" "}
                    {new Date(clientNotifiedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.
                  </span>
                )}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 3 COLONNES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Colonne 1 : Articles commandés */}
        <section className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-bg-secondary/40">
            <div className="w-[3px] h-6 bg-slate-800 rounded-sm shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Section 1</p>
              <h2 className="text-base font-semibold text-text-primary">Articles commandés</h2>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className="badge badge-neutral">{orderedItems.length} modèle{orderedItems.length > 1 ? "s" : ""}</span>
                <span className="badge badge-neutral">{orderedItems.reduce((s, i) => s + getTotalUnits(i), 0)} unités</span>
              </div>
            </div>
          </div>
          {orderedItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-text-muted italic">Aucun article commandé.</div>
          ) : (
            <div className="divide-y divide-border-light">
              {orderedItems.map((item) => {
                const mod = modifications.find((m) => m.orderItemId === item.id);
                return (
                  <div key={item.id} className="px-4 py-3.5 flex gap-3">
                    <ItemThumb src={item.imagePath} alt={item.productName} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary leading-snug">{item.productName}</p>
                      <p className="text-[10px] font-mono text-text-muted mt-0.5 truncate">{item.productRef}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="badge badge-neutral">{item.colorName}</span>
                        {item.saleType === "PACK" && item.packQty && (
                          <span className="badge badge-neutral">Paquet ×{item.packQty}</span>
                        )}
                        {mod && <span className="badge badge-warning">Quantité ajustée</span>}
                      </div>
                      <p className="text-[13px] font-semibold text-text-primary mt-1.5 tabular-nums">
                        {fmt(item.lineTotal)}{" "}
                        <span className="text-[10px] text-text-muted font-normal">
                          {item.saleType === "PACK" && item.packQty
                            ? `· ${item.quantity} paquet${item.quantity > 1 ? "s" : ""} × ${fmt(item.unitPrice)} = ${getTotalUnits(item)} unités`
                            : `· ${item.quantity} × ${fmt(item.unitPrice)}`}
                        </span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Colonne 2 : Articles ajoutés (offerts) */}
        <section className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-bg-secondary/40">
            <div className="w-[3px] h-6 bg-emerald-600 rounded-sm shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Section 2</p>
              <h2 className="text-base font-semibold text-text-primary">Articles ajoutés</h2>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className="badge badge-neutral">{compensationItems.length} ligne{compensationItems.length > 1 ? "s" : ""}</span>
                <span className="badge badge-neutral">{compensationItems.reduce((s, i) => s + getTotalUnits(i), 0)} unités</span>
              </div>
            </div>
            {compensationItems.length > 0 && (
              <span className="badge badge-success shrink-0">Offert</span>
            )}
          </div>
          {compensationItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-text-muted italic">Aucun article ajouté.</div>
          ) : (
            <div className="divide-y divide-border-light">
              {compensationItems.map((item) => {
                const isFree = item.unitPrice === 0;
                return (
                  <div key={item.id} className="px-4 py-3.5 flex gap-3 bg-emerald-50/40">
                    <ItemThumb src={item.imagePath} alt={item.productName} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary leading-snug">{item.productName}</p>
                      <p className="text-[10px] font-mono text-text-muted mt-0.5 truncate">{item.productRef}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="badge badge-neutral">{item.colorName}</span>
                        {isFree ? (
                          <span className="badge badge-success">Offert</span>
                        ) : (
                          <span className="badge badge-info">Ajouté</span>
                        )}
                      </div>
                      {isFree && (
                        <p className="text-[11px] text-emerald-700 mt-1.5 italic">Un petit geste de notre part.</p>
                      )}
                      <p className={`text-[13px] font-semibold mt-1.5 tabular-nums ${isFree ? "text-emerald-700" : "text-text-primary"}`}>
                        {fmt(item.lineTotal)}{" "}
                        <span className="text-[10px] text-text-muted font-normal">
                          {item.saleType === "PACK" && item.packQty
                            ? `· ${item.quantity} paquet${item.quantity > 1 ? "s" : ""} × ${fmt(item.unitPrice)} = ${getTotalUnits(item)} unités`
                            : `· ${item.quantity} × ${fmt(item.unitPrice)}`}
                        </span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Colonne 3 : Articles ajustés */}
        <section className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-bg-secondary/40">
            <div className="w-[3px] h-6 bg-rose-600 rounded-sm shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700">Section 3</p>
              <h2 className="text-base font-semibold text-text-primary">Articles ajustés</h2>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className="badge badge-neutral">{modifications.length} ligne{modifications.length > 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
          {modifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-text-muted italic">Aucun article ajusté.</div>
          ) : (
            <div className="divide-y divide-border-light">
              {modifications.map((mod) => {
                const qtyChanged = mod.originalQuantity !== mod.newQuantity;
                const priceChanged = mod.newUnitPrice !== null && mod.originalUnitPrice !== null;
                return (
                  <div key={mod.orderItemId} className="px-4 py-3.5">
                    <div className="flex items-start gap-2.5">
                      <ItemThumb src={mod.imagePath} alt={mod.productName} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary leading-snug">{mod.productName}</p>
                        <p className="text-[10px] font-mono text-text-muted truncate">{mod.productRef}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {qtyChanged && mod.newQuantity === 0 && (
                            <span className="badge badge-error">Retiré</span>
                          )}
                          {qtyChanged && mod.newQuantity > 0 && (
                            <span className="badge badge-warning">Quantité ajustée</span>
                          )}
                          {priceChanged && <span className="badge badge-info">Prix ajusté</span>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="p-1.5 rounded bg-bg-secondary border border-border">
                        <p className="text-[9px] uppercase font-semibold text-text-muted">Quantité</p>
                        {qtyChanged ? (
                          <p className="tabular-nums mt-0.5">
                            <span className="line-through text-text-muted">{mod.originalQuantity}</span>{" "}
                            → <span className={`font-bold ${mod.newQuantity === 0 ? "text-error" : ""}`}>{mod.newQuantity}</span>
                          </p>
                        ) : (
                          <p className="tabular-nums mt-0.5 font-bold">{mod.newQuantity}</p>
                        )}
                      </div>
                      <div className="p-1.5 rounded bg-bg-secondary border border-border">
                        <p className="text-[9px] uppercase font-semibold text-text-muted">Prix unit.</p>
                        {priceChanged ? (
                          <p className="tabular-nums mt-0.5">
                            <span className="line-through text-text-muted">{fmt(mod.originalUnitPrice!)}</span>{" "}
                            → <span className="font-bold">{fmt(mod.newUnitPrice!)}</span>
                          </p>
                        ) : (
                          <p className="tabular-nums mt-0.5 font-bold">{fmt(mod.unitPrice)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-[10px] text-text-muted italic">{REASON_LABELS[mod.reason]}</p>
                      <span className="text-sm font-semibold text-rose-700 tabular-nums">
                        − {fmt(mod.priceDifference)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* SECTION 4 : Résumé de la commande (liste finale) */}
      <section className="bg-white border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-3 bg-bg-secondary/40">
          <div className="w-[3px] h-6 bg-slate-800 rounded-sm" />
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Section 4 — Votre colis</p>
            <h2 className="text-lg font-semibold text-text-primary">Résumé de votre commande</h2>
          </div>
          <span className="badge badge-neutral">{totalUnits} unités</span>
          <span className="badge badge-neutral">{totalModels} modèles</span>
        </div>
        <div className="divide-y divide-border-light">
          {[...orderedItems, ...compensationItems].map((item) => {
            const isFree = item.isCompensation && item.unitPrice === 0;
            return (
              <div key={item.id} className={`px-5 py-3.5 flex gap-3 items-center ${item.isCompensation ? "bg-emerald-50/40" : ""}`}>
                <ItemThumb src={item.imagePath} alt={item.productName} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary">
                    {item.productName}
                    {isFree && <span className="badge badge-success ml-2">Offert</span>}
                    {item.isCompensation && !isFree && <span className="badge badge-info ml-2">Ajouté</span>}
                  </p>
                  <p className="text-[10px] font-mono text-text-muted mt-0.5">
                    {item.productRef} · {item.colorName}
                  </p>
                </div>
                <p className="text-sm text-text-secondary tabular-nums w-24 text-right">
                  {getTotalUnits(item)} unités
                  {item.saleType === "PACK" && item.packQty && (
                    <span className="block text-[10px] text-text-muted">
                      {item.quantity} × ×{item.packQty}
                    </span>
                  )}
                </p>
                <p className={`text-base font-semibold tabular-nums w-24 text-right ${isFree ? "text-emerald-700" : ""}`}>
                  {fmt(item.lineTotal)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION 5 : Résumé financier */}
      <section className="bg-white border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-3 bg-bg-secondary/40">
          <div className="w-[3px] h-6 bg-blue-600 rounded-sm" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">Section 5</p>
            <h2 className="text-lg font-semibold text-text-primary">Résumé financier</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
          {/* Détail chiffré */}
          <div className="px-5 py-5 space-y-2 text-sm md:col-span-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
              <div className="flex justify-between text-text-secondary">
                <span>Sous-total produits HT</span>
                <span className="font-medium text-text-primary tabular-nums">{fmt(subtotalHT)}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>TVA sur produits ({isVatExempt ? "0 % — exonéré" : `${(tvaRate * 100).toFixed(0)} %`})</span>
                <span className="font-medium text-text-primary tabular-nums">{fmt(tvaProducts)}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>Livraison HT ({carrierName})</span>
                <span className="font-medium text-text-primary tabular-nums">
                  {carrierPrice === 0 ? "Gratuit" : fmt(carrierPrice)}
                </span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>TVA sur livraison ({isVatExempt ? "0 % — exonéré" : `${(tvaRate * 100).toFixed(0)} %`})</span>
                <span className="font-medium text-text-primary tabular-nums">{fmt(tvaShipping)}</span>
              </div>
            </div>
            <div className="border-t border-border pt-2 mt-2 flex justify-between items-center">
              <span className="text-base font-semibold text-text-primary">Total TTC</span>
              <span className="text-2xl font-semibold text-text-primary tabular-nums">{fmt(finalTTC)}</span>
            </div>
          </div>

          {/* 3 montants clés */}
          <div className="px-5 py-5 space-y-3">
            <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">Vous aviez payé</p>
              <p className="text-2xl font-bold text-blue-800 mt-1 tabular-nums">{fmt(paidTTC)}</p>
            </div>
            <div className="p-4 rounded-lg bg-bg-secondary border border-border">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Nouveau total</p>
              <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{fmt(finalTTC)}</p>
            </div>
            {creditAmount > 0.01 && (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Remboursement à venir</p>
                <p className="text-2xl font-bold text-emerald-800 mt-1 tabular-nums">{fmt(creditAmount)}</p>
                <p className="text-[10px] text-emerald-700 mt-1">Crédité sous 3 à 5 jours ouvrés</p>
              </div>
            )}
            {hasCreditNote && creditNoteHref && (
              <a
                href={creditNoteHref}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold border border-border rounded-lg hover:bg-bg-secondary transition-colors"
              >
                Télécharger l'avoir (PDF)
              </a>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Vignette produit                                                   */
/* ------------------------------------------------------------------ */

function ItemThumb({ src, alt, size = "md" }: { src: string | null; alt: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? 44 : 56;
  return (
    <div
      className="rounded-md bg-bg-secondary shrink-0 overflow-hidden border border-border"
      style={{ width: dim, height: dim }}
    >
      {src ? (
        <Image src={src} alt={alt} width={dim} height={dim} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-text-muted text-[9px]">img</div>
      )}
    </div>
  );
}
