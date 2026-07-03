"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteTag, updateTagDirect } from "@/app/actions/admin/products";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import TranslateAllButton from "@/components/admin/TranslateAllButton";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface TagItem {
  id: string;
  name: string;
  productCount: number;
  translations: Record<string, string>;
}

type SortKey = "popular" | "az";

export default function TagsManager({ initialTags }: { initialTags: TagItem[] }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TagItem | null>(null);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("popular");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? initialTags.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            Object.values(t.translations).some((v) => v.toLowerCase().includes(q)),
        )
      : initialTags;
    const sorted = [...base];
    if (sort === "popular") {
      sorted.sort(
        (a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name, "fr"),
      );
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
    return sorted;
  }, [initialTags, search, sort]);

  async function handleDelete(tag: TagItem) {
    if (tag.productCount > 0) {
      setError(
        `Ce mot-clé est utilisé par ${tag.productCount} produit${tag.productCount > 1 ? "s" : ""}. Retirez-le des produits d'abord.`,
      );
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer ce mot-clé ?",
      message: `Le mot-clé « ${tag.name} » sera définitivement supprimé.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    setError("");
    setDeletingId(tag.id);
    deleteTag(tag.id)
      .then(() => router.refresh())
      .catch(() => setError("Erreur lors de la suppression."))
      .finally(() => setDeletingId(null));
  }

  async function handleSave(name: string, translations: Record<string, string>) {
    if (!editTarget) return;
    await updateTagDirect(editTarget.id, name, translations);
    router.refresh();
  }

  async function handleTranslateAll(
    translations: Record<string, Record<string, string>>,
  ) {
    const items = Object.entries(translations).map(([id, t]) => ({ id, translations: t }));
    await batchUpdateTranslations("tag", items);
    router.refresh();
  }

  return (
    <>
      {/* ── Barre d'actions ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative w-full sm:w-80">
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.6}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un mot-clé…"
            className="field-input w-full"
            style={{ paddingLeft: "2.25rem" }}
          />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <TranslateAllButton
            items={initialTags.map((t) => ({
              id: t.id,
              text: t.name,
              hasTranslations: Object.keys(t.translations).length > 0,
            }))}
            onTranslated={handleTranslateAll}
            label="Tout traduire"
            onlyMissing
          />
          <button
            type="button"
            onClick={() => {
              setError("");
              setCreateModalOpen(true);
            }}
            className="btn-primary shrink-0"
          >
            + Créer un mot-clé
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-[#EF4444] font-body px-1">{error}</p>}

      {/* ── Grille de cartes ── */}
      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted font-body py-6 text-center border border-dashed border-border rounded-2xl">
          {search.trim() ? "Aucun mot-clé trouvé" : "Aucun mot-clé pour l'instant."}
        </p>
      ) : (
        <section className="relative rounded-2xl bg-white border border-border overflow-hidden">
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: "linear-gradient(90deg,#34D399,#059669)" }}
          />

          <div className="px-5 md:px-6 pt-6 pb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span
                className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] font-body"
                style={{ color: "#047857" }}
              >
                <span
                  className="w-[3px] h-[14px] rounded-[3px]"
                  style={{ background: "linear-gradient(180deg,#34D399,#059669)" }}
                />
                Liste des mots-clés
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#F5F3EE] text-[#78716C] border border-[#E7E5E4] font-body">
                {filtered.length}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-text-muted font-body">
              <span>Trier par :</span>
              <button
                type="button"
                onClick={() => setSort("popular")}
                className={
                  sort === "popular"
                    ? "text-text-primary font-semibold underline"
                    : "hover:text-text-primary"
                }
              >
                Popularité
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => setSort("az")}
                className={
                  sort === "az"
                    ? "text-text-primary font-semibold underline"
                    : "hover:text-text-primary"
                }
              >
                A → Z
              </button>
            </div>
          </div>

          <div className="p-5 md:p-6 border-t border-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((tag) => (
              <TagCard
                key={tag.id}
                tag={tag}
                onEdit={() => {
                  setError("");
                  setEditTarget(tag);
                }}
                onDelete={() => handleDelete(tag)}
                deleting={deletingId === tag.id}
              />
            ))}
          </div>

          <div className="px-6 py-3 bg-[#FBFAF6] border-t border-border flex items-center justify-between text-[12px] text-text-muted font-body flex-wrap gap-2">
            <span>{filtered.length} mot{filtered.length !== 1 ? "s" : ""}-clé{filtered.length !== 1 ? "s" : ""} affiché{filtered.length !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex w-3 h-3 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700 text-[7px] items-center justify-center">✓</span>
                Traduit
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex w-3 h-3 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[7px] items-center justify-center font-bold">⚠</span>
                Sans traduction
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-100 border border-red-300" />
                Sans usage
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ── Modales ── */}
      <QuickCreateModal
        type="tag"
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={() => {
          setCreateModalOpen(false);
          router.refresh();
        }}
      />

      {editTarget && (
        <QuickCreateModal
          type="tag"
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          onCreated={() => {
            setEditTarget(null);
            router.refresh();
          }}
          editMode={{
            id: editTarget.id,
            name: editTarget.name,
            translations: editTarget.translations,
            onSave: handleSave,
          }}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Carte mot-clé
// ────────────────────────────────────────────────────────────────

function TagCard({
  tag,
  onEdit,
  onDelete,
  deleting,
}: {
  tag: TagItem;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const orphan = tag.productCount === 0;
  const hot = tag.productCount >= 100;
  const enName = tag.translations["en"];
  const translated = Object.keys(tag.translations).length > 0;

  return (
    <div
      className={`relative rounded-2xl border p-4 transition-all ${orphan ? "" : "bg-white"}`}
      style={
        orphan
          ? {
              background: "#FFF8F5",
              borderColor: "#FED7C4",
            }
          : { borderColor: "var(--border, #E5DFD3)" }
      }
    >
      {/* Hash badge en haut à gauche */}
      <span
        className="absolute top-2.5 left-3 inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold font-mono border"
        style={
          orphan
            ? { background: "linear-gradient(135deg,#FEF2F2,#FEE2E2)", color: "#B91C1C", borderColor: "#FECACA" }
            : { background: "linear-gradient(135deg,#ECFDF5,#D1FAE5)", color: "#059669", borderColor: "#A7F3D0" }
        }
        aria-hidden
      >
        #
      </span>

      <div className="pt-4 flex items-center justify-between gap-2">
        <span
          className={`font-semibold text-[15px] truncate font-body ${orphan ? "text-text-secondary" : "text-text-primary"}`}
          title={tag.name}
        >
          {tag.name}
        </span>
        {translated ? (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700 text-[10px] shrink-0"
            title="Traduit"
            aria-label="Traduit"
          >
            ✓
          </span>
        ) : (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[10px] font-bold shrink-0"
            title="Aucune traduction"
            aria-label="Aucune traduction"
          >
            ⚠
          </span>
        )}
      </div>
      <div className="text-[11px] text-text-muted mt-0.5 mb-3 truncate font-body">
        {enName || "—"}
      </div>

      <div className="flex items-center justify-between gap-2">
        {orphan ? (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold border font-body"
            style={{ background: "#FEF2F2", color: "#B91C1C", borderColor: "#FECACA" }}
          >
            0 · inutilisé
          </span>
        ) : (
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border font-body"
            style={
              hot
                ? { background: "linear-gradient(135deg,#DCFCE7,#BBF7D0)", color: "#15803D", borderColor: "#A7F3D0" }
                : { background: "#F5F3EE", color: "#78716C", borderColor: "#E7E5E4" }
            }
            title={`${tag.productCount} produit${tag.productCount > 1 ? "s" : ""}`}
          >
            {tag.productCount}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
            title="Modifier"
            aria-label={`Modifier le mot-clé ${tag.name}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting || tag.productCount > 0}
            title={tag.productCount > 0 ? "Impossible — utilisé par des produits" : "Supprimer"}
            aria-label={`Supprimer le mot-clé ${tag.name}`}
            className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-text-muted hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
