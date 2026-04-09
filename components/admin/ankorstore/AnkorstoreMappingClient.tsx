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
  updateAnkorstoreVariantStock,
  pushProductsToAnkorstore,
  type AnkorstoreMatchReportSerialized,
  type AnkorstoreMatchResultSerialized,
} from "@/app/actions/admin/ankorstore";

// ─── Types ──────────────────────────────────────────────────────────────────

interface MatchedVariant {
  productColorId: string;
  ankorsVariantId: string;
  colorName: string;
}

interface MatchedProduct {
  id: string;
  name: string;
  reference: string;
  ankorsProductId: string;
  ankorsMatchedAt: string | null;
  variantMatchCount: number;
  variants: MatchedVariant[];
}

interface Props {
  isConfigured: boolean;
  isEnabled: boolean;
  matchedCount: number;
  totalProducts: number;
  initialMatches: MatchedProduct[];
}

type TabKey = "matches" | "review" | "unmatched";

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

  function handlePush() {
    showLoading();
    startRunning(async () => {
      try {
        const result = await pushProductsToAnkorstore();
        if (result.success && result.report) {
          toast.success(
            "Push termine",
            `${result.report.succeeded} produit(s) envoye(s), ${result.report.failed} echec(s).`
          );
          router.refresh();
        } else {
          toast.error("Erreur", result.error ?? "Le push a echoue.");
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
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={handlePush}
              disabled={isRunning || !isEnabled}
              className="h-10 px-5 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
            >
              {isRunning ? "En cours..." : "Pousser vers Ankorstore"}
            </button>
            <button
              type="button"
              onClick={handleAutoMatch}
              disabled={isRunning || !isEnabled}
              className="h-10 px-5 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {isRunning ? "En cours..." : "Lancer le matching"}
            </button>
          </div>
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
            />
          )}
          {activeTab === "unmatched" && (
            <UnmatchedList
              items={unmatchedItems}
              emptyMessage="Aucun produit non matche. Lancez le matching automatique pour detecter les correspondances."
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        <div key={match.id} className="rounded-lg border border-border hover:bg-bg-secondary/50 transition-colors">
          <div className="flex items-center justify-between gap-4 p-3">
            <button
              type="button"
              onClick={() => setExpandedId(expandedId === match.id ? null : match.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex items-center gap-2">
                <svg
                  className={`w-4 h-4 text-text-muted shrink-0 transition-transform ${expandedId === match.id ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <p className="font-body text-sm font-medium text-text-primary truncate">
                  {match.name}
                </p>
                <span className="font-body text-xs text-text-muted shrink-0">
                  {match.reference}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 ml-6">
                <span className="font-body text-xs text-text-secondary">
                  {match.variantMatchCount} variante{match.variantMatchCount !== 1 ? "s" : ""} associee{match.variantMatchCount !== 1 ? "s" : ""}
                </span>
                {match.ankorsMatchedAt && (
                  <span className="font-body text-xs text-text-muted">
                    {new Date(match.ankorsMatchedAt).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onRemove(match.id, match.name)}
              disabled={isRemoving}
              className="h-8 px-3 rounded-lg border border-border text-xs font-body font-medium text-text-secondary hover:text-[#EF4444] hover:border-[#EF4444]/30 transition-colors disabled:opacity-50 shrink-0"
            >
              Dissocier
            </button>
          </div>
          {expandedId === match.id && match.variants.length > 0 && (
            <div className="border-t border-border px-3 py-3 space-y-2">
              {match.variants.map((v) => (
                <VariantStockRow key={v.productColorId} variant={v} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function VariantStockRow({ variant }: { variant: MatchedVariant }) {
  const toast = useToast();
  const [quantity, setQuantity] = useState("");
  const [isSaving, startSaving] = useTransition();
  const [lastResult, setLastResult] = useState<{ success: boolean; error?: string } | null>(null);

  function handleUpdateStock() {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 0) {
      toast.error("Erreur", "Quantite invalide.");
      return;
    }
    startSaving(async () => {
      const result = await updateAnkorstoreVariantStock(variant.productColorId, qty);
      setLastResult(result);
      if (result.success) {
        toast.success("Stock mis a jour", `${variant.colorName} → ${qty}`);
      } else {
        toast.error("Erreur", result.error ?? "Echec de la mise a jour.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3 py-1">
      <span className="font-body text-xs text-text-secondary min-w-[100px]">
        {variant.colorName}
      </span>
      <span className="font-body text-[10px] text-text-muted truncate max-w-[140px]" title={variant.ankorsVariantId}>
        {variant.ankorsVariantId.slice(0, 8)}...
      </span>
      <input
        type="number"
        min={0}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder="Qte"
        className="w-20 h-7 px-2 rounded-md border border-border text-xs font-body text-text-primary bg-bg-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        type="button"
        onClick={handleUpdateStock}
        disabled={isSaving || !quantity}
        className="h-7 px-3 rounded-md bg-bg-dark text-text-inverse text-xs font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
      >
        {isSaving ? "..." : "Tester stock"}
      </button>
      {lastResult && (
        <span className={`badge ${lastResult.success ? "badge-success" : "badge-error"}`}>
          {lastResult.success ? "OK" : "Echec"}
        </span>
      )}
    </div>
  );
}

function UnmatchedList({
  items,
  emptyMessage,
}: {
  items: AnkorstoreMatchResultSerialized[];
  emptyMessage: string;
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
      {items.map((item) => (
        <div
          key={item.bjProductId}
          className="flex items-center gap-3 p-3 rounded-lg border border-border"
        >
          <div className="min-w-0 flex-1">
            <p className="font-body text-sm font-medium text-text-primary truncate">
              {item.bjProductName}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-body text-xs text-text-muted">
                Ref: {item.bjReference}
              </span>
              <span className={`badge ${item.status === "ambiguous" ? "badge-warning" : "badge-error"}`}>
                {item.status === "ambiguous" ? "Ambigu" : "Non trouve"}
              </span>
              {item.ankorstoreVariants.length > 0 && (
                <span className="font-body text-xs text-text-muted">
                  ({item.ankorstoreVariants.length} variante{item.ankorstoreVariants.length > 1 ? "s" : ""} trouvee{item.ankorstoreVariants.length > 1 ? "s" : ""})
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
