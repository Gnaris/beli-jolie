"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteHsCode } from "@/app/actions/admin/hs-codes";
import HsCodeModal from "./HsCodeModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Item {
  id: string;
  code: string;
  label: string;
  productCount: number;
}

export default function HsCodesManager({ initialItems }: { initialItems: Item[] }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Item | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const filtered = search.trim()
    ? initialItems.filter((i) => {
        const q = search.trim().toLowerCase();
        return i.code.includes(q) || i.label.toLowerCase().includes(q);
      })
    : initialItems;

  async function handleDelete(item: Item) {
    const detail =
      item.productCount > 0
        ? `Ce code est utilisé par ${item.productCount} produit${
            item.productCount > 1 ? "s" : ""
          }. Ils perdront leur code SH.`
        : "Ce code n'est utilisé par aucun produit.";
    const ok = await confirm({
      type: "danger",
      title: "Supprimer ce code SH ?",
      message: `${item.code} — ${item.label}\n${detail}`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    setError("");
    setDeletingId(item.id);
    try {
      await deleteHsCode(item.id);
      router.refresh();
    } catch {
      setError("Erreur lors de la suppression.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative flex-1 max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (numéro ou libellé)…"
            className="field-input w-full"
            style={{ paddingLeft: "2.25rem" }}
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
        </div>
        <button
          type="button"
          className="btn-primary whitespace-nowrap"
          onClick={() => setCreateOpen(true)}
        >
          + Nouveau code SH
        </button>
      </div>

      {error && (
        <p className="text-xs text-[#EF4444] font-body px-1 mb-2">{error}</p>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted font-body py-6 text-center border border-dashed border-border rounded-xl">
          {search.trim()
            ? "Aucun code SH trouvé"
            : "Aucun code SH. Cliquez sur « + Nouveau code SH »."}
        </p>
      ) : (
        <div className="border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">
                    Numéro
                  </th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">
                    Libellé
                  </th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">
                    Produits
                  </th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-bg-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-text-primary">{item.code}</td>
                    <td className="px-4 py-3 text-text-primary">{item.label}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="badge badge-neutral text-[10px]">
                        {item.productCount}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => setEditTarget(item)}
                          className="p-2 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-bg-secondary"
                          title="Modifier"
                          aria-label={`Modifier le code ${item.code}`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          disabled={deletingId === item.id}
                          title="Supprimer"
                          aria-label={`Supprimer le code ${item.code}`}
                          className="p-2 text-text-muted hover:text-[#EF4444] transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-bg-secondary"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <HsCodeModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />
      <HsCodeModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          router.refresh();
        }}
        editMode={editTarget}
      />
    </>
  );
}
