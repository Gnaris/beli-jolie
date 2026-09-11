"use client";

/**
 * Vue Mails du tab « Mes fiches clients » sur /admin/marketing.
 *
 * Différences vs. AdminCardsPane (utilisé sur /admin/clients) :
 *  - Case à cocher par ligne (bulk newsletter) ; grisée si pas d'email
 *  - Colonne « Dernier mail envoyé » à la place de « Remises / Date »
 *  - Colonne Action = Éditer fiche + Envoyer mail (grisé si pas d'email)
 *  - Filtre en tête « uniquement les fiches avec email »
 *  - Fiches sans email affichées en opacité réduite (rappel visuel)
 */

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Pagination from "@/components/ui/Pagination";
import PerPageSelect from "@/components/ui/PerPageSelect";
import { countryFlagUrl, countryName } from "@/lib/countries";
import { Tooltip } from "@/components/ui/Tooltip";
import AdminCardDrawer, { type AdminClientCardForDrawer } from "./AdminCardDrawer";
import FicheMailRowCheckbox from "./FicheMailRowCheckbox";
import FicheSendMailButton from "./FicheSendMailButton";
import { useMailSelection } from "./MailSelectionContext";

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
  /** URL param `withEmail=1` — filtre côté serveur pour ne garder que les fiches destinataires. */
  onlyWithEmail: boolean;
  /**
   * Date du dernier mail envoyé à chaque fiche, indexé par ficheId (ISO string).
   * Priorité : `EmailSend.sentAt` du dernier envoi tenant lié à l'email de la
   * fiche > `AdminClientCard.lastMessageSentAt` (fallback historique).
   */
  lastMailByFicheId: Record<string, string | null>;
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

export default function AdminCardsMailPane({
  cards,
  totalCount,
  filterCounts,
  currentFilter,
  currentPage,
  perPage,
  search,
  onlyWithEmail,
  lastMailByFicheId,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [editing, setEditing] = useState<AdminClientCardForDrawer | null>(null);
  const [searchInput, setSearchInput] = useState(search);

  const { selectedIds, selectAll, clear, isSelected, toggle } = useMailSelection();

  // Deep-link fiche (?card=<id>) — même logique que AdminCardsPane
  useEffect(() => {
    const cardParam = searchParams.get("card");
    if (!cardParam) return;
    const match = cards.find((c) => c.id === cardParam);
    if (match) {
      setEditing(match);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("card");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, cards, pathname, router]);

  // Recherche client-side (comme AdminCardsPane)
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

  function toggleOnlyWithEmail() {
    const params = new URLSearchParams(searchParams.toString());
    if (onlyWithEmail) params.delete("withEmail");
    else params.set("withEmail", "1");
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Ne cocher que les fiches avec email — jamais les vides.
  const emailedIds = useMemo(
    () => clientFilteredCards.filter((c) => !!c.email && c.email.trim().length > 0).map((c) => c.id),
    [clientFilteredCards],
  );
  const allEmailedSelected = emailedIds.length > 0 && emailedIds.every((id) => selectedIds.includes(id));

  return (
    <div className="space-y-6">
      {/* Filtres marketplace + outils */}
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
          <button
            type="button"
            onClick={toggleOnlyWithEmail}
            className={`inline-flex items-center gap-1.5 px-3.5 h-10 rounded-xl text-[12.5px] font-body font-semibold border transition-all ${
              onlyWithEmail
                ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                : "bg-bg-primary text-text-secondary border-border hover:border-border-strong hover:text-text-primary"
            }`}
            title="N'afficher que les fiches ayant un email (les autres ne peuvent pas recevoir de mail)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            Avec email uniquement
          </button>

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
        </div>
      </div>

      {clientFilteredCards.length === 0 ? (
        <div className="bg-bg-primary rounded-2xl border border-border shadow-sm py-16 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-5 bg-violet-100 border border-violet-200">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-violet-600">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <h3 className="font-heading text-xl font-bold text-text-primary mb-2">Aucune fiche</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            {totalCount === 0
              ? onlyWithEmail
                ? "Aucune fiche ne dispose d'un email pour cette sélection."
                : "Votre répertoire est vide."
              : "Aucune fiche ne correspond aux filtres ou à la recherche."}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden lg:block bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-bg-secondary">
                  <tr className="border-b border-border">
                    <th className="px-3 py-3 w-8">
                      <Tooltip content={allEmailedSelected ? "Tout désélectionner" : "Sélectionner toutes les fiches avec email"}>
                        <input
                          type="checkbox"
                          checked={allEmailedSelected}
                          disabled={emailedIds.length === 0}
                          onChange={() => (allEmailedSelected ? clear() : selectAll(emailedIds))}
                          className="w-4 h-4 rounded border-border cursor-pointer accent-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Tout sélectionner"
                        />
                      </Tooltip>
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">
                      Client
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">
                      Société · Marketplaces
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">
                      Dernier mail envoyé
                    </th>
                    <th className="px-5 py-3 text-right text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clientFilteredCards.map((c) => {
                    const initials = initialsOf(c.firstName, c.lastName);
                    const gradient = gradientFor(c.id);
                    const hasEmail = !!c.email && c.email.trim().length > 0;
                    const lastMailIso = lastMailByFicheId[c.id] ?? null;
                    const label = `${c.firstName} ${c.lastName}`.trim() || c.company || c.email || "Fiche sans nom";
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
                        className={`border-b border-border last:border-0 hover:bg-bg-secondary/60 transition-colors ${hasEmail ? "" : "opacity-60"}`}
                      >
                        <td className="px-3 py-3.5">
                          <FicheMailRowCheckbox ficheId={c.id} hasEmail={hasEmail} />
                        </td>
                        <td
                          className="px-5 py-3.5 cursor-pointer"
                          onClick={() => setEditing(c)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`flex items-center justify-center w-10 h-10 rounded-xl text-white text-[13px] font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                              {initials || "?"}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-body font-semibold text-text-primary truncate">
                                {c.firstName} {c.lastName}
                              </p>
                              {hasEmail ? (
                                <p className="text-xs font-body text-text-muted truncate max-w-xs">{c.email}</p>
                              ) : (
                                <p className="text-xs font-body text-amber-700 truncate max-w-xs italic">Pas d&apos;email</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td
                          className="px-5 py-3.5 min-w-0 cursor-pointer"
                          onClick={() => setEditing(c)}
                        >
                          <p className="text-[13.5px] font-body font-medium text-text-primary truncate max-w-xs">
                            {c.company || "—"}
                          </p>
                          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                            {mps.length === 0 ? (
                              <span className="text-[11.5px] text-text-muted">—</span>
                            ) : (
                              mps.map((mp) => (
                                <span
                                  key={mp.key}
                                  title={mp.label}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-white text-[10px] font-bold"
                                  style={{ background: mp.gradient }}
                                >
                                  {mp.initial}
                                </span>
                              ))
                            )}
                            {c.countryCode && (
                              <Tooltip content={countryName(c.countryCode) || c.countryCode}>
                                <img
                                  src={countryFlagUrl(c.countryCode)}
                                  alt={countryName(c.countryCode) || c.countryCode}
                                  width={16}
                                  height={12}
                                  className="rounded-[2px] shadow-[0_0_0_1px_rgba(15,23,42,0.08)] object-cover shrink-0"
                                />
                              </Tooltip>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {lastMailIso ? (
                            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                <polyline points="22,6 12,13 2,6" />
                              </svg>
                              <span className="text-[11.5px] font-body font-medium">{formatDate(lastMailIso)}</span>
                            </div>
                          ) : (
                            <span className="text-[11.5px] text-text-muted italic">Jamais</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex gap-2 items-center">
                            <button
                              type="button"
                              onClick={() => setEditing(c)}
                              className="inline-flex items-center gap-1 text-xs font-body font-medium text-text-secondary hover:text-text-primary transition-colors"
                            >
                              Éditer
                            </button>
                            <FicheSendMailButton
                              ficheId={c.id}
                              ficheLabel={label}
                              ficheEmail={hasEmail ? (c.email as string) : null}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination totalItems={totalCount} perPage={perPage} currentPage={currentPage} itemLabel="fiches" />
          </div>

          {/* Mobile */}
          <div className="lg:hidden space-y-2.5">
            {clientFilteredCards.map((c) => {
              const initials = initialsOf(c.firstName, c.lastName);
              const gradient = gradientFor(c.id);
              const hasEmail = !!c.email && c.email.trim().length > 0;
              const lastMailIso = lastMailByFicheId[c.id] ?? null;
              const label = `${c.firstName} ${c.lastName}`.trim() || c.company || c.email || "Fiche sans nom";
              return (
                <div
                  key={c.id}
                  className={`rounded-2xl border border-border bg-bg-primary p-4 shadow-sm ${hasEmail ? "" : "opacity-60"}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="pt-1 shrink-0">
                      <FicheMailRowCheckbox ficheId={c.id} hasEmail={hasEmail} />
                    </div>
                    <div className={`flex items-center justify-center w-11 h-11 rounded-xl text-white text-sm font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                      {initials || "?"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[14px] font-body font-semibold text-text-primary truncate cursor-pointer"
                        onClick={() => setEditing(c)}
                      >
                        {c.firstName} {c.lastName}
                      </p>
                      {hasEmail ? (
                        <p className="text-[12px] font-body text-text-muted truncate">{c.email}</p>
                      ) : (
                        <p className="text-[12px] font-body text-amber-700 italic">Pas d&apos;email</p>
                      )}
                      <p className="text-[12px] font-body text-text-muted truncate mt-1">{c.company || "—"}</p>
                      <div className="mt-2 text-[11px] text-text-muted">
                        Dernier mail :{" "}
                        {lastMailIso ? (
                          <span className="text-emerald-700 font-medium">{formatDate(lastMailIso)}</span>
                        ) : (
                          <span className="italic">Jamais</span>
                        )}
                      </div>
                      <div className="mt-3">
                        <FicheSendMailButton
                          ficheId={c.id}
                          ficheLabel={label}
                          ficheEmail={hasEmail ? (c.email as string) : null}
                        />
                      </div>
                    </div>
                  </div>
                </div>
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
          key={editing.id}
          mode="edit"
          card={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
