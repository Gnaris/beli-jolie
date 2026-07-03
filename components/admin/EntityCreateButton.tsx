"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QuickCreateModal, { QuickCreateType } from "@/components/admin/products/QuickCreateModal";
import CategoryEditorModal from "@/components/admin/categories/CategoryEditorModal";
import CountryEditModal from "@/components/admin/manufacturing-countries/CountryEditModal";

interface EntityCreateButtonProps {
  type: QuickCreateType;
  label?: string;
  categoryId?: string;
  className?: string;
}

export default function EntityCreateButton({
  type,
  label = "Créer",
  categoryId,
  className = "btn-primary whitespace-nowrap",
}: EntityCreateButtonProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      {type === "category" ? (
        <CategoryEditorModal
          open={open}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); router.refresh(); }}
        />
      ) : type === "country" ? (
        <CountryEditModal
          open={open}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); router.refresh(); }}
        />
      ) : (
        <QuickCreateModal
          type={type}
          open={open}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); router.refresh(); }}
          categoryId={categoryId}
        />
      )}
    </>
  );
}
