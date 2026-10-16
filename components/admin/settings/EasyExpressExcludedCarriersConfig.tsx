"use client";

import { useEffect, useState, useTransition } from "react";
import {
  fetchEasyExpressAvailableCarriers,
  updateEasyExpressExcludedCarriers,
  type EasyExpressAvailableCarrier,
} from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  initialExcluded: string[];
  hasKey: boolean;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export default function EasyExpressExcludedCarriersConfig({ initialExcluded, hasKey }: Props) {
  const [carriers, setCarriers] = useState<EasyExpressAvailableCarrier[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set des noms (normalisés) actuellement MASQUÉS.
  const [excludedSet, setExcludedSet] = useState<Set<string>>(
    () => new Set(initialExcluded.map(normalize))
  );
  // Snapshot pour détecter les modifications non sauvegardées.
  const [savedSet, setSavedSet] = useState<Set<string>>(
    () => new Set(initialExcluded.map(normalize))
  );
  const [saving, startSaving] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  async function loadCarriers() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchEasyExpressAvailableCarriers();
      if (res.success && res.carriers) {
        setCarriers(res.carriers);
      } else {
        setLoadError(res.error ?? "Impossible de récupérer la liste des transporteurs.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (hasKey) {
      void loadCarriers();
    }
  }, [hasKey]);

  function toggle(name: string) {
    const key = normalize(name);
    setExcludedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSave() {
    showLoading();
    startSaving(async () => {
      try {
        // Reconstruire la liste à partir des noms affichés + ceux déjà exclus
        // mais plus visibles (ex. transporteur discontinué par Easy-Express) pour
        // éviter de perdre une préférence par oubli.
        const visibleNames = new Map<string, string>();
        for (const c of carriers ?? []) visibleNames.set(normalize(c.name), c.name);
        const legacy = initialExcluded.filter(
          (n) => !visibleNames.has(normalize(n))
        );
        const fromToggles: string[] = [];
        for (const key of excludedSet) {
          const original = visibleNames.get(key);
          if (original) fromToggles.push(original);
        }
        const toSave = Array.from(new Set([...legacy, ...fromToggles]));
        const res = await updateEasyExpressExcludedCarriers(toSave);
        if (res.success) {
          toast.success(
            "Enregistré",
            excludedSet.size === 0
              ? "Tous les transporteurs seront proposés à vos clientes."
              : `${excludedSet.size} transporteur${excludedSet.size > 1 ? "s" : ""} masqué${excludedSet.size > 1 ? "s" : ""}.`
          );
          setSavedSet(new Set(excludedSet));
        } else {
          toast.error("Erreur", res.error ?? "Enregistrement impossible.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  const isDirty =
    excludedSet.size !== savedSet.size ||
    [...excludedSet].some((n) => !savedSet.has(n));

  if (!hasKey) {
    return (
      <div className="rounded-xl border border-border bg-bg-secondary/40 px-4 py-3 text-xs font-body text-text-secondary">
        Renseignez d&apos;abord la clé API Easy-Express dans la carte au-dessus pour
        pouvoir choisir les transporteurs à proposer.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-secondary/40 px-4 py-3 text-xs font-body text-text-secondary">
        <p>
          Décochez un transporteur pour qu&apos;il n&apos;apparaisse <strong className="text-text-primary">plus jamais</strong> au checkout
          — valable pour <strong className="text-text-primary">toutes les destinations</strong> (France et international).
        </p>
        <p className="mt-1.5">
          Si une cliente arrive sur une destination où tous les transporteurs sont décochés,
          elle verra « Livraison indisponible » et ne pourra pas finaliser sa commande.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-6 justify-center text-sm text-text-secondary">
          <span className="h-3 w-3 rounded-full bg-amber-400 animate-pulse" />
          Détection des transporteurs Easy-Express…
        </div>
      )}

      {loadError && !loading && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-body text-red-700">
          <p className="font-semibold">Détection impossible</p>
          <p className="mt-1 text-xs">{loadError}</p>
          <button
            type="button"
            onClick={loadCarriers}
            className="mt-2 text-xs underline hover:no-underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {!loading && !loadError && carriers && carriers.length === 0 && (
        <div className="rounded-xl border border-border bg-bg-secondary/40 px-4 py-3 text-sm font-body text-text-secondary">
          Easy-Express n&apos;a retourné aucun transporteur pour la cotation test (France,
          1 kg). Vérifiez votre compte Easy-Express.
        </div>
      )}

      {!loading && carriers && carriers.length > 0 && (
        <>
          <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {carriers.map((c) => {
              const key = normalize(c.name);
              const isExcluded = excludedSet.has(key);
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 px-4 py-3 bg-bg-primary"
                >
                  {c.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.logo}
                      alt=""
                      className="h-8 w-14 object-contain shrink-0"
                    />
                  ) : (
                    <div className="h-8 w-14 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-body font-medium text-text-primary truncate">
                      {c.name}
                    </p>
                    {c.delay && (
                      <p className="text-xs font-body text-text-muted truncate">{c.delay}</p>
                    )}
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={!isExcluded}
                      onChange={() => toggle(c.name)}
                      className="h-4 w-4 rounded border-border text-bg-dark focus:ring-2 focus:ring-bg-dark/20"
                    />
                    <span className="text-xs font-body text-text-secondary">
                      {isExcluded ? "Masqué" : "Proposé"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={loadCarriers}
              disabled={loading || saving}
              className="text-xs font-body text-text-secondary hover:text-text-primary underline disabled:opacity-50"
            >
              Rafraîchir la liste
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
