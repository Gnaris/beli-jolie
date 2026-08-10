"use client";

/**
 * Éditeur newsletter à blocs — reprend la maquette validée.
 * Layout 3 colonnes : palette / aperçu / réglages.
 * Enregistrement auto au blur des champs (via updateNewsletterTemplate).
 */

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import {
  updateNewsletterTemplate,
  searchProductsForNewsletter,
  type NewsletterTemplateFull,
} from "@/app/actions/admin/newsletter-templates";
import {
  defaultDataFor,
  type NewsletterBlock,
  type NewsletterBlockType,
} from "@/lib/newsletter-blocks";

interface Props {
  template: NewsletterTemplateFull;
}

interface BlockMeta {
  key: NewsletterBlockType;
  label: string;
  desc: string;
  icon: string; // SVG path d
}

const BLOCKS_META: BlockMeta[] = [
  { key: "banner", label: "Bannière image", desc: "Photo plein largeur", icon: "M3 5h18v14H3zM8.5 10.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm12.5 4.5-5-5L5 21" },
  { key: "heading", label: "Titre + texte", desc: "Titre + paragraphe", icon: "M4 6h16M4 12h16M4 18h10" },
  { key: "callout", label: "Callout coloré", desc: "Bandeau coloré + CTA", icon: "M3 6h18v12H3z" },
  { key: "button", label: "Bouton CTA", desc: "Bouton cliquable", icon: "M4 9h16v6H4z" },
  { key: "products", label: "Grille produits", desc: "2 à 4 produits", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { key: "imgtext", label: "Image + texte", desc: "Photo et texte côte à côte", icon: "M3 4h8v16H3zM14 8h6M14 12h6M14 16h4" },
  { key: "list", label: "Liste emojis", desc: "Puces stylisées", icon: "M5 6h14M5 12h14M5 18h14" },
  { key: "divider", label: "Séparateur", desc: "Ligne décorative", icon: "M4 12h16" },
];

interface ProductLite {
  id: string;
  name: string;
  reference: string;
  imagePath: string | null;
  priceCents: number | null;
}

export default function NewsletterEditorClient({ template }: Props) {
  const router = useRouter();
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

  function addBlock(type: NewsletterBlockType) {
    const newBlock = {
      id: Date.now(),
      type,
      data: defaultDataFor(type),
    } as NewsletterBlock;
    const next = [...blocks, newBlock];
    setBlocks(next);
    setSelectedId(newBlock.id);
    save({ blocks: next });
  }

  function deleteBlock(id: number | string) {
    const next = blocks.filter((b) => b.id !== id);
    setBlocks(next);
    if (selectedId === id) setSelectedId(null);
    save({ blocks: next });
  }

  function moveBlock(id: number | string, dir: "up" | "down") {
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    const t = dir === "up" ? i - 1 : i + 1;
    if (t < 0 || t >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[t]] = [next[t], next[i]];
    setBlocks(next);
    save({ blocks: next });
  }

  function updateBlockData<K extends string>(id: number | string, key: K, value: unknown) {
    const next = blocks.map((b) => {
      if (b.id !== id) return b;
      return { ...b, data: { ...b.data, [key]: value } } as NewsletterBlock;
    });
    setBlocks(next);
    save({ blocks: next });
  }

  async function loadProducts(ids: string[]) {
    const missing = ids.filter((id) => !productsCache.has(id));
    if (missing.length === 0) return;
    // Approximation : on refait une recherche générique et on mappe par id
    // (une recherche par id précis serait plus efficace ; on garde simple pour l'étape 4)
    const all = await searchProductsForNewsletter("");
    const next = new Map(productsCache);
    for (const p of all) next.set(p.id, p);
    setProductsCache(next);
  }

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col">
      {/* Toolbar haute */}
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

      {/* 3 colonnes */}
      <div className="flex-1 overflow-hidden grid grid-cols-12 gap-3 p-3 bg-slate-100">

        {/* GAUCHE : palette + sujet */}
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
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {BLOCKS_META.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => addBlock(b.key)}
                className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl border border-border bg-bg-primary hover:border-slate-400 hover:bg-bg-secondary/40 transition-all"
              >
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d={b.icon} />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="font-heading font-semibold text-[12.5px] text-text-primary">{b.label}</div>
                  <div className="text-[10.5px] text-text-muted truncate">{b.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* CENTRE : canvas */}
        <main className="col-span-6 bg-bg-primary rounded-2xl border border-border overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-border bg-slate-50 text-[12px] text-text-muted">
            Aperçu en direct — largeur 600px (standard mail)
          </div>
          <div className="flex-1 overflow-y-auto p-6 bg-slate-100">
            <div className="max-w-[600px] mx-auto bg-white rounded-lg shadow-sm">
              {blocks.length === 0 ? (
                <div className="p-16 text-center text-text-muted text-sm">
                  Ajoute un bloc depuis la palette de gauche pour commencer.
                </div>
              ) : (
                blocks.map((b, i) => (
                  <BlockCanvas
                    key={b.id}
                    block={b}
                    isSelected={selectedId === b.id}
                    isFirst={i === 0}
                    isLast={i === blocks.length - 1}
                    onSelect={() => setSelectedId(b.id)}
                    onMoveUp={() => moveBlock(b.id, "up")}
                    onMoveDown={() => moveBlock(b.id, "down")}
                    onDelete={() => deleteBlock(b.id)}
                    productsCache={productsCache}
                    onLoadProducts={loadProducts}
                  />
                ))
              )}
            </div>
          </div>
        </main>

        {/* DROITE : réglages */}
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

// ─────────────────────────────────────────────────────
// Rendu d'un bloc dans le canvas central (aperçu + boutons d'action)
// ─────────────────────────────────────────────────────

function BlockCanvas({
  block,
  isSelected,
  isFirst,
  isLast,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  productsCache,
  onLoadProducts,
}: {
  block: NewsletterBlock;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  productsCache: Map<string, ProductLite>;
  onLoadProducts: (ids: string[]) => void;
}) {
  return (
    <div
      className={`relative group cursor-pointer ${isSelected ? "outline outline-2 outline-slate-900 outline-offset-2 rounded" : "hover:outline hover:outline-2 hover:outline-slate-300 hover:outline-offset-2 hover:rounded"}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <div className={`absolute -top-3 right-2 z-10 bg-slate-900 rounded-md p-0.5 flex gap-0.5 shadow-lg ${isSelected ? "" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
        <button type="button" onClick={(e) => { e.stopPropagation(); onMoveUp(); }} disabled={isFirst} className="w-5 h-5 flex items-center justify-center text-white disabled:opacity-30" title="Monter">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 15l6-6 6 6" /></svg>
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onMoveDown(); }} disabled={isLast} className="w-5 h-5 flex items-center justify-center text-white disabled:opacity-30" title="Descendre">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }} className="w-5 h-5 flex items-center justify-center text-white" title="Supprimer">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
        </button>
      </div>
      <BlockRender block={block} productsCache={productsCache} onLoadProducts={onLoadProducts} />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Rendu HTML approximatif d'un bloc (client-side preview)
// ─────────────────────────────────────────────────────

function BlockRender({ block, productsCache, onLoadProducts }: { block: NewsletterBlock; productsCache: Map<string, ProductLite>; onLoadProducts: (ids: string[]) => void }) {
  const s: React.CSSProperties = { fontFamily: "Roboto, sans-serif" };

  switch (block.type) {
    case "banner":
      return block.data.img ? (
        <img src={block.data.img} alt={block.data.alt} style={{ ...s, width: "100%", display: "block" }} />
      ) : (
        <div style={{ ...s, height: 140, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>Ajoute une URL d&apos;image dans les réglages</div>
      );
    case "heading":
      return (
        <div style={{ ...s, padding: "24px 20px", textAlign: block.data.align }}>
          <h2 style={{ fontFamily: "Poppins", fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 10px" }}>{block.data.title}</h2>
          <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>{block.data.body}</p>
        </div>
      );
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
        <div style={{ ...s, padding: "12px 20px", textAlign: "center" }}>
          <span style={{ display: "inline-block", background: block.data.bg, color: block.data.color, padding: "12px 28px", borderRadius: 10, fontFamily: "Poppins", fontWeight: 600, fontSize: 13 }}>{block.data.label} →</span>
        </div>
      );
    case "products": {
      if (block.data.productIds.length === 0) {
        return <div style={{ ...s, padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Aucun produit sélectionné — choisis-en dans les réglages.</div>;
      }
      onLoadProducts(block.data.productIds);
      const products = block.data.productIds.map((id) => productsCache.get(id)).filter(Boolean) as ProductLite[];
      const cols = block.data.cols;
      return (
        <div style={{ ...s, padding: "12px 20px", display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
          {products.map((p) => (
            <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
              {p.imagePath ? (
                <img src={p.imagePath} alt="" style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }} />
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
    case "imgtext":
      return (
        <div style={{ ...s, padding: "12px 20px", display: "flex", gap: 12, flexDirection: block.data.side === "left" ? "row" : "row-reverse" }}>
          <div style={{ width: "45%" }}>
            {block.data.img ? <img src={block.data.img} alt="" style={{ width: "100%", borderRadius: 8, display: "block" }} /> : <div style={{ height: 100, background: "#f1f5f9", borderRadius: 8 }} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "Poppins", fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{block.data.title}</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{block.data.body}</div>
          </div>
        </div>
      );
    case "list":
      return (
        <ul style={{ ...s, padding: "12px 20px", listStyle: "none", margin: 0 }}>
          {block.data.items.map((it, i) => (
            <li key={i} style={{ padding: "6px 0", fontSize: 14, color: "#334155", borderBottom: "1px solid #f1f5f9" }}>{it}</li>
          ))}
        </ul>
      );
    case "divider":
      return <hr style={{ ...s, border: "none", borderTop: "1px solid #e2e8f0", margin: "12px 20px" }} />;
    case "footer":
      return null;
  }
}

// ─────────────────────────────────────────────────────
// Panneau de réglages selon le type de bloc sélectionné
// ─────────────────────────────────────────────────────

function BlockSettings({ block, onUpdate }: { block: NewsletterBlock; onUpdate: (key: string, value: unknown) => void }) {
  switch (block.type) {
    case "banner":
      return (
        <div className="space-y-3">
          <Field label="URL de l'image">
            <input type="text" className="prop-input" value={block.data.img} onChange={(e) => onUpdate("img", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Texte alternatif (accessibilité)">
            <input type="text" className="prop-input" value={block.data.alt} onChange={(e) => onUpdate("alt", e.target.value)} />
          </Field>
        </div>
      );
    case "heading":
      return (
        <div className="space-y-3">
          <Field label="Titre">
            <input type="text" className="prop-input" value={block.data.title} onChange={(e) => onUpdate("title", e.target.value)} />
          </Field>
          <Field label="Paragraphe">
            <textarea rows={4} className="prop-input" value={block.data.body} onChange={(e) => onUpdate("body", e.target.value)} />
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
            <ColorSwatches value={block.data.bg} onChange={(c) => onUpdate("bg", c)} colors={["#0f172a", "#334155", "#64748b", "#b45309", "#7c2d12", "#065f46", "#701a75"]} />
          </Field>
        </div>
      );
    case "button":
      return (
        <div className="space-y-3">
          <Field label="Texte du bouton"><input type="text" className="prop-input" value={block.data.label} onChange={(e) => onUpdate("label", e.target.value)} /></Field>
          <Field label="Lien"><input type="text" className="prop-input" value={block.data.url} onChange={(e) => onUpdate("url", e.target.value)} placeholder="https://…" /></Field>
          <Field label="Couleur">
            <ColorSwatches value={block.data.bg} onChange={(c) => onUpdate("bg", c)} colors={["#0f172a", "#334155", "#b45309", "#065f46", "#7c2d12", "#e11d48"]} />
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
        </div>
      );
    case "imgtext":
      return (
        <div className="space-y-3">
          <Field label="URL de l'image"><input type="text" className="prop-input" value={block.data.img} onChange={(e) => onUpdate("img", e.target.value)} placeholder="https://…" /></Field>
          <Field label="Titre"><input type="text" className="prop-input" value={block.data.title} onChange={(e) => onUpdate("title", e.target.value)} /></Field>
          <Field label="Texte"><textarea rows={3} className="prop-input" value={block.data.body} onChange={(e) => onUpdate("body", e.target.value)} /></Field>
          <Field label="Position de l'image">
            <CustomSelect
              value={block.data.side}
              onChange={(v) => onUpdate("side", v)}
              options={[{ value: "left", label: "← Image gauche" }, { value: "right", label: "Image droite →" }]}
              size="sm"
            />
          </Field>
        </div>
      );
    case "list":
      return (
        <Field label="Un item par ligne (commence par un emoji)">
          <textarea
            rows={6}
            className="prop-input"
            value={block.data.items.join("\n")}
            onChange={(e) => onUpdate("items", e.target.value.split("\n"))}
          />
        </Field>
      );
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

function ColorSwatches({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-7 h-7 rounded-md border-2 transition-transform ${value === c ? "border-slate-900 scale-110" : "border-transparent"}`}
          style={{ background: c }}
          title={c}
        />
      ))}
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
