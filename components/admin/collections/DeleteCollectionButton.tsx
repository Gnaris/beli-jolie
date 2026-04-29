"use client";

import { deleteCollection } from "@/app/actions/admin/collections";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export default function DeleteCollectionButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const { confirm } = useConfirm();
  const { success, error } = useToast();

  async function handleClick() {
    const ok = await confirm({
      type: "danger",
      title: `Supprimer « ${name} » ?`,
      message: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
    });
    if (!ok) return;

    // P2-10 : sans try/catch, une erreur serveur fermait silencieusement
    // la modale et l'admin pensait que ça avait marché.
    try {
      await deleteCollection(id);
      success("Collection supprimée", `« ${name} » a été retirée.`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Erreur inconnue";
      error("Suppression impossible", detail);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleClick(); }}
      className="text-xs font-medium text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 transition-colors font-body"
    >
      Supprimer
    </button>
  );
}
