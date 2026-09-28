"use client";

/**
 * Picker en arbre pour choisir une cible de lien (Accueil / Panier / Produits /
 * Catégorie précise / Collection précise / À propos / Contact / URL libre).
 *
 * Historiquement inline dans l'éditeur newsletter, extrait pour être réutilisé
 * depuis d'autres endroits (modèles WhatsApp notamment). Le composant est
 * agnostique du contexte d'appel : il rend `newHref` via `onValidate` — c'est
 * au caller de décider quoi en faire (récrire le href d'une <a>, insérer dans
 * un textarea, copier dans le presse-papier, etc.).
 */

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  listCategoriesForLink,
  listCollectionsForLink,
  searchProductsForLink,
  type CategoryLinkOption,
  type CollectionLinkOption,
  type ProductLinkOption,
} from "@/app/actions/admin/newsletter-links";
import {
  buildLinkUrl,
  describeLinkTarget,
  type LinkTarget,
} from "@/lib/newsletter-link-targets";

type PickerParent = "home" | "cart" | "products" | "categories" | "collections" | "about" | "contact" | "custom";

export interface LinkPickerModalProps {
  /** URL actuellement associée à l'élément — sert à pré-remplir l'input « URL libre » si custom. Vide accepté. */
  currentHref: string;
  /** Base URL absolue de la boutique (ex. `https://beliandjolie.com`). Vide → URL retournée en relatif (`/fr/…`). */
  baseUrl: string;
  onClose: () => void;
  onValidate: (newHref: string) => void;
}

export default function LinkPickerModal({
  currentHref,
  baseUrl,
  onClose,
  onValidate,
}: LinkPickerModalProps) {
  const toast = useToast();
  const [selected, setSelected] = useState<LinkTarget | null>(null);
  const [expanded, setExpanded] = useState<PickerParent | null>(null);

  const [productQuery, setProductQuery] = useState("");
  const [products, setProducts] = useState<ProductLinkOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const [categories, setCategories] = useState<CategoryLinkOption[]>([]);
  const [collections, setCollections] = useState<CollectionLinkOption[]>([]);

  // Input « Lien personnalisé ». Pré-rempli si l'URL actuelle ressemble à une
  // URL absolue déjà tapée à la main (http/https/mailto/tel) — évite à la
  // cliente de tout retaper pour un simple changement de destination.
  const [customUrl, setCustomUrl] = useState<string>(() => {
    const t = currentHref.trim();
    return /^(https?:|mailto:|tel:)/i.test(t) ? t : "";
  });

  useEffect(() => {
    if (expanded !== "products") return;
    setProductsLoading(true);
    const t = setTimeout(() => {
      searchProductsForLink(productQuery)
        .then((rows) => setProducts(rows))
        .finally(() => setProductsLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [expanded, productQuery]);

  useEffect(() => {
    if (expanded !== "categories" || categories.length > 0) return;
    listCategoriesForLink().then(setCategories).catch(() => {});
  }, [expanded, categories.length]);

  useEffect(() => {
    if (expanded !== "collections" || collections.length > 0) return;
    listCollectionsForLink().then(setCollections).catch(() => {});
  }, [expanded, collections.length]);

  const canValidate =
    selected !== null &&
    !(selected.kind === "custom" && selected.url.trim().length === 0);

  const handleValidate = () => {
    if (!selected) {
      toast.error("Sélection incomplète", "Choisis une cible dans l'arbre.");
      return;
    }
    if (selected.kind === "custom" && selected.url.trim().length === 0) {
      toast.error("URL manquante", "Colle une URL complète (avec https://…) dans le champ Lien personnalisé.");
      return;
    }
    const newHref = buildLinkUrl(baseUrl || "", selected);
    onValidate(newHref);
  };

  const parentButton = (
    id: PickerParent,
    label: string,
    icon: string,
    hasChildren: boolean,
    directTarget: LinkTarget | null,
  ) => {
    const isExpanded = expanded === id;
    const isPickedDirectly = directTarget !== null && selected !== null && selected.kind === directTarget.kind;
    return (
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 p-2.5">
          <button
            type="button"
            onClick={() => {
              if (hasChildren) {
                setExpanded(isExpanded ? null : id);
              }
              if (directTarget) setSelected(directTarget);
            }}
            className={`flex-1 flex items-center gap-2 text-left ${isPickedDirectly ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
          >
            <span aria-hidden>{icon}</span>
            <span className="text-sm">{label}</span>
            {hasChildren && (
              <span className="text-xs text-text-muted ml-auto">
                {isExpanded ? "▼" : "▶"}
              </span>
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border">
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Configurer un lien</div>
          <div className="text-sm font-heading font-semibold text-text-primary">Choisis la cible</div>
          {currentHref.trim() && (
            <div className="text-xs text-text-muted mt-1">
              URL actuelle : <code className="text-[11px] bg-bg-secondary rounded px-1 py-0.5 break-all">{currentHref}</code>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {parentButton("home", "Accueil", "🏠", false, { kind: "home" })}
          {parentButton("cart", "Panier", "🛒", false, { kind: "cart" })}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => setSelected({ kind: "products" })}
                className={`text-sm ${selected?.kind === "products" ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
              >
                📦 Tous les produits
              </button>
              <button
                type="button"
                onClick={() => setExpanded(expanded === "products" ? null : "products")}
                className="ml-auto text-xs text-text-muted"
              >
                {expanded === "products" ? "▼ filtre / produit précis" : "▶ ou filtre / produit précis"}
              </button>
            </div>
            {expanded === "products" && (
              <div className="p-2 border-t border-border bg-bg-secondary space-y-2">
                {/* Raccourci filtre nouveautés : /produits?new=1 */}
                <button
                  type="button"
                  onClick={() => setSelected({ kind: "productsNew" })}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-1.5 ${selected?.kind === "productsNew" ? "bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold" : "bg-bg-primary hover:bg-emerald-50/40 border border-border"}`}
                >
                  <span aria-hidden>✨</span>
                  <span>Nouveautés</span>
                  <span className="text-text-muted ml-1 font-normal">— filtre « nouvelles arrivées »</span>
                </button>
                <input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Chercher par nom ou référence…"
                  className="w-full rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm"
                />
                {productsLoading && <div className="text-xs text-text-muted">Chargement…</div>}
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {products.map((p) => {
                    const isSel = selected?.kind === "product" && selected.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelected({ kind: "product", id: p.id, name: p.name, reference: p.reference, handle: p.handle })}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded ${isSel ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "hover:bg-bg-primary"}`}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-text-muted ml-1">— {p.reference}</span>
                      </button>
                    );
                  })}
                  {!productsLoading && products.length === 0 && (
                    <div className="text-xs text-text-muted italic px-2">Aucun résultat.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => setSelected({ kind: "categories" })}
                className={`text-sm ${selected?.kind === "categories" ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
              >
                📂 Toutes les catégories
              </button>
              <button
                type="button"
                onClick={() => setExpanded(expanded === "categories" ? null : "categories")}
                className="ml-auto text-xs text-text-muted"
              >
                {expanded === "categories" ? "▼ une catégorie précise" : "▶ ou une catégorie précise"}
              </button>
            </div>
            {expanded === "categories" && (
              <div className="p-2 border-t border-border bg-bg-secondary">
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {categories.map((c) => {
                    const isSel = selected?.kind === "category" && selected.id === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelected({ kind: "category", id: c.id, name: c.name, slug: c.slug })}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded ${isSel ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "hover:bg-bg-primary"}`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                  {categories.length === 0 && (
                    <div className="text-xs text-text-muted italic px-2">Aucune catégorie.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => setSelected({ kind: "collections" })}
                className={`text-sm ${selected?.kind === "collections" ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
              >
                ✨ Toutes les collections
              </button>
              <button
                type="button"
                onClick={() => setExpanded(expanded === "collections" ? null : "collections")}
                className="ml-auto text-xs text-text-muted"
              >
                {expanded === "collections" ? "▼ une collection précise" : "▶ ou une collection précise"}
              </button>
            </div>
            {expanded === "collections" && (
              <div className="p-2 border-t border-border bg-bg-secondary">
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {collections.map((c) => {
                    const isSel = selected?.kind === "collection" && selected.id === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelected({ kind: "collection", id: c.id, name: c.name, slug: c.slug })}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded ${isSel ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "hover:bg-bg-primary"}`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                  {collections.length === 0 && (
                    <div className="text-xs text-text-muted italic px-2">Aucune collection.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          {parentButton("about", "Qui sommes-nous", "ℹ️", false, { kind: "about" })}
          {parentButton("contact", "Nous contacter", "📞", false, { kind: "contact" })}

          {/* Lien personnalisé : URL libre (domaine inclus). Utilisé pour les
              cas hors-boutique (Instagram, WhatsApp, page événement, PDF…). */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => setExpanded(expanded === "custom" ? null : "custom")}
                className={`flex-1 flex items-center gap-2 text-left ${selected?.kind === "custom" ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
              >
                <span aria-hidden>🔗</span>
                <span className="text-sm">Lien personnalisé (URL libre)</span>
                <span className="text-xs text-text-muted ml-auto">
                  {expanded === "custom" ? "▼" : "▶"}
                </span>
              </button>
            </div>
            {expanded === "custom" && (
              <div className="p-3 border-t border-border bg-bg-secondary space-y-1.5">
                <input
                  type="url"
                  inputMode="url"
                  value={customUrl}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomUrl(v);
                    setSelected({ kind: "custom", url: v });
                  }}
                  onFocus={() => setSelected({ kind: "custom", url: customUrl })}
                  placeholder="https://exemple.com/ma-page"
                  className="w-full rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm"
                />
                <div className="text-[11px] text-text-muted">
                  Colle l&apos;URL complète (avec <code className="bg-bg-primary rounded px-1">https://</code>).
                  Aussi accepté : <code className="bg-bg-primary rounded px-1">mailto:</code>,{" "}
                  <code className="bg-bg-primary rounded px-1">tel:</code>.
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="p-4 border-t border-border flex items-center justify-between gap-3">
          <div className="text-xs text-text-muted min-w-0 truncate flex-1">
            {selected ? (
              <>
                <span className="text-text-primary font-medium">{describeLinkTarget(selected)}</span>
                <span className="ml-2 text-text-muted">→ {buildLinkUrl(baseUrl || "https://…", selected)}</span>
              </>
            ) : (
              "Choisis une cible dans la liste ci-dessus"
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded border border-border hover:bg-bg-secondary"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleValidate}
              disabled={!canValidate}
              className="text-sm px-3 py-1.5 rounded bg-bg-dark text-text-inverse hover:bg-text-primary disabled:opacity-40"
            >
              Valider
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
