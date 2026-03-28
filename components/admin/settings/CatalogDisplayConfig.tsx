"use client";

import { useState, useTransition } from "react";
import { updateCatalogDisplayConfig } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";
import type {
  DisplaySection,
  DisplaySectionType,
} from "@/lib/product-display-shared";

const SECTION_TYPES: { value: DisplaySectionType; label: string; icon: string }[] = [
  { value: "new",        label: "Nouveautés",   icon: "✨" },
  { value: "bestseller", label: "Best sellers", icon: "📈" },
  { value: "category",   label: "Catégorie",    icon: "🗂️" },
  { value: "collection", label: "Collections",  icon: "💎" },
  { value: "tag",        label: "Mot-clé",      icon: "🏷️" },
];

const SORT_OPTIONS = [
  { value: "new"        as const, label: "Plus récents" },
  { value: "bestseller" as const, label: "Meilleures ventes" },
  { value: "random"     as const, label: "Aléatoire" },
];

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

interface Props {
  initialMode: "date" | "custom";
  initialSections: DisplaySection[];
  categories: { id: string; name: string }[];
  collections: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

export default function CatalogDisplayConfig({ initialMode, initialSections, categories, collections, tags }: Props) {
  const [mode, setMode] = useState<"date" | "custom">(initialMode);
  const [sections, setSections] = useState<DisplaySection[]>(initialSections);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  function addSection(type: DisplaySectionType) {
    setSections(prev => [...prev, {
      id: genId(),
      type,
      quantity: 10,
      ...(type === "category"   && { categoryId: categories[0]?.id ?? "", categoryName: categories[0]?.name ?? "", sortBy: "random" as const }),
      ...(type === "collection" && { collectionIds: [] as string[], collectionNames: [] as string[] }),
      ...(type === "tag"        && { tagId: tags[0]?.id ?? "", tagName: tags[0]?.name ?? "" }),
    }]);
    setAddMenuOpen(false);
  }

  function removeSection(id: string) {
    setSections(prev => prev.filter(s => s.id !== id));
  }

  function moveSection(id: string, dir: "up" | "down") {
    setSections(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = dir === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  function updateSection(id: string, updates: Partial<DisplaySection>) {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }

  function toggleCollection(
    current: string[] | undefined,
    currentNames: string[] | undefined,
    collId: string,
    collName: string
  ): { collectionIds: string[]; collectionNames: string[] } {
    const ids   = [...(current ?? [])];
    const names = [...(currentNames ?? [])];
    const idx   = ids.indexOf(collId);
    if (idx >= 0) { ids.splice(idx, 1); names.splice(idx, 1); }
    else          { ids.push(collId); names.push(collName); }
    return { collectionIds: ids, collectionNames: names };
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateCatalogDisplayConfig(mode, mode === "custom" ? sections : []);
      if (result.success) {
        toast.success("Configuration catalogue enregistrée");
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  function sectionLabel(type: DisplaySectionType) {
    return SECTION_TYPES.find(t => t.value === type)?.label ?? type;
  }
  function sectionIcon(type: DisplaySectionType) {
    return SECTION_TYPES.find(t => t.value === type)?.icon ?? "";
  }

  function renderSection(section: DisplaySection, index: number) {
    return (
      <div key={section.id} className="border border-[#E5E5E5] rounded-xl bg-[#FAFAFA] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">{sectionIcon(section.type)}</span>
            <span className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
              {index + 1}. {sectionLabel(section.type)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => moveSection(section.id, "up")} disabled={index === 0}
              className="p-1 rounded hover:bg-[#E5E5E5] disabled:opacity-30 transition-colors" title="Monter">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
              </svg>
            </button>
            <button type="button" onClick={() => moveSection(section.id, "down")} disabled={index === sections.length - 1}
              className="p-1 rounded hover:bg-[#E5E5E5] disabled:opacity-30 transition-colors" title="Descendre">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            <button type="button" onClick={() => removeSection(section.id)}
              className="p-1 rounded hover:bg-[#FEE2E2] text-[#EF4444] transition-colors" title="Supprimer">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Quantité</label>
            <input
              type="number" min={1} max={100} value={section.quantity}
              onChange={e => updateSection(section.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
              className="field-input w-20 !py-1.5 text-sm"
            />
          </div>

          {section.type === "category" && (
            <>
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Catégorie</label>
                <CustomSelect
                  value={section.categoryId ?? ""}
                  onChange={v => {
                    const cat = categories.find(c => c.id === v);
                    updateSection(section.id, { categoryId: v, categoryName: cat?.name ?? "" });
                  }}
                  options={categories.map(c => ({ value: c.id, label: c.name }))}
                  size="sm"
                />
              </div>
              <div>
                <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Tri</label>
                <CustomSelect
                  value={section.sortBy ?? "random"}
                  onChange={v => updateSection(section.id, { sortBy: v as "new" | "bestseller" | "random" })}
                  options={SORT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                  size="sm"
                />
              </div>
            </>
          )}

          {section.type === "collection" && (
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
                Collections ({section.collectionIds?.length ?? 0} sélectionnée{(section.collectionIds?.length ?? 0) > 1 ? "s" : ""})
              </label>
              <div className="border border-[#E5E5E5] rounded-lg max-h-32 overflow-auto bg-white">
                {collections.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#F7F7F8] cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={section.collectionIds?.includes(c.id) ?? false}
                      onChange={() => {
                        const toggled = toggleCollection(section.collectionIds, section.collectionNames, c.id, c.name);
                        updateSection(section.id, toggled);
                      }}
                      className="accent-[#1A1A1A]"
                    />
                    <span className="text-[#1A1A1A] font-[family-name:var(--font-roboto)]">{c.name}</span>
                  </label>
                ))}
                {collections.length === 0 && (
                  <p className="text-xs text-[#6B6B6B] px-3 py-2 italic">Aucune collection</p>
                )}
              </div>
            </div>
          )}

          {section.type === "tag" && (
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Mot-clé</label>
              <CustomSelect
                value={section.tagId ?? ""}
                onChange={v => {
                  const tag = tags.find(t => t.id === v);
                  updateSection(section.id, { tagId: v, tagName: tag?.name ?? "" });
                }}
                options={tags.map(t => ({ value: t.id, label: t.name }))}
                size="sm"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div>
        <p className="field-label mb-3">Mode d&apos;affichage du catalogue</p>
        <div className="space-y-2.5">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input type="radio" name="displayMode" checked={mode === "date"} onChange={() => setMode("date")} className="mt-1 accent-[#1A1A1A]" />
            <div>
              <span className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)] group-hover:underline">Par date</span>
              <p className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Du plus récent au plus ancien (par défaut)</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer group">
            <input type="radio" name="displayMode" checked={mode === "custom"} onChange={() => setMode("custom")} className="mt-1 accent-[#1A1A1A]" />
            <div>
              <span className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)] group-hover:underline">Personnalisé</span>
              <p className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Sections prioritaires (nouveautés, best sellers, catégories...)</p>
            </div>
          </label>
        </div>
      </div>

      {/* Sections (custom mode) */}
      {mode === "custom" && (
        <div className="space-y-3">
          <h4 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">Sections prioritaires</h4>

          {sections.length === 0 && (
            <p className="text-sm text-[#6B6B6B] italic font-[family-name:var(--font-roboto)]">
              Aucune section. Affichage aléatoire.
            </p>
          )}

          {sections.map((s, i) => renderSection(s, i))}

          <div className="flex items-center gap-2 bg-[#F0F7FF] border border-[#BFDBFE] rounded-lg px-4 py-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#3B82F6] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <p className="text-xs text-[#1E40AF] font-[family-name:var(--font-roboto)]">
              Les produits restants s&apos;afficheront aléatoirement, renouvelés chaque jour. Pas de doublons.
            </p>
          </div>

          <div className="relative">
            <button type="button" onClick={() => setAddMenuOpen(!addMenuOpen)} className="btn-secondary text-sm flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Ajouter une section
            </button>
            {addMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAddMenuOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-[#E5E5E5] rounded-lg shadow-lg py-1 min-w-[180px]">
                  {SECTION_TYPES.map(t => (
                    <button key={t.value} type="button" onClick={() => addSection(t.value)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-[#F7F7F8] font-[family-name:var(--font-roboto)] flex items-center gap-2">
                      <span>{t.icon}</span> {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Save */}
      <div className="pt-4">
        <button type="button" onClick={handleSave} disabled={isPending} className="btn-primary">
          {isPending ? "Enregistrement..." : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
