"use client";

/**
 * EfashionMappingPicker — variante embarquée (sans bouton, sans modale wrapper).
 *
 * Pensé pour vivre dans la sidebar « Correspondances Marketplaces » de
 * QuickCreateModal, juste sous le bloc PFS. Cohérent visuellement avec
 * MarketplaceMappingSection (utilise CustomSelect).
 *
 * Auto-save : à chaque changement, on appelle la server action update
 * correspondante. Pas de bouton « Enregistrer » — le pattern PFS (CustomSelect
 * + auto-save) est respecté.
 *
 * Pour les tailles (2 dropdowns dépendants), il y a un composant à part dans
 * SizesManager qui utilise le bouton autonome `EfashionMappingControl`.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CustomSelect from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/Toast";
import {
  loadEfashionAnnexes,
  updateCategoryEfashionMapping,
  updateManufacturingCountryEfashionMapping,
  updateSeasonEfashionMapping,
  updateCompositionEfashionMapping,
  updateColorEfashionMapping,
  addEfashionColorToVendor,
} from "@/app/actions/admin/efashion-mappings";
import type { EfashionAnnexes } from "@/lib/efashion-annexes";

export type EmbeddedPickerKind = "category" | "country" | "season" | "composition" | "color";

interface Props {
  /** ID de l'entité — REQUIS en mode auto-save (édition). Omis en mode contrôlé (création). */
  entityId?: string;
  kind: EmbeddedPickerKind;
  /** Valeur initiale (id eFashion actuellement lié, ou null). */
  initialValue: number | null;
  /** Libellé du label lié (récupéré côté serveur si possible) — purement décoratif. */
  initialLabel?: string | null;
  /** Désactivé pendant que la modale fait autre chose (loading global). */
  disabled?: boolean;
  /** Nom FR de l'entité — utilisé pour proposer un pré-remplissage automatique. */
  entityName?: string;
  /**
   * Mode contrôlé (création) : si fourni, on n'auto-save pas — on appelle
   * onChange à chaque modification et c'est au parent de stocker la valeur
   * pour la passer à la fonction de création.
   */
  onChange?: (value: number | null) => void;
}

// Cache process-level partagé avec EfashionMappingControl
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

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Top 3 best matches between `name` and a flat list of options. */
function suggestMatches(
  name: string | undefined,
  options: Array<{ id: number; label: string }>,
): Array<{ id: number; label: string; score: number }> {
  if (!name) return [];
  const norm = normalize(name);
  if (norm.length < 2) return [];
  const words = norm.split(/\s+/).filter((w) => w.length >= 2);
  const matches: Array<{ id: number; label: string; score: number }> = [];
  for (const opt of options) {
    const optNorm = normalize(opt.label);
    let score = 0;
    if (optNorm === norm) score = 100;
    else if (optNorm.endsWith(`> ${norm}`)) score = 90; // path leaf match
    else if (optNorm.includes(` ${norm} `) || optNorm.startsWith(`${norm} `)) score = 70;
    else if (optNorm.includes(norm)) score = 50;
    else {
      const matchedWords = words.filter((w) => optNorm.includes(w));
      if (matchedWords.length > 0) score = 20 + matchedWords.length * 10;
    }
    if (score > 0) matches.push({ id: opt.id, label: opt.label, score });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3);
}

export default function EfashionMappingPicker({
  entityId,
  kind,
  initialValue,
  initialLabel,
  disabled,
  entityName,
  onChange,
}: Props) {
  const toast = useToast();
  const router = useRouter();
  const [value, setValue] = useState<number | null>(initialValue);

  // Re-synchronise la valeur affichée si le parent passe une nouvelle valeur
  // initiale (ex : après router.refresh() qui repropage les props).
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);
  const [annexes, setAnnexes] = useState<EfashionAnnexes | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Charge les annexes pour tous les types — les compositions (~190) y sont
  // pré-chargées, plus besoin de l'autocomplete réseau.
  useEffect(() => {
    setLoading(true);
    ensureAnnexes()
      .then((data) => {
        if (data) setAnnexes(data);
        else
          setLoadError(
            "Listes eFashion indisponibles — vérifiez la connexion dans Paramètres > Marketplaces.",
          );
      })
      .finally(() => setLoading(false));
  }, [kind]);

  function saveValue(newValue: number | null) {
    setValue(newValue);
    // Mode contrôlé : on délègue au parent (création — pas d'entityId encore)
    if (onChange) {
      onChange(newValue);
      return;
    }
    // Mode auto-save : on a un entityId, on persiste immédiatement
    if (!entityId) return;
    const id = entityId;
    startTransition(async () => {
      let res;
      if (kind === "category") res = await updateCategoryEfashionMapping(id, newValue);
      else if (kind === "country") res = await updateManufacturingCountryEfashionMapping(id, newValue);
      else if (kind === "season") res = await updateSeasonEfashionMapping(id, newValue);
      else if (kind === "composition") res = await updateCompositionEfashionMapping(id, newValue);
      else res = await updateColorEfashionMapping(id, newValue);

      if (!res.success) {
        toast.error("Sauvegarde eFashion échouée", res.error ?? "Erreur inconnue");
        // Rollback visuel
        setValue(initialValue);
      } else {
        // Forcer le re-render du Server Component parent pour que la valeur
        // sauvegardée soit visible immédiatement (badge tableau, prochaine
        // réouverture de la modale).
        router.refresh();
      }
    });
  }

  if (loading) {
    return (
      <p className="text-xs text-text-muted font-body">Chargement des listes eFashion…</p>
    );
  }
  if (loadError) {
    return <p className="text-xs text-[#EF4444] font-body">{loadError}</p>;
  }

  // Options par type — dédoublonnées par `value` (CustomSelect utilise value
  // comme clé React, et certaines feuilles eFashion partagent le même id sous
  // plusieurs parents → on fusionne les paths au lieu de dupliquer).
  let options: { value: string; label: string }[] = [];
  if (annexes) {
    if (kind === "category") {
      const byId = new Map<number, string[]>();
      for (const c of annexes.categories) {
        if (!c.isLeaf) continue;
        const arr = byId.get(c.id) ?? [];
        arr.push(c.path);
        byId.set(c.id, arr);
      }
      options = Array.from(byId.entries()).map(([id, paths]) => ({
        value: String(id),
        label: paths.length > 1 ? `${paths[0]}  (+ ${paths.length - 1} autres)` : paths[0],
      }));
    } else if (kind === "country") {
      const seen = new Set<number>();
      options = annexes.provenances
        .filter((p) => !seen.has(p.id) && (seen.add(p.id), true))
        .map((p) => ({ value: String(p.id), label: p.libelle }));
    } else if (kind === "season") {
      const seen = new Set<number>();
      options = annexes.collections
        .filter((c) => !seen.has(c.id) && (seen.add(c.id), true))
        .map((c) => ({ value: String(c.id), label: c.label }));
    } else if (kind === "composition") {
      const seen = new Set<number>();
      options = annexes.compositions
        .filter((c) => !seen.has(c.id) && (seen.add(c.id), true))
        .map((c) => ({ value: String(c.id), label: c.label }));
    }
  }

  if (kind === "color") {
    if (loading) return <p className="text-xs text-text-muted font-body">Chargement des couleurs…</p>;
    if (loadError) return <p className="text-xs text-[#EF4444] font-body">{loadError}</p>;
    return (
      <ColorPicker
        annexes={annexes}
        currentId={value}
        entityName={entityName}
        disabled={disabled || isPending}
        onPick={saveValue}
      />
    );
  }

  // Pré-suggestions basées sur le nom FR pour catégorie / pays / saison / composition
  const suggestions = annexes && entityName
    ? suggestMatches(
        entityName,
        kind === "category"
          ? annexes.categories.filter((c) => c.isLeaf).map((c) => ({ id: c.id, label: c.path }))
          : kind === "country"
            ? annexes.provenances.map((p) => ({ id: p.id, label: p.libelle }))
            : kind === "composition"
              ? annexes.compositions
              : annexes.collections.map((c) => ({ id: c.id, label: c.label })),
      )
    : [];
  const showSuggestions = suggestions.length > 0;

  return (
    <div className="space-y-2">
      <CustomSelect
        value={value !== null ? String(value) : ""}
        onChange={(v) => saveValue(v ? Number(v) : null)}
        options={options}
        searchable
        size="sm"
        placeholder="Choisir une référence eFashion…"
        emptyMessage="Aucune référence disponible"
        disabled={!!disabled || isPending}
        aria-label={`Référence eFashion (${kind})`}
      />
      {showSuggestions && (
        <SuggestionsBox
          suggestions={suggestions}
          currentValue={value}
          onPick={saveValue}
          disabled={isPending}
        />
      )}
    </div>
  );
}

// ─── Boîte de suggestions (clic pour pré-remplir) ──────────────────────────

function SuggestionsBox({
  suggestions,
  currentValue,
  onPick,
  disabled,
}: {
  suggestions: Array<{ id: number; label: string; score: number }>;
  currentValue: number | null;
  onPick: (id: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10.5px] font-body text-text-muted flex items-center gap-1.5 uppercase tracking-wide">
        <svg className="w-3 h-3 text-[#8B5CF6]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Correspondance eFashion suggérée
      </p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => {
          const isSelected = s.id === currentValue;
          const isExact = s.score >= 100;
          return (
            <button
              key={`${s.id}::${s.label}`}
              type="button"
              onClick={() => onPick(s.id)}
              disabled={disabled}
              title={s.label}
              className={`inline-flex items-center gap-1 text-[11px] font-body rounded-full border px-2.5 py-1 transition-all cursor-pointer hover:shadow-sm disabled:opacity-50 text-left ${
                isSelected
                  ? "bg-[#DCFCE7] border-[#86EFAC] text-[#14532D]"
                  : "bg-bg-secondary border-border text-text-secondary hover:border-text-primary hover:text-text-primary"
              }`}
            >
              {isSelected ? (
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              )}
              <span className="font-semibold whitespace-normal break-words">{s.label}</span>
              <span className="shrink-0 text-[10px] opacity-70">id {s.id}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Picker complet pour Color (avec swatches + add-to-catalog) ──────────

function ColorPicker({
  annexes,
  currentId,
  entityName,
  disabled,
  onPick,
}: {
  annexes: EfashionAnnexes | null;
  currentId: number | null;
  entityName?: string;
  disabled?: boolean;
  onPick: (id: number | null) => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [addingId, setAddingId] = useState<number | null>(null);

  const colors: EfashionAnnexes["colors"] = annexes?.colors ?? [];
  const current = colors.find((c: EfashionAnnexes["colors"][number]) => c.id === currentId) ?? null;

  // Suggestions par nom FR
  const suggestions = useMemo(() => {
    if (!entityName) return [];
    const norm = normalize(entityName);
    if (norm.length < 2) return [];
    const matches: Array<{ color: typeof colors[number]; score: number }> = [];
    for (const c of colors) {
      const fr = normalize(c.fr);
      const en = normalize(c.en);
      let score = 0;
      if (fr === norm || en === norm) score = 100;
      else if (fr.includes(norm) || en.includes(norm)) score = 60;
      else if (norm.includes(fr)) score = 40;
      if (score > 0) matches.push({ color: c, score });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 3).map((m) => m.color);
  }, [colors, entityName]);

  const filtered = useMemo(() => {
    const norm = normalize(filter);
    if (!norm) return colors.slice(0, 200); // pas plus de 200 sans filtre — perf
    return colors.filter((c) => normalize(c.fr).includes(norm) || normalize(c.en).includes(norm)).slice(0, 200);
  }, [colors, filter]);

  async function ensureInCatalogAndPick(c: typeof colors[number]) {
    // Le serveur (createColorQuick / updateColorEfashionMapping) tente toujours
    // `addCouleurToVendeur` à la sauvegarde, donc côté UI on se contente de
    // poser le mapping. Le seul cas où on appelle directement ici, c'est en
    // mode contrôlé (création) où onChange est passé et la sauvegarde du
    // mapping arrive plus tard avec le bouton « Créer ».
    onPick(c.id);
    if (c.inVendorCatalog) return;
    // Best-effort pré-activation pour que le hex apparaisse plus rapidement
    setAddingId(c.id);
    try {
      const res = await addEfashionColorToVendor(c.id);
      if (res.success) {
        toast.success(`Couleur « ${c.fr} » ajoutée à votre catalogue eFashion`);
      }
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="space-y-2">
      {/* État courant */}
      {current && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-emerald-200 bg-emerald-50/60">
          <span
            className="w-5 h-5 rounded border border-border shrink-0"
            style={{ backgroundColor: current.hex ?? "#D1D5DB" }}
            title={current.hex ?? "Hex inconnu"}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-body font-medium text-text-primary truncate">
              {current.fr} {current.fr !== current.en && <span className="text-text-muted">({current.en})</span>}
            </p>
            <p className="text-[10px] font-body text-text-muted">id {current.id}{!current.inVendorCatalog && " · pas encore dans votre catalogue eFashion"}</p>
          </div>
          <button
            type="button"
            onClick={() => onPick(null)}
            disabled={disabled}
            className="text-[11px] text-[#DC2626] hover:underline font-body disabled:opacity-50"
          >
            Délier
          </button>
        </div>
      )}

      {/* Suggestions */}
      {!current && suggestions.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider font-body font-semibold text-emerald-700 mb-1.5">
            Suggestions détectées
          </p>
          <div className="flex flex-col gap-1">
            {suggestions.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => ensureInCatalogAndPick(c)}
                disabled={disabled || addingId === c.id}
                className="text-left flex items-center gap-2 px-2 py-1 rounded text-xs font-body bg-bg-primary hover:bg-emerald-100 border border-emerald-200 transition-colors disabled:opacity-50"
              >
                <span
                  className="w-4 h-4 rounded border border-border shrink-0"
                  style={{ backgroundColor: c.hex ?? "#D1D5DB" }}
                />
                <span className="flex-1 truncate text-text-primary">
                  {c.fr}
                  {c.fr !== c.en && <span className="text-text-muted ml-1">({c.en})</span>}
                </span>
                <span className="shrink-0 text-[10px] text-emerald-700">
                  {addingId === c.id ? "Ajout…" : `id ${c.id}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Champ de recherche */}
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`Rechercher dans ${colors.length} couleurs eFashion…`}
        className="w-full h-9 px-3 rounded-lg border border-border bg-bg-primary text-sm font-body"
        disabled={disabled}
      />

      {/* Liste */}
      <div className="max-h-60 overflow-y-auto rounded-lg border border-border bg-bg-primary divide-y divide-border">
        {filtered.length === 0 && (
          <p className="text-xs text-text-muted font-body p-3 text-center">
            Aucune couleur trouvée.
          </p>
        )}
        {filtered.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => ensureInCatalogAndPick(c)}
            disabled={disabled || addingId === c.id}
            className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs font-body hover:bg-bg-secondary transition-colors disabled:opacity-50 ${
              c.id === currentId ? "bg-emerald-50/60" : ""
            }`}
          >
            <span
              className="w-4 h-4 rounded border border-border shrink-0"
              style={{ backgroundColor: c.hex ?? "#D1D5DB" }}
              title={c.hex ?? "Hex inconnu"}
            />
            <span className="flex-1 truncate text-text-primary">
              {c.fr}
              {c.fr !== c.en && <span className="text-text-muted ml-1">({c.en})</span>}
            </span>
            <span className="shrink-0 text-[10px] text-text-muted">id {c.id}</span>
            {!c.inVendorCatalog && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                + ajout
              </span>
            )}
          </button>
        ))}
      </div>

      {filter === "" && colors.length > 200 && (
        <p className="text-[10px] text-text-muted font-body italic">
          Affichage limité à 200 — tapez quelque chose pour filtrer dans les {colors.length} couleurs.
        </p>
      )}
      <p className="text-[10px] text-text-muted font-body leading-relaxed">
        Les couleurs marquées « + ajout » seront automatiquement ajoutées à votre
        catalogue vendeur eFashion au moment où vous les sélectionnez.
      </p>
    </div>
  );
}

