"use client";

import { useState, useTransition, useCallback, useRef, useEffect } from "react";
import Image from "next/image";
import { updateHomepageCarouselsConfig, searchProductsForCarousel, getProductsByIds, type CarouselProductInfo } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";
import type {
  HomepageCarousel,
  CarouselType,
} from "@/lib/product-display-shared";
import { DEFAULT_CAROUSEL_IDS } from "@/lib/product-display-shared";

const CAROUSEL_TYPES: { value: CarouselType; label: string; icon: string }[] = [
  { value: "new",         label: "Nouveautés",      icon: "✨" },
  { value: "bestseller",  label: "Best sellers",    icon: "📈" },
  { value: "promo",       label: "Promotions",      icon: "🔥" },
  { value: "category",    label: "Catégorie",       icon: "🗂️" },
  { value: "subcategory", label: "Sous-catégorie",  icon: "📁" },
  { value: "collection",  label: "Collections",     icon: "💎" },
  { value: "tag",         label: "Mot-clé",         icon: "🏷️" },
  { value: "custom",      label: "Sélection manuelle", icon: "🎯" },
];

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function carouselLabel(type: CarouselType) {
  if (type === "reassort") return "Réassort";
  return CAROUSEL_TYPES.find(t => t.value === type)?.label ?? type;
}

function carouselIcon(type: CarouselType) {
  if (type === "reassort") return "🔄";
  return CAROUSEL_TYPES.find(t => t.value === type)?.icon ?? "";
}

// ─── Product Search for Custom Carousel ─────────────────────────────────────────

function ProductSearchPanel({
  selectedIds,
  onAdd,
  onRemove,
  onReorder,
}: {
  selectedIds: string[];
  onAdd: (product: { id: string; name: string; reference: string }) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CarouselProductInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [productsMap, setProductsMap] = useState<Map<string, CarouselProductInfo>>(new Map());
  const [loadingExisting, setLoadingExisting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current || selectedIds.length === 0) return;
    loadedRef.current = true;
    const unknownIds = selectedIds.filter(id => !productsMap.has(id));
    if (unknownIds.length === 0) return;
    setLoadingExisting(true);
    getProductsByIds(unknownIds).then(products => {
      setProductsMap(prev => {
        const next = new Map(prev);
        for (const p of products) next.set(p.id, p);
        return next;
      });
    }).finally(() => setLoadingExisting(false));
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await searchProductsForCarousel(q);
      setResults(res);
      setProductsMap(prev => {
        const next = new Map(prev);
        for (const p of res) next.set(p.id, p);
        return next;
      });
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  function moveProduct(idx: number, dir: "up" | "down") {
    const newIds = [...selectedIds];
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= newIds.length) return;
    [newIds[idx], newIds[swap]] = [newIds[swap], newIds[idx]];
    onReorder(newIds);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Rechercher par nom ou référence..." className="field-input !py-1.5 !pl-9 text-sm" />
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        {searching && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-[#D1D5DB] border-t-[#1A1A1A] rounded-full animate-spin" />
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="border border-[#E5E5E5] rounded-lg max-h-52 overflow-auto bg-white">
          {results.filter(r => !selectedIds.includes(r.id)).map(product => (
            <button key={product.id} type="button" onClick={() => onAdd(product)}
              className="w-full text-left px-3 py-2 hover:bg-[#F7F7F8] text-sm flex items-center gap-3 border-b border-[#F3F4F6] last:border-0">
              <div className="w-10 h-10 rounded-lg bg-[#F3F4F6] overflow-hidden flex-shrink-0">
                {product.image ? (
                  <Image src={product.image} alt="" width={40} height={40} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#1A1A1A] truncate">{product.name}</div>
                <div className="text-xs text-[#9CA3AF]">{product.reference} · {product.category}</div>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#22C55E] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          ))}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
            {selectedIds.length} produit{selectedIds.length > 1 ? "s" : ""} sélectionné{selectedIds.length > 1 ? "s" : ""}
          </label>
          {loadingExisting && (
            <div className="flex items-center gap-2 text-xs text-[#6B6B6B] py-2">
              <div className="w-3.5 h-3.5 border-2 border-[#D1D5DB] border-t-[#1A1A1A] rounded-full animate-spin" />
              Chargement...
            </div>
          )}
          <div className="border border-[#E5E5E5] rounded-lg bg-white divide-y divide-[#F3F4F6] max-h-64 overflow-auto">
            {selectedIds.map((id, idx) => {
              const info = productsMap.get(id);
              return (
                <div key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="w-10 h-10 rounded-lg bg-[#F3F4F6] overflow-hidden flex-shrink-0">
                    {info?.image ? (
                      <Image src={info.image} alt="" width={40} height={40} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#1A1A1A] truncate">{info?.name ?? "Chargement..."}</div>
                    <div className="text-xs text-[#9CA3AF]">{info ? `${info.reference} · ${info.category}` : id}</div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button type="button" onClick={() => moveProduct(idx, "up")} disabled={idx === 0}
                      className="p-1 rounded hover:bg-[#E5E5E5] disabled:opacity-30">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                    <button type="button" onClick={() => moveProduct(idx, "down")} disabled={idx === selectedIds.length - 1}
                      className="p-1 rounded hover:bg-[#E5E5E5] disabled:opacity-30">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                    <button type="button" onClick={() => onRemove(id)}
                      className="p-1 rounded hover:bg-[#FEE2E2] text-[#EF4444]">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  initialCarousels: HomepageCarousel[];
  categories: { id: string; name: string }[];
  subCategories: { id: string; name: string; categoryName: string }[];
  collections: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

export default function HomepageCarouselsConfig({ initialCarousels, categories, subCategories, collections, tags }: Props) {
  const [carousels, setCarousels] = useState<HomepageCarousel[]>(initialCarousels);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const [addCarouselOpen, setAddCarouselOpen] = useState(false);

  function addCarousel(type: CarouselType) {
    const defaultTitles: Record<string, string> = {
      new: "Nouveautés", bestseller: "Best sellers", promo: "Bonnes affaires",
      category: categories[0]?.name ?? "Catégorie",
      subcategory: subCategories[0]?.name ?? "Sous-catégorie",
      collection: "Collection", tag: tags[0]?.name ?? "Mot-clé",
      custom: "Ma sélection",
    };
    setCarousels(prev => [...prev, {
      id: genId(),
      type,
      title: defaultTitles[type] ?? type,
      quantity: 20,
      visible: true,
      ...(type === "category"    && { categoryId: categories[0]?.id ?? "", categoryName: categories[0]?.name ?? "" }),
      ...(type === "subcategory" && { subCategoryId: subCategories[0]?.id ?? "", subCategoryName: subCategories[0]?.name ?? "" }),
      ...(type === "collection"  && { collectionIds: [] as string[], collectionNames: [] as string[] }),
      ...(type === "tag"         && { tagId: tags[0]?.id ?? "", tagName: tags[0]?.name ?? "" }),
      ...(type === "custom"      && { productIds: [] as string[] }),
    }]);
    setAddCarouselOpen(false);
  }

  function removeCarousel(id: string) {
    if (DEFAULT_CAROUSEL_IDS.includes(id)) return;
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

  function toggleCarouselVisibility(id: string) {
    setCarousels(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c));
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
      const result = await updateHomepageCarouselsConfig(carousels);
      if (result.success) {
        toast.success("Carrousels enregistrés");
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  function renderCarousel(carousel: HomepageCarousel, index: number) {
    const isDefault = DEFAULT_CAROUSEL_IDS.includes(carousel.id);

    return (
      <div
        key={carousel.id}
        className={`border rounded-xl p-4 space-y-3 transition-colors ${
          carousel.visible
            ? "border-[#E5E5E5] bg-[#FAFAFA]"
            : "border-dashed border-[#D1D5DB] bg-[#F9FAFB] opacity-60"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">{carouselIcon(carousel.type)}</span>
            <span className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
              {index + 1}. {carousel.title}
            </span>
            {isDefault && <span className="badge badge-info text-[10px] px-1.5 py-0.5">Par défaut</span>}
            {!carousel.visible && <span className="badge badge-neutral text-[10px] px-1.5 py-0.5">Masqué</span>}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => toggleCarouselVisibility(carousel.id)}
              className={`p-1 rounded transition-colors ${carousel.visible ? "hover:bg-[#E5E5E5] text-[#1A1A1A]" : "hover:bg-[#DBEAFE] text-[#9CA3AF]"}`}
              title={carousel.visible ? "Masquer" : "Afficher"}>
              {carousel.visible ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              )}
            </button>
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
            {!isDefault && (
              <button type="button" onClick={() => removeCarousel(carousel.id)}
                className="p-1 rounded hover:bg-[#FEE2E2] text-[#EF4444] transition-colors" title="Supprimer">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {isDefault ? (
            <div>
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Type</label>
              <div className="field-input !py-1.5 text-sm bg-[#F3F4F6] cursor-not-allowed">
                {carouselLabel(carousel.type)}
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Type</label>
              <CustomSelect
                value={carousel.type}
                onChange={v => updateCarousel(carousel.id, { type: v as CarouselType })}
                options={CAROUSEL_TYPES.map(t => ({ value: t.value, label: `${t.icon} ${t.label}` }))}
                size="sm"
              />
            </div>
          )}

          <div className="flex-1 min-w-[120px]">
            <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Titre</label>
            <input type="text" value={carousel.title}
              onChange={e => updateCarousel(carousel.id, { title: e.target.value })}
              className="field-input !py-1.5 text-sm" />
          </div>

          {carousel.type !== "custom" && (
            <div>
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Quantité</label>
              <input type="number" min={1} max={50} value={carousel.quantity}
                onChange={e => updateCarousel(carousel.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                className="field-input w-20 !py-1.5 text-sm" />
            </div>
          )}

          {carousel.type === "category" && (
            <div className="min-w-[140px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Catégorie</label>
              <CustomSelect
                value={carousel.categoryId ?? ""}
                onChange={v => {
                  const cat = categories.find(c => c.id === v);
                  updateCarousel(carousel.id, { categoryId: v, categoryName: cat?.name ?? "" });
                }}
                options={categories.map(c => ({ value: c.id, label: c.name }))}
                size="sm"
              />
            </div>
          )}

          {carousel.type === "subcategory" && (
            <div className="min-w-[200px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Sous-catégorie</label>
              <CustomSelect
                value={carousel.subCategoryId ?? ""}
                onChange={v => {
                  const sub = subCategories.find(s => s.id === v);
                  updateCarousel(carousel.id, { subCategoryId: v, subCategoryName: sub?.name ?? "" });
                }}
                options={subCategories.map(s => ({ value: s.id, label: `${s.name} (${s.categoryName})` }))}
                size="sm"
              />
            </div>
          )}

          {carousel.type === "collection" && (
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
                Collections ({carousel.collectionIds?.length ?? 0})
              </label>
              <div className="border border-[#E5E5E5] rounded-lg max-h-28 overflow-auto bg-white">
                {collections.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#F7F7F8] cursor-pointer text-sm">
                    <input type="checkbox"
                      checked={carousel.collectionIds?.includes(c.id) ?? false}
                      onChange={() => {
                        const toggled = toggleCollection(carousel.collectionIds, carousel.collectionNames, c.id, c.name);
                        updateCarousel(carousel.id, toggled);
                      }}
                      className="accent-[#1A1A1A]" />
                    <span className="text-[#1A1A1A] font-[family-name:var(--font-roboto)]">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {carousel.type === "tag" && (
            <div className="min-w-[140px]">
              <label className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Mot-clé</label>
              <CustomSelect
                value={carousel.tagId ?? ""}
                onChange={v => {
                  const tag = tags.find(t => t.id === v);
                  updateCarousel(carousel.id, { tagId: v, tagName: tag?.name ?? "" });
                }}
                options={tags.map(t => ({ value: t.id, label: t.name }))}
                size="sm"
              />
            </div>
          )}
        </div>

        {carousel.type === "custom" && (
          <ProductSearchPanel
            selectedIds={carousel.productIds ?? []}
            onAdd={p => updateCarousel(carousel.id, { productIds: [...(carousel.productIds ?? []), p.id] })}
            onRemove={id => updateCarousel(carousel.id, { productIds: (carousel.productIds ?? []).filter(pid => pid !== id) })}
            onReorder={ids => updateCarousel(carousel.id, { productIds: ids })}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
        Gérez l&apos;ordre et la visibilité. Les 3 par défaut ne peuvent pas être supprimés.
      </p>

      <div className="space-y-3">
        {carousels.map((c, i) => renderCarousel(c, i))}
      </div>

      <div className="relative">
        <button type="button" onClick={() => setAddCarouselOpen(!addCarouselOpen)}
          className="btn-secondary text-sm flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Ajouter un carrousel
        </button>
        {addCarouselOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setAddCarouselOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-[#E5E5E5] rounded-lg shadow-lg py-1 min-w-[220px]">
              {CAROUSEL_TYPES.map(t => (
                <button key={t.value} type="button" onClick={() => addCarousel(t.value)}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-[#F7F7F8] font-[family-name:var(--font-roboto)] flex items-center gap-2">
                  <span>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="pt-4">
        <button type="button" onClick={handleSave} disabled={isPending} className="btn-primary">
          {isPending ? "Enregistrement..." : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
