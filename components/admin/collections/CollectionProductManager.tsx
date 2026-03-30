"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import {
  addProductToCollection,
  removeProductFromCollection,
  updateCollectionProductColor,
  reorderCollectionProducts,
} from "@/app/actions/admin/collections";

interface ColorData {
  id: string;
  name: string;
  hex: string | null;
  images: { path: string }[];
}

interface CollectionItem {
  productId: string;
  colorId:   string | null;
  position:  number;
  product: {
    id:        string;
    name:      string;
    reference: string;
    colors:    ColorData[];
  };
}

interface AvailableProduct {
  id:        string;
  name:      string;
  reference: string;
  colors:    ColorData[];
}

interface Props {
  collectionId:      string;
  initialItems:      CollectionItem[];
  availableProducts: AvailableProduct[];
}

export default function CollectionProductManager({
  collectionId,
  initialItems,
  availableProducts,
}: Props) {
  const [items, setItems]           = useState<CollectionItem[]>(
    [...initialItems].sort((a, b) => a.position - b.position)
  );
  const [search, setSearch]         = useState("");
  const [saving, setSaving]         = useState(false);
  const [message, setMessage]       = useState<string | null>(null);

  // Drag & drop state
  const dragIndex = useRef<number | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function flash(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  async function saveOrder(newItems: CollectionItem[]) {
    setSaving(true);
    await reorderCollectionProducts(
      collectionId,
      newItems.map((it, i) => ({ productId: it.productId, position: i }))
    );
    setSaving(false);
  }

  // ── Drag & drop handlers ─────────────────────────────────────────────────

  function onDragStart(index: number) {
    dragIndex.current = index;
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;

    const newItems = [...items];
    const [moved]  = newItems.splice(dragIndex.current, 1);
    newItems.splice(index, 0, moved);
    dragIndex.current = index;
    setItems(newItems);
  }

  function onDragEnd() {
    dragIndex.current = null;
    saveOrder(items);
  }

  // ── Position input change ────────────────────────────────────────────────

  function onPositionChange(productId: string, raw: string) {
    const pos = parseInt(raw, 10);
    if (isNaN(pos) || pos < 1) return;

    const newItems = [...items];
    const idx      = newItems.findIndex((it) => it.productId === productId);
    if (idx === -1) return;

    const [moved] = newItems.splice(idx, 1);
    const insert  = Math.min(Math.max(0, pos - 1), newItems.length);
    newItems.splice(insert, 0, moved);
    setItems(newItems);
    saveOrder(newItems);
  }

  // ── Color change ─────────────────────────────────────────────────────────

  async function onColorChange(productId: string, colorId: string) {
    setItems((prev) =>
      prev.map((it) =>
        it.productId === productId ? { ...it, colorId: colorId || null } : it
      )
    );
    await updateCollectionProductColor(collectionId, productId, colorId || null);
  }

  // ── Remove product ───────────────────────────────────────────────────────

  async function onRemove(productId: string) {
    setSaving(true);
    await removeProductFromCollection(collectionId, productId);
    setItems((prev) => prev.filter((it) => it.productId !== productId));
    setSaving(false);
    flash("Produit retire.");
  }

  // ── Add product ──────────────────────────────────────────────────────────

  async function onAdd(product: AvailableProduct) {
    if (items.some((it) => it.productId === product.id)) {
      flash("Ce produit est deja dans la collection.");
      return;
    }
    setSaving(true);
    await addProductToCollection(collectionId, product.id);
    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        colorId:   null,
        position:  prev.length,
        product:   { id: product.id, name: product.name, reference: product.reference, colors: product.colors },
      },
    ]);
    setSaving(false);
    setSearch("");
    flash("Produit ajoute.");
  }

  // ── Filtered available products ──────────────────────────────────────────

  const alreadyIn = new Set(items.map((it) => it.productId));
  const filtered  = search.length >= 2
    ? availableProducts.filter(
        (p) =>
          !alreadyIn.has(p.id) &&
          (p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.reference.toLowerCase().includes(search.toLowerCase()))
      ).slice(0, 8)
    : [];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Status bar */}
      {message && (
        <div className="bg-bg-secondary border border-border text-text-secondary text-sm px-4 py-2 rounded-xl">
          {message}
        </div>
      )}

      {/* Search & add */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5 font-body">
          Ajouter un produit
        </label>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom ou reference..."
            className="field-input"
          />
          {filtered.length > 0 && (
            <ul className="absolute z-10 top-full mt-1 left-0 right-0 bg-bg-primary border border-border rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {filtered.map((p) => {
                const img = p.colors[0]?.images[0]?.path;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onAdd(p)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-secondary text-left"
                    >
                      <div className="w-9 h-9 rounded bg-bg-tertiary shrink-0 overflow-hidden">
                        {img && (
                          <Image src={img} alt={p.name} className="w-full h-full object-cover" width={36} height={36} unoptimized />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-text-primary truncate">{p.name}</p>
                        <p className="text-text-muted text-xs font-mono">{p.reference}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="mt-1 text-xs text-text-muted font-body">
          Saisissez au moins 2 caracteres pour rechercher.
        </p>
      </div>

      {/* Products list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-text-primary font-body">
            Produits dans la collection ({items.length})
          </p>
          {saving && (
            <span className="text-xs text-text-muted font-body">
              Enregistrement...
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl py-10 text-center text-text-muted text-sm font-body">
            Aucun produit dans cette collection. Ajoutez-en via la recherche ci-dessus.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item, index) => {
              const colors       = item.product.colors;
              const activeColor  = colors.find((c) => c.id === item.colorId) ?? colors.find((c) => c.id) ?? colors[0];
              const displayImage = activeColor?.images[0]?.path;

              return (
                <li
                  key={item.productId}
                  draggable
                  onDragStart={() => onDragStart(index)}
                  onDragOver={(e) => onDragOver(e, index)}
                  onDragEnd={onDragEnd}
                  className="flex items-center gap-3 bg-bg-primary border border-border rounded-xl px-3 py-2.5 cursor-grab active:cursor-grabbing select-none"
                >
                  {/* Drag handle */}
                  <div className="text-text-muted shrink-0" aria-hidden>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
                    </svg>
                  </div>

                  {/* Image */}
                  <div className="w-12 h-12 rounded bg-bg-tertiary shrink-0 overflow-hidden">
                    {displayImage ? (
                      <Image src={displayImage} alt={item.product.name} className="w-full h-full object-cover" width={48} height={48} unoptimized />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate font-body">
                      {item.product.name}
                    </p>
                    <p className="text-xs text-text-muted font-mono">{item.product.reference}</p>
                  </div>

                  {/* Color selector */}
                  {colors.length > 1 && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {colors.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          title={c.name}
                          onClick={() => onColorChange(item.productId, c.id)}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${
                            (item.colorId ?? activeColor?.id) === c.id
                              ? "border-bg-dark scale-110"
                              : "border-border hover:border-text-muted"
                          }`}
                          style={{ backgroundColor: c.hex ?? "#9CA3AF" }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Position input */}
                  <input
                    type="number"
                    min={1}
                    max={items.length}
                    defaultValue={index + 1}
                    key={`${item.productId}-${index}`}
                    onBlur={(e) => onPositionChange(item.productId, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onPositionChange(item.productId, (e.target as HTMLInputElement).value);
                    }}
                    className="w-12 text-center border border-border rounded-lg text-sm py-1 text-text-primary font-body shrink-0 focus:outline-none focus:border-bg-dark"
                    title="Position"
                  />

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => onRemove(item.productId)}
                    className="shrink-0 p-1 text-text-muted hover:text-red-600 transition-colors"
                    title="Retirer de la collection"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
