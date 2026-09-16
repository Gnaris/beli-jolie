"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { togglePromotion, deletePromotion } from "@/app/actions/admin/promotions";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  effectivePromotionStatus,
  usageProgress,
  progressTone,
  formatDiscountDisplay,
  type EffectivePromotionStatus,
} from "@/lib/promotion-status";

type SerializedPromotion = {
  id: string;
  name: string;
  type: "CODE" | "AUTO";
  code: string | null;
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  discountValue: number;
  minOrderAmount: number | null;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  firstOrderOnly: boolean;
  stackable: boolean;
  appliesToAll: boolean;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  currentUses: number;
  usageCount: number;
};

type FilterValue = "all" | "active" | "scheduled" | "expired";

type Counts = { all: number; active: number; scheduled: number; expired: number };

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all",       label: "Toutes" },
  { value: "active",    label: "Actives" },
  { value: "scheduled", label: "Programmées" },
  { value: "expired",   label: "Terminées" },
];

function formatFrDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: EffectivePromotionStatus }) {
  switch (status) {
    case "ACTIVE":    return <span className="badge badge-success">Active</span>;
    case "SCHEDULED": return <span className="badge badge-warning">Programmée</span>;
    case "EXPIRED":   return <span className="badge badge-neutral">Terminée</span>;
    case "EXHAUSTED": return <span className="badge badge-neutral">Épuisée</span>;
    case "INACTIVE":  return <span className="badge badge-neutral">Désactivée</span>;
  }
}

/** Coupon coloré à gauche de la carte, tel que dans la maquette. */
function PromoTicket({
  promo, status,
}: {
  promo: SerializedPromotion;
  status: EffectivePromotionStatus;
}) {
  const inactive = status !== "ACTIVE";
  const bg = inactive
    ? "bg-gradient-to-br from-stone-400 to-stone-600"
    : promo.discountKind === "PERCENTAGE"
      ? "bg-gradient-to-br from-zinc-900 to-zinc-700"
      : promo.discountKind === "FREE_SHIPPING"
        ? "bg-gradient-to-br from-zinc-800 to-zinc-600"
        : "bg-gradient-to-br from-zinc-900 to-zinc-600";

  const stampLabel = status === "ACTIVE" ? "Actif"
    : status === "SCHEDULED" ? "Programmé"
    : status === "EXPIRED" ? "Expiré"
    : status === "EXHAUSTED" ? "Épuisé"
    : "Désactivé";

  const display = formatDiscountDisplay(promo.discountKind, promo.discountValue);

  return (
    <div className={`relative flex flex-col items-center justify-center px-5 py-5 min-w-[128px] text-white ${bg}`}>
      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur text-[9px] font-body font-bold uppercase tracking-[0.14em]">
        {stampLabel}
      </span>
      {display.isText ? (
        <>
          <span className="font-heading font-bold text-xl leading-none">{display.main}</span>
          <span className="text-[11px] font-body font-semibold uppercase tracking-[0.12em] opacity-85 mt-1">{display.unit}</span>
        </>
      ) : (
        <>
          <span className="font-heading font-bold text-3xl leading-none tabular-nums">{display.main}</span>
          <span className="text-[10.5px] font-body font-semibold uppercase tracking-[0.16em] opacity-85 mt-1.5">{display.unit}</span>
        </>
      )}
    </div>
  );
}

/** Toggle isActif (visuel + optimistic UI). */
function Toggle({ on, disabled, onClick }: { on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={on ? "Désactiver" : "Activer"}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-60 ${
        on ? "bg-gradient-to-br from-emerald-600 to-emerald-700" : "bg-border-dark"
      }`}
    >
      <span className={`pointer-events-none absolute top-0.5 left-0.5 inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ${
        on ? "translate-x-5" : "translate-x-0"
      }`} />
    </button>
  );
}

function CopyChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-br from-bg-secondary to-bg-tertiary border border-dashed border-border-strong font-mono text-[12px] font-bold text-text-primary tracking-[0.1em] hover:border-text-primary transition-colors"
      title="Cliquer pour copier"
    >
      {code}
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-text-muted"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      )}
    </button>
  );
}

export default function PromotionsList({
  promotions,
  counts,
}: {
  promotions: SerializedPromotion[];
  counts: Counts;
}) {
  const [filter, setFilter] = useState<FilterValue>("all");
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();

  const now = useMemo(() => new Date(), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return promotions.filter((p) => {
      const s = effectivePromotionStatus(p, now);
      if (filter === "active"    && s !== "ACTIVE") return false;
      if (filter === "scheduled" && s !== "SCHEDULED") return false;
      if (filter === "expired"   && s !== "EXPIRED" && s !== "EXHAUSTED" && s !== "INACTIVE") return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.code?.toLowerCase().includes(q) ?? false);
    });
  }, [promotions, filter, query, now]);

  function handleToggle(id: string) {
    startTransition(async () => {
      const result = await togglePromotion(id);
      if (result.success) toast.success("Statut mis à jour");
      else toast.error(result.error || "Erreur");
    });
  }

  async function handleDelete(promo: SerializedPromotion) {
    const used = promo.usageCount > 0;
    const ok = await confirm({
      type: "danger",
      title: `Supprimer « ${promo.name} » ?`,
      message: used
        ? `Cette promotion a été utilisée ${promo.usageCount} fois. Les commandes concernées gardent leur remise, mais la trace de la promo dans leur historique sera effacée. Cette action est définitive.`
        : "Cette promotion sera définitivement supprimée. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deletePromotion(promo.id);
      if (result.success) {
        toast.success("Promotion supprimée");
        router.refresh();
      } else {
        toast.error(result.error || "Erreur");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Filtres + recherche */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            const count = counts[f.value];
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-body font-medium rounded-xl border transition-all ${
                  active
                    ? "bg-gradient-to-br from-text-primary to-text-secondary border-text-primary text-white shadow-sm"
                    : "bg-bg-primary border-border text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                {f.label}
                <span className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-semibold ${
                  active ? "bg-white/20 text-white" : "bg-bg-secondary text-text-muted"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full md:w-72">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/>
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un code, nom…"
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-border bg-bg-primary text-sm font-body placeholder:text-text-muted focus:outline-none focus:border-text-primary focus:ring-4 focus:ring-text-primary/5 transition-all"
          />
        </div>
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="bg-bg-primary rounded-2xl border border-border shadow-sm py-16 px-6 text-center">
          <div className="relative mx-auto w-20 h-24 mb-6">
            <div className="absolute inset-0 rounded-2xl border border-dashed border-border-strong bg-gradient-to-br from-bg-secondary to-bg-primary" />
            <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-bg-secondary border border-border" />
            <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-bg-secondary border border-border" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-heading text-3xl font-bold text-text-primary">%</span>
            </div>
          </div>
          <h3 className="font-heading text-xl font-bold text-text-primary mb-2">
            {query ? "Aucun résultat" : promotions.length === 0 ? "Aucune promotion pour l'instant" : "Aucune promotion dans ce filtre"}
          </h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            {query
              ? `Aucune promotion ne correspond à « ${query} ».`
              : promotions.length === 0
                ? "Créez votre premier code promo ou une remise automatique pour attirer et fidéliser vos clients."
                : "Essayez un autre filtre pour voir plus de promotions."}
          </p>
          {promotions.length === 0 && (
            <Link
              href="/admin/promotions/nouveau"
              className="inline-flex items-center gap-2 mt-6 px-4 py-2.5 rounded-xl bg-gradient-to-br from-text-primary to-text-secondary text-white text-sm font-body font-semibold shadow-md hover:opacity-95 transition-opacity"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              Créer ma première promotion
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((promo) => {
            const status = effectivePromotionStatus(promo, now);
            const ratio = usageProgress(promo.currentUses, promo.maxUses);
            const tone = progressTone(ratio);
            const inactive = status === "EXPIRED" || status === "EXHAUSTED" || status === "INACTIVE";

            return (
              <div
                key={promo.id}
                className={`bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm flex flex-col sm:flex-row transition-all hover:border-border-strong hover:shadow-md ${
                  inactive ? "opacity-70" : ""
                } ${status === "SCHEDULED" ? "border-dashed" : ""}`}
              >
                <Link href={`/admin/promotions/${promo.id}`} className="flex flex-col sm:flex-row flex-1 min-w-0">
                  <PromoTicket promo={promo} status={status} />

                  <div className="flex-1 flex flex-col md:flex-row md:items-center gap-4 p-4 sm:p-5 min-w-0">
                    <div className="flex-1 min-w-0">
                      {/* Titre + type + code */}
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <h3 className="font-heading text-lg font-bold text-text-primary truncate">{promo.name}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-body font-bold uppercase tracking-[0.05em] ${
                          promo.type === "CODE"
                            ? "bg-gradient-to-br from-text-primary to-text-secondary text-white"
                            : "bg-bg-primary text-text-primary border border-border-strong"
                        }`}>
                          {promo.type === "CODE" ? "Code" : "Auto"}
                        </span>
                        {promo.code && <CopyChip code={promo.code} />}
                        <StatusBadge status={status} />
                      </div>

                      {/* Métadonnées */}
                      <div className="flex items-center gap-x-4 gap-y-1 text-[12.5px] text-text-muted font-body flex-wrap">
                        {promo.minOrderAmount != null && promo.minOrderAmount > 0 && (
                          <span className="inline-flex items-center gap-1.5">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                            Min {promo.minOrderAmount.toFixed(2)} € HT
                          </span>
                        )}
                        {promo.firstOrderOnly && (
                          <span className="inline-flex items-center gap-1.5">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>
                            1<sup>re</sup> commande
                          </span>
                        )}
                        {promo.stackable && (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                            Cumulable
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="16" rx="2"/></svg>
                          {promo.endsAt
                            ? `Jusqu'au ${formatFrDate(promo.endsAt)}`
                            : status === "SCHEDULED"
                              ? `Démarre le ${formatFrDate(promo.startsAt)}`
                              : "Sans date de fin"}
                        </span>
                        {!promo.appliesToAll && (
                          <span className="inline-flex items-center gap-1.5">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 6h16M4 12h10M4 18h6"/></svg>
                            Sélection ciblée
                          </span>
                        )}
                      </div>

                      {/* Progression */}
                      <div className="mt-3 flex items-center gap-3">
                        {ratio != null ? (
                          <>
                            <div className="flex-1 max-w-md h-1.5 rounded-full bg-bg-secondary overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  tone === "ok" ? "bg-gradient-to-r from-emerald-600 to-emerald-700"
                                  : tone === "warn" ? "bg-gradient-to-r from-amber-500 to-amber-700"
                                  : "bg-gradient-to-r from-zinc-800 to-zinc-600"
                                }`}
                                style={{ width: `${ratio * 100}%` }}
                              />
                            </div>
                            <div className="text-[12px] text-text-secondary tabular-nums font-medium whitespace-nowrap">
                              <span className="font-bold">{promo.currentUses}</span> / {promo.maxUses}
                            </div>
                          </>
                        ) : (
                          <div className="text-[12px] text-text-secondary tabular-nums">
                            <span className="font-bold">{promo.currentUses}</span> utilisation{promo.currentUses !== 1 ? "s" : ""}
                            <span className="text-text-muted"> · illimitées</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>

                {/* Actions à droite */}
                <div className="flex items-center gap-3 px-4 sm:pr-5 sm:pl-0 pb-4 sm:pb-0">
                  <Toggle on={promo.isActive} disabled={isPending} onClick={() => handleToggle(promo.id)} />
                  <button
                    type="button"
                    onClick={() => handleDelete(promo)}
                    disabled={isPending}
                    aria-label="Supprimer cette promotion"
                    title="Supprimer"
                    className="inline-flex items-center justify-center h-9 w-9 rounded-xl border border-border text-text-muted hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"/>
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
