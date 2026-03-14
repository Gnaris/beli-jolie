"use client";

import { deleteCollection } from "@/app/actions/admin/collections";

export default function DeleteCollectionButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  return (
    <form
      action={async () => {
        await deleteCollection(id);
      }}
    >
      <button
        type="submit"
        className="text-xs font-medium text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 transition-colors font-[family-name:var(--font-roboto)]"
        onClick={(e) => {
          if (!confirm(`Supprimer « ${name} » ? Cette action est irréversible.`)) {
            e.preventDefault();
          }
        }}
      >
        Supprimer
      </button>
    </form>
  );
}
