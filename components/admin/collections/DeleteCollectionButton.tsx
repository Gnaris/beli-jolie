"use client";

import { deleteCollection } from "@/app/actions/admin/collections";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export default function DeleteCollectionButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const { confirm } = useConfirm();

  async function handleClick() {
    const ok = await confirm({
      type: "danger",
      title: `Supprimer « ${name} » ?`,
      message: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
    });
    if (ok) await deleteCollection(id);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-xs font-medium text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 transition-colors font-[family-name:var(--font-roboto)]"
    >
      Supprimer
    </button>
  );
}
