"use client";

/**
 * EfashionMappingControl — bouton + modale pour mapper une entité BJ vers son
 * équivalent eFashion. Réutilisable pour Category, Country, Season,
 * Composition (et Color en bonus).
 *
 * UX :
 *  - Affiche l'état actuel ("Lié à xxx (id Y)" ou "Non lié")
 *  - Bouton « Lier à eFashion » ou « Modifier » ouvre une modale avec une liste
 *    filtrable (autocomplete pour Composition)
 *  - 1 clic sur un élément de la liste → save + close
 *  - Bouton « Délier » pour effacer la liaison
 *
 * Note : les tailles ne passent pas par ce control. eFashion résout la « série
 * de tailles » (déclinaison) automatiquement à la publication.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  loadEfashionAnnexes,
  searchEfashionCompositionsAction,
  updateCategoryEfashionMapping,
  updateManufacturingCountryEfashionMapping,
  updateSeasonEfashionMapping,
  updateCompositionEfashionMapping,
  updateColorEfashionMapping,
} from "@/app/actions/admin/efashion-mappings";
import type { EfashionAnnexes } from "@/lib/efashion-annexes";
import { useToast } from "@/components/ui/Toast";

export type EfashionMappingKind =
  | "category"
  | "country"
  | "season"
  | "composition"
  | "color";

interface BaseProps {
  entityId: string;
  /** Label de l'entité BJ à afficher en haut de la modale. */
  entityName: string;
}

interface SimpleProps extends BaseProps {
  kind: EfashionMappingKind;
  currentId: number | null;
  currentLabel?: string | null;
}

export type EfashionMappingControlProps = SimpleProps;

// Cache process-level pour les annexes (1 fetch partagé entre tous les sélecteurs)
let annexesCache: EfashionAnnexes | null = null;
let annexesPromise: Promise<EfashionAnnexes | null> | null = null;

async function ensureAnnexes(): Promise<EfashionAnnexes | null> {
  if (annexesCache) return annexesCache;
  if (annexesPromise) return annexesPromise;
  annexesPromise = loadEfashionAnnexes().then((res) => {
    if (res.success) {
      annexesCache = res.data;
      return res.data;
    }
    return null;
  });
  return annexesPromise;
}

export default function EfashionMappingControl(props: EfashionMappingControlProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  // État affiché compact (bouton)
  let currentText = "—";
  let isLinked = false;
  if (props.currentId !== null) {
    currentText = props.currentLabel ? `${props.currentLabel} (id ${props.currentId})` : `id ${props.currentId}`;
    isLinked = true;
  }

  const [isPending, startTransition] = useTransition();

  function handleUnlink() {
    startTransition(async () => {
      const res = await callUpdate(props, null);
      if (res.success) {
        toast.success("Liaison eFashion effacée");
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Erreur", res.error ?? "Impossible de délier");
      }
    });
  }

  function handlePick(id: number) {
    startTransition(async () => {
      const res = await callUpdate(props, id);
      if (res.success) {
        toast.success("Liaison eFashion enregistrée");
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Erreur", res.error ?? "Erreur");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-body font-medium rounded-md border transition-colors ${
          isLinked
            ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] hover:bg-[#DCFCE7]"
            : "bg-bg-secondary text-text-secondary border-border hover:bg-bg-tertiary"
        }`}
        title={isLinked ? "Modifier la liaison eFashion" : "Lier à eFashion"}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isLinked ? "bg-[#22C55E]" : "bg-text-muted"
          }`}
        />
        <span className="truncate max-w-[200px]">eFashion : {currentText}</span>
      </button>

      {open && (
        <EfashionMappingModal
          props={props}
          isPending={isPending}
          onClose={() => setOpen(false)}
          onPick={handlePick}
          onUnlink={isLinked ? handleUnlink : undefined}
        />
      )}
    </>
  );
}

// ─── Modale ─────────────────────────────────────────────────────────────────

function EfashionMappingModal({
  props,
  isPending,
  onClose,
  onPick,
  onUnlink,
}: {
  props: EfashionMappingControlProps;
  isPending: boolean;
  onClose: () => void;
  onPick: (id: number) => void;
  onUnlink?: () => void;
}) {
  const [annexes, setAnnexes] = useState<EfashionAnnexes | null>(null);
  const [annexesError, setAnnexesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (props.kind === "composition") {
      setLoading(false);
      return;
    }
    setLoading(true);
    ensureAnnexes()
      .then((data) => {
        if (data) {
          setAnnexes(data);
        } else {
          setAnnexesError("Impossible de charger les listes eFashion (vérifier la connexion dans Paramètres > Marketplaces).");
        }
      })
      .finally(() => setLoading(false));
  }, [props.kind]);

  const title = `Lier « ${props.entityName} » à eFashion`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-none shadow-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-heading font-bold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="text-text-muted hover:text-text-primary"
            aria-label="Fermer"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <p className="font-body text-sm text-text-muted">Chargement…</p>}
          {annexesError && (
            <p className="font-body text-sm text-error">{annexesError}</p>
          )}

          {!loading && !annexesError && (
            <>
              {props.kind === "composition" ? (
                <CompositionAutocomplete onPick={onPick} disabled={isPending} />
              ) : (
                <>
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Rechercher…"
                    className="w-full h-10 px-3 mb-3 rounded-lg border border-border bg-bg-primary text-sm font-body"
                  />
                  {annexes && (
                    <FlatList
                      annexes={annexes}
                      kind={props.kind}
                      filter={filter}
                      onPick={(id) => onPick(id)}
                      disabled={isPending}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-bg-secondary/30 flex items-center justify-between gap-3">
          {onUnlink ? (
            <button
              type="button"
              onClick={onUnlink}
              disabled={isPending}
              className="h-9 px-4 rounded-lg border border-[#FECACA] text-sm font-body font-medium text-[#DC2626] hover:bg-[#FEF2F2]"
            >
              Délier
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="h-9 px-4 rounded-lg border border-border text-sm font-body text-text-secondary hover:bg-bg-secondary"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Liste plate (Category / Country / Season / Color) ─────────────────────

function FlatList({
  annexes,
  kind,
  filter,
  onPick,
  disabled,
}: {
  annexes: EfashionAnnexes;
  kind: "category" | "country" | "season" | "color";
  filter: string;
  onPick: (id: number) => void;
  disabled: boolean;
}) {
  const items = useMemo(() => {
    if (kind === "category") {
      // Seules les feuilles sont utilisables comme id_categorie
      return annexes.categories
        .filter((c) => c.isLeaf)
        .map((c) => ({ id: c.id, label: c.path }));
    }
    if (kind === "country") {
      return annexes.provenances.map((p) => ({ id: p.id, label: p.libelle }));
    }
    if (kind === "season") {
      return annexes.collections.map((c) => ({ id: c.id, label: c.label }));
    }
    if (kind === "color") {
      // Color → on n'a pas (encore) la liste master eFashion en annexe ;
      // dans la V1 on dépend du remplissage automatique via la liaison produit.
      // Si l'utilisatrice veut éditer, on lui propose un input manuel.
      return [];
    }
    return [];
  }, [annexes, kind]);

  const normFilter = filter
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

  const filtered = normFilter
    ? items.filter((it) =>
        it.label
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .includes(normFilter),
      )
    : items;

  if (kind === "color") {
    return (
      <ColorManualInput onPick={onPick} disabled={disabled} />
    );
  }

  if (items.length === 0) {
    return (
      <p className="font-body text-sm text-text-muted">
        Aucun élément reçu d&apos;eFashion pour ce type. Vérifiez votre connexion.
      </p>
    );
  }

  return (
    <div className="space-y-1 max-h-[50vh] overflow-y-auto">
      {filtered.map((it) => (
        <button
          key={`${it.id}::${it.label}`}
          type="button"
          onClick={() => onPick(it.id)}
          disabled={disabled}
          className="w-full text-left flex items-center justify-between px-3 py-2 rounded-md border border-border bg-bg-primary hover:bg-bg-secondary text-sm font-body disabled:opacity-50"
        >
          <span>{it.label}</span>
          <span className="text-[11px] text-text-muted">id {it.id}</span>
        </button>
      ))}
      {filtered.length === 0 && (
        <p className="font-body text-sm text-text-muted">Aucun résultat.</p>
      )}
    </div>
  );
}

// ─── Composition (autocomplete) ────────────────────────────────────────────

function CompositionAutocomplete({
  onPick,
  disabled,
}: {
  onPick: (id: number) => void;
  disabled: boolean;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Array<{ id: number; label: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (term.trim().length < 1) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchEfashionCompositionsAction(term);
        if (res.success && res.results) setResults(res.results);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [term]);

  return (
    <div>
      <input
        type="text"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Tapez 2-3 lettres (ex : Aci, Mét…)"
        className="w-full h-10 px-3 mb-3 rounded-lg border border-border bg-bg-primary text-sm font-body"
        autoFocus
      />
      {loading && <p className="font-body text-sm text-text-muted">Recherche…</p>}
      <div className="space-y-1 max-h-[50vh] overflow-y-auto">
        {results.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onPick(r.id)}
            disabled={disabled}
            className="w-full text-left flex items-center justify-between px-3 py-2 rounded-md border border-border bg-bg-primary hover:bg-bg-secondary text-sm font-body disabled:opacity-50"
          >
            <span>{r.label}</span>
            <span className="text-[11px] text-text-muted">id {r.id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Color : saisie manuelle (pas de liste master) ────────────────────────

function ColorManualInput({
  onPick,
  disabled,
}: {
  onPick: (id: number) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-3">
      <p className="font-body text-sm text-text-secondary">
        L&apos;ID couleur eFashion n&apos;est pas exposé publiquement par leur API.
        Il se remplit automatiquement lorsque vous liez un produit eFashion à
        un produit BJ qui utilise cette couleur. Si vous le connaissez, vous
        pouvez aussi le saisir directement ici.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ID couleur eFashion"
          className="flex-1 h-10 px-3 rounded-lg border border-border bg-bg-primary text-sm font-body"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => {
            const n = parseInt(value, 10);
            if (Number.isInteger(n) && n > 0) onPick(n);
          }}
          disabled={disabled || !value.trim()}
          className="h-10 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body disabled:opacity-50"
        >
          Enregistrer
        </button>
      </div>
    </div>
  );
}

// ─── Dispatcher d'update ────────────────────────────────────────────────────

async function callUpdate(
  props: EfashionMappingControlProps,
  id: number | null,
): Promise<{ success: boolean; error?: string }> {
  switch (props.kind) {
    case "category":
      return updateCategoryEfashionMapping(props.entityId, id);
    case "country":
      return updateManufacturingCountryEfashionMapping(props.entityId, id);
    case "season":
      return updateSeasonEfashionMapping(props.entityId, id);
    case "composition":
      return updateCompositionEfashionMapping(props.entityId, id);
    case "color":
      return updateColorEfashionMapping(props.entityId, id);
  }
}
