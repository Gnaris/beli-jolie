"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import {
  runAnkorstoreAutoMatch,
  removeAnkorstoreMatch,
  confirmAnkorstoreMatch,
  searchBjProducts,
  type AnkorstoreMatchReportSerialized,
  type AnkorstoreMatchResultSerialized,
} from "@/app/actions/admin/ankorstore";
import { getImageSrc } from "@/lib/image-utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface MatchedProduct {
  id: string;
  name: string;
  reference: string;
  ankorsProductId: string;
  ankorsMatchedAt: string | null;
  variantMatchCount: number;
}

interface Props {
  isConfigured: boolean;
  isEnabled: boolean;
  matchedCount: number;
  totalProducts: number;
  initialMatches: MatchedProduct[];
}

type TabKey = "matches" | "review" | "unmatched";

interface SearchResult {
  id: string;
  name: string;
  reference: string;
  image: string | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function AnkorstoreMappingClient({
  isConfigured,
  isEnabled,
  matchedCount: initialMatchedCount,
  totalProducts,
  initialMatches,
}: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const { showLoading, hideLoading } = useLoadingOverlay();

  const [activeTab, setActiveTab] = useState<TabKey>("matches");
  const router = useRouter();
  const [matches, setMatches] = useState<MatchedProduct[]>(initialMatches);
  const [matchedCount, setMatchedCount] = useState(initialMatchedCount);
  const [report, setReport] = useState<AnkorstoreMatchReportSerialized | null>(null);
  const [isRunning, startRunning] = useTransition();
  const [isRemoving, startRemoving] = useTransition();
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, startSearching] = useTransition();
  const [isAssociating, startAssociating] = useTransition();

  // ─── Not configured ────────────────────────────────────────────────

  if (!isConfigured) {
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm text-center">
        <svg className="w-12 h-12 mx-auto text-text-muted mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">
          Ankorstore n&apos;est pas configure
        </h3>
        <p className="font-body text-sm text-text-secondary mb-4">
          Ajoutez vos identifiants dans Parametres &gt; Marketplaces.
        </p>
        <Link
          href="/admin/parametres?tab=marketplaces"
          className="inline-flex h-9 px-4 items-center rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors"
        >
          Aller aux parametres
        </Link>
      </div>
    );
  }

  // ─── Handlers ──────────────────────────────────────────────────────

  function handleAutoMatch() {
    showLoading();
    startRunning(async () => {
      try {
        const result = await runAnkorstoreAutoMatch();
        if (result.success && result.report) {
          toast.success(
            "Matching termine",
            `${result.report.matched} match(es), ${result.report.ambiguous} ambigu(s), ${result.report.unmatched} non matche(s).`
          );
          setMatchedCount(result.report.matched);
          setReport(result.report);
          router.refresh();
        } else {
          toast.error("Erreur", result.error ?? "Le matching a echoue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleRemoveMatch(productId: string, productName: string) {
    confirm({
      title: "Dissocier le produit",
      message: `Supprimer le lien Ankorstore pour "${productName}" ?`,
      confirmLabel: "Dissocier",
      variant: "danger",
      onConfirm: () => {
        startRemoving(async () => {
          const result = await removeAnkorstoreMatch(productId);
          if (result.success) {
            setMatches((prev) => prev.filter((m) => m.id !== productId));
            setMatchedCount((prev) => prev - 1);
            toast.success("Dissocié", "Le lien Ankorstore a ete supprime.");
          } else {
            toast.error("Erreur", result.error ?? "Une erreur est survenue.");
          }
        });
      },
    });
  }

  function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    startSearching(async () => {
      const results = await searchBjProducts(query.trim());
      setSearchResults(results);
    });
  }

  function handleAssociate(ankorstoreProductId: string, bjProductId: string) {
    showLoading();
    startAssociating(async () => {
      try {
        const result = await confirmAnkorstoreMatch(ankorstoreProductId, bjProductId);
        if (result.success) {
          toast.success("Associe", "Le produit a ete associe.");
          setExpandedRow(null);
          setSearchQuery("");
          setSearchResults([]);
          // Remove from review items and refresh server data
          if (report) {
            setReport({
              ...report,
              reviewItems: report.reviewItems.filter(
                (r) => r.ankorstoreProductId !== ankorstoreProductId
              ),
            });
          }
          setMatchedCount((prev) => prev + 1);
          router.refresh();
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  // ─── Tab data from report ──────────────────────────────────────────

  const reviewItems = report?.reviewItems.filter((r) => r.status === "ambiguous") ?? [];
  const unmatchedItems = report?.reviewItems.filter((r) => r.status === "unmatched") ?? [];

  // ─── Render ────────────────────────────────────────────────────────

  const tabs: { key: TabKey; label: string; badge: string; count: number }[] = [
    { key: "matches", label: "Matches", badge: "badge-success", count: matchedCount },
    { key: "review", label: "A revoir", badge: "badge-warning", count: reviewItems.length },
    { key: "unmatched", label: "Non matches", badge: "badge-error", count: unmatchedItems.length },
  ];

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <p className="font-body text-xs text-text-secondary uppercase tracking-wider">Matches</p>
              <p className="font-heading text-2xl font-bold text-text-primary">{matchedCount}</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div>
              <p className="font-body text-xs text-text-secondary uppercase tracking-wider">Produits BJ</p>
              <p className="font-heading text-2xl font-bold text-text-primary">{totalProducts}</p>
            </div>
            {!isEnabled && (
              <>
                <div className="w-px h-10 bg-border" />
                <div>
                  <span className="badge badge-warning">Desactive</span>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={handleAutoMatch}
            disabled={isRunning || !isEnabled}
            className="h-10 px-5 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 shrink-0"
          >
            {isRunning ? "Matching en cours..." : "Lancer le matching automatique"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 sm:px-6">
          <div className="flex gap-1 -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-body font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-[#1A1A1A] text-text-primary"
                    : "border-transparent text-text-secondary hover:text-text-primary"
                }`}
              >
                {tab.label}
                <span className={`badge ${tab.badge}`}>{tab.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {activeTab === "matches" && (
            <MatchesTab
              matches={matches}
              isRemoving={isRemoving}
              onRemove={handleRemoveMatch}
            />
          )}
          {activeTab === "review" && (
            <UnmatchedList
              items={reviewItems}
              emptyMessage="Aucun produit ambigu. Lancez le matching automatique pour detecter les correspondances."
              expandedRow={expandedRow}
              onToggleExpand={(id) => setExpandedRow(expandedRow === id ? null : id)}
              searchQuery={searchQuery}
              searchResults={searchResults}
              isSearching={isSearching}
              isAssociating={isAssociating}
              onSearch={handleSearch}
              onAssociate={handleAssociate}
            />
          )}
          {activeTab === "unmatched" && (
            <UnmatchedList
              items={unmatchedItems}
              emptyMessage="Aucun produit non matche. Lancez le matching automatique pour detecter les correspondances."
              expandedRow={expandedRow}
              onToggleExpand={(id) => setExpandedRow(expandedRow === id ? null : id)}
              searchQuery={searchQuery}
              searchResults={searchResults}
              isSearching={isSearching}
              isAssociating={isAssociating}
              onSearch={handleSearch}
              onAssociate={handleAssociate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function MatchesTab({
  matches,
  isRemoving,
  onRemove,
}: {
  matches: MatchedProduct[];
  isRemoving: boolean;
  onRemove: (id: string, name: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <p className="font-body text-sm text-text-secondary text-center py-8">
        Aucun match pour le moment. Lancez le matching automatique pour commencer.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {matches.map((match) => (
        <div
          key={match.id}
          className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border hover:bg-bg-secondary/50 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-body text-sm font-medium text-text-primary truncate">
                {match.name}
              </p>
              <span className="font-body text-xs text-text-muted shrink-0">
                {match.reference}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="font-body text-xs text-text-secondary">
                {match.variantMatchCount} variante{match.variantMatchCount !== 1 ? "s" : ""} associee{match.variantMatchCount !== 1 ? "s" : ""}
              </span>
              {match.ankorsMatchedAt && (
                <span className="font-body text-xs text-text-muted">
                  {new Date(match.ankorsMatchedAt).toLocaleDateString("fr-FR")}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRemove(match.id, match.name)}
            disabled={isRemoving}
            className="h-8 px-3 rounded-lg border border-border text-xs font-body font-medium text-text-secondary hover:text-[#EF4444] hover:border-[#EF4444]/30 transition-colors disabled:opacity-50 shrink-0"
          >
            Dissocier
          </button>
        </div>
      ))}
    </div>
  );
}

function UnmatchedList({
  items,
  emptyMessage,
  expandedRow,
  onToggleExpand,
  searchQuery,
  searchResults,
  isSearching,
  isAssociating,
  onSearch,
  onAssociate,
}: {
  items: AnkorstoreMatchResultSerialized[];
  emptyMessage: string;
  expandedRow: string | null;
  onToggleExpand: (id: string) => void;
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  isAssociating: boolean;
  onSearch: (q: string) => void;
  onAssociate: (ankorstoreProductId: string, bjProductId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="font-body text-sm text-text-secondary text-center py-8">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const isExpanded = expandedRow === item.ankorstoreProductId;

        return (
          <div
            key={item.ankorstoreProductId}
            className="rounded-lg border border-border overflow-hidden"
          >
            <div
              className="flex items-center gap-3 p-3 hover:bg-bg-secondary/50 transition-colors cursor-pointer"
              onClick={() => onToggleExpand(item.ankorstoreProductId)}
            >
              {item.ankorstoreImageUrl ? (
                <img
                  src={item.ankorstoreImageUrl}
                  alt=""
                  className="w-10 h-10 rounded-lg object-cover border border-border shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-bg-secondary border border-border shrink-0 flex items-center justify-center">
                  <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm font-medium text-text-primary truncate">
                  {item.ankorstoreProductName}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {item.extractedRef && (
                    <span className="font-body text-xs text-text-muted">
                      Ref: {item.extractedRef}
                    </span>
                  )}
                  <span className={`badge ${item.status === "ambiguous" ? "badge-warning" : "badge-error"}`}>
                    {item.status === "ambiguous" ? "Ambigu" : "Non matche"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="h-8 px-3 rounded-lg border border-border text-xs font-body font-medium text-text-secondary hover:text-text-primary transition-colors shrink-0"
              >
                {isExpanded ? "Fermer" : "Associer"}
              </button>
            </div>

            {isExpanded && (
              <div className="border-t border-border p-3 bg-bg-secondary/30">
                <div className="mb-3">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => onSearch(e.target.value)}
                    placeholder="Rechercher un produit BJ par nom ou reference..."
                    className="w-full h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                    autoFocus
                  />
                </div>

                {isSearching && (
                  <p className="font-body text-xs text-text-secondary py-2">Recherche...</p>
                )}

                {!isSearching && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
                  <p className="font-body text-xs text-text-secondary py-2">
                    Aucun resultat pour &quot;{searchQuery}&quot;.
                  </p>
                )}

                {searchResults.length > 0 && (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {searchResults.map((result) => (
                      <div
                        key={result.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-primary transition-colors"
                      >
                        {result.image ? (
                          <img
                            src={getImageSrc(result.image, "thumb")}
                            alt=""
                            className="w-8 h-8 rounded object-cover border border-border shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded bg-bg-secondary border border-border shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-sm text-text-primary truncate">{result.name}</p>
                          <p className="font-body text-xs text-text-muted">{result.reference}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onAssociate(item.ankorstoreProductId, result.id)}
                          disabled={isAssociating}
                          className="h-7 px-3 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 shrink-0"
                        >
                          Associer
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
