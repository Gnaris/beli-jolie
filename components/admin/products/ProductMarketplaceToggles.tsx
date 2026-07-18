"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProductMarketplaceEnabled } from "@/app/actions/admin/product-marketplace-enabled";
import { useToast } from "@/components/ui/Toast";
import type { MarketplaceKey } from "@/lib/marketplace-enabled";

// ─────────────────────────────────────────────────────────────────────────
// Couleurs figées des initiales marketplaces (cf. CLAUDE.md).
// Ces gradients servent EXCLUSIVEMENT à colorer le rond d'initiale — jamais
// en halo, aurora, bandeau ou CTA. Le reste de l'UI reste ardoise.
// ─────────────────────────────────────────────────────────────────────────

const MP_META: Record<
  MarketplaceKey,
  { label: string; letter: string; gradient: string }
> = {
  pfs: {
    label: "Paris Fashion Shop",
    letter: "P",
    gradient: "linear-gradient(135deg,#4f46e5,#6366f1)",
  },
  ankorstore: {
    label: "Ankorstore",
    letter: "A",
    gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
  },
  efashion: {
    label: "eFashion Paris",
    letter: "E",
    gradient: "linear-gradient(135deg,#db2777,#ec4899)",
  },
  faire: {
    label: "Faire",
    letter: "F",
    gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  },
};

interface Props {
  productId: string;
  pfsEnabled: boolean;
  ankorsEnabled: boolean;
  efashionEnabled: boolean;
  faireEnabled: boolean;
  isPfsLinked: boolean;
  isAnkorsLinked: boolean;
  isEfashionLinked: boolean;
  isFaireLinked: boolean;
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  hasEfashionConfig: boolean;
  hasFaireConfig: boolean;
}

export function ProductMarketplaceToggles({
  productId,
  pfsEnabled,
  ankorsEnabled,
  efashionEnabled,
  faireEnabled,
  isPfsLinked,
  isAnkorsLinked,
  isEfashionLinked,
  isFaireLinked,
  hasPfsConfig,
  hasAnkorstoreConfig,
  hasEfashionConfig,
  hasFaireConfig,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<MarketplaceKey | null>(null);
  const [confirmState, setConfirmState] = useState<{
    marketplace: MarketplaceKey;
  } | null>(null);

  const rows: {
    key: MarketplaceKey;
    enabled: boolean;
    isLinked: boolean;
    show: boolean;
  }[] = [
    { key: "pfs", enabled: pfsEnabled, isLinked: isPfsLinked, show: hasPfsConfig },
    {
      key: "ankorstore",
      enabled: ankorsEnabled,
      isLinked: isAnkorsLinked,
      show: hasAnkorstoreConfig,
    },
    {
      key: "efashion",
      enabled: efashionEnabled,
      isLinked: isEfashionLinked,
      show: hasEfashionConfig,
    },
    { key: "faire", enabled: faireEnabled, isLinked: isFaireLinked, show: hasFaireConfig },
  ];

  const visibleRows = rows.filter((r) => r.show);
  if (visibleRows.length === 0) return null;

  const applyChange = (
    marketplace: MarketplaceKey,
    next: boolean,
    unlink: boolean,
  ) => {
    setPendingKey(marketplace);
    startTransition(async () => {
      const res = await setProductMarketplaceEnabled(
        productId,
        marketplace,
        next,
        { unlink },
      );
      setPendingKey(null);
      setConfirmState(null);
      if (res.success) {
        toast.success(
          next
            ? `${MP_META[marketplace].label} activée pour ce produit`
            : res.unlinked
              ? `${MP_META[marketplace].label} désactivée + lien effacé`
              : `${MP_META[marketplace].label} désactivée pour ce produit`,
        );
        router.refresh();
      } else {
        toast.error("Modification refusée", res.error ?? "Erreur inconnue.");
      }
    });
  };

  const handleToggle = (row: {
    key: MarketplaceKey;
    enabled: boolean;
    isLinked: boolean;
  }) => {
    // Activation : direct, pas de confirmation
    if (!row.enabled) {
      applyChange(row.key, true, false);
      return;
    }
    // Désactivation d'un produit déjà lié : ouvrir la modale de choix
    if (row.isLinked) {
      setConfirmState({ marketplace: row.key });
      return;
    }
    // Désactivation d'un produit non-lié : direct
    applyChange(row.key, false, false);
  };

  return (
    <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Header sobre ardoise */}
      <div className="p-6 border-b border-border">
        <div className="text-[10.5px] font-bold uppercase text-text-muted mb-2 font-body"
          style={{ letterSpacing: "0.2em" }}
        >
          Publication marketplaces
        </div>
        <h3 className="font-heading text-lg font-bold text-text-primary">
          Où voulez-vous que ce produit apparaisse ?
        </h3>
        <p className="text-xs text-text-secondary mt-1.5 max-w-xl leading-relaxed font-body">
          Décochez un marketplace pour l'exclure de ce produit. Une fois désactivé,
          plus aucune action automatique (publication, rafraîchissement, synchro
          stock, modif prix) ne partira vers lui — même en lot.
        </p>
      </div>

      {/* Liste des toggles */}
      <div className="divide-y divide-border">
        {visibleRows.map((row) => (
          <MarketplaceRow
            key={row.key}
            marketplace={row.key}
            enabled={row.enabled}
            onToggle={() => handleToggle(row)}
            busy={isPending && pendingKey === row.key}
          />
        ))}
      </div>

      {/* Bandeau info neutre ardoise */}
      <div className="p-4 bg-bg-secondary border-t border-border flex items-start gap-2.5">
        <svg
          className="w-4 h-4 text-text-muted flex-shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-xs text-text-secondary leading-relaxed font-body">
          <span className="font-semibold text-text-primary">
            Désactiver ici ne supprime rien côté marketplace.
          </span>{" "}
          Si le produit y est déjà publié, sa fiche existante reste en l'état —
          mais vos futures modifs ne partiront plus tant que vous n'aurez pas
          réactivé.
        </p>
      </div>

      {/* Modale de confirmation à la désactivation d'un produit lié */}
      {confirmState && (
        <DisableConfirmModal
          marketplace={confirmState.marketplace}
          onCancel={() => setConfirmState(null)}
          onConfirm={(unlink) =>
            applyChange(confirmState.marketplace, false, unlink)
          }
          busy={isPending}
        />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Ligne d'un marketplace (badge + libellé + toggle)
// ─────────────────────────────────────────────────────────────────────────

function MarketplaceRow({
  marketplace,
  enabled,
  onToggle,
  busy,
}: {
  marketplace: MarketplaceKey;
  enabled: boolean;
  onToggle: () => void;
  busy: boolean;
}) {
  const meta = MP_META[marketplace];
  return (
    <div
      className={`p-5 flex items-center gap-4 ${!enabled ? "bg-bg-secondary" : ""}`}
    >
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-extrabold text-sm flex-shrink-0"
        style={{ background: meta.gradient }}
        aria-hidden
      >
        {meta.letter}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold text-text-primary font-body">
            {meta.label}
          </div>
          {enabled ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold font-body bg-[color:var(--color-success-bg)] text-[color:var(--color-success)] border border-[#BBF7D0]">
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[7px] font-extrabold flex-shrink-0"
                style={{ background: meta.gradient }}
                aria-hidden
              >
                {meta.letter}
              </span>
              Activée
              <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-success)]" />
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full text-[11px] font-semibold font-body border border-border-dark text-text-muted"
              style={{
                background:
                  "repeating-linear-gradient(45deg,#FAFAFA,#FAFAFA 6px,#F4F4F5 6px,#F4F4F5 12px)",
              }}
              aria-label="Désactivée pour ce produit"
            >
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[7px] font-extrabold flex-shrink-0"
                style={{ background: meta.gradient, filter: "grayscale(1) brightness(0.85)" }}
                aria-hidden
              >
                {meta.letter}
              </span>
              <span className="line-through decoration-[1.5px] decoration-text-muted">
                Désactivée pour ce produit
              </span>
            </span>
          )}
        </div>
        <p className="text-xs text-text-secondary mt-1 font-body">
          {enabled
            ? "Les rafraîchissements, publications et synchros stock/prix sont autorisés."
            : `Aucune publication, aucun rafraîchissement, aucune synchro ne partira vers ${meta.label} pour ce produit.`}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? `Désactiver ${meta.label}` : `Activer ${meta.label}`}
        onClick={onToggle}
        disabled={busy}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 border ${
          enabled
            ? "bg-bg-dark border-bg-dark"
            : "bg-bg-tertiary border-border-strong"
        } ${busy ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-bg-primary shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Modale de confirmation à la désactivation d'un produit déjà lié
// (palette ardoise, CTA noir, initiale colorée)
// ─────────────────────────────────────────────────────────────────────────

function DisableConfirmModal({
  marketplace,
  onCancel,
  onConfirm,
  busy,
}: {
  marketplace: MarketplaceKey;
  onCancel: () => void;
  onConfirm: (unlink: boolean) => void;
  busy: boolean;
}) {
  const [choice, setChoice] = useState<"keep" | "unlink">("keep");
  const meta = MP_META[marketplace];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-lg bg-bg-primary rounded-3xl shadow-modal ring-1 ring-black/5 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disable-marketplace-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-extrabold text-xl flex-shrink-0"
              style={{ background: meta.gradient }}
              aria-hidden
            >
              {meta.letter}
            </div>
            <div className="min-w-0 pt-1">
              <div
                className="text-[10.5px] font-bold uppercase text-text-muted mb-1 font-body"
                style={{ letterSpacing: "0.2em" }}
              >
                {meta.label} · désactivation
              </div>
              <h3
                id="disable-marketplace-title"
                className="font-heading text-[22px] font-bold text-text-primary leading-tight"
              >
                Que faire du lien vers {meta.label} ?
              </h3>
            </div>
          </div>

          <p className="mt-5 text-sm text-text-secondary leading-relaxed font-body">
            Ce produit est déjà lié à une fiche {meta.label}. En désactivant,
            plus aucune synchro ne partira automatiquement. Vous avez le choix
            pour le lien existant :
          </p>

          <label
            className={`mt-4 flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-colors ${
              choice === "keep"
                ? "border-border-dark bg-bg-secondary"
                : "border-border hover:border-border-dark"
            }`}
          >
            <input
              type="radio"
              name="disable-choice"
              value="keep"
              checked={choice === "keep"}
              onChange={() => setChoice("keep")}
              className="w-4 h-4 accent-bg-dark mt-0.5"
              style={{ accentColor: "var(--color-bg-dark)" }}
            />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-text-primary text-sm font-body">
                Laisser le lien vers la fiche {meta.label}
              </div>
              <div className="text-[12px] text-text-secondary mt-0.5 font-body">
                Recommandé. La fiche reste visible sur {meta.label}. On coupe
                juste le flux automatique.
              </div>
            </div>
            <div className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[color:var(--color-success-bg)] text-[color:var(--color-success)] border border-[#BBF7D0] tracking-wider whitespace-nowrap">
              Recommandé
            </div>
          </label>

          <label
            className={`mt-2 flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-colors ${
              choice === "unlink"
                ? "border-border-dark bg-bg-secondary"
                : "border-border hover:border-border-dark"
            }`}
          >
            <input
              type="radio"
              name="disable-choice"
              value="unlink"
              checked={choice === "unlink"}
              onChange={() => setChoice("unlink")}
              className="w-4 h-4 mt-0.5"
              style={{ accentColor: "var(--color-bg-dark)" }}
            />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-text-primary text-sm font-body">
                Effacer le lien vers la fiche {meta.label}
              </div>
              <div className="text-[12px] text-text-secondary mt-0.5 font-body">
                Le lien côté site est effacé. La fiche existante reste chez{" "}
                {meta.label}, mais vous devrez recréer une nouvelle fiche pour
                re-publier.
              </div>
            </div>
          </label>

          <div className="mt-5 flex items-start gap-2.5 p-3 rounded-xl border border-border bg-bg-secondary">
            <svg
              className="w-4 h-4 flex-shrink-0 mt-0.5 text-text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-xs leading-relaxed font-body text-text-secondary">
              Dans les deux cas, {meta.label} sera désactivée pour ce produit
              tant que vous ne la réactiverez pas dans « Configuration
              Marketplace ».
            </p>
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2.5 text-sm font-semibold text-text-secondary rounded-xl hover:bg-bg-secondary transition-colors font-body disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => onConfirm(choice === "unlink")}
              disabled={busy}
              className="inline-flex items-center gap-2 pl-4 pr-5 py-2.5 text-sm font-semibold text-text-inverse bg-bg-dark hover:bg-black rounded-xl transition-colors font-body disabled:opacity-60"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2.4}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Confirmer la désactivation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
