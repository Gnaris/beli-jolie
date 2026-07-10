"use client";

/**
 * Tiroir « Shooting eFashion » — nouvelle UX validée :
 *  - Une croix par ligne pour retirer un produit du lot.
 *  - Un seul bouton « Tout confirmer » en bas.
 *  - Bandeau ambre expliquant la règle « tout ou rien ».
 *
 * Alimenté par `useEfashionShootingBatch()` — même contexte que l'ancien
 * widget flottant, seule la présentation change.
 */

import { useCallback, useEffect } from "react";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import { useEfashionShootingBatch } from "@/components/admin/products/EfashionShootingBatchContext";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const SHOOTING_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.822 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
    />
  </svg>
);

export function ShootingDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const { items, hasBlockingIssue, isCommitting, removeProduct, commit } = useEfashionShootingBatch();
  const toast = useToast();
  const { confirm } = useConfirm();

  useEffect(() => {
    setBadge("shooting", { count: items.length, pulse: items.length > 0 && !hasBlockingIssue });
  }, [items.length, hasBlockingIssue, setBadge]);

  const onCommitAll = useCallback(async () => {
    if (items.length === 0 || isCommitting) return;
    const ok = await confirm({
      type: "warning",
      title: "Envoyer le lot à eFashion ?",
      message: `${items.length} produit${items.length > 1 ? "s" : ""} seront envoyés à eFashion pour shooting.`,
      confirmLabel: "Tout confirmer",
    });
    if (!ok) return;
    const res = await commit();
    if (res.ok) toast.success("Shooting eFashion", res.message);
    else toast.error("Shooting eFashion", res.message);
  }, [items.length, isCommitting, confirm, commit, toast]);

  const title =
    items.length === 0
      ? "Rien à envoyer"
      : `${items.length} produit${items.length > 1 ? "s" : ""} à confirmer`;

  return (
    <DrawerShell
      open={openWidget === "shooting"}
      onClose={close}
      accent="amber"
      eyebrow="Shooting eFashion"
      title={
        <span className="flex items-center gap-1.5">
          {items.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={SHOOTING_ICON}
      footer={
        items.length > 0 ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500 tabular-nums">
              {items.length} produit{items.length > 1 ? "s" : ""} dans le lot
            </p>
            <button
              type="button"
              onClick={onCommitAll}
              disabled={isCommitting || hasBlockingIssue}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCommitting ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Envoi…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Tout confirmer
                </>
              )}
            </button>
          </div>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucun produit en attente de shooting.</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Ajoutez des produits depuis la page Produits pour les envoyer à eFashion.
          </p>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 bg-amber-50/60 border-b border-slate-100">
            <p className="text-xs text-amber-800 leading-relaxed">
              Vous confirmez le lot <b>en entier</b>. Pour exclure un produit, retirez-le
              de la liste avec la croix.
            </p>
          </div>
          {hasBlockingIssue && (
            <div className="px-4 py-2 bg-rose-50/60 border-b border-slate-100">
              <p className="text-xs text-rose-800 leading-relaxed">
                Un ou plusieurs produits ont des informations manquantes ou ont été
                supprimés. Retirez-les avant de confirmer.
              </p>
            </div>
          )}
          {items.map((item) => (
            <ItemRow
              key={item.id}
              productId={item.productId}
              reference={item.reference}
              name={item.productName}
              image={item.firstImage}
              missing={item.missing}
              blocking={item.noEligibleVariants || item.productDeleted}
              onRemove={() => removeProduct(item.productId)}
            />
          ))}
        </>
      )}
    </DrawerShell>
  );
}

function ItemRow({
  productId: _productId,
  reference,
  name,
  image,
  missing,
  blocking,
  onRemove,
}: {
  productId: string;
  reference: string;
  name: string;
  image: string | null;
  missing: string[];
  blocking: boolean;
  onRemove: () => void;
}) {
  return (
    <div className={`px-4 py-3 border-b border-slate-100 flex items-center gap-2 ${blocking ? "bg-rose-50/30" : "hover:bg-slate-50/60"}`}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="w-9 h-9 rounded-md border border-slate-200 object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] text-slate-400 flex-shrink-0">
          IMG
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name || reference}</p>
        <p className="text-[11px] text-slate-500 font-mono truncate">{reference}</p>
        {missing.length > 0 && (
          <p className="text-[10px] text-amber-700 mt-0.5 truncate">
            Manque : {missing.join(", ")}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        title="Retirer du lot"
        className="w-7 h-7 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center flex-shrink-0"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
