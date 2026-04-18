"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/Toast";
import { updateCategoryPfsTaxonomy } from "@/app/actions/admin/categories";
import { updateColorPfsRef } from "@/app/actions/admin/colors";
import { updateCompositionPfsRef } from "@/app/actions/admin/compositions";
import { updateManufacturingCountryPfsRef } from "@/app/actions/admin/manufacturing-countries";
import { updateSeasonPfsRef } from "@/app/actions/admin/seasons";
import { toggleSizePfsMapping } from "@/app/actions/admin/sizes";

// ─────────────────────────────────────────────
// Types (match page.tsx shape)
// ─────────────────────────────────────────────

interface PfsFamilyOption { gender: string; family: string }
interface PfsCategoryOption { gender: string; family: string; category: string }

interface AnnexesProp {
  families: PfsFamilyOption[];
  categories: PfsCategoryOption[];
  colors: string[];
  compositions: string[];
  countries: string[];
  sizes: string[];
}

interface BjCategory { id: string; name: string; pfsGender: string | null; pfsFamilyName: string | null }
interface BjColor { id: string; name: string; hex: string | null; patternImage: string | null; pfsColorRef: string | null }
interface BjComposition { id: string; name: string; pfsCompositionRef: string | null }
interface BjCountry { id: string; name: string; isoCode: string | null; pfsCountryRef: string | null }
interface BjSeason { id: string; name: string; pfsRef: string | null }
interface BjSize { id: string; name: string; pfsRefs: string[] }

interface Props {
  annexes: AnnexesProp;
  data: {
    categories: BjCategory[];
    colors: BjColor[];
    compositions: BjComposition[];
    countries: BjCountry[];
    seasons: BjSeason[];
    sizes: BjSize[];
  };
}

type TabKey = "categories" | "colors" | "compositions" | "countries" | "seasons" | "sizes";

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: "categories",   label: "Catégories",   hint: "Genre + Famille PFS" },
  { key: "colors",       label: "Couleurs",     hint: "Nom de couleur PFS" },
  { key: "compositions", label: "Matières",     hint: "Composition PFS" },
  { key: "countries",    label: "Pays",         hint: "Pays de fabrication PFS" },
  { key: "seasons",      label: "Saisons",      hint: "AH2025, PE2026…" },
  { key: "sizes",        label: "Tailles",      hint: "Libellé PFS (TU, XS, 38…)" },
];

const GENDER_OPTIONS: SelectOption[] = [
  { value: "", label: "— Non défini —" },
  { value: "WOMAN", label: "Femme" },
  { value: "MAN", label: "Homme" },
  { value: "KID", label: "Enfant" },
  { value: "SUPPLIES", label: "Lifestyle / Fournitures" },
];

const GENDER_FR_FROM_CODE: Record<string, string> = {
  WOMAN: "Femme",
  MAN: "Homme",
  KID: "Enfant",
  SUPPLIES: "Lifestyle_et_Plus",
};
const GENDER_CODE_FROM_FR: Record<string, string> = Object.fromEntries(
  Object.entries(GENDER_FR_FROM_CODE).map(([k, v]) => [v, k]),
);

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function toOptions(values: string[], placeholder = "— Non défini —"): SelectOption[] {
  return [{ value: "", label: placeholder }, ...values.map((v) => ({ value: v, label: v }))];
}

function completeness<T>(items: T[], pred: (x: T) => boolean): { done: number; total: number } {
  return { done: items.filter(pred).length, total: items.length };
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function PfsMappingClient({ annexes, data }: Props) {
  const [tab, setTab] = useState<TabKey>("categories");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  // Completeness per tab — drives the badges in the tab strip
  const stats = useMemo(() => ({
    categories:   completeness(data.categories,   (c) => !!c.pfsGender && !!c.pfsFamilyName),
    colors:       completeness(data.colors,       (c) => !!c.pfsColorRef),
    compositions: completeness(data.compositions, (c) => !!c.pfsCompositionRef),
    countries:    completeness(data.countries,    (c) => !!c.pfsCountryRef),
    seasons:      completeness(data.seasons,      (c) => !!c.pfsRef),
    sizes:        completeness(data.sizes,        (c) => c.pfsRefs.length > 0),
  }), [data]);

  async function runSave(id: string, fn: () => Promise<unknown>) {
    setSavingId(id);
    try {
      await fn();
      startTransition(() => router.refresh());
    } catch (err) {
      toast({ type: "error", title: "Erreur d'enregistrement", message: err instanceof Error ? err.message : undefined });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      {/* ── Progress + tabs strip ── */}
      <div className="bg-bg-primary border border-border rounded-2xl shadow-sm p-1.5 flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const s = stats[t.key];
          const pct = s.total === 0 ? 100 : Math.round((s.done / s.total) * 100);
          const complete = s.done === s.total;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setTab(t.key); setSearch(""); }}
              className={`shrink-0 px-4 py-2.5 rounded-xl font-body text-sm font-medium transition-colors flex items-center gap-2 ${
                active
                  ? "bg-bg-dark text-text-inverse"
                  : "text-text-secondary hover:bg-bg-secondary"
              }`}
            >
              <span>{t.label}</span>
              <span className={`badge text-[10px] ${
                active
                  ? "bg-white/15 text-white border-transparent"
                  : complete
                    ? "badge-success"
                    : "badge-warning"
              }`}>
                {s.done}/{s.total}
                {!complete && <span className="ml-1">· {pct}%</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Search bar ── */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Rechercher une ${TABS.find((t) => t.key === tab)?.label.toLowerCase().replace(/s$/, "") ?? "entrée"}…`}
          className="field-input w-full sm:w-[28rem]"
          style={{ paddingLeft: "2.25rem" }}
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      </div>

      {/* ── Tab content ── */}
      <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
        {tab === "categories" && (
          <CategoriesTab
            rows={data.categories.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))}
            annexes={annexes}
            savingId={savingId}
            onSave={(row, gender, family) =>
              runSave(row.id, () => updateCategoryPfsTaxonomy(row.id, gender || null, family || null))
            }
          />
        )}
        {tab === "colors" && (
          <SimpleTab
            title="Couleur BJ"
            annexTitle="Valeur PFS"
            options={toOptions(annexes.colors)}
            rows={data.colors
              .filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
              .map((c) => ({ id: c.id, name: c.name, value: c.pfsColorRef ?? "", meta: (
                <ColorSwatch hex={c.hex} pattern={c.patternImage} />
              ) }))}
            savingId={savingId}
            onSave={(id, value) => runSave(id, () => updateColorPfsRef(id, value || null))}
          />
        )}
        {tab === "compositions" && (
          <SimpleTab
            title="Matière BJ"
            annexTitle="Valeur PFS"
            options={toOptions(annexes.compositions)}
            rows={data.compositions
              .filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
              .map((c) => ({ id: c.id, name: c.name, value: c.pfsCompositionRef ?? "" }))}
            savingId={savingId}
            onSave={(id, value) => runSave(id, () => updateCompositionPfsRef(id, value || null))}
          />
        )}
        {tab === "countries" && (
          <SimpleTab
            title="Pays BJ"
            annexTitle="Valeur PFS"
            options={toOptions(annexes.countries)}
            rows={data.countries
              .filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
              .map((c) => ({
                id: c.id,
                name: c.name,
                value: c.pfsCountryRef ?? "",
                meta: c.isoCode ? <span className="badge badge-neutral text-[10px]">{c.isoCode}</span> : null,
              }))}
            savingId={savingId}
            onSave={(id, value) => runSave(id, () => updateManufacturingCountryPfsRef(id, value || null))}
          />
        )}
        {tab === "seasons" && (
          <SimpleTab
            title="Saison BJ"
            annexTitle="Valeur PFS"
            // Seasons aren't in ANNEXE sheets — admin types free-form (e.g. "AH2025")
            options={[]}
            freeText
            placeholder="Ex : AH2025, PE2026…"
            rows={data.seasons
              .filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
              .map((c) => ({ id: c.id, name: c.name, value: c.pfsRef ?? "" }))}
            savingId={savingId}
            onSave={(id, value) => runSave(id, () => updateSeasonPfsRef(id, value || null))}
          />
        )}
        {tab === "sizes" && (
          <SizesTab
            rows={data.sizes.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))}
            annexes={annexes}
            savingId={savingId}
            onToggle={(sizeId, pfsRef) => runSave(sizeId, () => toggleSizePfsMapping(sizeId, pfsRef))}
          />
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// Categories tab — Gender + Family (cascading)
// ─────────────────────────────────────────────

function CategoriesTab({
  rows, annexes, savingId, onSave,
}: {
  rows: BjCategory[];
  annexes: AnnexesProp;
  savingId: string | null;
  onSave: (row: BjCategory, gender: string, family: string) => void;
}) {
  if (rows.length === 0) return <EmptyRow label="catégorie" />;

  return (
    <table className="w-full text-sm font-body">
      <thead>
        <tr className="bg-bg-secondary border-b border-border">
          <Th>Catégorie</Th>
          <Th>Genre PFS</Th>
          <Th>Famille PFS</Th>
          <Th className="text-center w-24">État</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <CategoryRow key={row.id} row={row} annexes={annexes} saving={savingId === row.id} onSave={onSave} />
        ))}
      </tbody>
    </table>
  );
}

function CategoryRow({
  row, annexes, saving, onSave,
}: {
  row: BjCategory;
  annexes: AnnexesProp;
  saving: boolean;
  onSave: (row: BjCategory, gender: string, family: string) => void;
}) {
  const initialGenderFr = row.pfsGender ? (GENDER_FR_FROM_CODE[row.pfsGender] ?? row.pfsGender) : "";
  const [genderCode, setGenderCode] = useState(row.pfsGender ?? "");
  const [family, setFamily] = useState(row.pfsFamilyName ?? "");

  const genderFr = GENDER_FR_FROM_CODE[genderCode] ?? initialGenderFr;
  const families = useMemo(
    () => annexes.families.filter((f) => f.gender === genderFr).map((f) => f.family),
    [annexes.families, genderFr],
  );

  const ok = !!genderCode && !!family;

  function handleGender(v: string) {
    setGenderCode(v);
    // If current family no longer exists under new gender, reset it.
    const genderFrNew = GENDER_FR_FROM_CODE[v] ?? "";
    const allowed = annexes.families.filter((f) => f.gender === genderFrNew).map((f) => f.family);
    const nextFamily = allowed.includes(family) ? family : "";
    setFamily(nextFamily);
    onSave(row, v, nextFamily);
  }

  function handleFamily(v: string) {
    setFamily(v);
    onSave(row, genderCode, v);
  }

  return (
    <tr className="hover:bg-bg-secondary/30">
      <Td>
        <span className="font-medium text-text-primary">{row.name}</span>
      </Td>
      <Td>
        <CustomSelect
          value={genderCode}
          onChange={handleGender}
          options={GENDER_OPTIONS}
          size="sm"
          aria-label={`Genre PFS pour ${row.name}`}
          disabled={saving}
        />
      </Td>
      <Td>
        <CustomSelect
          value={family}
          onChange={handleFamily}
          options={toOptions(families)}
          size="sm"
          searchable
          disabled={!genderCode || saving}
          placeholder={genderCode ? "— Sélectionner —" : "Sélectionner un genre d'abord"}
          aria-label={`Famille PFS pour ${row.name}`}
          emptyMessage="Aucune famille pour ce genre"
        />
      </Td>
      <Td className="text-center">
        <StatusDot ok={ok} saving={saving} />
      </Td>
    </tr>
  );
}

// ─────────────────────────────────────────────
// Simple 1-select tab (colors, compositions, countries, seasons)
// ─────────────────────────────────────────────

interface SimpleRow {
  id: string;
  name: string;
  value: string;
  meta?: React.ReactNode;
}

function SimpleTab({
  title, annexTitle, options, rows, savingId, onSave, freeText, placeholder,
}: {
  title: string;
  annexTitle: string;
  options: SelectOption[];
  rows: SimpleRow[];
  savingId: string | null;
  onSave: (id: string, value: string) => void;
  freeText?: boolean;
  placeholder?: string;
}) {
  if (rows.length === 0) return <EmptyRow label={title.toLowerCase()} />;

  return (
    <table className="w-full text-sm font-body">
      <thead>
        <tr className="bg-bg-secondary border-b border-border">
          <Th>{title}</Th>
          <Th>{annexTitle}</Th>
          <Th className="text-center w-24">État</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <SimpleRowEl
            key={row.id}
            row={row}
            options={options}
            saving={savingId === row.id}
            onSave={onSave}
            freeText={freeText}
            placeholder={placeholder}
          />
        ))}
      </tbody>
    </table>
  );
}

function SimpleRowEl({
  row, options, saving, onSave, freeText, placeholder,
}: {
  row: SimpleRow;
  options: SelectOption[];
  saving: boolean;
  onSave: (id: string, value: string) => void;
  freeText?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(row.value);
  const ok = !!value.trim();

  return (
    <tr className="hover:bg-bg-secondary/30">
      <Td>
        <div className="flex items-center gap-2">
          {row.meta}
          <span className="font-medium text-text-primary">{row.name}</span>
        </div>
      </Td>
      <Td>
        {freeText ? (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => { if (value !== row.value) onSave(row.id, value.trim()); }}
            placeholder={placeholder}
            disabled={saving}
            className="field-input text-sm w-full max-w-xs disabled:opacity-60"
          />
        ) : (
          <CustomSelect
            value={value}
            onChange={(v) => { setValue(v); onSave(row.id, v); }}
            options={options}
            size="sm"
            searchable
            disabled={saving}
            aria-label={`Correspondance PFS pour ${row.name}`}
          />
        )}
      </Td>
      <Td className="text-center">
        <StatusDot ok={ok} saving={saving} />
      </Td>
    </tr>
  );
}

// ─────────────────────────────────────────────
// Sizes tab — multi-select (a BJ size can map to several PFS labels)
// ─────────────────────────────────────────────

function SizesTab({
  rows, annexes, savingId, onToggle,
}: {
  rows: BjSize[];
  annexes: AnnexesProp;
  savingId: string | null;
  onToggle: (sizeId: string, pfsRef: string) => void;
}) {
  if (rows.length === 0) return <EmptyRow label="taille" />;

  return (
    <table className="w-full text-sm font-body">
      <thead>
        <tr className="bg-bg-secondary border-b border-border">
          <Th>Taille BJ</Th>
          <Th>Libellés PFS associés</Th>
          <Th>Ajouter</Th>
          <Th className="text-center w-24">État</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <SizeRow key={row.id} row={row} annexes={annexes} saving={savingId === row.id} onToggle={onToggle} />
        ))}
      </tbody>
    </table>
  );
}

function SizeRow({
  row, annexes, saving, onToggle,
}: {
  row: BjSize;
  annexes: AnnexesProp;
  saving: boolean;
  onToggle: (sizeId: string, pfsRef: string) => void;
}) {
  const [toAdd, setToAdd] = useState("");
  const remaining = annexes.sizes.filter((s) => !row.pfsRefs.includes(s));
  const ok = row.pfsRefs.length > 0;

  function handleAdd(v: string) {
    if (!v) return;
    setToAdd("");
    onToggle(row.id, v);
  }

  return (
    <tr className="hover:bg-bg-secondary/30">
      <Td>
        <span className="font-medium text-text-primary">{row.name}</span>
      </Td>
      <Td>
        {row.pfsRefs.length === 0 ? (
          <span className="text-text-muted text-xs">—</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.pfsRefs.map((ref) => (
              <button
                key={ref}
                type="button"
                onClick={() => onToggle(row.id, ref)}
                disabled={saving}
                className="badge badge-purple text-[11px] gap-1 hover:bg-red-100 hover:text-red-700 hover:border-red-300 transition-colors disabled:opacity-60"
                title="Retirer cette correspondance"
              >
                {ref}
                <span className="text-[10px]">×</span>
              </button>
            ))}
          </div>
        )}
      </Td>
      <Td>
        <CustomSelect
          value={toAdd}
          onChange={handleAdd}
          options={toOptions(remaining, "+ Ajouter un libellé")}
          size="sm"
          searchable
          disabled={saving || remaining.length === 0}
          aria-label={`Ajouter un libellé PFS pour ${row.name}`}
        />
      </Td>
      <Td className="text-center">
        <StatusDot ok={ok} saving={saving} />
      </Td>
    </tr>
  );
}

// ─────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3 ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function StatusDot({ ok, saving }: { ok: boolean; saving: boolean }) {
  if (saving) {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 mx-auto">
        <span className="w-3 h-3 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mx-auto ${
        ok
          ? "bg-emerald-100 border border-emerald-300 text-emerald-700"
          : "bg-amber-100 border border-amber-300 text-amber-700"
      }`}
      title={ok ? "Mappé" : "Manquant"}
    >
      {ok ? "✓" : "⚠"}
    </span>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="text-sm text-text-muted font-body py-10 text-center">
      Aucune {label} à mapper.
    </div>
  );
}

function ColorSwatch({ hex, pattern }: { hex: string | null; pattern: string | null }) {
  if (pattern) {
    return (
      <span
        className="inline-block w-5 h-5 rounded border border-border shrink-0"
        style={{ backgroundImage: `url(${pattern})`, backgroundSize: "cover" }}
      />
    );
  }
  return (
    <span
      className="inline-block w-5 h-5 rounded border border-border shrink-0"
      style={{ backgroundColor: hex ?? "#E5E7EB" }}
    />
  );
}
