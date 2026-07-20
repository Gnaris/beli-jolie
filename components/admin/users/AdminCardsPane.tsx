"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Pagination from "@/components/ui/Pagination";
import PerPageSelect from "@/components/ui/PerPageSelect";
import { countryFlagUrl, countryName } from "@/lib/countries";
import { Tooltip } from "@/components/ui/Tooltip";
import AdminCardDrawer, { type AdminClientCardForDrawer } from "./AdminCardDrawer";

interface Props {
  cards: AdminClientCardForDrawer[];
  totalCount: number;
  filterCounts: {
    ALL: number;
    PFS: number;
    ANKORSTORE: number;
    EFASHION: number;
    FAIRE: number;
    MICROSTORE: number;
    PASSAGE: number;
  };
  currentFilter: "ALL" | "PFS" | "ANKORSTORE" | "EFASHION" | "FAIRE" | "MICROSTORE" | "PASSAGE";
  currentPage: number;
  perPage: number;
  search: string;
}

const MARKETPLACES = [
  { key: "PFS" as const, label: "PFS", initial: "P", gradient: "linear-gradient(135deg,#4f46e5,#6366f1)" },
  { key: "ANKORSTORE" as const, label: "Ankorstore", initial: "A", gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)" },
  { key: "EFASHION" as const, label: "eFashion", initial: "E", gradient: "linear-gradient(135deg,#db2777,#ec4899)" },
  { key: "FAIRE" as const, label: "Faire", initial: "F", gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)" },
  { key: "MICROSTORE" as const, label: "Microstore", initial: "M", gradient: "linear-gradient(135deg,#64748b,#334155)" },
  { key: "PASSAGE" as const, label: "Passage", initial: "Pa", gradient: "linear-gradient(135deg,#0d9488,#14b8a6)" },
];

const FILTERS = [
  { value: "ALL" as const, label: "Toutes" },
  { value: "PFS" as const, label: "PFS" },
  { value: "ANKORSTORE" as const, label: "Ankorstore" },
  { value: "EFASHION" as const, label: "eFashion" },
  { value: "FAIRE" as const, label: "Faire" },
  { value: "MICROSTORE" as const, label: "Microstore" },
  { value: "PASSAGE" as const, label: "Passage" },
];

function formatDate(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function initialsOf(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

const AVATAR_GRADIENTS = [
  "bg-gradient-to-br from-rose-500 to-rose-700",
  "bg-gradient-to-br from-emerald-500 to-emerald-700",
  "bg-gradient-to-br from-sky-500 to-sky-700",
  "bg-gradient-to-br from-violet-500 to-violet-700",
  "bg-gradient-to-br from-amber-500 to-amber-700",
  "bg-gradient-to-br from-teal-500 to-teal-700",
];

function gradientFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function formatDiscount(type: "PERCENT" | "AMOUNT" | null, value: string | null): string | null {
  if (!type || !value) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const clean = num % 1 === 0 ? String(num) : num.toFixed(2).replace(/\.?0+$/, "");
  return type === "PERCENT" ? `−${clean} %` : `−${clean} €`;
}

export default function AdminCardsPane({
  cards,
  totalCount,
  filterCounts,
  currentFilter,
  currentPage,
  perPage,
  search,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [editing, setEditing] = useState<AdminClientCardForDrawer | "new" | null>(null);
  const [searchInput, setSearchInput] = useState(search);

  // Ouverture automatique du drawer via ?card=<id> (deep link depuis /admin/commandes tab PFS)
  useEffect(() => {
    const cardParam = searchParams.get("card");
    if (!cardParam) return;
    const match = cards.find((c) => c.id === cardParam);
    if (match) {
      setEditing(match);
      // Consomme le param pour éviter la ré-ouverture au prochain refresh
      const params = new URLSearchParams(searchParams.toString());
      params.delete("card");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, cards, pathname, router]);

  const clientFilteredCards = useMemo(() => {
    if (!searchInput.trim()) return cards;
    const q = searchInput.trim().toLowerCase();
    return cards.filter((c) => {
      const hay = `${c.firstName} ${c.lastName} ${c.company ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [cards, searchInput]);

  function updateSearchParam(next: string) {
    setSearchInput(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      {/* Filtres + outils */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const active = currentFilter === f.value;
            const params = new URLSearchParams(searchParams.toString());
            params.set("tab", "fiches");
            if (f.value === "ALL") params.delete("mp");
            else params.set("mp", f.value);
            params.delete("page");
            const href = `${pathname}?${params.toString()}`;
            const count = filterCounts[f.value];
            return (
              <Link
                key={f.value}
                href={href}
                prefetch={false}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-body font-medium rounded-xl border transition-all ${
                  active
                    ? "bg-gradient-to-br from-text-primary to-text-secondary border-text-primary text-white shadow-sm"
                    : "bg-bg-primary border-border text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                {f.label}
                <span
                  className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-semibold ${
                    active ? "bg-white/20 text-white" : "bg-bg-secondary text-text-muted"
                  }`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4-4" />
              </svg>
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => updateSearchParam(e.target.value)}
              placeholder="Rechercher…"
              className="pl-9 pr-3 py-2 h-10 w-56 rounded-xl bg-bg-primary border border-border text-[13px] font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-slate-100"
            />
          </div>
          <PerPageSelect value={perPage} />
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-violet-800 text-white text-[13px] font-semibold shadow-sm hover:opacity-90"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nouvelle fiche
          </button>
        </div>
      </div>

      {clientFilteredCards.length === 0 ? (
        <div className="bg-bg-primary rounded-2xl border border-border shadow-sm py-16 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-5 bg-violet-100 border border-violet-200">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-violet-600">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <h3 className="font-heading text-xl font-bold text-text-primary mb-2">Aucune fiche</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            {totalCount === 0
              ? "Votre répertoire est vide. Créez votre première fiche client pour commencer."
              : "Aucune fiche ne correspond aux filtres ou à la recherche."}
          </p>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="mt-6 inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-violet-800 text-white text-[13px] font-semibold shadow-sm hover:opacity-90"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nouvelle fiche
          </button>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-bg-secondary">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Client</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Société · Contact</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Marketplaces</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Remises</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Date</th>
                    <th className="px-5 py-3 text-right text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {clientFilteredCards.map((c) => {
                    const initials = initialsOf(c.firstName, c.lastName);
                    const gradient = gradientFor(c.id);
                    const orderDiscount = formatDiscount(c.orderDiscountType, c.orderDiscountValue);
                    const shipping = c.shippingFree
                      ? "Livraison offerte"
                      : formatDiscount(c.shippingDiscountType, c.shippingDiscountValue);
                    const mps = MARKETPLACES.filter((mp) => {
                      if (mp.key === "PFS") return c.hasPfs;
                      if (mp.key === "ANKORSTORE") return c.hasAnkorstore;
                      if (mp.key === "EFASHION") return c.hasEfashion;
                      if (mp.key === "FAIRE") return c.hasFaire;
                      if (mp.key === "MICROSTORE") return c.hasMicrostore;
                      return c.hasPassage;
                    });
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setEditing(c)}
                        className="border-b border-border last:border-0 hover:bg-bg-secondary/60 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`flex items-center justify-center w-10 h-10 rounded-xl text-white text-[13px] font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                              {initials || "?"}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-body font-semibold text-text-primary truncate">{c.firstName} {c.lastName}</p>
                              {c.vatNumber && <p className="text-[11px] font-mono text-text-muted truncate">TVA {c.vatNumber}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 min-w-0">
                          <p className="text-[13.5px] font-body font-medium text-text-primary truncate max-w-xs">{c.company || "—"}</p>
                          <p className="text-xs font-body text-text-muted truncate max-w-xs">
                            {[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                          </p>
                          {(c.city || c.countryCode) && (
                            <p className="text-[11px] font-body text-text-muted truncate max-w-xs inline-flex items-center gap-1.5 mt-0.5">
                              {c.countryCode && (() => {
                                const label = countryName(c.countryCode) || c.countryCode;
                                return (
                                  <Tooltip content={label}>
                                    <img
                                      src={countryFlagUrl(c.countryCode)}
                                      alt={label}
                                      width={16}
                                      height={12}
                                      className="rounded-[2px] shadow-[0_0_0_1px_rgba(15,23,42,0.08)] object-cover shrink-0"
                                    />
                                  </Tooltip>
                                );
                              })()}
                              <span className="truncate">
                                {[c.city, countryName(c.countryCode)].filter(Boolean).join(" · ")}
                              </span>
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {mps.length === 0 ? (
                            <span className="text-[11.5px] text-text-muted">—</span>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {mps.map((mp) => (
                                <span
                                  key={mp.key}
                                  title={mp.label}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-white text-[10px] font-bold"
                                  style={{ background: mp.gradient }}
                                >
                                  {mp.initial}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {orderDiscount || shipping ? (
                            <div className="flex flex-col gap-1">
                              {orderDiscount && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-semibold w-fit">
                                  {orderDiscount}
                                </span>
                              )}
                              {shipping && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[11px] font-semibold w-fit">
                                  {shipping}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11.5px] text-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5" title="Dernière commande">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={c.lastOrderAt ? "text-text-muted" : "text-text-muted/40"}>
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                              </svg>
                              <span className={`text-xs ${c.lastOrderAt ? "text-text-secondary" : "text-text-muted"}`}>
                                {formatDate(c.lastOrderAt) || "—"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5" title="Dernier message envoyé">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={c.lastMessageSentAt ? "text-text-muted" : "text-text-muted/40"}>
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                              </svg>
                              <span className={`text-[11px] ${c.lastMessageSentAt ? "text-text-muted" : "text-text-muted/60"}`}>
                                {formatDate(c.lastMessageSentAt) || "—"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditing(c); }}
                            className="inline-flex items-center gap-1 text-xs font-body font-medium text-text-secondary hover:text-text-primary transition-colors"
                          >
                            Éditer
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M5 12h14M13 5l7 7-7 7" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination totalItems={totalCount} perPage={perPage} currentPage={currentPage} itemLabel="fiches" />
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-2.5">
            {clientFilteredCards.map((c) => {
              const initials = initialsOf(c.firstName, c.lastName);
              const gradient = gradientFor(c.id);
              const mps = MARKETPLACES.filter((mp) => {
                if (mp.key === "PFS") return c.hasPfs;
                if (mp.key === "ANKORSTORE") return c.hasAnkorstore;
                if (mp.key === "EFASHION") return c.hasEfashion;
                if (mp.key === "FAIRE") return c.hasFaire;
                if (mp.key === "MICROSTORE") return c.hasMicrostore;
                return c.hasPassage;
              });
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setEditing(c)}
                  className="w-full text-left block rounded-2xl border border-border bg-bg-primary p-4 shadow-sm hover:border-border-strong transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex items-center justify-center w-11 h-11 rounded-xl text-white text-sm font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                      {initials || "?"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-body font-semibold text-text-primary truncate">{c.firstName} {c.lastName}</p>
                      <p className="text-[12px] font-body text-text-muted truncate">{c.company || "—"}</p>
                      {mps.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          {mps.map((mp) => (
                            <span
                              key={mp.key}
                              className="inline-flex items-center justify-center w-5 h-5 rounded text-white text-[9px] font-bold"
                              style={{ background: mp.gradient }}
                            >
                              {mp.initial}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            <div className="bg-bg-primary rounded-2xl border border-border overflow-hidden">
              <Pagination totalItems={totalCount} perPage={perPage} currentPage={currentPage} itemLabel="fiches" />
            </div>
          </div>
        </>
      )}

      {editing !== null && (
        <AdminCardDrawer
          key={editing === "new" ? "new" : editing.id}
          mode={editing === "new" ? "create" : "edit"}
          card={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
