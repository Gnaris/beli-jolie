"use client";

import { useState, useTransition, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import CustomSelect from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/Toast";
import {
  setCollectionRule,
  removeCollectionRule,
  previewRuleMatchCount,
  reincludeProductInCollection,
} from "@/app/actions/admin/collections";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Option {
  id: string;
  name: string;
}

interface SubCategoryOption extends Option {
  categoryId: string;
}

interface CompositionRuleLine {
  compositionId: string;
  minPercent: number | null;
}

interface RuleState {
  seasonId: string | null;
  categoryIds: string[];
  subCategoryIds: string[];
  tagIds: string[];
  compositions: CompositionRuleLine[];
}

interface ExclusionRow {
  productId: string;
  name: string;
  reference: string;
  excludedAt: string;
}

interface Props {
  collectionId: string;
  seasons: Option[];
  categories: Option[];
  subCategories: SubCategoryOption[];
  tags: Option[];
  compositions: Option[];
  initialRule: RuleState | null;
  initialLastRecalculatedAt: string | null;
  exclusions: ExclusionRow[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const EMPTY_STATE: RuleState = {
  seasonId: null,
  categoryIds: [],
  subCategoryIds: [],
  tagIds: [],
  compositions: [],
};

function isRuleEmpty(r: RuleState): boolean {
  return (
    !r.seasonId &&
    r.categoryIds.length === 0 &&
    r.subCategoryIds.length === 0 &&
    r.tagIds.length === 0 &&
    r.compositions.length === 0
  );
}

function serialize(r: RuleState) {
  return {
    seasonId: r.seasonId,
    categoryIds: r.categoryIds,
    subCategoryIds: r.subCategoryIds,
    tagIds: r.tagIds,
    compositions: r.compositions.map((c) => ({
      compositionId: c.compositionId,
      minPercent: c.minPercent ?? undefined,
    })),
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CollectionRuleEditor({
  collectionId,
  seasons,
  categories,
  subCategories,
  tags,
  compositions,
  initialRule,
  initialLastRecalculatedAt,
  exclusions,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<RuleState>(initialRule ?? EMPTY_STATE);
  const [dirty, setDirty] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [showExclusions, setShowExclusions] = useState(false);
  const [lastRecalculatedAt, setLastRecalculatedAt] = useState<string | null>(
    initialLastRecalculatedAt,
  );
  const hasRule = initialRule !== null;

  // Resync avec les props quand le server component re-render (après
  // router.refresh() suite à une modification produit qui a bougé les
  // appartenances aux collections). Sans ça, la liste d'exclusions et
  // l'horodatage du dernier recalcul restent figés jusqu'au reload.
  useEffect(() => {
    setLastRecalculatedAt(initialLastRecalculatedAt);
  }, [initialLastRecalculatedAt]);

  // Preview live du nombre de produits éligibles (debounced). setState est
  // planifié via setTimeout pour éviter le warning « setState synchronously
  // within an effect » — même dans la branche "règle vide".
  useEffect(() => {
    if (isRuleEmpty(state)) {
      const t = setTimeout(() => setPreviewCount(0), 0);
      return () => clearTimeout(t);
    }
    const timer = setTimeout(async () => {
      try {
        const { count } = await previewRuleMatchCount(serialize(state));
        setPreviewCount(count);
      } catch {
        setPreviewCount(null);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [state]);

  function update<K extends keyof RuleState>(key: K, value: RuleState[K]) {
    setState((s) => ({ ...s, [key]: value }));
    setDirty(true);
  }

  function addComposition(compositionId: string) {
    if (!compositionId) return;
    if (state.compositions.some((c) => c.compositionId === compositionId)) return;
    update("compositions", [...state.compositions, { compositionId, minPercent: null }]);
  }

  function updateCompositionPercent(compositionId: string, value: string) {
    const parsed = value.trim() === "" ? null : Math.max(0, Math.min(100, Number(value)));
    update(
      "compositions",
      state.compositions.map((c) =>
        c.compositionId === compositionId ? { ...c, minPercent: parsed } : c,
      ),
    );
  }

  function removeComposition(compositionId: string) {
    update(
      "compositions",
      state.compositions.filter((c) => c.compositionId !== compositionId),
    );
  }

  function handleSave() {
    if (isRuleEmpty(state)) {
      toast.warning("Règle vide", "Ajoutez au moins un critère avant d'enregistrer.");
      return;
    }
    startTransition(async () => {
      const res = await setCollectionRule(collectionId, serialize(state));
      if (!res.success) {
        toast.error("Impossible d'enregistrer", res.error ?? "");
        return;
      }
      setDirty(false);
      setLastRecalculatedAt(new Date().toISOString());
      const added = res.result?.added.length ?? 0;
      const removed = res.result?.removed.length ?? 0;
      toast.success(
        "Règle enregistrée",
        `${added} produit(s) ajouté(s), ${removed} retiré(s).`,
      );
      router.refresh();
    });
  }

  function handleRemove() {
    if (!hasRule) return;
    if (
      !confirm(
        "Supprimer la règle ?\n\nLes produits déjà ajoutés automatiquement restent dans la collection, mais aucun nouveau produit ne sera plus ajouté.",
      )
    )
      return;
    startTransition(async () => {
      const res = await removeCollectionRule(collectionId);
      if (!res.success) {
        toast.error("Impossible de supprimer la règle");
        return;
      }
      setState(EMPTY_STATE);
      setDirty(false);
      setLastRecalculatedAt(null);
      toast.success("Règle supprimée");
      router.refresh();
    });
  }

  const seasonOptions = useMemo(
    () => [
      { value: "", label: "Toutes les saisons" },
      ...seasons.map((s) => ({ value: s.id, label: s.name })),
    ],
    [seasons],
  );

  const filteredSubCategories = useMemo(() => {
    if (state.categoryIds.length === 0) return subCategories;
    return subCategories.filter((sc) => state.categoryIds.includes(sc.categoryId));
  }, [subCategories, state.categoryIds]);

  const availableCompositions = useMemo(() => {
    const used = new Set(state.compositions.map((c) => c.compositionId));
    return compositions.filter((c) => !used.has(c.id));
  }, [compositions, state.compositions]);

  const compositionOptions = useMemo(
    () => [
      { value: "", label: "Ajouter une composition…" },
      ...availableCompositions.map((c) => ({ value: c.id, label: c.name })),
    ],
    [availableCompositions],
  );

  const compositionById = useMemo(() => {
    const m = new Map(compositions.map((c) => [c.id, c.name]));
    return m;
  }, [compositions]);

  return (
    <div className="bg-bg-primary border border-border rounded-2xl shadow-sm p-5 space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-heading font-semibold text-text-primary text-sm">
            Peuplement automatique
          </h2>
          <p className="text-xs text-text-muted font-body mt-1">
            Les produits qui correspondent à tous les critères sont ajoutés automatiquement.
          </p>
        </div>
        {hasRule && (
          <span className="inline-flex items-center gap-1.5 shrink-0 text-[10px] font-body font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Règle active
          </span>
        )}
      </div>

      {/* ── Saison ────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-text-muted uppercase tracking-wide font-body mb-1.5">
          Saison
        </label>
        <CustomSelect
          value={state.seasonId ?? ""}
          onChange={(v) => update("seasonId", v || null)}
          options={seasonOptions}
          size="sm"
        />
      </div>

      {/* ── Catégories ─────────────────────────────────────────────────── */}
      <MultiPicker
        label="Catégories"
        helper="Le produit doit être dans une de ces catégories."
        options={categories}
        selected={state.categoryIds}
        placeholder="Ajouter une catégorie…"
        onAdd={(id) => update("categoryIds", [...state.categoryIds, id])}
        onRemove={(id) => update("categoryIds", state.categoryIds.filter((x) => x !== id))}
      />

      {/* ── Sous-catégories ──────────────────────────────────────────── */}
      <MultiPicker
        label="Sous-catégories"
        helper="Le produit doit avoir au moins une de ces sous-catégories."
        options={filteredSubCategories}
        selected={state.subCategoryIds}
        placeholder="Ajouter une sous-catégorie…"
        onAdd={(id) => update("subCategoryIds", [...state.subCategoryIds, id])}
        onRemove={(id) =>
          update("subCategoryIds", state.subCategoryIds.filter((x) => x !== id))
        }
        emptyOptionsMessage={
          state.categoryIds.length > 0
            ? "Aucune sous-catégorie disponible pour les catégories choisies."
            : undefined
        }
      />

      {/* ── Tags ────────────────────────────────────────────────────── */}
      <MultiPicker
        label="Mots-clés"
        helper="Le produit doit avoir au moins un de ces mots-clés."
        options={tags}
        selected={state.tagIds}
        placeholder="Ajouter un mot-clé…"
        onAdd={(id) => update("tagIds", [...state.tagIds, id])}
        onRemove={(id) => update("tagIds", state.tagIds.filter((x) => x !== id))}
      />

      {/* ── Compositions ─────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-text-muted uppercase tracking-wide font-body mb-1.5">
          Compositions (matière)
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Chaque ligne doit être présente sur le produit. Le % minimum est facultatif.
        </p>

        {state.compositions.length > 0 && (
          <ul className="space-y-2 mb-2">
            {state.compositions.map((c) => (
              <li
                key={c.compositionId}
                className="flex items-center gap-2 bg-bg-secondary border border-border rounded-xl px-3 py-2"
              >
                <span className="flex-1 text-sm text-text-primary font-body truncate">
                  {compositionById.get(c.compositionId) ?? c.compositionId}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={c.minPercent ?? ""}
                    onChange={(e) => updateCompositionPercent(c.compositionId, e.target.value)}
                    placeholder="%"
                    className="w-14 text-center text-sm border border-border rounded-lg py-1 text-text-primary font-body bg-bg-primary focus:outline-none focus:border-bg-dark [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-text-muted font-body">min.</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeComposition(c.compositionId)}
                  className="shrink-0 p-1 text-text-muted hover:text-red-600"
                  title="Retirer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        {availableCompositions.length > 0 && (
          <CustomSelect
            value=""
            onChange={addComposition}
            options={compositionOptions}
            size="sm"
            searchable
          />
        )}
      </div>

      {/* ── Compteur preview + boutons ──────────────────────────────── */}
      <div className="pt-3 border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-body text-text-muted">
            {isRuleEmpty(state) ? (
              <span>Aucun critère : la règle est vide.</span>
            ) : previewCount === null ? (
              <span>Calcul…</span>
            ) : (
              <span>
                <strong className="text-text-primary">{previewCount}</strong> produit(s) en ligne
                correspondrai(en)t à cette règle.
              </span>
            )}
          </div>
          {lastRecalculatedAt && (
            <div className="text-[10px] text-text-muted font-body">
              Dernier recalcul {new Date(lastRecalculatedAt).toLocaleString("fr-FR")}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || (!dirty && hasRule) || isRuleEmpty(state)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-dark text-text-inverse text-sm font-medium font-body hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {hasRule ? "Enregistrer la règle" : "Créer la règle"}
          </button>
          {hasRule && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-red-700 text-sm font-medium font-body hover:bg-red-50 transition-all disabled:opacity-50"
            >
              Supprimer la règle
            </button>
          )}
        </div>
      </div>

      {/* ── Exclusions manuelles ────────────────────────────────────── */}
      {exclusions.length > 0 && (
        <div className="pt-4 border-t border-border">
          <button
            type="button"
            onClick={() => setShowExclusions((v) => !v)}
            className="w-full flex items-center justify-between text-left text-xs font-body font-medium text-text-muted uppercase tracking-wide hover:text-text-primary"
          >
            <span>Exclus manuellement ({exclusions.length})</span>
            <svg
              className={`w-4 h-4 transition-transform ${showExclusions ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showExclusions && (
            <ul className="mt-3 space-y-1.5">
              {exclusions.map((e) => (
                <li
                  key={e.productId}
                  className="flex items-center gap-2 bg-bg-secondary border border-border rounded-xl px-3 py-2 text-sm font-body"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary truncate">{e.name}</p>
                    <p className="text-xs text-text-muted font-mono">{e.reference}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await reincludeProductInCollection(collectionId, e.productId);
                        if (!res.success) {
                          toast.error("Impossible de lever l'exclusion");
                          return;
                        }
                        toast.success("Exclusion levée");
                        router.refresh();
                      })
                    }
                    disabled={isPending}
                    className="shrink-0 text-xs px-2 py-1 rounded-lg border border-border text-text-primary hover:bg-bg-primary transition-colors"
                  >
                    Réinclure
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Multi-picker sous-composant ────────────────────────────────────────
// Trigger cliquable qui affiche un panneau flottant (portalisé) avec un
// champ de recherche et la liste des options en cases à cocher. La cliente
// peut cocher plusieurs items d'affilée sans réouvrir le menu ; fermeture
// par clic extérieur ou Échap. Adapté aux listes longues (centaines d'items).

function MultiPicker({
  label,
  helper,
  options,
  selected,
  placeholder,
  onAdd,
  onRemove,
  emptyOptionsMessage,
}: {
  label: string;
  helper?: string;
  options: Option[];
  selected: string[];
  placeholder: string;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  emptyOptionsMessage?: string;
}) {
  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Positionnement du panneau flottant sous le trigger. Recalé en continu
  // sur scroll/resize pour rester collé au bouton même quand la cliente
  // scrolle la page (sinon le panneau, en `position: fixed`, resterait figé
  // dans la fenêtre pendant que le trigger défile avec le reste).
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const measure = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    measure();
    // Focus dans la recherche à l'ouverture.
    requestAnimationFrame(() => searchRef.current?.focus());
    // `capture: true` pour attraper les scrolls des conteneurs internes
    // (panneau admin scrollable, drawers, etc.) et pas juste window.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  // Fermeture au clic extérieur / Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Empêche la molette de scroller la page quand la souris est sur le panneau.
  // React attache `onWheel` en passive par défaut → preventDefault() ne
  // marcherait pas. On passe donc par un listener natif { passive: false }.
  // Comportement : deltaY est reporté manuellement sur le scroll de la liste.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const onWheel = (e: WheelEvent) => {
      const list = listRef.current;
      if (list) {
        list.scrollTop += e.deltaY;
      }
      e.preventDefault();
    };
    panel.addEventListener("wheel", onWheel, { passive: false });
    return () => panel.removeEventListener("wheel", onWheel);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  const noOptions = options.length === 0;
  const triggerLabel =
    selected.length === 0
      ? placeholder
      : `${selected.length} sélectionné${selected.length > 1 ? "s" : ""}`;

  return (
    <div>
      <label className="block text-xs font-medium text-text-muted uppercase tracking-wide font-body mb-1.5">
        {label}
      </label>
      {helper && <p className="text-xs text-text-muted font-body mb-2">{helper}</p>}

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((id) => (
            <li
              key={id}
              className="inline-flex items-center gap-1 bg-bg-secondary border border-border rounded-lg pl-2.5 pr-1 py-1 text-xs font-body text-text-primary"
            >
              <span className="truncate max-w-[180px]">{optionById.get(id) ?? id}</span>
              <button
                type="button"
                onClick={() => onRemove(id)}
                className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-red-600"
                title="Retirer"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {noOptions ? (
        <p className="text-xs text-text-muted italic font-body">
          {emptyOptionsMessage ?? "Aucun élément disponible."}
        </p>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full h-9 flex items-center justify-between gap-2 px-3 rounded-xl border border-border bg-bg-primary hover:border-text-muted transition-colors text-sm font-body text-left"
        >
          <span className={selected.length === 0 ? "text-text-muted" : "text-text-primary"}>
            {triggerLabel}
          </span>
          <svg
            className={`w-4 h-4 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {mounted && open && pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
            className="bg-bg-primary border border-border rounded-xl shadow-lg overflow-hidden"
          >
            <div className="p-2 border-b border-border">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher…"
                className="w-full h-8 px-2 text-sm font-body bg-bg-secondary rounded-lg border border-transparent focus:outline-none focus:border-border"
              />
            </div>
            <ul ref={listRef} className="max-h-64 overflow-y-auto py-1 [overscroll-behavior:contain]">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-xs text-text-muted italic font-body">
                  Aucun résultat.
                </li>
              ) : (
                filtered.map((o) => {
                  const checked = selectedSet.has(o.id);
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => (checked ? onRemove(o.id) : onAdd(o.id))}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm font-body text-left hover:bg-bg-secondary"
                      >
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                            checked
                              ? "bg-bg-dark border-bg-dark text-text-inverse"
                              : "bg-bg-primary border-border"
                          }`}
                        >
                          {checked && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <span className="flex-1 truncate text-text-primary">{o.name}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            {selected.length > 0 && (
              <div className="px-3 py-1.5 border-t border-border bg-bg-secondary flex items-center justify-between">
                <span className="text-[11px] text-text-muted font-body">
                  {selected.length} sélectionné{selected.length > 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => selected.forEach((id) => onRemove(id))}
                  className="text-[11px] font-body text-red-600 hover:underline"
                >
                  Tout décocher
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
