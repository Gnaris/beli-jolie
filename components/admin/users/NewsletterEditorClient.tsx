"use client";

/**
 * Éditeur newsletter à blocs.
 * Layout 3 colonnes : palette / aperçu / réglages.
 * Enregistrement auto au blur des champs et à chaque modif de blocs.
 * Drag-and-drop pour réordonner (indicateur au-dessus/en-dessous).
 * Bouton « Ajouter » sur chaque bloc pour dupliquer en bas.
 * Color picker libre (roue chromatique + hex) sur toutes les couleurs.
 * Upload d'image depuis l'ordinateur (bannière, image+texte, colonnes).
 */

import { useState, useTransition, useCallback, useRef } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";
import { useDragReorder, dropIndicatorClass } from "@/components/admin/shared/useDragReorder";
import {
  updateNewsletterTemplate,
  searchProductsForNewsletter,
  type NewsletterTemplateFull,
} from "@/app/actions/admin/newsletter-templates";
import {
  defaultDataFor,
  type NewsletterBlock,
  type NewsletterBlockType,
  type ColumnData,
} from "@/lib/newsletter-blocks";

interface Props {
  template: NewsletterTemplateFull;
}

interface BlockMeta {
  key: NewsletterBlockType;
  label: string;
  desc: string;
  icon: string;
}

const BLOCKS_META: BlockMeta[] = [
  { key: "banner", label: "Bannière image", desc: "Photo plein largeur", icon: "M3 5h18v14H3zM8.5 10.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm12.5 4.5-5-5L5 21" },
  { key: "heading", label: "Titre + texte", desc: "Titre + paragraphe", icon: "M4 6h16M4 12h16M4 18h10" },
  { key: "callout", label: "Callout coloré", desc: "Bandeau coloré + CTA", icon: "M3 6h18v12H3z" },
  { key: "button", label: "Bouton CTA", desc: "Bouton cliquable", icon: "M4 9h16v6H4z" },
  { key: "products", label: "Grille produits", desc: "2 à 4 produits", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { key: "imgtext", label: "Image + texte", desc: "Photo et texte côte à côte", icon: "M3 4h8v16H3zM14 8h6M14 12h6M14 16h4" },
  { key: "columns", label: "Colonnes libres", desc: "2 ou 3 colonnes texte/image", icon: "M4 4h5v16H4zM10 4h4v16h-4zM15 4h5v16h-5z" },
  { key: "list", label: "Liste emojis", desc: "Puces stylisées", icon: "M5 6h14M5 12h14M5 18h14" },
  { key: "divider", label: "Séparateur", desc: "Ligne décorative", icon: "M4 12h16" },
  { key: "empty", label: "Bloc vide", desc: "Espace pour aérer", icon: "M4 4h16v16H4z" },
];

interface ProductLite {
  id: string;
  name: string;
  reference: string;
  imagePath: string | null;
  priceCents: number | null;
}

export default function NewsletterEditorClient({ template }: Props) {
  const toast = useToast();
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [blocks, setBlocks] = useState<NewsletterBlock[]>(template.blocks);
  const [selectedId, setSelectedId] = useState<number | string | null>(null);
  const [saving, startSaving] = useTransition();
  const [productsCache, setProductsCache] = useState<Map<string, ProductLite>>(new Map());

  const selected = selectedId !== null ? blocks.find((b) => b.id === selectedId) : null;

  const save = useCallback(
    (patch: Partial<{ name: string; subject: string; blocks: NewsletterBlock[] }>) => {
      startSaving(async () => {
        const res = await updateNewsletterTemplate(template.id, patch);
        if (!res.success) toast.error("Enregistrement échoué", res.error);
      });
    },
    [template.id, toast],
  );

  const commit = useCallback(
    (next: NewsletterBlock[]) => {
      setBlocks(next);
      save({ blocks: next });
    },
    [save],
  );

  function makeBlock(type: NewsletterBlockType): NewsletterBlock {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      data: defaultDataFor(type),
    } as NewsletterBlock;
  }

  function addBlock(type: NewsletterBlockType) {
    const newBlock = makeBlock(type);
    const next = [...blocks, newBlock];
    setSelectedId(newBlock.id);
    commit(next);
  }

  function insertBlockAt(type: NewsletterBlockType, index: number) {
    const newBlock = makeBlock(type);
    const next = [...blocks];
    const safe = Math.max(0, Math.min(next.length, index));
    next.splice(safe, 0, newBlock);
    setSelectedId(newBlock.id);
    commit(next);
  }

  function deleteBlock(id: number | string) {
    const next = blocks.filter((b) => b.id !== id);
    if (selectedId === id) setSelectedId(null);
    commit(next);
  }

  function updateBlockData<K extends string>(id: number | string, key: K, value: unknown) {
    const next = blocks.map((b) => {
      if (b.id !== id) return b;
      return { ...b, data: { ...b.data, [key]: value } } as NewsletterBlock;
    });
    commit(next);
  }

  async function loadProducts(ids: string[]) {
    const missing = ids.filter((id) => !productsCache.has(id));
    if (missing.length === 0) return;
    const all = await searchProductsForNewsletter("");
    const next = new Map(productsCache);
    for (const p of all) next.set(p.id, p);
    setProductsCache(next);
  }

  const orderedIds = blocks.map((b) => String(b.id));
  const drag = useDragReorder({
    orderedIds,
    onReorder: (newOrder) => {
      const byId = new Map(blocks.map((b) => [String(b.id), b]));
      const next = newOrder.map((id) => byId.get(id)!).filter(Boolean);
      commit(next);
    },
  });

  // Drag depuis la palette : on distingue via le type MIME dataTransfer.
  // paletteHover pointe vers l'index où le nouveau bloc s'insérerait.
  const [paletteHover, setPaletteHover] = useState<{ index: number; pos: "above" | "below" } | null>(null);
  const paletteDropIndicator = (blockIndex: number): string => {
    if (!paletteHover || paletteHover.index !== blockIndex) return "";
    return paletteHover.pos === "above"
      ? "before:content-[''] before:absolute before:left-2 before:right-2 before:-top-0.5 before:h-[3px] before:rounded before:bg-emerald-500 before:shadow-[0_0_0_2px_rgba(255,255,255,.9)] before:pointer-events-none"
      : "after:content-[''] after:absolute after:left-2 after:right-2 after:-bottom-0.5 after:h-[3px] after:rounded after:bg-emerald-500 after:shadow-[0_0_0_2px_rgba(255,255,255,.9)] after:pointer-events-none";
  };

  function handlePaletteDragOver(e: React.DragEvent, blockIndex: number) {
    if (!e.dataTransfer.types.includes("application/x-newsletter-type")) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    setPaletteHover({ index: blockIndex, pos: above ? "above" : "below" });
    return true;
  }

  function handlePaletteDrop(e: React.DragEvent, blockIndex: number) {
    if (!e.dataTransfer.types.includes("application/x-newsletter-type")) return false;
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-newsletter-type") as NewsletterBlockType;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    const insertAt = above ? blockIndex : blockIndex + 1;
    setPaletteHover(null);
    if (type) insertBlockAt(type, insertAt);
    return true;
  }

  function handlePaletteDropAtEnd(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("application/x-newsletter-type")) return;
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-newsletter-type") as NewsletterBlockType;
    setPaletteHover(null);
    if (type) insertBlockAt(type, blocks.length);
  }

  function handlePaletteDragOverEnd(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("application/x-newsletter-type")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setPaletteHover({ index: blocks.length, pos: "above" });
  }

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col">
      <div className="bg-bg-primary border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <Link
            href="/admin/utilisateurs/newsletters"
            className="text-xs font-body font-semibold text-text-secondary hover:text-text-primary shrink-0"
          >
            ← Retour
          </Link>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => save({ name })}
            className="flex-1 min-w-0 font-heading font-bold text-lg text-text-primary bg-transparent focus:outline-none border-b border-transparent focus:border-slate-300"
            placeholder="Nom du modèle"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-body text-text-muted">
            {saving ? "Enregistrement…" : "Enregistré ✓"}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-12 gap-3 p-3 bg-slate-100">

        <aside className="col-span-3 bg-bg-primary rounded-2xl border border-border overflow-hidden flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted">Sujet du mail</div>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => save({ subject })}
              placeholder="Ce que verra le client dans sa boîte…"
              className="mt-2 w-full px-3 py-2 rounded-lg border border-border bg-bg-primary text-[13px] focus:outline-none focus:border-slate-500"
            />
          </div>
          <div className="p-4 border-b border-border">
            <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted">Blocs disponibles</div>
            <div className="text-[11px] text-text-muted mt-1">Glisse à la position voulue ou utilise le bouton « + Ajouter »</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {BLOCKS_META.map((b) => {
              const isActive = selected?.type === b.key;
              return (
                <div
                  key={b.key}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-newsletter-type", b.key);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onDragEnd={() => setPaletteHover(null)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-grab active:cursor-grabbing ${
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white shadow-md ring-2 ring-slate-900/20"
                      : "border-border bg-bg-primary hover:border-emerald-400 hover:bg-emerald-50/40"
                  }`}
                  title={isActive ? "Type du bloc actuellement sélectionné dans l'aperçu" : "Glisse à la position voulue, ou clique « + Ajouter » pour poser en bas"}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    isActive ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"
                  }`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d={b.icon} />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`font-heading font-semibold text-[12.5px] ${isActive ? "text-white" : "text-text-primary"}`}>{b.label}</div>
                    <div className={`text-[10.5px] truncate ${isActive ? "text-white/70" : "text-text-muted"}`}>{b.desc}</div>
                  </div>
                  {isActive ? (
                    <span className="shrink-0 text-[10px] uppercase tracking-wider font-bold bg-white/15 text-white px-1.5 py-0.5 rounded">
                      Sélec.
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); addBlock(b.key); }}
                      draggable={false}
                      className="shrink-0 h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-body font-semibold flex items-center gap-1 shadow-sm"
                      title={`Ajouter un bloc « ${b.label} » en bas`}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Ajouter
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="col-span-6 bg-bg-primary rounded-2xl border border-border overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-border bg-slate-50 text-[12px] text-text-muted">
            Aperçu en direct — largeur 600 px (standard mail). Glisse un bloc pour le réorganiser.
          </div>
          <div className="flex-1 overflow-y-auto p-6 bg-slate-100">
            <div className="max-w-[600px] mx-auto bg-white rounded-lg shadow-sm">
              {blocks.length === 0 ? (
                <div
                  className="p-16 text-center text-text-muted text-sm border-2 border-dashed border-slate-300 rounded-lg m-4"
                  onDragOver={handlePaletteDragOverEnd}
                  onDrop={handlePaletteDropAtEnd}
                  onDragLeave={() => setPaletteHover(null)}
                >
                  Ajoute un bloc depuis la palette de gauche — clique ou glisse-le ici.
                </div>
              ) : (
                <>
                  {blocks.map((b, i) => (
                    <BlockCanvas
                      key={b.id}
                      block={b}
                      isSelected={selectedId === b.id}
                      onSelect={() => setSelectedId(b.id)}
                      onDelete={() => deleteBlock(b.id)}
                      productsCache={productsCache}
                      onLoadProducts={loadProducts}
                      dragBinding={drag.bind(String(b.id))}
                      dropIndicator={`${dropIndicatorClass(drag.overId, drag.overPos, String(b.id))} ${paletteDropIndicator(i)}`}
                      isDragging={drag.dragId === String(b.id)}
                      onPaletteDragOver={(e) => handlePaletteDragOver(e, i)}
                      onPaletteDrop={(e) => handlePaletteDrop(e, i)}
                      onPaletteDragLeave={() => setPaletteHover(null)}
                    />
                  ))}
                  {/* Zone de drop finale visible pendant un drag depuis palette */}
                  <div
                    className={`h-3 mx-2 rounded transition-all ${paletteHover?.index === blocks.length ? "bg-emerald-500 h-[8px] my-1" : ""}`}
                    onDragOver={handlePaletteDragOverEnd}
                    onDrop={handlePaletteDropAtEnd}
                    onDragLeave={() => setPaletteHover(null)}
                  />
                </>
              )}
            </div>
          </div>
        </main>

        <aside className="col-span-3 bg-bg-primary rounded-2xl border border-border overflow-hidden flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted">Réglages du bloc</div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!selected ? (
              <div className="text-center py-8 text-text-muted text-[13px]">
                Sélectionne un bloc dans l&apos;aperçu pour voir ses réglages.
              </div>
            ) : (
              <BlockSettings block={selected} onUpdate={(k, v) => updateBlockData(selected.id, k, v)} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function BlockCanvas({
  block,
  isSelected,
  onSelect,
  onDelete,
  productsCache,
  onLoadProducts,
  dragBinding,
  dropIndicator,
  isDragging,
  onPaletteDragOver,
  onPaletteDrop,
  onPaletteDragLeave,
}: {
  block: NewsletterBlock;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  productsCache: Map<string, ProductLite>;
  onLoadProducts: (ids: string[]) => void;
  dragBinding: ReturnType<ReturnType<typeof useDragReorder>["bind"]>;
  dropIndicator: string;
  isDragging: boolean;
  onPaletteDragOver: (e: React.DragEvent) => void;
  onPaletteDrop: (e: React.DragEvent) => void;
  onPaletteDragLeave: () => void;
}) {
  // On combine les handlers : palette (nouveau bloc) prioritaire sur reorder (bloc existant).
  const combinedOnDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-newsletter-type")) {
      onPaletteDragOver(e);
      return;
    }
    dragBinding.onDragOver(e);
  };
  const combinedOnDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-newsletter-type")) {
      onPaletteDrop(e);
      return;
    }
    dragBinding.onDrop(e);
  };
  const combinedOnDragLeave = (e: React.DragEvent) => {
    onPaletteDragLeave();
    dragBinding.onDragLeave(e);
  };

  return (
    <div
      draggable={dragBinding.draggable}
      onDragStart={dragBinding.onDragStart}
      onDragEnd={dragBinding.onDragEnd}
      onDragOver={combinedOnDragOver}
      onDragLeave={combinedOnDragLeave}
      onDrop={combinedOnDrop}
      className={`relative group ${isDragging ? "opacity-40" : ""} ${dropIndicator} ${isSelected ? "outline outline-2 outline-slate-900 outline-offset-2 rounded" : "hover:outline hover:outline-2 hover:outline-slate-300 hover:outline-offset-2 hover:rounded"}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* Poignée grip visible en haut à gauche : cliquer + glisser pour déplacer */}
      <div className={`absolute -top-3 -left-3 z-10 ${isSelected ? "" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
        <div
          className="h-7 w-7 rounded-md bg-slate-800 hover:bg-slate-900 text-white flex items-center justify-center shadow-md cursor-grab active:cursor-grabbing"
          title="Glisse pour réorganiser"
        >
          <svg width="12" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" />
            <circle cx="15" cy="6" r="1.6" />
            <circle cx="15" cy="12" r="1.6" />
            <circle cx="15" cy="18" r="1.6" />
          </svg>
        </div>
      </div>
      <div className={`absolute -top-3 right-2 z-10 flex gap-1 ${isSelected ? "" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="h-7 w-7 rounded-md bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-md"
          title="Supprimer ce bloc"
          aria-label="Supprimer"
          draggable={false}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            <path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      </div>
      <BlockRender block={block} productsCache={productsCache} onLoadProducts={onLoadProducts} />
    </div>
  );
}

function BlockRender({ block, productsCache, onLoadProducts }: { block: NewsletterBlock; productsCache: Map<string, ProductLite>; onLoadProducts: (ids: string[]) => void }) {
  const s: React.CSSProperties = { fontFamily: "Roboto, sans-serif" };
  const bg = "bg" in block.data ? (block.data as { bg?: string }).bg : undefined;

  switch (block.type) {
    case "banner": {
      const h = block.data.height ? Math.max(60, Math.min(600, block.data.height)) : null;
      const fit: React.CSSProperties["objectFit"] = block.data.fit === "contain" ? "contain" : "cover";
      return (
        <div style={{ background: bg || "transparent" }}>
          {block.data.img ? (
            <img
              src={block.data.img}
              alt={block.data.alt}
              draggable={false}
              style={{ ...s, width: "100%", display: "block", ...(h ? { height: h, objectFit: fit } : {}) }}
            />
          ) : (
            <div style={{ ...s, height: h || 140, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>
              Choisis une image dans les réglages
            </div>
          )}
        </div>
      );
    }
    case "heading": {
      const hasBody = (block.data.body || "").trim().length > 0;
      const hasTitle = (block.data.title || "").trim().length > 0;
      return (
        <div style={{ ...s, padding: "24px 20px", textAlign: block.data.align, background: block.data.bg || "transparent" }}>
          {hasTitle && (
            <h2 style={{ fontFamily: "Poppins", fontSize: 20, fontWeight: 700, color: block.data.titleColor || "#0f172a", margin: hasBody ? "0 0 10px" : "0" }}>{block.data.title}</h2>
          )}
          {hasBody && (
            <p style={{ fontSize: 13, color: block.data.bodyColor || "#475569", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>{block.data.body}</p>
          )}
          {!hasTitle && !hasBody && (
            <div style={{ color: "#cbd5e1", fontSize: 12 }}>Titre et texte vides — renseigne au moins l&apos;un dans les réglages.</div>
          )}
        </div>
      );
    }
    case "callout":
      return (
        <div style={{ ...s, padding: "12px 20px" }}>
          <div style={{ background: block.data.bg, color: block.data.color, padding: 20, borderRadius: 14, textAlign: "center" }}>
            <div style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{block.data.title}</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 14 }}>{block.data.subtitle}</div>
            <span style={{ display: "inline-block", background: "white", color: block.data.bg, padding: "8px 20px", borderRadius: 999, fontWeight: 600, fontSize: 12 }}>{block.data.cta}</span>
          </div>
        </div>
      );
    case "button":
      return (
        <div style={{ ...s, padding: "12px 20px", textAlign: block.data.align || "center" }}>
          <span style={{ display: "inline-block", background: block.data.bg, color: block.data.color, padding: "12px 28px", borderRadius: 10, fontFamily: "Poppins", fontWeight: 600, fontSize: 13 }}>{block.data.label} →</span>
        </div>
      );
    case "products": {
      if (block.data.productIds.length === 0) {
        return <div style={{ ...s, padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12, background: bg || "transparent" }}>Aucun produit sélectionné — choisis-en dans les réglages.</div>;
      }
      onLoadProducts(block.data.productIds);
      const products = block.data.productIds.map((id) => productsCache.get(id)).filter(Boolean) as ProductLite[];
      const cols = block.data.cols;
      return (
        <div style={{ ...s, padding: "12px 20px", display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, background: bg || "transparent" }}>
          {products.map((p) => (
            <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
              {p.imagePath ? (
                <img src={p.imagePath} alt="" draggable={false} style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }} />
              ) : (
                <div style={{ height: 100, background: "#f1f5f9" }} />
              )}
              <div style={{ padding: 8, textAlign: "center" }}>
                <div style={{ fontFamily: "Poppins", fontSize: 11, fontWeight: 600, color: "#0f172a" }}>{p.name}</div>
                {p.priceCents !== null && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{(p.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "imgtext": {
      const side = block.data.side;
      const isVertical = side === "top" || side === "bottom";
      const flexDir: React.CSSProperties["flexDirection"] =
        side === "left" ? "row" : side === "right" ? "row-reverse" : side === "top" ? "column" : "column-reverse";
      const imgW = Math.max(20, Math.min(100, block.data.imgWidth || 45));
      const textAlign = (block.data.textAlign || "left") as React.CSSProperties["textAlign"];
      const imgEl = block.data.img
        ? <img src={block.data.img} alt="" draggable={false} style={{ width: "100%", borderRadius: 8, display: "block" }} />
        : <div style={{ height: 100, background: "#f1f5f9", borderRadius: 8 }} />;
      return (
        <div style={{ ...s, padding: "12px 20px", display: "flex", gap: 12, flexDirection: flexDir, background: block.data.bg || "transparent", alignItems: isVertical ? "center" : undefined }}>
          <div style={{ width: isVertical ? `${imgW}%` : `${imgW}%` }}>{imgEl}</div>
          <div style={{ flex: 1, width: isVertical ? "100%" : undefined }}>
            <div style={{ fontFamily: "Poppins", fontSize: 15, fontWeight: 700, color: block.data.titleColor || "#0f172a", marginBottom: 6, textAlign }}>{block.data.title}</div>
            <div style={{ fontSize: 13, color: block.data.bodyColor || "#475569", lineHeight: 1.6, whiteSpace: "pre-wrap", textAlign }}>{block.data.body}</div>
          </div>
        </div>
      );
    }
    case "list":
      return (
        <ul style={{ ...s, padding: "12px 20px", listStyle: "none", margin: 0, background: block.data.bg || "transparent" }}>
          {block.data.items.map((it, i) => (
            <li key={i} style={{ padding: "6px 0", fontSize: 14, color: block.data.color || "#334155", borderBottom: "1px solid #f1f5f9" }}>{it}</li>
          ))}
        </ul>
      );
    case "empty":
      return (
        <div
          style={{
            ...s,
            height: Math.max(4, Math.min(400, block.data.height || 40)),
            background: block.data.bg || "transparent",
          }}
        />
      );
    case "columns": {
      const cols = block.data.cols;
      const columns = block.data.columns.slice(0, cols);
      while (columns.length < cols) columns.push({ kind: "text", text: "" });
      return (
        <div style={{ ...s, padding: "12px 20px", display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12, background: block.data.bg || "transparent" }}>
          {columns.map((col, i) => (
            <div key={i}>
              {col.kind === "image" ? (
                col.img ? <img src={col.img} alt="" draggable={false} style={{ width: "100%", borderRadius: 8, display: "block" }} /> : <div style={{ height: 90, background: "#f1f5f9", borderRadius: 8 }} />
              ) : (
                <div style={{ fontSize: 13, color: block.data.color || "#334155", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{col.text || <span style={{ color: "#cbd5e1" }}>Texte de colonne…</span>}</div>
              )}
            </div>
          ))}
        </div>
      );
    }
    case "divider":
      return <hr style={{ ...s, border: "none", borderTop: "1px solid #e2e8f0", margin: "12px 20px" }} />;
    case "footer":
      return null;
  }
}

function BlockSettings({ block, onUpdate }: { block: NewsletterBlock; onUpdate: (key: string, value: unknown) => void }) {
  switch (block.type) {
    case "banner":
      return (
        <div className="space-y-3">
          <Field label="Image de la bannière">
            <ImageInput value={block.data.img} onChange={(v) => onUpdate("img", v)} />
          </Field>
          <Field label="Texte alternatif (accessibilité)">
            <input type="text" className="prop-input" value={block.data.alt} onChange={(e) => onUpdate("alt", e.target.value)} />
          </Field>
          <Field label={block.data.height ? `Hauteur fixe (${block.data.height} px)` : "Hauteur — automatique (proportion image)"}>
            <input
              type="range"
              min={0}
              max={600}
              step={10}
              value={block.data.height || 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                onUpdate("height", v === 0 ? undefined : v);
              }}
              className="w-full"
            />
            <div className="text-[10.5px] text-text-muted mt-1">Glisse à zéro pour laisser l&apos;image respirer à sa proportion naturelle.</div>
          </Field>
          {block.data.height ? (
            <Field label="Ajustement quand hauteur fixe">
              <CustomSelect
                value={block.data.fit || "cover"}
                onChange={(v) => onUpdate("fit", v)}
                options={[
                  { value: "cover", label: "Remplir (coupe les bords si besoin)" },
                  { value: "contain", label: "Contenir (voit toute l'image)" },
                ]}
                size="sm"
              />
            </Field>
          ) : null}
          <Field label="Couleur de fond du bloc">
            <ColorPicker value={block.data.bg || ""} onChange={(c) => onUpdate("bg", c)} allowEmpty />
          </Field>
        </div>
      );
    case "heading":
      return (
        <div className="space-y-3">
          <Field label="Titre">
            <input type="text" className="prop-input" value={block.data.title} onChange={(e) => onUpdate("title", e.target.value)} />
          </Field>
          <Field label="Paragraphe (facultatif — laisse vide pour un titre seul)">
            <textarea rows={4} className="prop-input" value={block.data.body} onChange={(e) => onUpdate("body", e.target.value)} placeholder="Vide pour n'afficher que le titre." />
          </Field>
          <Field label="Alignement">
            <CustomSelect
              value={block.data.align}
              onChange={(v) => onUpdate("align", v)}
              options={[
                { value: "left", label: "← Gauche" },
                { value: "center", label: "↔ Centre" },
                { value: "right", label: "Droite →" },
              ]}
              size="sm"
            />
          </Field>
          <Field label="Couleur du titre">
            <ColorPicker value={block.data.titleColor || "#0f172a"} onChange={(c) => onUpdate("titleColor", c)} />
          </Field>
          <Field label="Couleur du texte">
            <ColorPicker value={block.data.bodyColor || "#475569"} onChange={(c) => onUpdate("bodyColor", c)} />
          </Field>
          <Field label="Couleur de fond du bloc">
            <ColorPicker value={block.data.bg || ""} onChange={(c) => onUpdate("bg", c)} allowEmpty />
          </Field>
        </div>
      );
    case "callout":
      return (
        <div className="space-y-3">
          <Field label="Titre"><input type="text" className="prop-input" value={block.data.title} onChange={(e) => onUpdate("title", e.target.value)} /></Field>
          <Field label="Sous-titre"><input type="text" className="prop-input" value={block.data.subtitle} onChange={(e) => onUpdate("subtitle", e.target.value)} /></Field>
          <Field label="Texte du bouton"><input type="text" className="prop-input" value={block.data.cta} onChange={(e) => onUpdate("cta", e.target.value)} /></Field>
          <Field label="Lien du bouton"><input type="text" className="prop-input" value={block.data.ctaUrl} onChange={(e) => onUpdate("ctaUrl", e.target.value)} placeholder="https://…" /></Field>
          <Field label="Couleur de fond">
            <ColorPicker value={block.data.bg} onChange={(c) => onUpdate("bg", c)} />
          </Field>
          <Field label="Couleur du texte">
            <ColorPicker value={block.data.color} onChange={(c) => onUpdate("color", c)} />
          </Field>
        </div>
      );
    case "button":
      return (
        <div className="space-y-3">
          <Field label="Texte du bouton"><input type="text" className="prop-input" value={block.data.label} onChange={(e) => onUpdate("label", e.target.value)} /></Field>
          <Field label="Lien"><input type="text" className="prop-input" value={block.data.url} onChange={(e) => onUpdate("url", e.target.value)} placeholder="https://…" /></Field>
          <Field label="Alignement">
            <CustomSelect
              value={block.data.align || "center"}
              onChange={(v) => onUpdate("align", v)}
              options={[
                { value: "left", label: "← Gauche" },
                { value: "center", label: "↔ Centre" },
                { value: "right", label: "Droite →" },
              ]}
              size="sm"
            />
          </Field>
          <Field label="Couleur de fond">
            <ColorPicker value={block.data.bg} onChange={(c) => onUpdate("bg", c)} />
          </Field>
          <Field label="Couleur du texte">
            <ColorPicker value={block.data.color} onChange={(c) => onUpdate("color", c)} />
          </Field>
        </div>
      );
    case "products":
      return (
        <div className="space-y-3">
          <Field label="Nombre de colonnes">
            <CustomSelect
              value={String(block.data.cols)}
              onChange={(v) => onUpdate("cols", Number(v))}
              options={[{ value: "2", label: "2 colonnes" }, { value: "3", label: "3 colonnes" }, { value: "4", label: "4 colonnes" }]}
              size="sm"
            />
          </Field>
          <ProductsPicker
            value={block.data.productIds}
            onChange={(ids) => onUpdate("productIds", ids)}
          />
          <Field label="Couleur de fond du bloc">
            <ColorPicker value={block.data.bg || ""} onChange={(c) => onUpdate("bg", c)} allowEmpty />
          </Field>
        </div>
      );
    case "imgtext":
      return (
        <div className="space-y-3">
          <Field label="Image">
            <ImageInput value={block.data.img} onChange={(v) => onUpdate("img", v)} />
          </Field>
          <Field label="Titre"><input type="text" className="prop-input" value={block.data.title} onChange={(e) => onUpdate("title", e.target.value)} /></Field>
          <Field label="Texte"><textarea rows={3} className="prop-input" value={block.data.body} onChange={(e) => onUpdate("body", e.target.value)} /></Field>
          <Field label="Position de l'image">
            <CustomSelect
              value={block.data.side}
              onChange={(v) => onUpdate("side", v)}
              options={[
                { value: "left", label: "← Image à gauche" },
                { value: "right", label: "Image à droite →" },
                { value: "top", label: "↑ Image en haut" },
                { value: "bottom", label: "↓ Image en bas" },
              ]}
              size="sm"
            />
          </Field>
          <Field label={`Largeur de l'image (${block.data.imgWidth || 45} %)`}>
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={block.data.imgWidth || 45}
              onChange={(e) => onUpdate("imgWidth", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label="Alignement du texte">
            <CustomSelect
              value={block.data.textAlign || "left"}
              onChange={(v) => onUpdate("textAlign", v)}
              options={[
                { value: "left", label: "← Gauche" },
                { value: "center", label: "↔ Centre" },
                { value: "right", label: "Droite →" },
              ]}
              size="sm"
            />
          </Field>
          <Field label="Couleur du titre">
            <ColorPicker value={block.data.titleColor || "#0f172a"} onChange={(c) => onUpdate("titleColor", c)} />
          </Field>
          <Field label="Couleur du texte">
            <ColorPicker value={block.data.bodyColor || "#475569"} onChange={(c) => onUpdate("bodyColor", c)} />
          </Field>
          <Field label="Couleur de fond du bloc">
            <ColorPicker value={block.data.bg || ""} onChange={(c) => onUpdate("bg", c)} allowEmpty />
          </Field>
        </div>
      );
    case "list":
      return (
        <div className="space-y-3">
          <Field label="Un item par ligne (commence par un emoji)">
            <textarea
              rows={6}
              className="prop-input"
              value={block.data.items.join("\n")}
              onChange={(e) => onUpdate("items", e.target.value.split("\n"))}
            />
          </Field>
          <Field label="Couleur du texte">
            <ColorPicker value={block.data.color || "#334155"} onChange={(c) => onUpdate("color", c)} />
          </Field>
          <Field label="Couleur de fond du bloc">
            <ColorPicker value={block.data.bg || ""} onChange={(c) => onUpdate("bg", c)} allowEmpty />
          </Field>
        </div>
      );
    case "empty":
      return (
        <div className="space-y-3">
          <Field label={`Hauteur (${block.data.height} px)`}>
            <input
              type="range"
              min={4}
              max={200}
              step={4}
              value={block.data.height}
              onChange={(e) => onUpdate("height", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label="Couleur de fond">
            <ColorPicker value={block.data.bg || ""} onChange={(c) => onUpdate("bg", c)} allowEmpty />
          </Field>
        </div>
      );
    case "columns":
      return <ColumnsSettings data={block.data} onUpdate={onUpdate} />;
    case "divider":
      return <div className="text-[12px] text-text-muted p-3 bg-bg-secondary rounded-lg">Ligne fine décorative — pas de réglage.</div>;
    case "footer":
      return null;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-body font-semibold text-text-muted mb-1.5">{label}</label>
      {children}
      <style jsx>{`
        :global(.prop-input) {
          width: 100%;
          padding: 7px 10px;
          font-size: 13px;
          border: 1px solid var(--color-border, #e2e8f0);
          border-radius: 8px;
          background: white;
          font-family: inherit;
        }
        :global(.prop-input:focus) {
          outline: none;
          border-color: #64748b;
          box-shadow: 0 0 0 3px rgba(15,23,42,.06);
        }
      `}</style>
    </div>
  );
}

/**
 * Color picker libre : roue chromatique (native <input type=color>) + champ hex.
 * `allowEmpty` : bouton pour retirer la couleur (fond transparent).
 */
function ColorPicker({ value, onChange, allowEmpty = false }: { value: string; onChange: (c: string) => void; allowEmpty?: boolean }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-9 rounded-md border border-border cursor-pointer shrink-0"
        style={{ padding: 2 }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#000000"
        className="flex-1 min-w-0 px-2 py-1.5 text-[12px] font-mono border border-border rounded-md focus:outline-none focus:border-slate-500"
      />
      {allowEmpty && value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="shrink-0 px-2 py-1.5 text-[10.5px] text-text-muted hover:text-red-600 border border-border rounded-md hover:border-red-300"
          title="Retirer la couleur (fond transparent)"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Upload d'image depuis l'ordinateur.
 * Retombe sur URL manuelle si besoin (compat avec anciennes newsletters).
 */
function ImageInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/admin/newsletter-image", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) {
        toast.error("Upload échoué", json.error || "Réessaye.");
        return;
      }
      onChange(json.path as string);
    } catch (err) {
      toast.error("Upload échoué", (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {value && (
        <div className="relative rounded-lg overflow-hidden border border-border">
          <img src={value} alt="" className="w-full h-24 object-cover" />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-1 right-1 h-6 w-6 rounded-md bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow"
            title="Retirer l'image"
            aria-label="Retirer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex-1 px-3 py-2 text-[12px] font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg"
        >
          {uploading ? "Envoi…" : value ? "Remplacer" : "📁 Choisir un fichier"}
        </button>
        <button
          type="button"
          onClick={() => setShowUrl((v) => !v)}
          className="px-2 py-2 text-[11px] font-semibold text-text-secondary border border-border rounded-lg hover:bg-bg-secondary"
          title="Coller une URL au lieu d'uploader"
        >
          URL
        </button>
      </div>
      {showUrl && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          className="prop-input"
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ColumnsSettings({ data, onUpdate }: { data: { cols: 2 | 3; columns: ColumnData[]; bg?: string; color?: string }; onUpdate: (key: string, value: unknown) => void }) {
  const columns = [...data.columns];
  while (columns.length < data.cols) columns.push({ kind: "text", text: "" });

  function updateCol(i: number, patch: Partial<ColumnData>) {
    const next = [...columns];
    next[i] = { ...next[i], ...patch };
    onUpdate("columns", next);
  }

  return (
    <div className="space-y-3">
      <Field label="Nombre de colonnes">
        <CustomSelect
          value={String(data.cols)}
          onChange={(v) => {
            const n = Number(v) as 2 | 3;
            onUpdate("cols", n);
            const next = [...columns];
            while (next.length < n) next.push({ kind: "text", text: "" });
            onUpdate("columns", next.slice(0, n));
          }}
          options={[{ value: "2", label: "2 colonnes" }, { value: "3", label: "3 colonnes" }]}
          size="sm"
        />
      </Field>
      {columns.slice(0, data.cols).map((col, i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2 bg-bg-secondary/30">
          <div className="text-[11px] font-body font-bold text-text-primary">Colonne {i + 1}</div>
          <CustomSelect
            value={col.kind}
            onChange={(v) => updateCol(i, { kind: v as "text" | "image" })}
            options={[{ value: "text", label: "📝 Texte" }, { value: "image", label: "🖼️ Image" }]}
            size="sm"
          />
          {col.kind === "text" ? (
            <textarea
              rows={3}
              className="prop-input"
              value={col.text || ""}
              onChange={(e) => updateCol(i, { text: e.target.value })}
              placeholder="Texte de la colonne…"
            />
          ) : (
            <ImageInput value={col.img || ""} onChange={(v) => updateCol(i, { img: v })} />
          )}
        </div>
      ))}
      <Field label="Couleur du texte">
        <ColorPicker value={data.color || "#334155"} onChange={(c) => onUpdate("color", c)} />
      </Field>
      <Field label="Couleur de fond du bloc">
        <ColorPicker value={data.bg || ""} onChange={(c) => onUpdate("bg", c)} allowEmpty />
      </Field>
    </div>
  );
}

function ProductsPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(false);

  async function doSearch(q: string) {
    setQuery(q);
    setLoading(true);
    const rows = await searchProductsForNewsletter(q);
    setResults(rows);
    setLoading(false);
  }

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-body font-semibold text-text-muted">
        Produits sélectionnés ({value.length})
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => doSearch(e.target.value)}
        onFocus={() => results.length === 0 && doSearch("")}
        placeholder="Chercher un produit…"
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg-primary text-[13px]"
      />
      {loading && <div className="text-[11px] text-text-muted">Chargement…</div>}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {results.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              className={`w-full text-left flex items-center gap-2 p-2 rounded-lg border ${on ? "border-violet-500 bg-violet-50" : "border-border hover:bg-bg-secondary"}`}
            >
              {p.imagePath ? (
                <img src={p.imagePath} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded bg-slate-100 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-text-primary truncate">{p.name}</div>
                <div className="text-[10.5px] text-text-muted truncate">{p.reference}{p.priceCents !== null ? ` · ${(p.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : ""}</div>
              </div>
              {on && <span className="text-violet-700 text-lg shrink-0">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
