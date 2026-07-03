"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import HsCodesList from "./HsCodesList";
import HsCodeDetail, { type HsCodeDetailData } from "./HsCodeDetail";
import HsCodeModal from "./HsCodeModal";
import { deleteHsCode, reorderHsCodes } from "@/app/actions/admin/hs-codes";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export type HsCodeItem = {
  id: string;
  code: string;
  label: string;
  productCount: number;
  position: number;
  createdAt: Date;
};

type Props = {
  initialItems: HsCodeItem[];
};

export default function HsCodesMasterDetail({ initialItems }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [, startTransition] = useTransition();

  // Copie locale pour permettre l'optimistic update lors du drag & drop.
  const [items, setItems] = useState<HsCodeItem[]>(initialItems);
  useEffect(() => { setItems(initialItems); }, [initialItems]);

  const urlSelectedId = searchParams.get("code");
  const initialSelectedId = urlSelectedId ?? initialItems[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<HsCodeItem | null>(null);

  useEffect(() => {
    if (urlSelectedId && urlSelectedId !== selectedId) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId]);

  useEffect(() => {
    if (selectedId && !items.some((i) => i.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("code");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, items, pathname, router, searchParams]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("code", id);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  function handleBack() {
    setSelectedId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("code");
    window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  async function handleDelete(item: HsCodeItem) {
    if (item.productCount > 0) {
      toast.error(
        "Impossible",
        `« ${item.code} » est attribué à ${item.productCount} produit${item.productCount > 1 ? "s" : ""}.`,
      );
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer ce code SH ?",
      message: `« ${item.code} — ${item.label} » sera définitivement supprimé.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    try {
      await deleteHsCode(item.id);
      toast.success("Code SH supprimé.");
      const remaining = items.filter((c) => c.id !== item.id);
      setSelectedId(remaining[0]?.id ?? null);
      router.refresh();
    } catch (err) {
      toast.error("Erreur", (err as Error).message);
    }
  }

  function handleReorder(newOrderedIds: string[]) {
    // Optimistic — recalcul immédiat des positions.
    const positionMap = new Map(newOrderedIds.map((id, i) => [id, i]));
    const previous = items;
    setItems((prev) =>
      prev.map((i) => ({ ...i, position: positionMap.get(i.id) ?? i.position })),
    );
    startTransition(async () => {
      try {
        await reorderHsCodes(newOrderedIds);
      } catch (err) {
        setItems(previous);
        toast.error("Erreur", (err as Error).message);
      }
    });
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const selectedDetail: HsCodeDetailData | null = selected
    ? {
        id: selected.id,
        code: selected.code,
        label: selected.label,
        productCount: selected.productCount,
        createdAt: selected.createdAt,
      }
    : null;

  return (
    <>
      <div
        className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-bg-primary border border-border rounded-3xl overflow-hidden md:h-[calc(100vh-22rem)] md:min-h-[600px]"
        style={{ boxShadow: "var(--shadow-pop)" }}
      >
        {/* Master (list) */}
        <div className={`${selectedId ? "hidden" : "block"} md:block md:border-r md:border-border md:min-h-0 md:h-full md:overflow-hidden`}>
          <HsCodesList
            items={items}
            selectedId={selectedId}
            onSelect={handleSelect}
            onReorder={handleReorder}
          />
        </div>

        {/* Detail pane */}
        <div className={`${selectedId ? "block" : "hidden"} md:block md:min-h-0 md:h-full md:overflow-hidden`}>
          {selectedDetail && selected ? (
            <HsCodeDetail
              item={selectedDetail}
              showBackButton={!!selectedId}
              onBack={handleBack}
              onEdit={() => setEditTarget(selected)}
              onDelete={() => handleDelete(selected)}
            />
          ) : (
            <div className="hidden md:flex flex-col items-center justify-center h-full min-h-[600px] text-text-muted text-sm">
              Sélectionnez un code SH à gauche.
            </div>
          )}
        </div>
      </div>

      {/* Modale création */}
      <HsCodeModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(created) => {
          setCreateOpen(false);
          if (created?.id) handleSelect(created.id);
          router.refresh();
        }}
      />

      {/* Modale édition */}
      <HsCodeModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          router.refresh();
        }}
        editMode={editTarget}
      />

      {/* Trigger invisible pour le bouton « Nouveau code SH » du header de page */}
      <button
        type="button"
        data-trigger-create-hscode
        className="hidden"
        onClick={() => setCreateOpen(true)}
      />
    </>
  );
}
