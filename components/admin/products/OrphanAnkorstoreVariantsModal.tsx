"use client";

import { useEffect, useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  getOrphanAnkorstoreVariants,
  linkOrphanVariantPair,
  createLocalVariantFromAnkorstoreVariant,
  type LocalOrphanVariant,
  type AnkorstoreOrphanVariant,
  type LinkedVariantPair,
} from "@/app/actions/admin/ankorstore";

interface OrphanAnkorstoreVariantsModalProps {
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
}

export default function OrphanAnkorstoreVariantsModal({
  productId,
  productName,
  reference,
  onClose,
}: OrphanAnkorstoreVariantsModalProps) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locals, setLocals] = useState<LocalOrphanVariant[]>([]);
  const [ankorstoreItems, setAnkorstoreItems] = useState<AnkorstoreOrphanVariant[]>([]);
  const [linkedPairs, setLinkedPairs] = useState<LinkedVariantPair[]>([]);
  const [ankorsProductId, setAnkorsProductId] = useState<string | null>(null);
  const [ankorstoreProductName, setAnkorstoreProductName] = useState<string | null>(null);
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getOrphanAnkorstoreVariants(productId);
      if (!res.success) {
        setError(res.error);
        setLocals([]);
        setAnkorstoreItems([]);
        setLinkedPairs([]);
        setAnkorsProductId(null);
        setAnkorstoreProductName(null);
      } else {
        setLocals(res.data.localOrphans);
        setAnkorstoreItems(res.data.ankorstoreOrphans);
        setLinkedPairs(res.data.linkedPairs);
        setAnkorsProductId(res.data.ankorsProductId);
        setAnkorstoreProductName(res.data.ankorstoreProductName);
        if (res.data.localOrphans.length === 0) setSelectedLocalId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function handleLinkPair(ankorstoreVariantId: string) {
    if (!selectedLocalId) {
      toast.info("Sélectionnez d'abord une couleur à gauche.");
      return;
    }
    setBusyId(ankorstoreVariantId);
    try {
      const res = await linkOrphanVariantPair(productId, selectedLocalId, ankorstoreVariantId);
      if (res.success) {
        toast.success("Variantes liées", "Mise à jour Ankorstore lancée en arrière-plan.");
        setSelectedLocalId(null);
        startTransition(() => {
          void load();
        });
      } else {
        toast.error("Échec", res.error ?? "Erreur inconnue");
      }
    } catch (err) {
      toast.error("Échec", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateHere(item: AnkorstoreOrphanVariant) {
    const ok = await confirm({
      type: "info",
      title: "Créer cette variante chez vous ?",
      message: `Couleur "${item.colorOption ?? item.name}" (gris par défaut, à corriger plus tard), taille "${item.sizeOption ?? "TU"}", stock ${item.stockQuantity ?? 0}, prix de gros ${item.wholesalePrice.toFixed(2)} €. Les images Ankorstore seront téléchargées chez vous.`,
      confirmLabel: "Oui, créer",
    });
    if (!ok) return;

    setBusyId(item.ankorstoreVariantId);
    try {
      const res = await createLocalVariantFromAnkorstoreVariant(productId, item.ankorstoreVariantId);
      if (res.success) {
        toast.success(
          "Variante créée",
          `${res.imageCount ?? 0} image${(res.imageCount ?? 0) > 1 ? "s" : ""} téléchargée${(res.imageCount ?? 0) > 1 ? "s" : ""}. Pensez à corriger la pastille de couleur dans la bibliothèque.`,
        );
        startTransition(() => {
          void load();
        });
      } else {
        toast.error("Échec", res.error ?? "Erreur inconnue");
      }
    } catch (err) {
      toast.error("Échec", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-none shadow-lg p-6 max-w-5xl w-full mx-4 space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-heading font-bold text-text-primary">
              Lien Ankorstore détaillé
            </h3>
            <p className="text-sm text-text-secondary font-body mt-0.5">
              {productName} ({reference})
            </p>
            <p className="text-xs text-text-muted font-body mt-1">
              Récapitulatif des couleurs déjà reliées entre votre site et Ankorstore, et de
              celles qui restent à apparier manuellement.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading && (
          <div className="p-4 text-sm text-text-muted font-body text-center">Chargement…</div>
        )}

        {!loading && error && (
          <div className="p-4 text-sm text-red-600 font-body border border-red-200 bg-red-50">
            Erreur : {error}
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
            {/* Bloc « Produit Ankorstore lié » */}
            {ankorsProductId && (
              <div className="border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3">
                <p className="text-[10px] font-semibold text-[#15803D] uppercase tracking-wider font-body">
                  Produit Ankorstore lié
                </p>
                <p className="text-sm font-semibold text-text-primary font-body mt-0.5">
                  {ankorstoreProductName ?? "(nom indisponible)"}
                </p>
                <p className="text-[11px] text-text-muted font-mono mt-0.5 break-all">
                  ID Ankorstore : {ankorsProductId}
                </p>
              </div>
            )}

            {/* Bloc « Couleurs reliées » */}
            <div className="border border-border">
              <div className="px-3 py-2 bg-[#F0FDF4] border-b border-border">
                <h4 className="text-sm font-semibold font-body text-[#15803D]">
                  Couleurs reliées ({linkedPairs.length})
                </h4>
                <p className="text-xs text-text-muted font-body">
                  Chaque couleur de votre site appariée avec sa variante Ankorstore.
                </p>
              </div>
              {linkedPairs.length === 0 ? (
                <div className="p-4 text-sm text-text-muted font-body text-center">
                  Aucune couleur reliée pour l&apos;instant.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {linkedPairs.map((p) => (
                    <li key={p.productColorId} className="grid grid-cols-1 md:grid-cols-2 gap-2 px-3 py-2.5">
                      {/* Côté site */}
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full border border-border shrink-0"
                          style={
                            p.patternImage
                              ? {
                                  backgroundImage: `url(${p.patternImage})`,
                                  backgroundSize: "cover",
                                }
                              : { backgroundColor: p.colorHex ?? "#9CA3AF" }
                          }
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold font-body text-text-primary truncate">
                            {p.colorName}
                          </p>
                          <p className="text-xs text-text-muted font-body truncate">
                            {p.localSku ?? "Pas de SKU"} · stock {p.localStock}
                            {p.localSizeName ? ` · taille ${p.localSizeName}` : ""}
                          </p>
                        </div>
                      </div>
                      {/* Côté Ankorstore */}
                      <div className="flex items-center gap-3 md:border-l md:border-border md:pl-3">
                        <div className="w-10 h-10 rounded bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center">
                          {p.ankorstoreFirstImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.ankorstoreFirstImageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold font-body text-text-primary truncate">
                            {p.ankorstoreColorOption ?? p.ankorstoreVariantName}
                            {p.ankorstoreSizeOption && (
                              <span className="text-text-muted font-normal"> · {p.ankorstoreSizeOption}</span>
                            )}
                          </p>
                          <p className="text-xs text-text-muted font-body truncate">
                            {p.ankorstoreVariantSku ?? "Pas de SKU"} ·{" "}
                            {p.ankorstoreWholesalePrice.toFixed(2)} € HT · stock{" "}
                            {p.ankorstoreStockQuantity ?? 0}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Sections orphelines (existantes) */}
            <div className="px-1 pt-1">
              <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body">
                Couleurs orphelines — à relier manuellement
              </p>
              <p className="text-xs text-text-muted font-body mt-0.5">
                Cliquez sur une couleur à gauche, puis sur sa jumelle Ankorstore à droite pour les
                relier. Ou cliquez sur « Créer chez moi » pour ajouter chez vous une variante qui
                n&apos;existe que sur Ankorstore.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Colonne gauche : couleurs locales orphelines */}
            <div className="flex flex-col min-h-0 border border-border">
              <div className="px-3 py-2 bg-bg-tertiary border-b border-border">
                <h4 className="text-sm font-semibold font-body text-text-primary">
                  Sur votre site ({locals.length})
                </h4>
                <p className="text-xs text-text-muted font-body">
                  Couleurs sans jumelle Ankorstore
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {locals.length === 0 ? (
                  <div className="p-4 text-sm text-text-muted font-body text-center">
                    Toutes vos couleurs sont liées à Ankorstore.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {locals.map((c) => {
                      const isSelected = selectedLocalId === c.productColorId;
                      return (
                        <li
                          key={c.productColorId}
                          className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                            isSelected ? "bg-blue-50 border-l-4 border-blue-500" : "hover:bg-bg-tertiary"
                          }`}
                          onClick={() => setSelectedLocalId(c.productColorId)}
                        >
                          <div
                            className="w-8 h-8 rounded-full border border-border shrink-0"
                            style={
                              c.patternImage
                                ? {
                                    backgroundImage: `url(${c.patternImage})`,
                                    backgroundSize: "cover",
                                  }
                                : { backgroundColor: c.colorHex ?? "#9CA3AF" }
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold font-body text-text-primary truncate">
                              {c.colorName}
                            </p>
                            <p className="text-xs text-text-muted font-body">
                              {c.sku ?? "Pas de SKU"} · stock {c.stock}
                              {c.sizeName ? ` · taille ${c.sizeName}` : ""}
                            </p>
                          </div>
                          {isSelected && (
                            <span className="text-xs font-semibold text-blue-700 font-body">
                              sélectionnée
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Colonne droite : variantes Ankorstore orphelines */}
            <div className="flex flex-col min-h-0 border border-border">
              <div className="px-3 py-2 bg-bg-tertiary border-b border-border">
                <h4 className="text-sm font-semibold font-body text-text-primary">
                  Sur Ankorstore ({ankorstoreItems.length})
                </h4>
                <p className="text-xs text-text-muted font-body">
                  Variantes sans jumelle locale
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {ankorstoreItems.length === 0 ? (
                  <div className="p-4 text-sm text-text-muted font-body text-center">
                    Toutes les variantes Ankorstore sont liées chez vous.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {ankorstoreItems.map((item) => {
                      const isBusy = busyId === item.ankorstoreVariantId;
                      return (
                        <li key={item.ankorstoreVariantId} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="w-12 h-12 rounded bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center">
                            {item.firstImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.firstImageUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold font-body text-text-primary truncate">
                              {item.colorOption ?? item.name}
                              {item.sizeOption && (
                                <span className="text-text-muted font-normal"> · {item.sizeOption}</span>
                              )}
                            </p>
                            <p className="text-xs text-text-muted font-body truncate">
                              {item.sku ?? "Pas de SKU"} · {item.wholesalePrice.toFixed(2)} € HT · stock{" "}
                              {item.stockQuantity ?? 0}
                            </p>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleLinkPair(item.ankorstoreVariantId)}
                              disabled={isBusy || !selectedLocalId}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-[#15803D] rounded-none hover:bg-[#166534] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-body whitespace-nowrap"
                              title={selectedLocalId ? "Lier à la couleur sélectionnée" : "Sélectionnez d'abord une couleur à gauche"}
                            >
                              {isBusy && selectedLocalId ? "Liaison…" : "Lier ici"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCreateHere(item)}
                              disabled={isBusy}
                              className="px-2.5 py-1 text-[11px] font-semibold text-text-primary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-body whitespace-nowrap"
                              title="Créer cette variante chez vous (couleur grise par défaut)"
                            >
                              {isBusy && !selectedLocalId ? "Création…" : "Créer chez moi"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-xs text-text-secondary hover:text-text-primary underline font-body"
          >
            Recharger la liste
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
