"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import MarketplaceExportButton from "./MarketplaceExportButton";
import {
  isItemActive,
  useMarketplaceRefreshQueue,
} from "./MarketplaceRefreshContext";
import { useMarketplaceMaintenance } from "./MarketplaceMaintenanceContext";

// Sous-ensemble des champs d'AdminProduct nécessaires à la barre — évite
// d'importer tout le type et de forcer les refactos si l'entité principale
// gagne d'autres champs plus tard.
export interface BulkBarProduct {
  id: string;
  reference: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  locked: boolean;
  firstImage: string | null;
  pfsProductId: string | null;
  ankorsProductId: string | null;
  efashionReferenceBase: string | null;
  faireProductId: string | null;
  pfsSyncRequired: boolean;
  ankorsSyncRequired: boolean;
  efashionSyncRequired: boolean;
  faireSyncRequired: boolean;
}

export type MarketplaceKey = "pfs" | "ankorstore" | "efashion" | "faire";

interface MarketplacesConfig {
  pfs: { available: boolean };
  ankorstore: { configured: boolean; enabled: boolean };
  efashion: { configured: boolean; enabled: boolean };
  faire: { configured: boolean; enabled: boolean };
}

interface Props {
  selectedProducts: BulkBarProduct[];
  isPending: boolean;
  /**
   * Libellé affiché à côté du compteur quand une action bulk est en cours
   * (ex : « Traduction de 3 produits en cours… »). Quand non-null, la bande
   * dégradée du haut se met à glisser en boucle pour signaler l'activité.
   */
  pendingLabel?: string | null;
  marketplaces: MarketplacesConfig;
  /**
   * Nombre de brouillons (OFFLINE) dans la sélection courante. Quand > 0, on
   * affiche un bouton dédié qui ouvre la modale « Publier brouillons » — celle
   * qui vérifie côté serveur si chaque brouillon remplit toutes les conditions
   * pour passer en ligne (image, prix, stock, catégorie, code SH, etc.) et
   * propose la publication marketplaces dans la foulée.
   */
  draftCount?: number;

  onStatus: (status: "ONLINE" | "OFFLINE" | "ARCHIVED") => void;
  onDelete: () => void;
  onRefresh: () => void;
  onEditAttributes: () => void;
  onTranslateAll: () => void;
  onDeselectAll: () => void;
  onMarketplacePublish: (marketplace: MarketplaceKey, productIds: string[]) => void;
  onMarketplaceSync: (marketplace: MarketplaceKey, productIds: string[]) => void;
  onPublishDrafts?: () => void;
  /**
   * Bascule le drapeau best-seller sur toute la sélection. Impacte PFS :
   * pose `pfsSyncRequired=true` sur les produits déjà publiés (cf.
   * bulkUpdateProductAttributes côté server action).
   */
  onSetBestSeller: (isBestSeller: boolean) => void;
  /**
   * Bascule le marqueur « Important » (étoile jaune admin) sur toute la
   * sélection. Aucun effet marketplaces ni boutique publique — usage admin
   * uniquement pour filtrage / tri.
   */
  onSetImportant: (important: boolean) => void;
  /** Ouvre la modale « Tags en masse » (ajouter / retirer). */
  onOpenTagsModal: () => void;
  /** Ouvre la modale « Ajouter à une collection ». */
  onOpenCollectionModal: () => void;
}

// ─── Calcul par marketplace ────────────────────────────────────────────────
// Un produit est "à publier" si (a) l'identifiant marketplace est null, (b) le
// statut est ONLINE (les brouillons ne sont pas éligibles), (c) il n'est pas
// incomplet. "À synchroniser" = drapeau *SyncRequired = true, indépendamment
// du statut (la synchro sert justement à propager les changements).
//
// Un produit est retiré de "à publier" ET "à synchroniser" pour une marketplace
// donnée si une opération est déjà en cours (queued / in_progress / awaiting
// callback) — évite de proposer à la cliente de relancer une action déjà lancée.
export type InFlightByMarketplace = Partial<Record<MarketplaceKey, ReadonlySet<string>>>;

function computeMarketplaceCounts(
  products: BulkBarProduct[],
  inFlight?: InFlightByMarketplace,
) {
  const eligibleForPublish = (p: BulkBarProduct) =>
    p.status === "ONLINE" && !p.isIncomplete;
  const notInFlight = (mp: MarketplaceKey) => (p: BulkBarProduct) =>
    !inFlight?.[mp]?.has(p.id);

  // `publish` : produits ONLINE et complets, pas encore poussés sur cette marketplace.
  // `sync`    : produits avec le drapeau orange « Synchro nécessaire » (delta à envoyer).
  // `alreadyOn` : produits déjà présents sur la marketplace (ID rempli). Sert au bouton
  //   « Synchroniser » toujours actif : quand `sync` est vide, on autorise une resynchro
  //   forcée sur tous ces produits (pratique quand la cliente veut « tout ré-envoyer par
  //   sécurité »). On exclut les opérations déjà en vol pour ne pas doublonner.
  const pfsToPublish = products.filter((p) => !p.pfsProductId && eligibleForPublish(p) && notInFlight("pfs")(p));
  const pfsToSync = products.filter((p) => p.pfsSyncRequired && notInFlight("pfs")(p));
  const pfsAlreadyOn = products.filter((p) => !!p.pfsProductId && notInFlight("pfs")(p));
  const ankorsToPublish = products.filter((p) => !p.ankorsProductId && eligibleForPublish(p) && notInFlight("ankorstore")(p));
  const ankorsToSync = products.filter((p) => p.ankorsSyncRequired && notInFlight("ankorstore")(p));
  const ankorsAlreadyOn = products.filter((p) => !!p.ankorsProductId && notInFlight("ankorstore")(p));
  const efashionToPublish = products.filter((p) => !p.efashionReferenceBase && eligibleForPublish(p) && notInFlight("efashion")(p));
  const efashionToSync = products.filter((p) => p.efashionSyncRequired && notInFlight("efashion")(p));
  const efashionAlreadyOn = products.filter((p) => !!p.efashionReferenceBase && notInFlight("efashion")(p));
  const faireToPublish = products.filter((p) => !p.faireProductId && eligibleForPublish(p) && notInFlight("faire")(p));
  const faireToSync = products.filter((p) => p.faireSyncRequired && notInFlight("faire")(p));
  const faireAlreadyOn = products.filter((p) => !!p.faireProductId && notInFlight("faire")(p));

  return {
    pfs: { publish: pfsToPublish, sync: pfsToSync, alreadyOn: pfsAlreadyOn },
    ankorstore: { publish: ankorsToPublish, sync: ankorsToSync, alreadyOn: ankorsAlreadyOn },
    efashion: { publish: efashionToPublish, sync: efashionToSync, alreadyOn: efashionAlreadyOn },
    faire: { publish: faireToPublish, sync: faireToSync, alreadyOn: faireAlreadyOn },
  };
}

// Classes Tailwind ecrites en dur pour rester compatible avec le JIT (les
// noms de classes construits par interpolation ne sont pas detectes au build).
const MARKETPLACE_META: Record<MarketplaceKey, {
  label: string;
  subtitle: string;
  initial: string;
  accentBg: string;
  accentText: string;
  gradient: string;
  publishHover: string;
}> = {
  pfs: {
    label: "PFS", subtitle: "Paris Fashion Shop", initial: "P",
    accentBg: "bg-emerald-50 text-emerald-700",
    accentText: "text-emerald-700",
    gradient: "from-emerald-400 to-emerald-600",
    publishHover: "hover:border-emerald-300 hover:bg-emerald-50/50",
  },
  ankorstore: {
    label: "Ankorstore", subtitle: "Marketplace B2B", initial: "A",
    accentBg: "bg-violet-50 text-violet-700",
    accentText: "text-violet-700",
    gradient: "from-violet-400 to-violet-600",
    publishHover: "hover:border-violet-300 hover:bg-violet-50/50",
  },
  efashion: {
    label: "eFashion", subtitle: "Marketplace mode", initial: "e",
    accentBg: "bg-sky-50 text-sky-700",
    accentText: "text-sky-700",
    gradient: "from-sky-400 to-sky-600",
    publishHover: "hover:border-sky-300 hover:bg-sky-50/50",
  },
  faire: {
    label: "Faire", subtitle: "Wholesale US", initial: "F",
    accentBg: "bg-rose-50 text-rose-700",
    accentText: "text-rose-700",
    gradient: "from-rose-400 to-rose-600",
    publishHover: "hover:border-rose-300 hover:bg-rose-50/50",
  },
};

export default function BulkActionBar({
  selectedProducts,
  isPending,
  pendingLabel,
  marketplaces,
  draftCount = 0,
  onStatus,
  onDelete,
  onRefresh,
  onEditAttributes,
  onTranslateAll,
  onDeselectAll,
  onMarketplacePublish,
  onMarketplaceSync,
  onPublishDrafts,
  onSetBestSeller,
  onSetImportant,
  onOpenTagsModal,
  onOpenCollectionModal,
}: Props) {
  const showPending = Boolean(pendingLabel);
  const [marketplacesOpen, setMarketplacesOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  // Sous-menu best-seller : true = on affiche les 2 choix (Marquer / Retirer)
  // dans le menu Plus. Se remet à false à chaque ouverture du menu.
  const [bestSellerSubOpen, setBestSellerSubOpen] = useState(false);
  // Sous-menu Important : même principe (Marquer / Retirer l'étoile admin).
  const [importantSubOpen, setImportantSubOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  // Sentinelle placée juste au-dessus de la barre sticky. Quand elle sort du
  // viewport (le user scrolle), on sait que la barre est « collée » en haut,
  // et on bascule son fond en noir.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    // Garde jsdom / env sans IntersectionObserver (tests unitaires). La barre
    // reste alors en mode « pas collée » — comportement neutre.
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const someSelected = selectedProducts.length > 0;

  // Ferme les 2 popovers si on clique en dehors ou si la sélection se vide.
  useEffect(() => {
    if (!someSelected) {
      setMarketplacesOpen(false);
      setPlusOpen(false);
      setBestSellerSubOpen(false);
      setImportantSubOpen(false);
    }
  }, [someSelected]);

  // Reset les sous-menus quand on ferme le menu Plus.
  useEffect(() => {
    if (!plusOpen) {
      setBestSellerSubOpen(false);
      setImportantSubOpen(false);
    }
  }, [plusOpen]);

  useEffect(() => {
    if (!marketplacesOpen && !plusOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setMarketplacesOpen(false);
        setPlusOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [marketplacesOpen, plusOpen]);

  // ── Compteur détaillé ──
  const counts = useMemo(() => {
    let online = 0, draft = 0, archived = 0;
    for (const p of selectedProducts) {
      if (p.status === "ONLINE") online++;
      else if (p.status === "ARCHIVED") archived++;
      else draft++;
    }
    return { online, draft, archived };
  }, [selectedProducts]);

  // ── Opérations marketplace en cours par productId ──
  // Vient de la file du provider (poll 2s si actif). On regroupe par marketplace
  // pour retirer du panneau les produits déjà en train d'être publiés ou
  // synchronisés — sinon la cliente voit "1 produit pas encore sur Ankorstore"
  // alors qu'elle vient de cliquer "Publier" et que le badge affiche déjà
  // "Ankorstore en cours".
  const { items: queueItems } = useMarketplaceRefreshQueue();
  const inFlightByMarketplace = useMemo<InFlightByMarketplace>(() => {
    const map: Record<MarketplaceKey, Set<string>> = {
      pfs: new Set(),
      ankorstore: new Set(),
      efashion: new Set(),
      faire: new Set(),
    };
    for (const item of queueItems) {
      if (isItemActive(item)) map[item.marketplace].add(item.productId);
    }
    return map;
  }, [queueItems]);

  // ── Calcul actions marketplace (mémoïsé) ──
  const mpCounts = useMemo(
    () => computeMarketplaceCounts(selectedProducts, inFlightByMarketplace),
    [selectedProducts, inFlightByMarketplace],
  );

  const mpActionsTotal = useMemo(() => {
    let n = 0;
    (["pfs", "ankorstore", "efashion", "faire"] as MarketplaceKey[]).forEach((k) => {
      if (!isMarketplaceAvailable(k, marketplaces)) return;
      n += mpCounts[k].publish.length + mpCounts[k].sync.length;
    });
    return n;
  }, [mpCounts, marketplaces]);

  // Bouton actif dès qu'il y a de quoi ouvrir le panneau : publier, synchro
  // avec drapeau, OU produits déjà sur une marketplace (resynchro forcée).
  // Sinon le bouton apparaissait grisé alors qu'on pouvait quand même
  // « Synchroniser » les produits déjà en ligne sur les marketplaces.
  const hasAnyMarketplaceAction = useMemo(() => {
    if (mpActionsTotal > 0) return true;
    return (["pfs", "ankorstore", "efashion", "faire"] as MarketplaceKey[]).some((k) => {
      if (!isMarketplaceAvailable(k, marketplaces)) return false;
      return mpCounts[k].alreadyOn.length > 0;
    });
  }, [mpActionsTotal, mpCounts, marketplaces]);

  const productIds = useMemo(() => selectedProducts.map((p) => p.id), [selectedProducts]);

  return (
    <>
      {/* Sentinelle 1px pour détecter l'état « collé en haut » via IntersectionObserver. */}
      <div ref={sentinelRef} aria-hidden className="h-px -mb-px" />
    <div
      aria-hidden={!someSelected}
      // sticky top-4 : la barre est dans le flux au-dessus du tableau, puis
      // se colle en haut de l'écran (16px d'offset) dès qu'on scrolle. Largeur
      // pleine du conteneur parent (pas de max-width). z-40 la garde au-dessus
      // du tableau mais sous les modales (z-50) et le widget flottant (z-9001).
      className={`sticky top-4 z-40 grid transition-all duration-300 ease-out ${
        someSelected
          ? "grid-rows-[1fr] opacity-100 mb-3"
          : "grid-rows-[0fr] opacity-0 mb-0 pointer-events-none"
      }`}
    >
      <div className="min-h-0 overflow-visible">
        <div
          ref={barRef}
          data-stuck={isStuck ? "true" : undefined}
          className={`relative rounded-2xl border transition-colors duration-200 ${
            isStuck
              ? "bg-slate-900 border-slate-800 shadow-[0_10px_25px_-8px_rgba(0,0,0,0.35),0_4px_10px_-2px_rgba(0,0,0,0.2)]"
              : "bg-white border-border-strong/80 shadow-[0_10px_25px_-8px_rgba(24,24,27,0.12),0_4px_10px_-2px_rgba(24,24,27,0.06)]"
          }`}
        >
          <div className="flex items-center gap-2 lg:gap-3 px-3 lg:px-4 py-3 flex-wrap">
            {/* Compteur intelligent */}
            <div className="flex items-center gap-3 pr-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-100 to-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <div className="leading-tight">
                <div className={`font-heading font-bold text-[15px] tabular-nums transition-colors ${isStuck ? "text-white" : "text-text-primary"}`}>
                  {selectedProducts.length} produit{selectedProducts.length > 1 ? "s" : ""}
                </div>
                <div className={`text-[11px] font-medium flex items-center gap-1 transition-colors ${isStuck ? "text-slate-400" : "text-text-muted"}`}>
                  {counts.online > 0 && <span className={`tabular-nums ${isStuck ? "text-emerald-400" : "text-emerald-600"}`}>{counts.online} en ligne</span>}
                  {counts.online > 0 && counts.draft > 0 && <span>·</span>}
                  {counts.draft > 0 && <span className={`tabular-nums ${isStuck ? "text-slate-300" : "text-slate-500"}`}>{counts.draft} brouillon{counts.draft > 1 ? "s" : ""}</span>}
                  {(counts.online > 0 || counts.draft > 0) && counts.archived > 0 && <span>·</span>}
                  {counts.archived > 0 && <span className={`tabular-nums ${isStuck ? "text-amber-400" : "text-amber-600"}`}>{counts.archived} archivé{counts.archived > 1 ? "s" : ""}</span>}
                </div>
              </div>
            </div>

            {/* Badge « action en cours » — s'affiche juste après le compteur
                pendant une action bulk (traduction, suppression, changement de
                statut, modification d'attributs). Reprend le voile blanc du
                tableau côté visuel. */}
            {showPending && (
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-[12px] font-medium"
                role="status"
                aria-live="polite"
              >
                <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="truncate max-w-[240px]">{pendingLabel}</span>
              </div>
            )}

            <Separator isStuck={isStuck} />

            {/* Groupe Statut */}
            <div className="flex items-center gap-1">
              <SegButton onClick={() => onStatus("ONLINE")} disabled={isPending} tone="emerald">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden md:inline">En ligne</span>
              </SegButton>
              <SegButton onClick={() => onStatus("OFFLINE")} disabled={isPending} tone="slate">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
                <span className="hidden md:inline">Hors ligne</span>
              </SegButton>
              <SegButton onClick={() => onStatus("ARCHIVED")} disabled={isPending} tone="amber">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5" />
                </svg>
                <span className="hidden md:inline">Archiver</span>
              </SegButton>
            </div>

            {/* Bouton dédié brouillons — n'apparaît que si au moins un brouillon
                est sélectionné. Ouvre une modale qui vérifie côté serveur si
                chaque brouillon remplit toutes les conditions pour passer en
                ligne (image, prix, stock, catégorie…) et liste les manques. */}
            {draftCount > 0 && onPublishDrafts && (
              <>
                <Separator isStuck={isStuck} />
                <button
                  type="button"
                  onClick={onPublishDrafts}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[13px] font-medium whitespace-nowrap transition-all shadow-sm bg-gradient-to-r from-indigo-500 to-violet-500 text-white hover:from-indigo-600 hover:to-violet-600 disabled:opacity-50"
                  title="Vérifier si les brouillons sélectionnés peuvent être mis en ligne et les publier"
                >
                  <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="hidden md:inline">Publier brouillons</span>
                  <span className="md:hidden">Brouillons</span>
                  <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white text-violet-700 text-[11px] font-bold tabular-nums">
                    {draftCount}
                  </span>
                </button>
              </>
            )}

            <Separator isStuck={isStuck} />

            {/* Marketplaces + actions */}
            <div className="flex items-center gap-1 relative">
              <button
                type="button"
                onClick={() => {
                  setMarketplacesOpen((v) => !v);
                  setPlusOpen(false);
                }}
                disabled={isPending}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[13px] font-medium whitespace-nowrap transition-all shadow-sm disabled:opacity-50 ${
                  hasAnyMarketplaceAction
                    ? "bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white hover:from-fuchsia-600 hover:to-violet-600"
                    : "bg-slate-100 text-slate-500 cursor-not-allowed"
                }`}
                aria-expanded={marketplacesOpen}
              >
                <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72" />
                </svg>
                <span className="hidden md:inline">Marketplaces</span>
                <span className="md:hidden">MP</span>
                {mpActionsTotal > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white text-fuchsia-700 text-[11px] font-bold tabular-nums">
                    {mpActionsTotal}
                  </span>
                )}
              </button>

              <SegButton onClick={onRefresh} disabled={isPending} tone="indigo">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
                <span className="hidden md:inline">Rafraîchir</span>
              </SegButton>

              {/* MarketplaceExportButton existant — bouton "Exporter" avec son
                  propre dropdown. On le reutilise tel quel : il gere deja le
                  choix marketplace + preview + telechargement ZIP. */}
              <MarketplaceExportButton
                productIds={productIds}
                disabled={isPending}
              />

              <button
                type="button"
                onClick={() => {
                  setPlusOpen((v) => !v);
                  setMarketplacesOpen(false);
                }}
                disabled={isPending}
                className={`inline-flex items-center gap-1 px-3 py-2 rounded-[10px] text-[13px] font-medium whitespace-nowrap transition-colors border ${
                  plusOpen
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-border-strong hover:bg-slate-50"
                }`}
                aria-expanded={plusOpen}
              >
                Plus
                <svg className={`w-[15px] h-[15px] transition-transform ${plusOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {/* Menu Plus */}
              {plusOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-[280px] bg-white rounded-2xl border border-border-strong shadow-2xl overflow-hidden z-50"
                >
                  <div className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                    Actions rapides
                  </div>
                  <MenuItem
                    icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>}
                    iconClass="bg-violet-50 text-violet-700"
                    title="Modifier les attributs"
                    hint="Catégorie, code SH, composition, pays…"
                    highlight
                    onClick={() => {
                      setPlusOpen(false);
                      onEditAttributes();
                    }}
                  />
                  <MenuItem
                    icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>}
                    iconClass="bg-sky-50 text-sky-700"
                    title="Tout traduire"
                    hint="Nom + description en anglais"
                    onClick={() => {
                      setPlusOpen(false);
                      onTranslateAll();
                    }}
                  />
                  <div className="border-t border-border-light" />
                  <div className="px-4 pt-2 pb-1.5 text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                    Organisation
                  </div>

                  {/* Best-seller : sous-menu à 2 choix (Marquer / Retirer).
                      Réutilise `bulkUpdateProductAttributes({ isBestSeller })` :
                      pose `pfsSyncRequired=true` sur les produits déjà publiés. */}
                  {bestSellerSubOpen ? (
                    <div className="bg-amber-50/40 border-y border-amber-100">
                      <button
                        type="button"
                        onClick={() => setBestSellerSubOpen(false)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-[11px] text-amber-800 hover:bg-amber-50 font-medium"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                        Retour
                      </button>
                      <MenuItem
                        icon={<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" /></svg>}
                        iconClass="bg-amber-100 text-amber-700"
                        title="Marquer best-seller"
                        hint="Ajoute l'étoile · resync PFS auto"
                        onClick={() => {
                          setPlusOpen(false);
                          onSetBestSeller(true);
                        }}
                      />
                      <MenuItem
                        icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" /></svg>}
                        iconClass="bg-slate-100 text-slate-600"
                        title="Retirer best-seller"
                        hint="Enlève l'étoile · resync PFS auto"
                        onClick={() => {
                          setPlusOpen(false);
                          onSetBestSeller(false);
                        }}
                      />
                    </div>
                  ) : (
                    <MenuItem
                      icon={<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" /></svg>}
                      iconClass="bg-amber-50 text-amber-700"
                      title="Best-seller"
                      hint="Marquer ou retirer l'étoile"
                      onClick={() => setBestSellerSubOpen(true)}
                    />
                  )}

                  {/* Important : étoile jaune admin — filtrage/tri interne
                      uniquement. Aucun impact marketplaces ni boutique. */}
                  {importantSubOpen ? (
                    <div className="bg-yellow-50/40 border-y border-yellow-100">
                      <button
                        type="button"
                        onClick={() => setImportantSubOpen(false)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-[11px] text-yellow-800 hover:bg-yellow-50 font-medium"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                        Retour
                      </button>
                      <MenuItem
                        icon={<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" /></svg>}
                        iconClass="bg-yellow-100 text-yellow-700"
                        title="Marquer important"
                        hint="Étoile admin · filtrage interne"
                        onClick={() => {
                          setPlusOpen(false);
                          onSetImportant(true);
                        }}
                      />
                      <MenuItem
                        icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" /></svg>}
                        iconClass="bg-slate-100 text-slate-600"
                        title="Retirer important"
                        hint="Enlève l'étoile admin"
                        onClick={() => {
                          setPlusOpen(false);
                          onSetImportant(false);
                        }}
                      />
                    </div>
                  ) : (
                    <MenuItem
                      icon={<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" /></svg>}
                      iconClass="bg-yellow-50 text-yellow-700"
                      title="Important"
                      hint="Marquer ou retirer l'étoile admin"
                      onClick={() => setImportantSubOpen(true)}
                    />
                  )}

                  {/* Tags — modale (ajouter OU retirer une liste de tags) */}
                  <MenuItem
                    icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" /></svg>}
                    iconClass="bg-fuchsia-50 text-fuchsia-700"
                    title="Ajouter / retirer des tags"
                    hint="Modifier les mots-clés"
                    onClick={() => {
                      setPlusOpen(false);
                      onOpenTagsModal();
                    }}
                  />

                  {/* Collection — modale (les brouillons/archivés sont ignorés côté serveur) */}
                  <MenuItem
                    icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>}
                    iconClass="bg-emerald-50 text-emerald-700"
                    title="Ajouter à une collection"
                    hint="Choix parmi les collections existantes"
                    onClick={() => {
                      setPlusOpen(false);
                      onOpenCollectionModal();
                    }}
                  />
                </div>
              )}

              {/* Panneau Marketplaces */}
              {marketplacesOpen && (
                <MarketplacePanel
                  counts={mpCounts}
                  marketplaces={marketplaces}
                  totalSelected={selectedProducts.length}
                  onPublish={(k, products) => {
                    setMarketplacesOpen(false);
                    onMarketplacePublish(k, products.map((p) => p.id));
                  }}
                  onSync={(k, products) => {
                    setMarketplacesOpen(false);
                    onMarketplaceSync(k, products.map((p) => p.id));
                  }}
                  onClose={() => setMarketplacesOpen(false)}
                />
              )}
            </div>

            <Separator isStuck={isStuck} />

            <SegButton onClick={onDelete} disabled={isPending} tone="red">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397" />
              </svg>
              <span className="hidden md:inline">Supprimer</span>
            </SegButton>

            <button
              type="button"
              onClick={onDeselectAll}
              className={`ml-1 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                isStuck
                  ? "text-slate-300 hover:bg-slate-800"
                  : "text-text-muted hover:bg-slate-100"
              }`}
              title="Désélectionner"
              aria-label="Désélectionner"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

// ─── Helpers UI ────────────────────────────────────────────────────────────

function Separator({ isStuck }: { isStuck?: boolean }) {
  return <div className={`hidden md:block w-px h-[26px] flex-shrink-0 transition-colors ${isStuck ? "bg-slate-700" : "bg-border-strong"}`} />;
}

type Tone = "emerald" | "slate" | "amber" | "indigo" | "sky" | "red";

const TONE_CLASSES: Record<Tone, string> = {
  emerald: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  slate:   "bg-slate-100 text-slate-700 hover:bg-slate-200",
  amber:   "bg-amber-50 text-amber-700 hover:bg-amber-100",
  indigo:  "bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
  sky:     "bg-sky-50 text-sky-700 hover:bg-sky-100",
  red:     "bg-red-50 text-red-600 hover:bg-red-100",
};

function SegButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: Tone;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[13px] font-medium whitespace-nowrap transition-colors disabled:opacity-50 ${TONE_CLASSES[tone]} [&_svg]:w-[15px] [&_svg]:h-[15px]`}
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon, iconClass, title, hint, onClick, highlight,
}: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  hint?: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left text-sm ${
        highlight ? "border-l-2 border-violet-400" : ""
      }`}
    >
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconClass}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-text-primary">{title}</div>
        {hint && <div className="text-xs text-text-muted truncate">{hint}</div>}
      </div>
    </button>
  );
}

// ─── Panneau Marketplaces ──────────────────────────────────────────────────

export function isMarketplaceAvailable(k: MarketplaceKey, cfg: MarketplacesConfig): boolean {
  if (k === "pfs") return cfg.pfs.available;
  if (k === "ankorstore") return cfg.ankorstore.configured && cfg.ankorstore.enabled;
  if (k === "efashion") return cfg.efashion.configured && cfg.efashion.enabled;
  return cfg.faire.configured && cfg.faire.enabled;
}

function MarketplacePanel({
  counts,
  marketplaces,
  totalSelected,
  onPublish,
  onSync,
  onClose,
}: {
  counts: ReturnType<typeof computeMarketplaceCounts>;
  marketplaces: MarketplacesConfig;
  totalSelected: number;
  onPublish: (k: MarketplaceKey, products: BulkBarProduct[]) => void;
  onSync: (k: MarketplaceKey, products: BulkBarProduct[]) => void;
  onClose: () => void;
}) {
  const maintenance = useMarketplaceMaintenance();
  const order: MarketplaceKey[] = ["pfs", "ankorstore", "efashion", "faire"];

  const totalActions = order.reduce((acc, k) => {
    if (!isMarketplaceAvailable(k, marketplaces)) return acc;
    return acc + counts[k].publish.length + counts[k].sync.length;
  }, 0);

  return (
    <div className="absolute right-0 top-full mt-2 w-[720px] max-w-[92vw] bg-white/98 backdrop-blur-xl rounded-2xl border border-border-strong shadow-2xl overflow-hidden z-50">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-light">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-fuchsia-700 mb-0.5">
            Actions marketplaces
          </div>
          <div className="font-heading font-bold text-[15px] text-text-primary">
            {totalActions === 0
              ? "Aucune action détectée sur la sélection"
              : `${totalActions} action${totalActions > 1 ? "s" : ""} détectée${totalActions > 1 ? "s" : ""} sur ${totalSelected} produit${totalSelected > 1 ? "s" : ""}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Fermer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {order.filter((k) => {
        if (!isMarketplaceAvailable(k, marketplaces)) return false;
        // Ligne visible si on peut publier OU si au moins un produit sélectionné
        // est déjà sur la marketplace (permet la resynchro forcée). Sinon rien à
        // faire pour cette marketplace, on la cache.
        return counts[k].publish.length + counts[k].alreadyOn.length > 0;
      }).length === 0 ? (
        <div className="p-6 text-center text-sm text-text-muted">
          Aucune action possible : les produits sélectionnés ne sont sur aucune marketplace configurée.
        </div>
      ) : (
        order.map((k) => {
          if (!isMarketplaceAvailable(k, marketplaces)) return null;
          const { publish, sync, alreadyOn } = counts[k];
          if (publish.length === 0 && alreadyOn.length === 0) return null;
          const meta = MARKETPLACE_META[k];
          const hasFlagged = sync.length > 0;
          // Cible du bouton Synchroniser : les produits avec drapeau orange si
          // présents, sinon tous ceux déjà sur la marketplace (resynchro forcée).
          const syncTargets = hasFlagged ? sync : alreadyOn;
          const canSync = syncTargets.length > 0;
          const actionCount = (publish.length > 0 ? 1 : 0) + (canSync ? 1 : 0);
          const inMaintenance = maintenance[k];
          return (
            <div
              key={k}
              className={`px-5 py-4 border-b border-border-light last:border-b-0 ${
                inMaintenance ? "bg-[#FEF2F2]/40" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-white text-[11px] font-bold`}
                    style={inMaintenance ? { filter: "grayscale(1) brightness(0.85)" } : undefined}
                  >
                    {meta.initial}
                  </div>
                  <div>
                    <div className={`font-heading font-bold text-[14px] ${inMaintenance ? "text-text-muted line-through" : "text-text-primary"}`}>{meta.label}</div>
                    <div className="text-[10px] text-text-muted">{meta.subtitle}</div>
                  </div>
                </div>
                {inMaintenance ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse" />
                    En maintenance
                  </span>
                ) : (
                  <span className={`text-[11px] font-semibold ${meta.accentText}`}>
                    {actionCount} action{actionCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="grid gap-2 grid-cols-2">
                {publish.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => !inMaintenance && onPublish(k, publish)}
                    disabled={inMaintenance}
                    title={inMaintenance ? `${meta.label} en maintenance sur la plateforme` : undefined}
                    className={`flex items-center gap-3 p-3 rounded-xl border border-border transition-all text-left ${
                      inMaintenance ? "opacity-50 cursor-not-allowed" : meta.publishHover
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg ${meta.accentBg} flex items-center justify-center flex-shrink-0`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-text-primary">Publier</div>
                      <div className="text-[11px] text-text-muted">
                        <b className={meta.accentText}>{publish.length} produit{publish.length > 1 ? "s" : ""}</b> pas encore sur {meta.label}
                      </div>
                    </div>
                  </button>
                ) : (
                  <EmptyCard label="Rien à publier" hint="Tout est déjà en ligne" />
                )}
                {canSync && (
                  <button
                    type="button"
                    onClick={() => !inMaintenance && onSync(k, syncTargets)}
                    disabled={inMaintenance}
                    className={`flex items-center gap-3 p-3 rounded-xl border border-border transition-all text-left ${
                      inMaintenance
                        ? "opacity-50 cursor-not-allowed"
                        : hasFlagged
                          ? "hover:border-amber-300 hover:bg-amber-50/50"
                          : "hover:border-slate-300 hover:bg-slate-50/70"
                    }`}
                    title={
                      inMaintenance
                        ? `${meta.label} en maintenance sur la plateforme`
                        : hasFlagged
                          ? `Envoyer les changements en attente sur ${meta.label}`
                          : `Forcer la resynchro de tous les produits déjà sur ${meta.label}`
                    }
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        hasFlagged ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-text-primary">Synchroniser</div>
                      <div className="text-[11px] text-text-muted">
                        {hasFlagged ? (
                          <>
                            <b className="text-amber-700">{sync.length} produit{sync.length > 1 ? "s" : ""}</b> avec changement à envoyer
                          </>
                        ) : (
                          <>
                            <b className="text-slate-600">{alreadyOn.length} produit{alreadyOn.length > 1 ? "s" : ""}</b> — resynchro forcée
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function EmptyCard({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-border text-left opacity-60">
      <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center flex-shrink-0">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-text-muted">{label}</div>
        <div className="text-[11px] text-text-muted">{hint}</div>
      </div>
    </div>
  );
}

// ─── Exports pour tests ────────────────────────────────────────────────────

export { computeMarketplaceCounts };
