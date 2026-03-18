"use client";

import { useState, useTransition } from "react";
import { updateProductDisplayConfig } from "@/app/actions/admin/site-config";
import type {
  ProductDisplayConfig as Config,
  DisplaySection,
  DisplaySectionType,
  HomepageCarousel,
} from "@/lib/product-display";

// ─── Constants ──────────────────────────────────────────────────────────────────

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

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  config: Config;
  categories: { id: string; name: string }[];
  collections: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function ProductDisplayConfig({ config, categories, collections, tags }: Props) {
  const [mode, setMode]               = useState<"date" | "custom">(config.catalogMode);
  const [sections, setSections]       = useState<DisplaySection[]>(config.sections);
  const [homepageEnabled, setHomepageEnabled] = useState(config.homepageCarousels.length > 0);
  const [carousels, setCarousels]     = useState<HomepageCarousel[]>(config.homepageCarousels);
  const [isPending, startTransition]  = useTransition();
  const [message, setMessage]         = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addCarouselOpen, setAddCarouselOpen] = useState(false);

  // ─── Section CRUD ───────────────────────────────────────────────────────────

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

  // ─── Carousel CRUD ─────────────────────────────────────────────────────────

  function addCarousel(type: HomepageCarousel["type"]) {
    const defaultTitles: Record<string, string> = {
      new: "Nouveautés", bestseller: "Best sellers",
      category: categories[0]?.name ?? "Catégorie",
      collection: "Collection", tag: tags[0]?.name ?? "Mot-clé",
    };
    setCarousels(prev => [...prev, {
      id: genId(),
      type,
      title: defaultTitles[type] ?? type,
      quantity: 20,
      ...(type === "category"   && { categoryId: categories[0]?.id ?? "", categoryName: categories[0]?.name ?? "" }),
      ...(type === "collection" && { collectionIds: [] as string[], collectionNames: [] as string[] }),
      ...(type === "tag"        && { tagId: tags[0]?.id ?? "", tagName: tags[0]?.name ?? "" }),
    }]);
    setAddCarouselOpen(false);
  }

  function removeCarousel(id: string) {
    setCarousels(prev => prev.filter(c => c.id !== id));
  }

  function moveCarousel(id: string, dir: "up" | "down") {
    setCarousels(prev => {
      const idx = prev.findIndex(c => c.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = dir === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  function updateCarousel(id: string, updates: Partial<HomepageCarousel>) {
    setCarousels(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }

  // ─── Collection toggle helper ──────────────────────────────────────────────

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

  // ─── Save ──────────────────────────────────────────────────────────────────

  function handleSave() {
    startTransition(async () => {
      const newConfig: Config = {
        catalogMode: mode,
        sections: mode === "custom" ? sections : [],
        homepageCarousels: homepageEnabled ? carousels : [],
      };
      const result = await updateProductDisplayConfig(newConfig);
      setMessage(result.success
        ? { type: "success", text: "Configuration enregistrée." }
        : { type: "error",   text: result.error ?? "Erreur." }
      );
      setTimeout(() => setMessage(null), 4000);
    });
  }

  // ─── Render helpers ────────────────────────────────────────────────────────

  function sectionLabel(type: DisplaySectionType) {
    return SECTION_TYPES.find(t => t.value === type)?.label ?? type;
  }
  function sectionIcon(type: DisplaySectionType) {
    return SECTION_TYPES.find(t => t.value === type)?.icon ?? "";
  }

  // ─── Render: Section card ─────────────────────────────────────────────────

  function renderSection(section: DisplaySection, index: number) {
    return (
      <div key={section.id} className="border border-[#E5E5E5] rounded-xl bg-[#FAFAFA] p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">{sectionIcon(section.type)}</span>
            <span className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
              {index + 1}. {sectionLabel(section.type)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => moveSection(section.id, "up")}
              disabled={index === 0}
              className="p-1 rounded hover:bg-[#E5E5E5] disabled:opacity-30 transition-colors"
              title="Monter"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => moveSection(section.id, "down")}
              disabled={index === sections.length - 1}
              className="p-1 rounded hover:bg-[#E5E5E5] disabled:opacity-30 transition-colors"
              title="Descendre"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => removeSection(section.id)}
              className="p-1 rounded hover:bg-[#FEE2E2] text-[#EF4444] transition-colors"
              title="Supprimer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Quantity */}
          <div>
            <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Quantité</label>
            <input
              type="number"
              min={1}
              max={100}
              value={section.quantity}
              onChange={e => updateSection(section.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
              className="field-input w-20 !py-1.5 text-sm"
            />
          </div>

          {/* Category selector */}
          {section.type === "category" && (
            <>
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Catégorie</label>
                <select
                  value={section.categoryId ?? ""}
                  onChange={e => {
                    const cat = categories.find(c => c.id === e.target.value);
                    updateSection(section.id, { categoryId: e.target.value, categoryName: cat?.name ?? "" });
                  }}
                  className="field-input !py-1.5 text-sm"
                >
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Tri</label>
                <select
                  value={section.sortBy ?? "random"}
                  onChange={e => updateSection(section.id, { sortBy: e.target.value as "new" | "bestseller" | "random" })}
                  className="field-input !py-1.5 text-sm"
                >
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Collection multi-select */}
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

          {/* Tag selector */}
          {section.type === "tag" && (
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Mot-clé</label>
              <select
                value={section.tagId ?? ""}
                onChange={e => {
                  const tag = tags.find(t => t.id === e.target.value);
                  updateSection(section.id, { tagId: e.target.value, tagName: tag?.name ?? "" });
                }}
                className="field-input !py-1.5 text-sm"
              >
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Render: Carousel card ────────────────────────────────────────────────

  function renderCarousel(carousel: HomepageCarousel, index: number) {
    return (
      <div key={carousel.id} className="border border-[#E5E5E5] rounded-xl bg-[#FAFAFA] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
            {index + 1}. {carousel.title}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => moveCarousel(carousel.id, "up")} disabled={index === 0}
              className="p-1 rounded hover:bg-[#E5E5E5] disabled:opacity-30 transition-colors" title="Monter">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
              </svg>
            </button>
            <button type="button" onClick={() => moveCarousel(carousel.id, "down")} disabled={index === carousels.length - 1}
              className="p-1 rounded hover:bg-[#E5E5E5] disabled:opacity-30 transition-colors" title="Descendre">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            <button type="button" onClick={() => removeCarousel(carousel.id)}
              className="p-1 rounded hover:bg-[#FEE2E2] text-[#EF4444] transition-colors" title="Supprimer">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* Type */}
          <div>
            <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Type</label>
            <select
              value={carousel.type}
              onChange={e => updateCarousel(carousel.id, { type: e.target.value as HomepageCarousel["type"] })}
              className="field-input !py-1.5 text-sm"
            >
              {SECTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Title */}
          <div className="flex-1 min-w-[120px]">
            <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Titre</label>
            <input
              type="text"
              value={carousel.title}
              onChange={e => updateCarousel(carousel.id, { title: e.target.value })}
              className="field-input !py-1.5 text-sm"
            />
          </div>

          {/* Quantity */}
          <div>
            <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Quantité</label>
            <input
              type="number"
              min={1}
              max={50}
              value={carousel.quantity}
              onChange={e => updateCarousel(carousel.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
              className="field-input w-20 !py-1.5 text-sm"
            />
          </div>

          {/* Category */}
          {carousel.type === "category" && (
            <div className="min-w-[140px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Catégorie</label>
              <select
                value={carousel.categoryId ?? ""}
                onChange={e => {
                  const cat = categories.find(c => c.id === e.target.value);
                  updateCarousel(carousel.id, { categoryId: e.target.value, categoryName: cat?.name ?? "" });
                }}
                className="field-input !py-1.5 text-sm"
              >
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* Collection multi-select */}
          {carousel.type === "collection" && (
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
                Collections ({carousel.collectionIds?.length ?? 0})
              </label>
              <div className="border border-[#E5E5E5] rounded-lg max-h-28 overflow-auto bg-white">
                {collections.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#F7F7F8] cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={carousel.collectionIds?.includes(c.id) ?? false}
                      onChange={() => {
                        const toggled = toggleCollection(carousel.collectionIds, carousel.collectionNames, c.id, c.name);
                        updateCarousel(carousel.id, toggled);
                      }}
                      className="accent-[#1A1A1A]"
                    />
                    <span className="text-[#1A1A1A] font-[family-name:var(--font-roboto)]">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Tag */}
          {carousel.type === "tag" && (
            <div className="min-w-[140px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Mot-clé</label>
              <select
                value={carousel.tagId ?? ""}
                onChange={e => {
                  const tag = tags.find(t => t.id === e.target.value);
                  updateCarousel(carousel.id, { tagId: e.target.value, tagName: tag?.name ?? "" });
                }}
                className="field-input !py-1.5 text-sm"
              >
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Mode selector ─────────────────────────────────────────────────── */}
      <div>
        <p className="field-label mb-3">Mode d&apos;affichage du catalogue</p>
        <div className="space-y-2.5">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="radio"
              name="displayMode"
              checked={mode === "date"}
              onChange={() => setMode("date")}
              className="mt-1 accent-[#1A1A1A]"
            />
            <div>
              <span className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)] group-hover:underline">
                Par date
              </span>
              <p className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
                Du plus récent au plus ancien (comportement par défaut)
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="radio"
              name="displayMode"
              checked={mode === "custom"}
              onChange={() => setMode("custom")}
              className="mt-1 accent-[#1A1A1A]"
            />
            <div>
              <span className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)] group-hover:underline">
                Personnalisé
              </span>
              <p className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
                Définir des sections prioritaires (nouveautés, best sellers, catégories, collections, mots-clés)
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* ── Sections (custom mode) ────────────────────────────────────────── */}
      {mode === "custom" && (
        <div className="space-y-3">
          <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
            Sections prioritaires
          </h3>

          {sections.length === 0 && (
            <p className="text-sm text-[#6B6B6B] italic font-[family-name:var(--font-roboto)]">
              Aucune section définie. Tous les produits s&apos;afficheront aléatoirement.
            </p>
          )}

          {sections.map((s, i) => renderSection(s, i))}

          {/* Info band */}
          <div className="flex items-center gap-2 bg-[#F0F7FF] border border-[#BFDBFE] rounded-lg px-4 py-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#3B82F6] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <p className="text-xs text-[#1E40AF] font-[family-name:var(--font-roboto)]">
              Les produits restants s&apos;afficheront dans un ordre aléatoire, renouvelé chaque jour.
              Un produit n&apos;apparaît qu&apos;une seule fois (pas de doublons entre sections).
            </p>
          </div>

          {/* Add section dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAddMenuOpen(!addMenuOpen)}
              className="btn-secondary text-sm flex items-center gap-2"
            >
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
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => addSection(t.value)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-[#F7F7F8] font-[family-name:var(--font-roboto)] flex items-center gap-2"
                    >
                      <span>{t.icon}</span> {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Homepage carousels ────────────────────────────────────────────── */}
      <div className="border-t border-[#E5E5E5] pt-6 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={homepageEnabled}
            onChange={e => setHomepageEnabled(e.target.checked)}
            className="mt-1 accent-[#1A1A1A]"
          />
          <div>
            <span className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
              Personnaliser les carrousels de la page d&apos;accueil
            </span>
            <p className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
              Par défaut : Réassort + Nouveautés + Best Sellers. Le réassort et la grille de collections restent toujours visibles.
            </p>
          </div>
        </label>

        {homepageEnabled && (
          <div className="space-y-3 pl-7">
            {carousels.length === 0 && (
              <p className="text-sm text-[#6B6B6B] italic font-[family-name:var(--font-roboto)]">
                Aucun carrousel configuré. Ajoutez-en pour remplacer l&apos;affichage par défaut.
              </p>
            )}

            {carousels.map((c, i) => renderCarousel(c, i))}

            {/* Add carousel dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAddCarouselOpen(!addCarouselOpen)}
                className="btn-secondary text-sm flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Ajouter un carrousel
              </button>
              {addCarouselOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAddCarouselOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-[#E5E5E5] rounded-lg shadow-lg py-1 min-w-[180px]">
                    {SECTION_TYPES.filter(t => t.value !== "random").map(t => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => addCarousel(t.value as HomepageCarousel["type"])}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-[#F7F7F8] font-[family-name:var(--font-roboto)] flex items-center gap-2"
                      >
                        <span>{t.icon}</span> {t.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Save ──────────────────────────────────────────────────────────── */}
      <div className="border-t border-[#E5E5E5] pt-6 flex items-center gap-4">
        <button type="button" onClick={handleSave} disabled={isPending} className="btn-primary">
          {isPending ? "Enregistrement..." : "Enregistrer la configuration"}
        </button>
        {message && (
          <p className={`text-sm font-[family-name:var(--font-roboto)] ${
            message.type === "success" ? "text-[#22C55E]" : "text-[#EF4444]"
          }`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
